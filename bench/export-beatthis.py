# One-off dev-time export: a Beat This! checkpoint -> ONNX, matching the graph the shipped
# beat_this.onnx presents. Never committed; the artefact lands in models/ beside the others.
# Upstream is MIT (CPJKU/beat_this), so the export is unencumbered.
#
#   uv run --python 3.12 --with torch --with onnx --with onnxruntime \
#     --with "beat_this @ https://github.com/CPJKU/beat_this/archive/main.zip" \
#     python bench/export-beatthis.py --checkpoint small0
#
# Why this exists: the shipped graph came from a third-party export, so there was no way to
# try the distilled checkpoint without redoing that work. small0 is 2.1 M parameters against
# final0's 20.3 M - a tenth of the download - and the paper reports it "still gives SOTA F1
# scores". Whether that survives THIS decode path, resampler and peak picker is what
# bench/beatscore.ts is for; this only produces the graph to ask with.
import argparse
from pathlib import Path

import numpy as np
import torch
from beat_this.inference import load_model
from beat_this.model import beat_tracker

# The window the host feeds, one per call: batching materialises an attention tensor of
# windows x 32 x 1500 x 1500 floats, which is gigabytes on a long track.
CHUNK = 1500
MEL_BINS = 128

parser = argparse.ArgumentParser()
parser.add_argument('--checkpoint', default='small0')
parser.add_argument('--out', default=None)
args = parser.parse_args()

# `PartialTransformer.forward` and `PartialFTTransformer.forward` both read the batch size as
# `b = len(x)`, a PYTHON int, which the tracer folds into a constant. The published export
# rewrites that as a shape read because it takes a variable WINDOW axis. This one does not:
# the host feeds exactly one window per call, so batch 1 is the contract rather than a
# limitation, and the folded constant is the truth. The parity check at the bottom is what
# says so rather than this comment.
assert hasattr(beat_tracker, 'PartialFTTransformer'), 'upstream layout moved; re-read the forwards'

model = load_model(args.checkpoint, 'cpu')
model.eval()
params = sum(p.numel() for p in model.parameters())
print(f'{args.checkpoint}: {params} parameters ({params * 4 / 1e6:.1f} MB fp32)')


class Wrapped(torch.nn.Module):
    """The reference returns a dict; ONNX wants named outputs in a fixed order."""

    def __init__(self, inner):
        super().__init__()
        self.inner = inner

    def forward(self, spect):
        out = self.inner(spect)
        return out['beat'], out['downbeat']


wrapped = Wrapped(model).eval()
example = torch.randn(1, CHUNK, MEL_BINS)

out = Path(args.out or f'models/beat_this_{args.checkpoint}.onnx')
out.parent.mkdir(parents=True, exist_ok=True)
torch.onnx.export(
    wrapped,
    (example,),
    str(out),
    input_names=['spect'],
    output_names=['beat', 'downbeat'],
    opset_version=17,
    dynamo=False
)
print(f'wrote {out} ({out.stat().st_size / 1e6:.1f} MB)')

# Parity against torch on the same input, because an export that silently substitutes an
# approximation is worth less than no export at all.
import onnxruntime as ort  # noqa: E402

session = ort.InferenceSession(str(out), providers=['CPUExecutionProvider'])
worst = 0.0
for seed in range(3):
    torch.manual_seed(seed)
    probe = torch.randn(1, CHUNK, MEL_BINS)
    with torch.no_grad():
        ref = wrapped(probe)
    got = session.run(None, {'spect': probe.numpy()})
    for a, b in zip(ref, got):
        worst = max(worst, float(np.abs(a.numpy() - b).max()))
print(f'max abs error vs torch over 3 probes: {worst:.3g}')
