# Dev-time: unpack the float16 corpus embeddings (extract-musicfm.py) into raw f32 .bin
# files the TS head-gate harness can mmap with a Float32Array view. Temporary artefacts
# beside the .npz they mirror; gitignored with the rest of bench/corpus/.musicfm.
#
#   uv run --python 3.12 --with numpy python bench/convert-embeddings.py
import json
from pathlib import Path

import numpy as np

SRC = Path(__file__).parent / 'corpus' / '.musicfm'
DST = SRC / 'bin'
DST.mkdir(exist_ok=True)

manifest = {}
done = 0
for f in sorted(SRC.glob('*.npz')):
    out = DST / f'{f.stem}.bin'
    d = np.load(f)
    emb = d['emb'].astype(np.float32)
    if not out.exists():
        emb.tofile(out)
    manifest[f.stem] = list(emb.shape)
    done += 1
json.dump(manifest, open(DST / 'manifest.json', 'w'), indent=1)
print(f'{done} tracks converted into {DST}')
