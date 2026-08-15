# Round 2 record (v18 analysis / v14 show)

Driven by the A/B verdicts (ab-verdicts.md) and the 47 marked bars. Four work-streams;
two shipped, one shipped smaller than designed, one deferred with a reason.

## Boundary skew (the 22-early-vs-7-late class)

The instrument came first: `bench/earlybars.ts` freezes 15 complaint pairs (judged bar
vs the owner's true bar) plus 10 sentinels (praised boundaries that must not move).
Baseline at round-1 HEAD: 1 hit, 14 same, 0 worse - every error reproduced.

What survived four design iterations, each earlier one killed by the instrument:

- **The snap physics veto** (shipped): a FULL-REACH (2-bar) earlier pull in snapToHooks
  is refused when the incumbent bar's physics-only arrival is decisive (>= 2, the pin
  class) and the target edge is noise (< 0.6). Physics-only because the hook's own
  voice term was lifting the edge above the floor - the evidence on trial was grading
  itself. Distance-narrowed because a praised one-bar pickup (Praha 63) is
  indistinguishable from silence by arrival, which measures change, not level.
  Yield: EARFQUAKE 38 -> 40 and 6 -> 8 in isolation; in the full pipeline the chorus
  lands at 40, punctuation follows, and the peak relocates to the corrected chorus.
- **The settling-contrast term** (shipped OFF, settleWeight 0): sim(b, b+1) minus
  sim(b-1, b) - newness that persists. At weight 1.6 it fixed Killing In the Name
  21 -> 22 but moved two praised boundaries (KITN 49, Praha 63); at safe weights it
  buys nothing. The knob and the negative result are both kept.
- Final ladder: 12 hit, 0 worse of 25 (2 complaint pairs fixed + all 10 sentinels).
  The 13 unfixed pairs are refine-margin and DP class - round 3, instrument ready.

## Peak-master treatment matching (the A/B regression cluster)

`taste.peakStyle` on masters ('slam' | 'bloom', absent = both); `strongest()` refuses a
styled master on the other treatment. tideBloom declares bloom, blinderWall slam.
Až na měsíc recomposes to blinderWall (the A-preferred look); a 60-seed no-crossover
test guards it. Folds the Safír discoBall and Hannah Montana tension complaints'
master-level half; the peak-section ACCENT pool question stays open.

## Endings (5 chips, research-backed)

- **Outro inheritance**: an outro keeps the previous cue's bed and everything else
  leaves - the thinning is the gesture (research: no documented practice makes the
  entry into an outro an event). Fresh draws only when there is nothing to inherit or
  the bed cannot carry alone. The linter learned the exception narrowly (bed only,
  must equal the previous cue's).
- **The button**: a track ending cold inside drop-class material gets its final
  downbeat marked - slam where the bar kicks, colour lift where it does not, never on
  swell treatments or after a carved outro. In the wild: American Idiot bar 132, Cígo
  bar 117.
- Round 3 inherits: ring-out decay at the audio's own rate (T2), fade tracking (T3),
  afterglow and the queue seam (T4/T5 - partly app-side, outside this scope).

## Deferred: the relative arrival floor

Back In Black's cache grid is ~198 bars for a 255 s track - a double-time metrical
level, which doubles section resolution by itself. Its over-sectioning may be
grid-class, not floor-class; and a track-relative floor risks merging the confirmed
second-drop seams on the watchlist (Titi 53). Needs its own measured design after a
publishedBpm-correction check. (Also parked: boundlab disagrees with the cached grid
on such tracks - align before using it there.)

## Adversarial review, second pass (14 findings, dispositions)

The reviewer executed repros against the real library and found a SHIP-BLOCKER the
first readout missed because judged-after composes but never lints:

1. The button lint-ERRORED (`unanchored-hit`) on final sections that are not whole
   phrases - American Idiot and Cígo, the round's own flagships - and a rejected show
   deletes the track's show. FIXED: the linter learned the finish line as an anchor (a
   hit ending exactly where the record does is anchored to the one boundary every
   listener hears); regression test proven failing first. Post-fix: 46/46 library
   tracks compose lint-clean, 16 buttons placed.
2. The button yielded to routine phrase bumps (HUMBLE. unmarked). FIXED: placed before
   the flashes and punctuation; everything later yields through its own clear().
3. A bloom-family chorus ending took a slam its vocabulary forbids. FIXED: anthem rule
   applied to the button's kind.
5. Groove-base cold endings never qualified (Do I Wanna Know). FIXED: groove-base
   endings that pound (>= 0.8 kicks/beat) take the button.
10. repeated-stack fired on long inherited-bed outros, pushing agents toward the exact
    look-change the inheritance forbids. FIXED: consecutive outro cues exempt.
11. The lint exemption indexed the unsorted cue array. FIXED.
12/13. silhouette and shutterCut declare peakStyle 'slam' (a withheld centre and hard
    frames are impacts; an anthem wants its centre lit); the pool-membership test now
    asserts members per treatment, so a reshuffle is a deliberate edit. chromaBurst
    deliberately serves both (the generic biggest thing).
4/6/7/8/9/14: recorded risks, not fixed - swell cold-ends get no button (T2 territory),
    ring-out pollution by a stray kick, the band-lags-singer inversion of the veto
    (no on-record instance; every judged late-chorus error is 1 bar), the veto's
    edge-bar blind spot, single-raw-kick fragility, and the settle-scale coupling now
    named in the tuning docblock.

## Gates

762 tests green, typecheck clean, v18/v14. 46/46 library tracks lint-clean. Judged-36
re-analysis at v18: round-1 changes carried exactly; EARFQUAKE corrected with its peak
following the fixed boundary; no sentinel track moved. cache114 gate 0/0/100%.

## The room's verdict (B = round 1 vs C = round 2, 2026-08-15)

Good: Až na měsíc (the blinder punch back - the peak-style fix confirmed), Cígo a káva
(the button confirmed), Painkillers (guard held), Praha/Vídeň (good, one note),
EARFQUAKE (no complaint at the fixed second drop). Unchanged: Safír (the known blocked
pair, re-marked at 42), Stranded ("same as B" - the outro inheritance did not register
on its 4-bar outro; keep, but not a claimed win). No regressions reported.

Three time-anchored notes, all mined into earlybars:
- Safír 42 re-confirmed; mechanism known (the 2-bar build 41-43 blocks the snap via
  minSegmentBars). Top of round 3.
- EARFQUAKE first chorus: owner marks 7 against the in-window placement at 6 - the
  in-window edge-choice question, now a target instead of a guess.
- Praha 63 sentinel CONTESTED: owner says "maybe 64". The settle variants that pushed
  63 to 64 were scored worse against that sentinel; the sentinel is now a tentative
  pair at 64 instead. Instrument humility: sentinels built from silence are weaker
  than sentinels built from praise.
