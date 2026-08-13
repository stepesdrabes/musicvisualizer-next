# One-off dev-time export: MusicFM conformer (layer-9 hidden states) + section head -> ONNX.
# Never shipped in the repo; the graphs land in models/ beside the other optional weights.
# MIT upstream (ByteDance MusicFM), so unlike ADTOF the artefact itself is unencumbered.
#
#   uv run --python 3.12 --with torch --with torchaudio --with transformers \
#     --with einops --with onnx --with onnxruntime python bench/export-musicfm.py
#
# The encoder needs a DYNAMIC time axis: extract-musicfm.py fed variable-length pieces
# (35 s at the track head, 40 s interior, whatever remained at the tail), and the head
# was trained on those numerics, so a fixed-window graph would put unfamiliar edge
# effects exactly where intro and outro live. The HF conformer's rotary embedding caches
# its table behind a Python length check, which a legacy trace constant-folds, so the
# module is patched to compute positions unconditionally and the export goes through
# dynamo. The mel frontend does NOT export - the TS port recomputes it - so the graph
# input is the NORMALISED mel: (AmplitudeToDB(MelSpectrogram(wav))[..., :-1] - mean) / std.
import json
import sys
from pathlib import Path

import numpy as np
import torch

ROOT = Path(__file__).parent
REPO = ROOT.parent
sys.path.insert(0, str(ROOT / '.musicfm-src'))

from musicfm.model.musicfm_25hz import MusicFM25Hz  # noqa: E402

OUT = REPO / 'models'
OUT.mkdir(parents=True, exist_ok=True)
PROBE_DIR = ROOT / 'corpus' / '.musicfm'

SR = 24000
HOP = 240
WIN_S = 30
PAD_S = 5
POOL = 3
LAYER = 9
MEL_T = WIN_S * SR // HOP  # 3000 frames after the [..., :-1] drop
ENC_T = MEL_T // 4  # 750 frames at 25 Hz

stats = json.load(open(ROOT / '.musicfm-weights' / 'msd_stats.json'))
MEAN = stats['melspec_2048_mean']
STD = stats['melspec_2048_std']

HEAD_ONLY = '--head-only' in sys.argv

model = MusicFM25Hz(
    is_flash=False,
    stat_path=str(ROOT / '.musicfm-weights' / 'msd_stats.json'),
    model_path=str(ROOT / '.musicfm-weights' / 'pretrained_msd.pt'),
)
model.eval()


class Encoder(torch.nn.Module):
    """conv subsample + conformer, returning the one hidden layer the head was trained on."""

    def __init__(self, m: MusicFM25Hz, layer: int):
        super().__init__()
        self.conv = m.conv
        self.conformer = m.conformer
        self.layer = layer

    def forward(self, mel_norm):  # [1, 128, MEL_T]
        x = self.conv(mel_norm)
        out = self.conformer(x, output_hidden_states=True)
        return out['hidden_states'][self.layer]  # [1, ENC_T, 1024]


encoder = Encoder(model, LAYER).eval()

# The rotary cache: `if sequence_length == self.cached_sequence_length` is Python control
# flow over a symbolic dimension, which no exporter can keep. Recomputing every call is
# what the cache was saving anyway, and export happens once.
from transformers.models.wav2vec2_conformer import modeling_wav2vec2_conformer as w2v2c  # noqa: E402


def rotary_forward(self, hidden_states):
    sequence_length = hidden_states.shape[1]
    time_stamps = torch.arange(sequence_length, device=hidden_states.device).type_as(self.inv_freq)
    freqs = torch.einsum('i,j->ij', time_stamps, self.inv_freq)
    embeddings = torch.cat((freqs, freqs), dim=-1)
    cos_embeddings = embeddings.cos()[:, None, None, :]
    sin_embeddings = embeddings.sin()[:, None, None, :]
    return torch.stack((cos_embeddings, sin_embeddings)).type_as(hidden_states)


w2v2c.Wav2Vec2ConformerRotaryPositionalEmbedding.forward = rotary_forward

example = torch.randn(1, 128, MEL_T)
with torch.no_grad():
    ref = encoder(example)
print('encoder output', tuple(ref.shape))
assert tuple(ref.shape) == (1, ENC_T, 1024)

if not HEAD_ONLY:
    torch.onnx.export(
        encoder,
        (example,),
        str(OUT / 'musicfm_encoder.onnx'),
        input_names=['mel_norm'],
        output_names=['hidden'],
        dynamic_shapes={'mel_norm': {2: torch.export.Dim('time', min=256, max=4096)}},
        opset_version=17,
        dynamo=True,
    )
    print('exported musicfm_encoder.onnx')

    # int8 weights: the fp32 graph is 1.3 GB, the quantised one ships in ~a quarter of it.
    from onnxruntime.quantization import QuantType, quantize_dynamic  # noqa: E402

    quantize_dynamic(
        str(OUT / 'musicfm_encoder.onnx'),
        str(OUT / 'musicfm_encoder_int8.onnx'),
        weight_type=QuantType.QInt8,
    )
    print('exported musicfm_encoder_int8.onnx')

# --- the section head, dynamic time axis (it reads a whole track at 8.33 Hz) ----------
sys.path.insert(0, str(ROOT))
head_cfg = json.load(open(PROBE_DIR / 'sectionhead.json'))


class SectionHead(torch.nn.Module):
    def __init__(self, dim=1024, width=256, classes=len(head_cfg['kinds'])):
        super().__init__()
        self.proj = torch.nn.Linear(dim + 1, width)
        layer = torch.nn.TransformerEncoderLayer(
            d_model=width, nhead=4, dim_feedforward=512, dropout=0.1,
            batch_first=True, norm_first=True, activation='gelu',
        )
        self.encoder = torch.nn.TransformerEncoder(layer, num_layers=2)
        self.out = torch.nn.Linear(width, classes)

    def forward(self, x):  # [1, t, dim+1]
        return self.out(self.encoder(self.proj(x)))


head = SectionHead()
head.load_state_dict(torch.load(PROBE_DIR / 'sectionhead.pt', map_location='cpu'))
head.eval()

# dynamo, not the legacy tracer: nn.MultiheadAttention reshapes with Python ints, which
# a trace bakes in - the first track longer than the example then fails inside the graph.
head_example = torch.randn(1, 400, 1025)
with torch.no_grad():
    head_ref = head(head_example)
torch.onnx.export(
    head,
    (head_example,),
    str(OUT / 'musicfm_sectionhead.onnx'),
    input_names=['emb_pos'],
    output_names=['logits'],
    dynamic_shapes={'x': {1: torch.export.Dim('time', min=8, max=16384)}},
    opset_version=17,
    dynamo=True,
)
print('exported musicfm_sectionhead.onnx')

# --- probes -----------------------------------------------------------------------------
# Three parity targets, one per seam the TS port can get wrong on its own:
#  1. audio -> mel (the torchaudio frontend the TS code reimplements),
#  2. normalised mel -> hidden (the exported encoder graph),
#  3. embedding+position -> logits (the exported head graph).
rng = np.random.default_rng(7)
wav = (rng.standard_normal(WIN_S * SR) * 0.1).astype(np.float32)
with torch.no_grad():
    mel = model.preprocessor_melspec_2048(torch.from_numpy(wav)[None])[..., :-1]
mel_np = mel.numpy()
mel_norm = ((mel - MEAN) / STD).float()
with torch.no_grad():
    hidden = encoder(mel_norm).numpy()

# Raw little-endian f32 with a shape manifest, so the TS parity test reads them with a
# Float32Array view instead of growing an npy parser.
wav.tofile(PROBE_DIR / 'probe_wav.bin')
mel_np.astype(np.float32).tofile(PROBE_DIR / 'probe_mel.bin')
hidden.astype(np.float32).tofile(PROBE_DIR / 'probe_hidden.bin')
# The head probe crosses the TS side's PUBLIC seam: raw 1024-dim embeddings in,
# softmaxed posteriors out, with the position channel appended by each side itself.
head_emb = rng.standard_normal((400, 1024)).astype(np.float32)
pos = np.linspace(0, 1, 400, dtype=np.float32)[:, None]
head_in = np.concatenate([head_emb, pos], axis=1)[None]
with torch.no_grad():
    head_logits = head(torch.from_numpy(head_in))
    head_post = torch.softmax(head_logits, dim=-1).numpy()
head_emb.tofile(PROBE_DIR / 'probe_head_in.bin')
head_post.astype(np.float32).tofile(PROBE_DIR / 'probe_head_out.bin')
json.dump(
    {
        'wav': list(wav.shape),
        'mel': list(mel_np.shape),
        'hidden': list(hidden.shape),
        'headIn': list(head_emb.shape),
        'headOut': list(head_post.shape),
    },
    open(PROBE_DIR / 'probe_manifest.json', 'w'),
    indent=1,
)

# The exact filterbank torchaudio built, saved for the TS port to matmul rather than
# rederive: HTK mel arithmetic reimplemented by hand is exactly the parity bug the ADTOF
# port hit, and a saved matrix cannot drift.
fb = model.preprocessor_melspec_2048.mel_stft.mel_scale.fb  # [n_freqs=1025, n_mels=128]
fb.numpy().astype(np.float32).tofile(OUT / 'musicfm_mel_fb.bin')
print('wrote musicfm_mel_fb.bin', tuple(fb.shape))

# ONNX runtime cross-check right here, so a broken export never reaches the TS side.
import onnxruntime as ort  # noqa: E402

sess = ort.InferenceSession(str(OUT / 'musicfm_encoder.onnx'), providers=['CPUExecutionProvider'])
got = sess.run(None, {'mel_norm': mel_norm.numpy()})[0]
print('encoder onnx max err', float(np.abs(got - hidden).max()))

# The dynamic axis has to be proven at a second length, or a silently-pinned shape only
# fails on the first track whose tail window is short.
short = mel_norm[:, :, : 35 * SR // HOP]
with torch.no_grad():
    short_ref = encoder(short).numpy()
short_got = sess.run(None, {'mel_norm': short.numpy()})[0]
print('encoder onnx (short window) max err', float(np.abs(short_got - short_ref).max()))
sess8 = ort.InferenceSession(
    str(OUT / 'musicfm_encoder_int8.onnx'), providers=['CPUExecutionProvider']
)
got8 = sess8.run(None, {'mel_norm': mel_norm.numpy()})[0]
print('encoder int8 max err', float(np.abs(got8 - hidden).max()))
sess_head = ort.InferenceSession(
    str(OUT / 'musicfm_sectionhead.onnx'), providers=['CPUExecutionProvider']
)
got_head = sess_head.run(None, {'emb_pos': head_in})[0]
print('head onnx max err', float(np.abs(got_head - head_logits.numpy()).max()))

# One corpus track's stored training embedding as the end-to-end target: the TS port
# must reproduce the numbers the head actually learned from, windowing scheme included.
track_ref = sorted(PROBE_DIR.glob('harmonix-*.npz'))
if track_ref:
    d = np.load(track_ref[0])
    emb = d['emb'].astype(np.float32)
    emb.tofile(PROBE_DIR / 'probe_track_emb.bin')
    json.dump(
        {'id': track_ref[0].stem.removeprefix('harmonix-'), 'shape': list(emb.shape)},
        open(PROBE_DIR / 'probe_track.json', 'w'),
    )
    print('wrote probe_track_emb.bin for', track_ref[0].stem)

json.dump(
    {
        'sampleRate': SR,
        'nFft': 2048,
        'hopLength': HOP,
        'nMels': 128,
        'melMean': MEAN,
        'melStd': STD,
        'windowSeconds': WIN_S,
        'padSeconds': PAD_S,
        'pool': POOL,
        'layer': LAYER,
        'fps': 25 / POOL,
        'kinds': head_cfg['kinds'],
    },
    open(OUT / 'musicfm_config.json', 'w'),
    indent=1,
)
print('wrote musicfm_config.json')
