# How section-label accuracy scales with the NUMBER OF LABELLED TRACKS. The one question a
# hand-labelling loop needs answered before it starts: what does the 30th map buy that the
# 15th did not, and where does the curve flatten.
#
#   uv run --python 3.12 --with torch --with numpy python bench/learncurve.py
#
# Same head, same features and the same grouped-by-track split as train-sectionhead.py, but
# the training set is SUBSAMPLED to a ladder of sizes and each size is fitted several times
# from different draws. The test fold is held fixed per repeat, so the only thing moving
# between rungs is how many labelled tracks the head was shown.
#
# Read it as a SHAPE, not as a promise: these are Harmonix + Raveform annotations in someone
# else's vocabulary, so the absolute numbers do not transfer to hand-drawn maps. The curvature
# does - it is the same head, the same features and the same nine classes.
import json
import sys
from pathlib import Path

import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).parent))
import importlib.util

spec = importlib.util.spec_from_file_location('sh', Path(__file__).parent / 'train-sectionhead.py')
_src = (Path(__file__).parent / 'train-sectionhead.py').read_text()
# The trainer runs main() at import; take the definitions only.
_defs = _src.split('def main()')[0]
ns: dict = {'__file__': str(Path(__file__).parent / 'train-sectionhead.py')}
exec(compile(_defs, 'train-sectionhead.py', 'exec'), ns)

load_tracks = ns['load_tracks']
train_one = ns['train_one']
evaluate = ns['evaluate']
KINDS = ns['KINDS']

LADDER = [10, 20, 40, 80, 120, 160]
REPEATS = 3
EPOCHS = 8


def main():
    device = 'mps' if torch.backends.mps.is_available() else 'cpu'
    tracks = load_tracks()
    print(f'{len(tracks)} annotated tracks with embeddings, device {device}')

    rows = []
    for repeat in range(REPEATS):
        rng = np.random.default_rng(100 + repeat)
        order = rng.permutation(len(tracks))
        # A fixed fifth is the test set for this repeat; the pool is everything else.
        cut = len(tracks) // 5
        test = [tracks[i] for i in order[:cut]]
        pool = [tracks[i] for i in order[cut:]]
        rungs = [n for n in LADDER if n <= len(pool)] + [len(pool)]
        print(f'\nrepeat {repeat + 1}/{REPEATS}: test {len(test)}, pool {len(pool)}, rungs {rungs}')
        for n in rungs:
            # Nested draws: the n-track set is a PREFIX of the larger ones, so a rung
            # difference is the added tracks and not a different sample.
            train = pool[:n]
            model = train_one(train, device, epochs=EPOCHS, seed=repeat * 100 + n)
            acc, macro, f1, _ = evaluate(model, test, device)
            kinds_used = sum(1 for k in KINDS if f1[k] > 0.02)
            print(f'  n={n:3d}  acc {100 * acc:.1f}%  macroF1 {100 * macro:.1f}  live kinds {kinds_used}/9')
            rows.append({'repeat': repeat, 'n': n, 'acc': float(acc), 'macro': float(macro),
                         'f1': {k: float(v) for k, v in f1.items()}})
            del model

    print('\n=== learning curve (mean over repeats) ===')
    by_n: dict[int, list] = {}
    for r in rows:
        by_n.setdefault(r['n'], []).append(r)
    for n in sorted(by_n):
        accs = [r['acc'] for r in by_n[n]]
        macros = [r['macro'] for r in by_n[n]]
        print(f'  n={n:3d}  acc {100 * np.mean(accs):5.1f}% +-{100 * np.std(accs):4.1f}   '
              f'macroF1 {100 * np.mean(macros):5.1f} +-{100 * np.std(macros):4.1f}')

    out = Path(__file__).parent / 'corpus' / '.musicfm' / 'learncurve.json'
    json.dump(rows, open(out, 'w'), indent=1)
    print(f'\nwrote {out}')


main()
