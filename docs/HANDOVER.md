# Handover

State as of 2026-08-15 (afternoon session), after round 4 CLOSED on the room's
verdict and the ROUND-5 BOUNDARY SLICE landed code-complete at v20 - uncommitted,
awaiting the owner's listening pass and the word "commit". Safir's phase question
is open in parallel (tap protocol asked, taps not yet given). Start at "If you are
the next session" near the end, then come back to the top.
`docs/EFFECT_POLISHING.md` carries the method (judge loop, cluster-before-fix, the
kill criterion, bench-vs-room discipline). The complete campaign evidence lives in
`bench/judged/round-2026-08-14/`:

- `snapshot.json` - all 36 original judgements joined against the sections/cues/hits
  they were made against. Survives every version bump. Never regenerate it.
- `digest.md` - the human walk of the same. `diagnosis.md` - ranked root causes RC1-6.
- `adversary-review.md` + `round2-record.md` - every design, every adversarial finding
  and its disposition, and the room's verdicts per round. READ round2-record.md FIRST:
  its tail sections carry rounds 2, 3 and the round-4 target.
- `ab-verdicts.md`, `listening-list*.md`, `research-endings.md` (verified citations),
  `sweep-record.md` (every corpus sweep number).

The older overhaul history (pre-campaign) is in git at `fd9cbb0` and in the session
memory; nothing there is needed to start round 4.

## Where the code stands

Round-5 work COMMITTED on the owner's word (2026-08-15 late evening) in four
chunks: the v20+v21 analyser slice, the bench instruments (stagetrace, phasepick,
phaseflip, gridedit, judgemap + the earlybars scorer), the judge trio (section
editor, typed hit marks, arrangement preview), and these records. The owner's own
in-flight work stays uncommitted: `docs/hardware.html` and everything under
`packages/preview3d/` - DO NOT touch or commit those; stage explicit paths only.
The sectioning-model memo was moved OUT of the repo by the owner on purpose
(a second research agent must not read it) - do not recreate it here.

ANALYSIS_VERSION 21 (v20 = the boundary slice, v21 = + the Ponyboy pounding arm),
SHOW_VERSION 15. 769 tests green, `npm run check` clean. earlybars at v21: 20 hit /
0 closer / 8 same / 0 worse of 28 - THE FLOOR (WTSA true bar ear-confirmed at 83).
structscore v21 identical to v20: raveform F0.5 0.394 / F3 0.540, harmonix 0.202 /
0.532 (sweep-record.md). Judged-after at v21 byte-identical to v20 - the pounding
arm's only corpus effect is Ponyboy itself (drop@72 now). showprobe baselines from
the v20 run: 0 lint / 0 misfires / 100% quiet, contrast 2.84, hue jumps 2894, dark
bars 2 (the lavaBlobs pair); the v21 cache114 regen re-verifies on ship. Room
verdicts on file: Vitej GOOD, EARFQUAKE GOOD, WTSA GOOD, SAFIR piecewise staging
CONFIRMED ("now looks correct").
Commit discipline: Conventional Commits, no co-author trailer, no em-dashes anywhere,
stage explicit paths, only commit when the owner says so (the pattern each round:
implement -> gates -> owner listens -> owner says "commit").

What shipped, one line each (details in round2-record.md):

- R1 (v17/v13): same-material consolidation behind five guards; club vocabulary needs
  kit corroboration (CLUB_KICK_FLOOR 0.4); hasDrops behind `audible`; the Discogs
  "Folk, World, & Country" parent no longer votes; heartbeat kick-gated; `silhouette`
  peak master added. Room: B beat A 3 wins / 5 ties / 1 loss.
- R2 (v18/v14): hook-snap physics veto (physics-only arrivals - the voice term was
  grading itself); peakStyle on masters (pools pinned by test: slam = blinderWall,
  chromaBurst, shutterCut, silhouette; bloom = chromaBurst, tideBloom); outro bed
  inheritance; the cold-ending button; linter learned the finish-line anchor and the
  outro repeated-stack exemption. Room: 4 good, 0 regressions.
- R3 (v19): the ratio form of the snap veto restored (entrance windows ONLY - a
  restart cannot lag or lead) and the absorb-left move for 2-bar builds. Room:
  EARFQUAKE went 2* -> 5* ("sectioning is great"); Vitej 3* -> 4*.
- R4 (v19/v15 + playhead): the breath dims instead of re-staging; indicators mark
  the heard instant. Room: playhead CONFIRMED; both seams still early -> reclassified
  (Vitej bar-class, Safir phase-class). Round 4 closed in the round record.
- R5 boundary slice (v20, UNCOMMITTED): stay-pins (physics-only, stayPinScore 3,
  protect-not-vote), pin-aware fold with the void guard, restart noise floor on the
  snap veto, earlybars scores non-build starts, bench/stagetrace.ts instrument.
  Fixes on the ladder: Vitej 82, Kisses 63, Titi 54, Lose Yourself 23, WTSA 83
  (closer). Awaiting the room.

The boundary instrument `bench/earlybars.ts` is the campaign's backbone: 18 frozen
owner-marked pairs + 10 sentinels (28 rows), scored against whatever analyzer is
checked out. Current full score 19 hit / 1 closer / 8 same / 0 worse of 28 (the
v20 floor). Run it after ANY analysis change - with MV_CACHE_DIR pointed at a
cache that has Kisses/WTSA audio (cache-C today; the primary cache lacks those
two): `MV_CACHE_DIR=... node bench/earlybars.ts [--variant=NAME] [--no-lyrics]`.
First run per track pays BeatThis (~15 s each, cached in bench/corpus/.beats).
`--no-lyrics` attributes an error to the DP/refine vs the hook snap - it found
EARFQUAKE. The scorer reads non-build section starts (a build is the approach, not
the seam). Its sibling `bench/stagetrace.ts` (round 5) replays the structure stages
one call at a time in cache coordinates and self-checks against a real analyzeTrack
run - the instrument that named every mechanism this round.

## ROUND 4, first slice: SHIPPED same session - read this before the phase brief

The phase hypothesis below was TESTED AND REFUTED by `bench/phaseprobe.ts` before any
code changed: (B) Beat This's own downbeats agree with the shipped grid at +0.00
beats on EVERY track - the "% agree" column reproduces meterConfidence, i.e. low-conf
tracks have INTERNALLY inconsistent model downbeats, not wrongly-chosen ones; and
(A) the owner's marks sit mid-bar even on conf-1.00 praised tracks (EARFQUAKE 5* at
~2.8 beats), so note lag (~1.5-2 s, half a bar at these tempos) swamps sub-bar
reading. Marks cannot resolve phase; the prose can.

What the "2-4 beats off" actually was: `shapeApproaches` in plan.ts - "the breath
before it lands" - inserted a one-bar cue before every drop-class arrival that
STRIPPED the look to its bed and dimmed. Both owner marks (Safir 41, Vitej 80) sat
exactly on it: a re-staged room reads as the next section arriving. On Safir it was
newly exposed because R3's absorb removed the 2-bar build whose climb used to occupy
that bar. FIXED at SHOW_VERSION 15, owner delegating the call ("decide for the best
look"): the breath now keeps the FULL outgoing look and only dims (intensity x0.6,
fadeBeats 2 so it settles by mid-bar and HOLDS). Verified: Safir 41 and Vitej 80
recompose with identical layer stacks to their predecessors; lintsweep clean; 764.

If the next A/B still reads "off" at these seams, the remaining suspect is the model
plurality phase itself being wrong on low-conf tracks - untestable from marks; would
need the owner tapping "one" per suspect track (a which-beat-is-one question, one
track at a time). Do not rebuild a local discriminator (history below).

Also in this slice (0e6e3c4): the scrubber and timeline playhead led the ear by the
audio OUTPUT LATENCY - the readout published the raw clock while the room and the
hardware sync already rendered `heardPosition` (raw minus outputLatency). Fixed at
the readout, so judge timestamps now land on the heard moment too, which makes every
FUTURE owner mark slightly more accurate than the ones already mined (do not
re-litigate old marks against the new clock). App-chrome change, made on the owner's
explicit ask - the chrome stays out of scope otherwise.

**ROUND 4 CLOSED (2026-08-15 afternoon).** The owner listened: playhead confirmed;
both seams STILL EARLY, and the fresh marks split them - Vitej resolved to bar 82
(bar-class, fixed in the round-5 slice), Safir confirmed as the phase suspect
(third press on the same instant, half-bar-flip line inside the cluster). The
model-plurality path is OPEN: the owner was asked for tap-protocol marks
(EARFQUAKE ~0:25-0:50 as lag calibration, Safir ~0:50-1:15, live presses on the
felt "one"); taps had not landed by session end. Full verdicts + diagnoses in
round2-record.md.

## The original phase brief (kept for the evidence and the code map; hypothesis REFUTED)

**The finding.** After R3 landed Safir's boundaries EXACTLY on the owner's marked bars
(breakdown 33, chorus 42, verified in cache-C's v19 blob), the owner still heard it
wrong and, asked directly, said: sections start "2-4 beats off", and explicitly
CLEARED the strobe lead as a suspect ("strobe is okay like that before actual drop" -
do not redesign the strobe-into-drop). Measured: the owner's timestamped marks sit
1.3 beats (67.1 s vs barTimes[42] = 66.56) and 2.5 beats (54.0 s vs barTimes[33] =
52.98) AFTER the grid's bar starts, at meterConfidence 0.52 and downbeatPhase 0. The
bar boundaries are right in bar numbers; the grid's "one" is displaced from the felt
one, so every cue, slam and strobe fires beats ahead of the music's own count.

**The hypothesis worth the round**: the stubborn "boundary off" residue on
low-meterConfidence tracks is PHASE-class, not section-class. The suspects and their
meterConfidence, all judged tracks with unresolved off-feel: Cigo a kava 0.32,
Thinkin Bout You 0.36, SICKO MODE 0.39, bad guy 0.47, Killing In the Name 0.47,
Safir 0.52, Tili Me Pregunto 0.54, Snooze 0.56. The 4-5* cohort sits at 0.75-1.0.
A half-bar phase error also poisons everything downstream that looked "1 bar early
or late" at bar resolution - some of the 11 unfixed earlybars pairs may be phase in
disguise.

**Instruments that exist:**

- `bench/beatscore.ts` - beat/downbeat F and CMLt on GTZAN. The downbeat columns are
  the corpus-side gate; the shipped Beat This checkpoint decision (final0 over small0,
  downbeat CMLt 0.605 vs 0.558) is in round2-record's history and memory.
- The owner's timestamped marks: every note in snapshot.json carries `t` seconds AND
  a bar. A phase probe compares `t` against `tempo.barTimes[bar]` per mark - marks
  carry ~0.5-1 s reaction lag (they drift LATE), so treat deltas under ~1 beat as
  noise and look for the CONSISTENT 2-beat-class offsets. Safir's two marks and the
  round-2 mark (67.2 s for bar 42) are the cleanest anchors.
- `bench/boundlab.ts` prints per-bar arrivals for one track. CAVEAT: it re-runs
  BeatThis fresh and reads only beatsPerBar/downbeatPhase from the cached blob, so on
  a track where the cached grid came out at another metrical level (Back In Black)
  its bar indices disagree with the cache. Align before trusting it there.

**Where the phase is decided (read in this order, none of it read this session):**

1. `packages/analysis/src/beatthis.ts` - the model emits beats AND downbeats.
2. `packages/analysis/src/downbeats.ts` - how downbeat phase is chosen from them
   (and what happens at low agreement; meterConfidence's semantics live here or in
   `tempo.ts` - "margin over the runner-up", per README).
3. `packages/analysis/src/beats.ts`, `metricalLevel.ts`, and `analyze.ts` around the
   `barSynchronous(bf, beatsPerBar, phase)` call - where phase becomes the bar table.
4. `publishedLevel` in enrich/analyze - corrects the metrical LEVEL from published
   bpm; it has no phase component.

**First moves, in order:**

1. Build the phase probe (bench/, ~an hour): for every judged track, every owner mark
   -> delta between `t` and `barTimes[bar]` in beats, grouped by meterConfidence.
   If the low-confidence cohort shows consistent ~2-beat deltas and the high-
   confidence cohort does not, the hypothesis is confirmed before any code changes.
2. Diagnose Safir specifically: does Beat This's own downbeat stream agree with the
   shipped phase 0? If the model said the other phase and the local fit overrode it
   (or vice versa), the fix is about WHO decides at low confidence.
3. Only then design. Constraints from history: "metrical level cannot be delegated to
   either tracker, and no local discriminator adjudicates it" (the abandoned
   metrical-level corrector - do not rebuild it); Beat This final0's downbeat CMLt is
   the number that must not regress; the beatscore gate must stay flat on the
   high-confidence majority. A phase fix that helps 8 low-confidence tracks and
   moves nothing else is the win condition. Sweepable, sentinel-guarded, adversary
   before shipping - the full R2/R3 loop.
4. The metrical-level cousin: Back In Black's grid is DOUBLE-TIME because Deezer's
   published 190.5 is itself the doubled reading, so publishedLevel confirmed the
   wrong octave (meterConf 1.0!). Owner ground truth on file: "verse 2 should be as
   verse 1 in length". Parked with the relative-floor idea (task: NOT floor-class);
   any phase work should at least not make this class worse.

**Design-space notes for the fix (written before reading the phase code - verify):**
`downbeatPhase` is the beat offset (0..beatsPerBar-1) at which bars start on the beat
stream; a "2-beat" error is a HALF-BAR phase flip, the classic weak-backbeat
ambiguity. Candidate shapes, cheapest first: (a) at low meterConfidence, trust Beat
This's own downbeat stream over the local fit (or vice versa - the diagnosis says
which side Safir's error came from); (b) an arrival-evidence vote: the pipeline's own
decisive arrivals (the pin class) overwhelmingly land on true downbeats, so their
beat-phase distribution is a cheap discriminator that does NOT rebuild the abandoned
level corrector (it adjudicates PHASE, not level, and only at low confidence);
(c) expose the half-bar alternative the way tempo.alternativeBpm exposes octaves, and
let reanalyse/research flip it. Guard rails: never touch tracks above ~0.7
meterConfidence; beatscore downbeat F/CMLt flat; earlybars 15/0 floor holds (bar
INDICES shift when phase flips - the probe's pairs are bar-numbered, so re-derive
expected bars from the owner's `t` marks, not from stored bar numbers, for any track
whose phase changes).

## The rounds beyond 4, each with its design direction and instrument

**R5 candidate: ballad/swell endings** (T2/T3/T4 from `research-endings.md`, all
citations verified). T2 ring-out decay: the outro cue's intensity tracks a level
follower on the audio tail instead of holding 0.5 - engine-side, needs the outro cue
to read the spectrum envelope it already has; select by terminal envelope (the carve
already distinguishes ringing tails). T3 fade tracking: monotonic level decline with
pattern unchanged -> brightness follows, motion slows. T4 afterglow: after
button/decay, a low warm still wash instead of zero (between-track form is short;
end-of-queue lingers - the lounge dissolve partly covers this, check what the app
already does before building). Measure: recomposed outro cue intensity curves on the
5 ending-chip tracks + KITN/Gojira; the button/outro tests extend naturally. T5
(queue-seam palette handover in the dark) is app-side: out of scope, note for owner.

**The remaining earlybars pairs after the v20 slice** (8 "same" + WTSA at closer):
refine-margin class (Titi 73->72, Cigo 50->49, PROVENZA 79->80, bad guy 23->24,
KITN 21->22, Thinkin 2->1 - the fill-vs-arrival fight; the settle knob history says
a track-local or evidence-gated settle is the unexplored move), DP class (Snooze
17->23, six bars - needs the lyric window used ASSERTIVELY, see RC5), phase-suspect
(Safir 33->34 - waits on the tap verdict), and WTSA 83-vs-82 (the stay-pin landed
83 on the huge arrival; whether the owner's 82 or the physics' 83 is the felt bar
is a listening question, not a code one). Vitej 82, Kisses 63, Titi 54 and Lose
Yourself 23 are DONE at v20. Unmarked v20 collateral to listen for: Praha chorus
39 -> 41 (the restart floor holding the band's bar - 1:26.8 vs 1:30.5).

**Peak selection by mean energy** - three complaints on file (Ine Plemena, Self Aware
"I would not say this is peak", Hannah Montana tension drop) PLUS EARFQUAKE: its peak
now sits on the FIRST chorus at bar 8, before SETTLE_BARS, so the reserved master is
SKIPPED - and the owner's only nit on the 5* was "effects could be a more lively",
which may BE that skipped master. Design direction: bias the rank toward the LAST
statement of the loudest group (finalOfGroup already exists; the house craft says the
first chorus holds back so every return adds), or rank groups pooled and pick the
final member. Instrument: peak bars across the judged 36 + cache114 before/after,
plus the three complaint tracks' peaks specifically. Engine-side, SHOW_VERSION bump.

**RC5 lyric-assertive naming** - Blinding Lights "almost the whole track is chorus";
demotion needs overlap < 0.12 while misplaced boundaries hold overlap at 0.27-0.31;
the hook windows land on the TRUE choruses (33/72/104 - hookcheck output in the round
dir). Direction: let strong hook windows PLACE chorus starts on song-family tracks
(not just nudge existing chorus-class boundaries), and loosen demotion where a
better-overlapping sibling exists. This is the assertive step the v16 snap
deliberately did not take; sentinel-heavy territory (Hannah, KITN, Praha all
lyric-good today). Snooze 17->23 is the same fix seen from the other side.

**Kit false positives** - Self Aware 4*: "drums just A BIT off (taking the bassline
as drums I think)". The kick detector's bass-subtraction exists precisely for this
(removing it once cost fixture precision 1.000 -> 0.529, in memory); suspect ADTOF's
kick head or the DSP threshold on bass-heavy mixes. Instrument: the drum fixtures +
spot-listening; low stakes, one track so far.

**Context provenance + CONTEXT_VERSION** - cached `genres` carry effnet's own echo
(adversary R1 finding 17), so a context re-vote no-ops; Get Lucky still wears
`ballad` in the app until its context re-derives. Fix shape: store effnet labels in
their own field, bump CONTEXT_VERSION, re-enrich lazily like analyses. Touches
ingest/enrich + the contract; cheap but wide - own round.

**Parked with reasons**: relative arrival floor (its poster child Back In Black is
metrical-class; risks the confirmed second-drop seams), exposure damper (design
against the every-mechanism-becomes-a-mandate history; the scratch usage probe's
share-per-family numbers are the instrument), peak-section ACCENT pool (Safir's
discoBall - the picker fills peak-span slots from thinned pools; an energy floor
with fallback is the shape), in-window hook edge choice (EARFQUAKE's 6-vs-8 resolved
via the veto instead; revisit only if a new in-window complaint lands).

Named risks with fixtures wanted (adversary R2, unfixed by choice): band-lags-singer
veto inversion (gospel/soul shape), ring-out kick pollution, swell cold endings, the
veto's edge-bar blind spot, single-raw-kick fragility of the veto, settle-scale
coupling (five absolute thresholds calibrated on the settle-free scale - the
structure.ts docblock names them).

## The apps and caches (the owner's A/B/C setup)

- `/Applications/LightningStrike.app` = A, the ORIGINAL judged build (337d06f), on
  `~/Library/Application Support/cz.drabek.lightningstrike/cache` (+ judge/ = the 36
  original judgements, already fully mined into snapshot.json).
- `LightningStrike (B).app` = round 1 (v17/v13) on `cache-B` (round-1 A/B verdicts
  in its judge/).
- `LightningStrike (C).app` = ROUND 4 FINAL (v19/v15 + the playhead fix) on
  `cache-C` (round-2 and round-3 verdicts in its judge/, all mined; the round-4
  listening verdicts LAND HERE and are the next session's first read).
- Round 5 hands over by replacing C again (after mining its judge/) or adding D -
  ask the owner which.
- **THE INSTALL TRAP**: `cp -R new.app "/Applications/X.app"` onto an existing bundle
  NESTS it (X.app/LightningStrike.app) and the old binary keeps launching - one A/B
  was listened against the wrong build this way. `rm -rf` the target first, then
  copy, then verify `ls "X.app/"` shows `Contents` and nothing else.
- Cache clears keep audio/meta/context/judge and delete only `*.analysis.json` +
  `*.show.json`; stale versions re-derive lazily anyway (~30-60 s per track on first
  play). `cache114/` (repo, gitignored) is the 114-track gate corpus, regenerated at
  v19 - do not wipe. The judged-36 scratch copies in the session scratchpad are GONE
  (session temp); recreate from the desktop cache if needed (copy audio+meta+context,
  run `MV_CACHE_DIR=<dir> node bench/reanalyse.ts`).

## Mining a new judged round (the workflow, refined over three rounds)

Verdicts land in the JUDGING app's cache: `cache-C/judge/*.json` for anything judged
in C. To mine: diff each file against the round's prior state (snapshot.json holds the
originals; per-file `updatedAt` and note lists say what changed - a python join, see
the mining scripts' shape in git history at 7ee7b3f's digest generator). Rules the
rounds taught:

- **A cleared rating + cleared tags is a RESET, not a bad verdict** - the owner wipes
  a track's old judgement before re-marking it (Praha, Safir in R3).
- **The note's `bar` field TRUNCATES from `t`.** EARFQUAKE's mark at 23.3 s printed
  bar 7 but 23.3 s is bar 7.87 - the intended bar was 8. Always recompute from `t`
  against `tempo.barTimes`; at fast tempos the field is off-by-one half the time.
- **Marks carry ~0.5-1 s reaction lag** (late). The owner's PROSE ("2-4 beats off")
  outranks the millisecond arithmetic.
- **Notes are usually dropped at the TRUE moment** ("this is where X should start"),
  not at the wrong one - but confirmations exist too ("correct chorus"), so read the
  text before the number.
- Join every new mark against the CURRENT analysis (sections + barTimes + arrivals)
  before believing any interpretation - R3's "Safir still wrong" dissolved into the
  phase finding only because the blob showed the bars already exactly on the marks.

## Gates and probes (run all before any handover)

1. `npm test` (764) and `npm run check`. If check errors with TS6305 after deleting
   dist/, `npx tsc --build --force packages/analysis` (stale tsbuildinfo).
2. `node bench/earlybars.ts` - 15 hit / 0 worse (of 28 rows) is the floor; any
   WORSE is a stop.
3. `node bench/structscore.ts --dataset raveform|harmonix --limit 60 --variant current`
   after analyser changes (baselines in sweep-record.md; label columns are BLIND to
   same-kind merges and lyric effects - read F0.5/F3/sections).
4. Judged-36 recompose readout: `node bench/judged-after.ts <scratch>` AFTER a scratch
   reanalyse - it diffs sections/phantoms/peaks/hits vs snapshot.json. IT DOES NOT
   LINT: the R2 ship-blocker (the button lint-deleting shows) was invisible to it.
   Always ALSO run `node bench/lintsweep.ts` (composes + lints the whole library;
   46/46 lint-clean is the floor, and the app fails DARK on lint errors).
5. `MV_CACHE_DIR=.../cache114 node bench/reanalyse.ts` then
   `MV_CACHE_DIR=... node bench/showprobe.ts` - 0 lint / 0 misfires / 100% quiet
   coverage, dark bars <= 2 (the known pair). Env var must prefix EACH command
   (an `&&` chain does not inherit it - this bit once).
6. Versions: ANY analyser change bumps ANALYSIS_VERSION, ANY composition change bumps
   SHOW_VERSION, in the same change. cache114 must be regenerated before showprobe
   means anything at the new version.
7. Build: `npm run bundle -w @mv/desktop` then `npx tauri build --bundles app` from
   apps/desktop (DMG fails on this machine; --bundles app is the path). ~4 min.
8. Background-run hygiene: a running structscore/reanalyse loads code per PROCESS at
   start - editing packages/analysis or core mid-sweep contaminates the variants that
   have not started yet (one sweep was killed and rerun for this). Land edits between
   runs. And if two desktop apps are open with the room wired, only one may stream to
   the board or it flickers between shows.

## Method invariants this campaign proved again (beyond EFFECT_POLISHING)

- **Instrument first, sentinels included, and prove a new test fails against its
  bug.** Four snap-veto designs died on the instrument before one shipped; the
  cheapest of those deaths cost minutes.
- **Sentinels built from silence are weaker than sentinels built from praise.** The
  old Praha-63 "sentinel" (uncomplained, not praised) wrongly killed the ratio veto
  for a round; the owner's "maybe 64" note overturned it. Mark tentative vs hard.
- **Evidence on trial must not grade itself**: the snap veto reads PHYSICS-ONLY
  arrivals because the hook's voice term was lifting its own edge over the floor.
- **Restart vs entrance is a real asymmetry**: an entrance can lead the beat, a
  restart cannot lag or lead. It is encoded in the veto and in a Le Freak sentinel.
- **The owner's ear outranks the pairs**: "2-4 beats off" reframed bar-perfect
  boundaries as a phase problem no bar-resolution instrument could see.
- **Adversary before shipping, and have it EXECUTE repros** - the R2 reviewer found
  a show-deleting blocker by composing and linting the real library, which no test
  and no readout covered.
- Ask the owner in small pieces; they answer fast and their one-line answers have
  twice redirected a round ("strobe is okay", "maybe 64").
- **When the table is right and the ear still says off, suspect the LOOK, not the
  analysis.** Round 4's "2-4 beats off" survived three correct boundary fixes because
  the offender was a show gesture (the breath cue re-staging the room) - diff the
  CUES at the complained bar (layers, fades, intensity), not just the sections.
- **A re-staged room reads as an arrival, however dim.** Changing the layer stack is
  a boundary statement; changing only intensity is not. The breath, the outro, and
  any future approach-shaping obey this.
- **Owner marks carry ~1.5-2 s of lag** (mid-bar positions even on praised conf-1.00
  tracks); the `bar` field truncates from `t`. Trust the prose, recompute from `t`,
  and never read sub-bar meaning from a mark.

## Owner's standing taste verdicts (unchanged, do not re-propose)

No whole-field displacement; no fill-and-drain wipes; no strobing accents in rap
verses; buildStrobe only in a build's back half; 8 Hz strobe ceiling; kick-burst
family drawn at most one per show; one wave-family at ~50-60% of its genre is the
ceiling; exact-arrival gestures need the shape between arrivals to be worth watching.
PLUS, new this campaign: the strobe-before-a-drop is explicitly endorsed ("strobe is
okay like that before actual drop"); outros keep their look and thin; endings are
anchored to the finish line, not the outro boundary; the pre-arrival breath DIMS the
rig and never strikes the set (full look kept, intensity only - the owner delegated
this call and it shipped at v15).

## If you are the next session: the first hour

1. Read this file to the end, then round2-record.md's tail (round-4 close + the
   round-5 boundary-slice diagnoses and implementation - the freshest evidence).
2. Mine cache-C/judge for new marks (rules under "Mining a new judged round"; the
   v20 build IS app C now, and it carries the SECTION-EDITING UI - the owner can
   hand-draw a track's section map in the judge panel; it saves into the
   judgement as `sections` with authoritative TIMES + fractional bars on the
   pinned grid. Mine those as ground truth before anything else). Open with the
   owner: (a) SAFIR - a PIECEWISE grid staged in cache-C (gridedit.ts, cuts at
   53.8 and 106.8 from the owner's five-mark prescription; .orig backup,
   `restore` mode) - the track carries TWO half-bar edits and no single phase
   serves it (the round record's "piecewise-phase track" section); does the
   staged version land every seam?; (b) Kisses 1:47.8, Titi 1:59.0, Praha 1:30.5
   verdicts; (c) the commit word; (d) PONYBOY - the kick-blindness diagnosis was
   RETRACTED (an undefined-read artifact); the measured mechanism is hasDrops
   starving on step-less wall-to-wall bangers, fix design A in the round record
   (third hasDrops arm: club + sustained pounding); implement behind judged-36
   zero-drift.
3. The v20 slice is UNCOMMITTED - if the owner said "commit", stage the explicit
   paths in "Where the code stands" (never the preview3d files or hardware.html).
4. Taps landed -> compute per-tap offsets vs the shipped grid, subtract the
   EARFQUAKE median lag, read Safir's phase (~0 = grid right, ~2 beats = half-bar
   flip confirmed -> design the low-meterConf phase fix; guard rails in the phase
   brief above; NEVER a local discriminator).
5. Before ANY further analyser change: `MV_CACHE_DIR=<cache with Kisses/WTSA audio>
   node bench/earlybars.ts` - the floor is 20 hit / 0 worse of 28. Keep every gate
   in "Gates and probes" green behind each slice; `bench/stagetrace.ts <id> [from]
   [to]` names the stage that moved any boundary (MATCH line must hold; it prints
   the real analyzeTrack table - compare FINALS, a mid-pipeline line once read as
   the final cost an hour).
6. Ballad endings (the old R5 candidate above) is the next queued round AFTER the
   phase question and the v20 room verdict settle.
