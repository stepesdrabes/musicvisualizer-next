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

## Round-4 room verdict (2026-08-15 afternoon) - round 4 CLOSED

The owner listened to the final C build (breath fix + playhead fix, v19/v15) and
answered the three-item list. First marks ever taken on the heard clock.

- **Playhead: confirmed.** "Yes, it looks correct" - the heard-instant readout ships
  as-is and every future mark is more trustworthy than the pre-fix ones.
- **Safir seam: STILL EARLY.** Fresh mark t=67.4, "THIS is where the second chorus
  should start (it still starts early)". Third press on the same instant in three
  rounds (67.3 / 67.1 / 67.4) against the bar-42 line at 66.56; the press cluster
  sits ~2 beats after the grid line, and the half-bar flip would put the downbeat at
  67.38 - inside the cluster. Boundary is on the marked bar, the breath no longer
  re-stages, the clock is fixed: the remaining suspect is the model-plurality phase
  itself (meterConf 0.52), exactly the branch the round-4 refutation left open.
  OPENS the phase path: owner taps "one" per track, lag-calibrated on a praised
  high-confidence track; never a local discriminator.
- **Vitej seam: resolved to bar 82, NOT phase.** Fresh mark t=158.4, "THIS is where
  the last drop should start (it starts too early)" - the press lands 0.3 s before
  the bar-82 line (158.72) and the prose settles the contested 81-vs-82 pair: true
  bar 82, agreeing with round 1 and with the physics (e95 k4 at 82 vs e72 k0 at 81).
  Reread, round 3's "should start here" at the identical instant said the same thing;
  the truncated bar field misled. meterConf 0.99 - this is a plain one-bar-early
  boundary for the earlybars queue, unblocked now that the direction is answered.

Round 4 closes here: both round-4 changes shipped and verified, the playhead
confirmed by the room, and the seam residue reclassified - one phase suspect
(Safir), one ordinary boundary pair (Vitej 81 -> 82).

## Boundary-slice diagnoses (same day, instrument: bench/stagetrace.ts)

New instrument: `bench/stagetrace.ts` mirrors analyze.ts's structure pass stage by
stage on the CACHED earlybars beats (never a fresh BeatThis - boundlab's fresh grids
have disagreed with the cache by a bar) and self-checks every run by diffing its
final table against a real analyzeTrack on identical inputs (MATCH on all three
tracks below). Three pairs, three mechanisms, all named:

- **Vitej 81 -> 82: the DP phrase-rounds unpinned-but-correct bounds.** segmentBars
  and refine both put bounds at 80 and 82 (the 2-bar kickless cut before the last
  drop; arrival 5.89 at 82). Neither bound MOVED in refine, so neither earned a pin
  (pins are minted from moves only, analyze.ts), and arrange re-drew them onto the
  phrase line: 72->73, 80->81, the 82 bound deleted - the drop ships starting on a
  kickless rms-0.135 bar. Fix shape: mint pins for STAY-decisive bounds (unmoved,
  arrival >= pinScore), so facts outrank the phrase preference at unmoved bounds too.
- **Way Too Self Aware 84 -> 82/83: same stay-pin hole.** The drop-in at 83 is the
  biggest arrival traced so far (7.22, rms 0.082 -> 0.255), unmoved in refine, hence
  unpinned; the DP rounded it to the 4-bar line at 84. No snap involved. The owner's
  mark (t=120.2 at 169 bpm) reads 82 with 83 inside press ambiguity - the stay-pin
  fix cuts the error to at most one bar; re-listen decides the rest.
- **Kisses 61 -> 63: restart windows bypass the physics veto.** Refine's 62->63 move
  scored 5.44 and WAS pinned; the DP respected it; then snapToHooks pulled 63->61
  because the hook window at 61 is a RESTART and the R3 doctrine exempts restarts
  from the veto entirely (`!w.restart`). The singer runs continuously (vocal 1.00
  throughout), so a repeated line mid-flow read as a restart with nothing arriving
  under it (physics 0.23 at 61). Le Freak - the sentinel the doctrine protects -
  traced for the distinguisher: its correct pull 47->45 lands on an edge the band
  corroborates (physics 1.57 at 45), so an incumbent-strength veto would wrongly
  kill it, but the R2 NOISE-FLOOR test on the target (< 0.6) separates them
  cleanly: Kisses 0.23 refused, Le Freak 1.57 proceeds. Fix shape: restart windows
  keep their exemption from the RATIO veto but not from the absolute
  decisive-incumbent + noise-target refusal.

Both fixes are analysis-side (one ANALYSIS_VERSION bump), sweepable behind
earlybars 28 rows + structscore + judged-after + the full gate battery.
The owner chose "boundary fixes now"; Safir phase awaits the owner's taps.

## Round 5, boundary slice (v20): implementation

Tests first, proven failing: the Kisses restart pull reproduced against the veto
(pull [{23 -> 21}] where [] was demanded), the Vitej fold reproduced against
snapToPhrases (pinned 82 dragged to 81 by the sliver fold). The Le Freak guard and
the pinned-yield guard passed before and after. Suite 764 -> 768.

**The first form failed its own ladder and was revised before anything else ran.**
Stay-pins minted at pinScore from FULL arrivals scored 18 hit but 3 WORSE - Titi
73 -> 74, and the praised KITN 49 sentinel to 50. Two mechanisms, both instructive:

- KITN 50's full arrival (2.09) is voice-lifted - physics only 0.89 - so the pin
  minted itself from the hook term: evidence on trial grading itself, the exact R2
  lesson, now proven to apply to pin minting too.
- The stays joined the REPHASE VOTE and diluted KITN's unanimous move-pin phase
  {9,69,81} below the 0.8 agreement, silently switching re-phasing off track-wide -
  which is what had been producing the praised 49 (and Titi's 73) all along.

Final form, all shipped in one v20 bump:

- **Stay-pins**: physics-only, at `stayPinScore` 3 (not pinScore 2) - a moved pin
  proved itself against a contested neighbour, a stayed bound never did, so it pins
  only where no contest is conceivable. On-file cases split wide around the value:
  legitimate stays tower (5.9 / 6.0 / 7.2), the displacing ones sat at 2.4 and 0.89.
- **Vote split**: `rephaseToPins` gained a `voting` set (move-pins only). Stays are
  PROTECTED from re-phasing and the phrase snap but do not vote the track's phase -
  deciding one bar is a smaller claim than deciding the grid.
- **Pin-aware fold**: snapToPhrases' sliver fold redirects leftward when folding
  forward would drag a pinned startBar off its arrival.
- **Restart noise floor**: restart windows stay exempt from the RATIO veto (Le
  Freak's whole case) but cannot pull a decisive incumbent onto an edge below 0.6 -
  a "restart" nothing arrives under is a repeated line mid-flow, not a section.
- **Instrument**: earlybars scores against non-build section starts (a build's
  start is the approach, not the seam; verified against every v19 blob that this
  shifts no prior row). stagetrace now prints the real analyzeTrack table
  unconditionally - a mid-pipeline grep got read as the final table during
  diagnosis (rephase drags KITN's 58 to 57 and the restart hook snap corrects it
  back; the sentinel was never actually in danger in either version).

Ladder after revision: **19 hit / 1 closer / 8 same / 0 worse of 28** (v19 floor
was 15/0). New hits: Vitej 82, Kisses 63, Titi 54 (chorus on the owner's slam, with
its 2-bar build kept), Lose Yourself 23, KITN 21 -> 22 reverted to same (it was a
by-product of the diluted vote, not a designed fix). WTSA 84 -> 83 closer; whether
the owner's 82 or the physics' 83 is the felt bar goes on the listening list.
Suite 768, typecheck clean.

Corpus gate, v20 vs the sweep3 v19 baselines (cons16): raveform F0.5 0.383 ->
0.394, F3 0.540 flat, sections 18.1 flat; harmonix F0.5 0.196 -> 0.202, F3 0.528
-> 0.532, sections 10.7 flat. Boundaries on physical arrivals beat phrase-rounded
bars inside the tight window, on both corpora. Adversary follow-up shipped in the
same bump: the pin-aware fold refuses to grow a VOID over a played bar (a dark bar
in the room outranks a one-bar pin shift; test proven failing unguarded). Suite
769.

Named risks recorded, not fixed: An Ending (Ascent) phantomShare 0.53 -> 0.82
(ambient seams shifted off rounded bars; global phantom flat at 28%, 1* track,
listening-flagged); Praha's refused restart edge measures 0.63 bench-side -
a hair above the 0.6 noise floor, so a kick-detector change could flap it (the
app-path Adtof reading is what shipped the refusal).

App-path verification (reanalyse with BeatThis + Adtof, the build the room hears):
judged-36 scratch at v20 - 36/36 lint-clean, 10 buttons; judged-after vs snapshot
shows the intended moves (Vitej peak 81 -> 82 following its drop; Titi peak 37 ->
54 onto the corrected chorus; Safir's 2-bar build absorbed into one clean
breakdown 33-42 + chorus 42) and no sentinel drift. Kisses and WTSA (no cache-A
audio) verified in a separate mini-scratch: drop@63 and chorus@83 under model
drums too, both lint-clean. v19 -> v20 diff over the six tracks with cache-C
blobs: Vitej 81 -> 82 (the fix, alone) and one collateral, **Praha chorus 39 ->
41**: under Adtof kicks the band's bar pins and the restart noise floor refuses
the pull onto the singer at 39 - the Kisses mechanism on a second track, at an
unmarked seam. Praised Praha sentinels 24 and 64 hold; 39-vs-41 goes on the
listening list (1:26.8 vs 1:30.5).

## Round-5 room verdict, first pass (2026-08-15 evening, v20 installed as C)

- **Vitej mezi nama: GOOD.** The 82 fix confirmed in the room.
- **EARFQUAKE: GOOD.** Still holds at v20.
- **Way Too Self Aware: GOOD.** The stay-pin bar 83 is the ear-confirmed truth -
  the round-3 mark's 82 was press ambiguity at 169 bpm. Pair updated to true@83
  (now a HIT; ladder floor becomes 20 hit / 0 worse of 28).
- **Safir: STILL EARLY, now in the owner's own words a SUB-BAR error** - "starts
  at ~1:06, but should be ~1:07". The grid line is 66.56; the felt moment ~67.
  New instrument `bench/phasepick.ts` (strongest onset per bar, beat-phase
  histogram): BOTH owner-marked seams slam at +2 beats of the grid (breakdown
  +2.08 = 53.83 s, chorus +2.03 = 67.39 s - dead on the three-round press
  cluster), track-wide onset mass 67% in the back half of the bar. The half-bar
  flip hypothesis is all but confirmed by the record itself. New harness
  `bench/phaseflip.ts` staged a +2-beat variant into cache-C (doctored downbeats
  through the real pipeline, original hash/version, .orig backup, restore mode):
  flipped bar 42 starts 67.40 s and the chorus lands on it. AWAITING the owner's
  flip listen; their ear picks phase, then the general fix gets designed (the
  pin-class beat-phase vote at low meterConf - never a local discriminator).
- **NEW THREAD - Ponyboy (SOPHIE): "completely lost its energy in effects, does
  not work in A or B, was good way before."** First diagnosis (kick blindness)
  was WRONG and is retracted: it read `section.kicksPerBeat` off raw blobs where
  the field does not exist - undefined printed as 0. A measured investigation
  (subagent, full numbers in its report): both drum paths hear the kick fine
  (ADTOF 342, DSP 572, blob kick-rich at F=0.990 vs the model; the kick is a
  pitched sub gliding ~100 -> 60-90 Hz with no transient, and the flux that
  survives the bass-subtraction is 4-8x the picker floor). The REAL mechanism:
  **no section can earn drop class** - hasDrops (arrange.ts) demands an energy
  step >= 0.22 or kick step >= 0.3 between consecutive sections, and a
  wall-to-wall banger has no step (Ponyboy: 0.11 / 0.125) - so every loud
  section is groove, both peak rescues are gated off, hits are two bumps, and
  the show never escalates. Fix design (A): a third hasDrops arm - club
  vocabulary AND sustained pounding (loudKickRate >= ~0.8, kit in >= ~90% of
  non-outro bars) counts as having drops, letting the existing peak-group rescue
  assign one. No detector change (measured as unjustified; it would move TOWARD
  the Self Aware failure). Gates: judged-36 zero sentinel drift, the beatless
  ambient counter-case stays excluded via `audible`, flat rock via genre.
  Second finding kept: the undefined-reads-as-0 diagnostic hole - per-section
  kit rates exist only in mining scripts, not on SectionSpan; give the tooling
  one shared computation off bars[].kicks so this cannot happen again.
- Kisses 1:47.8, Titi 1:59.0, Praha 1:30.5: no verdict reported yet.

## Safir resolved to a PIECEWISE-PHASE track (2026-08-15 evening, flip listen)

The owner listened to the +2 flip and prescribed the whole section map in five
marks (mined 17:10). Joined against both grids, the marks are bimodal: 14.8 and
106.8 sit ON the ORIGINAL grid's lines, 53.8 and 67.3 sit ON the FLIPPED lines
("this chorus start is CORRECT" - the flip won the 1:07 seam), 132.8 is +-1 beat
ambiguous. Beat-counting between marks: chorus start -> end spans 24 bars + 2
beats, and chorus start -> divide spans 24 bars + 2 beats again - the track
carries TWO half-bar edits, and NO single phase can serve it (meterConf 0.52 was
the pipeline noticing). bench/phasepick.ts's onset evidence agrees per passage;
the model's own downbeat stream wanders all four phases (cannot adjudicate).
Direction: a grid that absorbs 2-beat short bars at detected phase-shift points
(sustained local onset-phase plateaus, low-meterConf only) - variable barTimes
are already representable in the contract; every uniform-bar assumption
downstream is the design's risk surface. Next concrete step: hand-build the
owner-prescribed grid as a cache-C experiment (bench-side custom barSynchronous)
so the target state is HEARD before the general detector is designed.

Also mined: Praha "build should start there" at 15.1 (bar 4) - the v20 refine
move 4 -> 3 (score 5.19, pinned) contradicts the owner's ear; candidate pair for
earlybars once the current threads settle. The v20 room verdicts and the
section-editing UI request (drag boundaries in the judge panel, hand the map to
the analysis session) arrived in the same message; UI work opens as its own
track.

## The section-editing UI (2026-08-15 evening, apps/web - on the owner's ask)

The judge panel grew "Adjust sections": arming it opens the timeline drawer and
the section lane becomes editable - drag a boundary (snapped to the BEAT grid via
barAtTime/barTimeAt, so a hand mark is never rounded onto a wrong bar phase),
double-click splits, alt-click a handle merges, click a section for a kind picker
(the nine SECTION_KINDS with their swatches). Every gesture commits once, into the
judgement as `sections: JudgedSection[]` - kind + startTime/endTime (authoritative)
+ fractional bars on the pinned analysisHash grid - so a hand-drawn map survives
re-analysis and reads directly as mining ground truth. Server type + client mirror
updated in lockstep; the POST route needed nothing (it spreads). Two writers share
the judgement file (panel vs editor), merged through the page's map, and a save
racing the first judgements load now awaits it - the unguarded merge nulled the
sections field once during verification. Verified in the browser end to end: drag
-> bar 30.75 beat-snap, kind chorus -> drop, split at 21.50, merge back - one save
per gesture, all four confirmed through GET /api/judge. Typecheck + suite green.

## Safir piecewise grid: CONFIRMED by the room (2026-08-15 evening)

"Safir now looks correct!" - the staged two-cut grid (53.8, 106.8) lands every
seam. The hypothesis chain closed: sub-bar complaint -> phasepick evidence ->
five-mark prescription -> gridedit experiment -> ear confirmation. The staged
blob STAYS in cache-C as the owner's listening copy until the real fix ships.
The general fix (automatic half-bar-edit detection: sustained local onset-phase
plateaus at low meterConfidence producing 2-beat short bars) is the campaign's
next analysis design; the owner's confirmed cut points and, once drawn, their
hand-drawn section map are its gates. Ponyboy design A approved in the same
breath - implemented next.

## Ponyboy slice (v21): the pounding arm, implemented

`hasDrops` gained its third arm: on a club-family track (isClubFamily, the genre
half of speaksClub, passed into arrange), sustained pounding counts as having
drops - every inner section holding >= half the track's own q90 kick bar
(POUND_KICK 0.5) with the kit in >= 90% of bars (POUND_KIT 0.9). The existing
peak rescue then assigns WHICH group is the drop. Threshold chosen by
measurement, not taste: a blob-side probe over Ponyboy + every club-family track
of the judged 36 showed Ponyboy's inner grooves at kick 0.50-0.73 / kit 1.0 and
NO other dropless club track anywhere near the floor (An Ending and Someone You
Loved, the ambient/ballad sentinels, far under). ANALYSIS_VERSION 21.

Proof: Ponyboy app-path reanalyse -> `intro, groove, groove, groove, DROP@72,
outro` - the loudest passage is the drop, lint-clean. Gates: suite 769, typecheck
clean, judged-after at v21 BYTE-IDENTICAL to v20 (zero drift across the 36),
36/36 + Ponyboy lint-clean, earlybars 20 hit / 0 worse of 28, structscore both
corpora identical to v20 (raveform 0.394/0.540, harmonix 0.202/0.532). The
staged Safir piecewise blob and Ponyboy's fixed blob were re-staged at v21 in
cache-C so the version bump cannot lazily destroy the owner's listening copies.

## Safir strobe-edge complaint -> the piecewise design's first hard requirement

The owner: "the strobe at the end should be right on the edge of the last drop."
Composed the staged blob: the pre-arrival strobe sat in bar 65 - the LONG-BAR
WART (2.46 s, the bar that absorbed the cut's two deleted beats) - so a 4-beat
strobe stretched to six real beats and led the slam by 2.46 s instead of 1.64.
Requirement for the real detector, now measured in the room: **edits must be
absorbed as SHORT bars (2 listed beats), never long ones - pre-arrival gestures
keep their true duration.** The beats-deletion staging trick cannot express a
short bar; the real fix needs barSynchronous over explicit bar starts.

Staged copy healed meanwhile: the deletion point moved to a gesture-free
mid-passage bar (cuts now 53.8, 100.0 - the wart sits at bar 61 where only
bed/rhythm breathe), every owner seam still lands on a bar line, and the strobe
now runs 105.16 -> 106.80, ending exactly on the slam. Re-listen pending.

Also mined: the owner's first HAND-DRAWN MAP (Ponyboy, via the new editor):
groove 0-16, drop 16-32, drop 32-48, groove 48-64, drop 64-72, drop 72-80,
outro 80-81. Against the analyser's v21 single drop@72: the map wants TWO drop
blocks and a mid-track valley - the first concrete eval case for both the
sectioning-model research and any future peak/drop-assignment work.

## Hit marking in the judge panel (agent-built, same evening)

MomentNote gained `hit?: 'strobe' | 'slam' | 'blackout'` (server type + client
mirror in lockstep); the judge panel's mark row grew three compact typed-mark
buttons using ShowStrip's glyph language, and typed notes render their glyph in
the timestamp chip. The free text still says which way the complaint runs; the
kind makes it minable. Save path unchanged (the route spreads). Typecheck 0
errors, web tests 92/92. Mining rule for future rounds: a note with a `hit`
kind is a ground-truth statement about a hard hit at that instant - join it
against the composed show's hits the way boundary notes join against sections.

## bench/judgemap.ts - the hand-map eval harness (same evening)

Scores the analyser against every judgement carrying a hand-drawn map or typed
hit marks: per-second kind agreement (exact + sectionBase-folded), per-boundary
deltas, and hit marks joined against the composed show. First measurement,
Ponyboy v21 vs the owner's map: **boundaries largely right (4 of 6 on), kinds
35%** - the analyser calls the owner's drops grooves. The failure is LABELS,
not boundaries, which is precisely the applyHeadLabels contract's frame (the
head names sections, the DP keeps the seams) and the strongest argument yet for
the labels-first training target the research memo is evaluating.

## Sectioning-model research: memo landed at docs/SECTIONING_MODEL.md

Agent-researched with verified citations. The recommendation: resurrect P6's
machinery (frozen MusicFM int8 embeddings + a small head) under a new evaluation
protocol whose first law is "the owner's maps are an eval before they are ever
training data"; labels only, boundaries stay DP-owned; the room is the final
gate. Phase 0 runs with today's one map: build bench/mapscore.ts, score the
rules AND the rolled-back P6 head against the owner's maps. 15-20 maps freeze
the eval; 30-50 adapt the head. judgemap's first numbers (boundaries right,
kinds 35%) already point the same direction.
