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

## Round 3, boundary slice (v19, same night)

The three owner-marked targets, all landed, measured by the grown instrument
(16 pairs + 11 sentinels):

- Safír 43 -> 42: the 2-bar build 41-43 blocked the snap via minSegmentBars; the move
  now absorbs such a build leftward (its first bar joins the passage it rose from) and
  the chorus starts where the owner marked twice.
- EARFQUAKE first chorus 6 -> 8: the DP had it right (arrival 6.48 at 8) and the snap
  dragged it to the sung entrance. The RATIO veto - tried in round 2 and dropped when
  the old Praha-63 sentinel scored its one disagreement as a regression - was restored
  after the owner's note overturned that sentinel, then narrowed to ENTRANCE windows
  only when the readout showed it sliding Le Freak's lyric-perfect RESTART chorus onto
  the band's arrival. A restart cannot lag or lead; an entrance can lead. Le Freak is
  now a sentinel.
- Praha 63 -> 64: falls out of the ratio veto, matching the owner's tentative mark.

Final ladder: 15 hit, 0 worse of 26. Suite 764. Readout collateral, flagged for the
listening list: EARFQUAKE's corrected first chorus now outranks by mean energy, so the
peak moved to bar 8 (before SETTLE_BARS, so its reserved master is skipped) - the third
data point for the queued peak-selection-by-mean redesign, not fixed here.

## Round-3 room verdict (same night, after the nested-bundle fix)

- **EARFQUAKE 2* -> 5***, tags cleared: "sectioning is great". The campaign's
  worst-complained hip-hop track, fixed by the boundary rounds; the peak-front-loading
  worry did not materialise ("maybe effects could be a more lively" only).
- Vítej 3* -> 4*; Praha's old rating and effects chip withdrawn (reset to unrated).
- Safír: analysis verified EXACTLY on the owner's marks (breakdown 33, chorus 42) -
  the residual complaint is hypothesised to be the one-bar strobe at 41 rolling into
  the slam at 42, reading as a false start. Vítej's note (drop "should start" at 81,
  where it IS, with the strobe at 80) fits the same shape. AWAITING the owner's answer
  before designing: is the pre-arrival strobe the thing that reads early?
- New boundary pairs into earlybars: Kisses 61 -> 63, Way Too Self Aware 84 -> 82.
- Back In Black: "verse 2 should be as verse 1 in length" - structure ground truth for
  the parked metrical-level thread (double-time grid).
- Self Aware 4*: "drums just A BIT off (taking the bassline as drums)" - kit
  false-positive thread, recorded.

## Round-4 headline target: downbeat phase (found via the owner's strobe answer)

The owner cleared the strobe lead ("strobe is okay like that before actual drop") and
named the real error: sections start "2-4 beats off". Measured on Safir's fresh v19
blob: the marked moments sit 1.3 and 2.5 beats AFTER the barTimes the grid uses, at
meter confidence 0.52 - the bar boundaries are correct in bar numbers while the
downbeat PHASE is displaced roughly half a bar from the felt one. Every gesture on the
track fires beats ahead of the music's own count. Hypothesis to test next: the
remaining "boundary off" residue on low-meterConf tracks (Cigo 0.32, Thinkin 0.36,
SICKO 0.39, Safir 0.52) is phase-class, not section-class - which would also explain
why bar-level fixes kept reading "a bit off" to the ear. Instruments: beatscore's
downbeat metrics (GTZAN), and a per-track phase probe against the owner's timestamped
marks (marks carry ~0.5-1 s reaction lag; the 2-4-beat report is the owner's own).

## Round 4, first slice (v19/v15, same session)

The phase probe (bench/phaseprobe.ts) REFUTED the downbeat-phase hypothesis before
any code changed: model downbeats agree with the shipped grid everywhere (the
disagreement % just re-derives meterConfidence), and owner marks are lag-dominated
(~1.5-2 s) - mid-bar positions appear on conf-1.00 praised tracks too. The real
"2-4 beats off": shapeApproaches' breath cue re-STAGED the room (bed-only) a bar
before each arrival; both owner marks sat exactly on it. Fixed with the owner's
delegated call: the breath keeps the full look and only dims (x0.6, 2-beat settle).
SHOW_VERSION 15. Verified on Safir 41 / Vitej 80 recompose, lintsweep 15/15 clean on
cache-C, suite 764. The listening question for the next A/B: do those two seams now
read as arriving ON the bar?
