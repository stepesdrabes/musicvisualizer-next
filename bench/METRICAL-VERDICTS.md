# Metrical-level verdicts, decided by ear

No annotation exists for this repertoire, and the obvious objective proxy is biased: any
"how close is the nearest beat" measure prefers a faster grid mechanically, because a half-time
grid has twice the gap. So the disputed tracks were settled by listening to an A/B click test
(`bench/clicktest.ts`, current grid panned left at 1400 Hz, Beat This right at 700 Hz).

Judged by the repo owner, 2026-08-06.

| track | current | beat-this | correct | winner |
|---|---|---|---|---|
| `9lfkYc_eqLE` Obchodnik s destem | 175.7 | 88.2 | 88 | beat-this |
| `Yv2p-ffhj1M` Jedna Dva | 150.0 | 75.0 | 150 | current |
| `tNHXDNaNqsU` Take Me (To The Moon) | 87.5 | 176.5 | 176 | beat-this |
| `jojRxf2qvqs` Melanz | 120.2 | 79.0 | 120 | current |

Two each. Neither tracker is trustworthy on metrical level for this music, even though Beat This
is clearly better at beat phase, continuity and downbeats.

## The pattern

Beat This chose the slower reading in three of the four disputes and was right in one. Both
Czech rap tracks are cases where it halved and was wrong, which is the documented failure mode:
a kick on every beat and dense hats remove the cues downbeat and tactus detection lean on.

Three disputes were not judged and are predicted, not known:

| track | current | beat-this | ratio |
|---|---|---|---|
| `HAQQUDbuudY` Hallowed Be Thy Name | 105.0 | 200.0 | 1.90 |
| `PhdmtUuX7J0` JE MI FAJN | 164.0 | 81.1 | 0.49 |
| `h85f-OKUrqQ` Tajemstvi | 150.0 | 75.0 | 0.50 |

## What follows

- Metrical level must not be delegated to either tracker. Decide it in a dedicated stage.
- The error is always a clean factor, which makes it tractable: a half-time reading is a subset
  of the true beats, so inserting midpoints and scoring them against the onset curve tests it
  directly; a double-time reading is a superset that can be thinned the same way.
- The two systems agreed on level for 8 of 15 tracks. Disagreement is a well-calibrated
  uncertainty flag and should reach the UI as a half/double correction rather than being hidden.
- Any change here is measured with `node bench/run.ts` (Acc1/Acc2 over 764 tracks), not against
  these four.
