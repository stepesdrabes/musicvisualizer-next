# Handover

State of the analysis/authoring overhaul as of 2026-08-13 (evening), what remains, and the
knowhow a continuation needs. `docs/EFFECT_POLISHING.md` carries the method; this file
carries the open work. The session memory has the same facts with more numbers.

## Round 1 against the 2026-08-14 judged round (36 judgements, build 337d06f)

Everything about that round lives in `bench/judged/round-2026-08-14/`: `snapshot.json`
(the full join of every judgement against sections/cues/hits/kit rows - survives version
bumps), `digest.md`, `diagnosis.md` (ranked root causes RC1-RC6), `adversary-review.md`
(25 attacks on the designs and their dispositions), `research-endings.md` (verified
practice for the endings round), `sweep-record.md`. All 36 judged shows recomposed
bit-identically at 337d06f before any change - every complaint was live.

Shipped at ANALYSIS_VERSION 17 + SHOW_VERSION 13 (2026-08-14 late, not yet judged):

- **Same-material consolidation** (`consolidate.ts`, floor 1.6 in `StructureTuning`):
  merges adjacent same-kind sections only when nothing arrives within a bar of the seam
  AND the material matches across it (groupSegments' 0.92 standard, seam-local) AND the
  seam is phrase-aligned from the merged start AND it touches neither the loudest
  segment, a pinned arrival, nor a hook-snap target. Sweep: Raveform F0.5/F3 +1.5/+1.9
  with sections 20.0 -> 17.9-18.1, Harmonix within 0.2pt of baseline. On the judged 36:
  conservative by design - 6 tracks changed (No One Knows 17->15, Sandman 13->12 with
  the phantom slam@79 gone, Self Esteem, Roygbiv, As It Was, Adele), 0 peaks moved,
  every steelman-watchlist seam survived. Xtal kept its five drops: the evidence says
  those seams are real; its complaint is now filed under boundary placement (round 2).
- **Genre trio**: the "Folk, World, & Country" Discogs parent no longer votes (Get
  Lucky stops being ballad; other parents deliberately kept - stripping "Hip Hop" turns
  "Trap" into a bass vote); `speaksClub` requires kit corroboration (CLUB_KICK_FLOOR
  0.4 kicks/beat over the loud half - a house-tagged piano ballad and beatless ambient
  now speak song vocabulary; halftime bass at ~0.5 keeps its drops); `hasDrops` requires
  `audible` (a track the drum detector heard nothing in cannot have drops). Someone You
  Loved: six kickless drops -> verse/chorus, bumps 8 -> 4. An Ending: drops -> calm
  verse treatment. DEFERRED: per-source context provenance + CONTEXT_VERSION (cached
  `genres` carry effnet's own echo, so a context re-vote no-ops - see adversary-review
  finding 17); the ambient-in-CLUB_FAMILIES question (Roygbiv keeps its drops, on
  purpose).
- **gridTrust reads `rawSectionCount`** (new optional TrackAnalysis field): a wreck must
  not merge its way past the lounge gate.
- **Effects**: heartbeat now declares `taste.kit: 'kick'` and takes strike permission
  from a kick Presence (two judged tracks heard it fighting the drums); new `silhouette`
  peak master - figure/ground inversion, ring blazing over a dark centre beam, held for
  up to 8 bars, from the verified rap-climax research (Saint Pablo / Stormzy silhouette
  practice). It wins 4 of 28 mastered peaks on the judged corpus by seed tie-break
  alone, no preference wiring.

Round 2 SHIPPED at v18/v14 (2026-08-15, gate green: 0/0/100% over regenerated
cache114, 46/46 library tracks lint-clean): the snap physics veto (EARFQUAKE's 2-bar
early drags fixed; earlybars instrument with 15 complaint pairs + 10 sentinels is
permanent), peakStyle treatment matching on masters (Až na měsíc's blinder punch
restored; pool membership pinned by test), outro bed inheritance + the cold-ending
button (finish-line anchor taught to the linter after an adversarial review caught the
button lint-rejecting its own flagship tracks - see round2-record.md for all 14
findings and dispositions). settleWeight ships 0: a documented negative with the
coupled-thresholds warning in the docblock.

Round 3 queue, in order: the remaining 13 marked pairs (refine-margin and DP class;
instrument ready), relative arrival floor AFTER a metrical-level check on Back In
Black (its cache grid is double-time - the over-sectioning may be grid-class), ballad
endings (T2 ring-out decay, T3 fade tracking, T4 afterglow - T5's queue seam is
app-side), lyric-assertive chorus naming (RC5), context provenance + CONTEXT_VERSION,
the peak-section ACCENT pool (Safír's discoBall half of the peak cluster), exposure
damper. Named risks with fixtures wanted: band-lags-singer veto inversion, ring-out
kick pollution, swell cold endings.

## Where things stand

Shipped and verified across the overhaul and two judged rounds (analysis v16, show v12,
nothing regressed - the gate at every step was 0 lint errors, 0 misfires, 100% quiet
coverage over the 114-track corpus, full suite green; cache114 artifacts regenerated at
v16 on 2026-08-13):

- Build-labelling discipline: Harmonix 7-way agreement 50.5 -> 53.1, build share on the
  owner's corpus 17.0 -> 9.6% (annotated 6.1 pop / 9.6 EDM), consecutive-build chains 80 -> 2.
- ADTOF drum model beside the DSP (model kick+snare, DSP hats - its hat class halves the
  true rate), ~7 s/track, optional file like the other models.
- Genre avoid-lists, per-show signature sampling with the undrawn half foreign for the
  night, crash-answer budget, per-slot bloom->slam aggression, quiet-to-quiet 3-bar fades,
  wildcard honesty, key-change palette lift, trust gate with a ten-section floor.
- Judge mode in the app (J / N; verdicts pinned to analysisHash+seed in `<cache>/judge/`).
- New effects through the full gate; the owner deleted recoil, timedSweep and buildStacker on sight.
  89 effects. The kick-burst family (shockwave, kickTunnel, kickCannon, ricochet,
  pyroBursts, splash) is drawn at most ONE per show via PickRequest.exclude - the hard
  form of avoid, with an empty-pool fallback - after the weighted form still left two
  members in most shows. Every drop-class bed must carry (generalised from the peak-only rule after a
  seed reshuffle produced eight dark bars under an all-event stack).
- The kick-on-switch bug: the anticipation lead consumed boundary hits into the outgoing
  effect; the player re-asserts fresh edges on the install frame. Test proven both ways.

## Remaining work, in order

### 1. Hook-snap boundaries - SHIPPED 2026-08-13 at ANALYSIS_VERSION 16

Built, but not as diagnosed: the acceptance corpus refuted "the hook bar IS the chorus
bar" twice before a design survived. Measured across the judged tracks, hook lines sit
anywhere in the bar before the true downbeat (sung pickups: Svoboda's 5/5 boundaries at
10/42 against hooks at 9.27/41.28) or bars AFTER it (club vocals entering over a drop
already running: VYZEE), and in-bar phase cannot split the two (a 0.27 pickup belongs to
the next bar where a 0.31 belongs to its own). What shipped (`hookStarts` + `snapToHooks`
in vocabulary.ts, wired post-vocabulary in analyze.ts):

- cycle-restart detection recovers hooks hidden inside merged repeated-line runs (Safír's
  opening chorus flows straight into the first real one; the restart at bar 8.4 is the
  only evidence for the true boundary at 9);
- a hook claims a two-bar WINDOW {bar, bar+1}; a boundary inside any window is evidence
  and never moves; an outside one moves at most 2 bars EARLIER onto the nearest edge, or
  exactly 1 bar later and only toward a RESTART hook (an entrance can lag the drop it
  belongs to, a mid-flow restart cannot); hooks under 4 bars apart are refrain chant and
  are dropped;
- events are re-placed from the final table afterwards (`placeEvents`, extracted from
  arrange.ts) - that resolved the events trap, and also made events honest for
  promoted/demoted segments.

Yield on the judged corpus (bench/hooksnap.ts): Safír 11->9, Cikády 23->24, VYZEE 65->63,
every sentinel and out-of-scope track byte-identical. Gates: structscore bit-identical on
both corpora (the bench has no lyrics), 702 tests, showprobe 0/0/100% over the
regenerated cache114. HONEST YIELD WARNING: ~10 of the ~14 marked complaint bars carry no
lyric evidence at all (no LRCLIB sync, or hooks nowhere near the boundary) - that
residue is the learned labeller's to fix, not the hook's.

### 2. P6 production: the learned section labeller - ABANDONED, see the rollback below

Everything in this section was built and then rolled back on 2026-08-14 after the owner
judged it in the room. Read "Tried and rolled back" further down before acting on any of it;
the three "Remaining" items at the end of this section are moot. It is kept because the
measurements in it are real and the traps it documents are still traps.

### 2 (as written at the time). P6 production: the learned section labeller

The head is trained and validated: 5-fold grouped CV 66.8% +-1.8 on the nine-way lighting
vocabulary; Harmonix 62.6 (rules: 53.1 on the easier 7-way), Raveform 69.8 (rules: 33.6).
EDM drop/breakdown/build is where it doubles the rules - which also covers the judged
rock/SOPHIE complaints. Artifacts: `bench/corpus/.musicfm/sectionhead.pt` + config;
embeddings for all 270 annotated tracks in the same dir; checkpoint at
`bench/.musicfm-weights/` (1.3 GB, MIT); vendored model source at `bench/.musicfm-src/`.
Training is ~3 min on MPS via `bench/train-sectionhead.py` - iterate freely (layer-10
fusion and more depth untried).

DONE 2026-08-13 - export, TS port, parity, mapping, end-to-end gate:
- Both graphs exported by `bench/export-musicfm.py` via DYNAMO with dynamic time axes.
  Two traps paid for: the extraction pieces are variable-length (35 s head, 40 s
  interior, arbitrary tail), so a static graph would corrupt exactly the intro/outro
  numerics; and the legacy tracer baked T=400 into the head's attention reshape - the
  first longer track failed inside the graph. The HF rotary cache is monkey-patched to
  compute unconditionally before export.
- TS side in `packages/analysis/src/musicfm.ts` (MusicFm = frontend + encoder + head,
  MusicFmHead = head alone for embedding-holding callers). Parity
  (`bench/musicfm-parity.ts`): head exact (2e-6), fp32 encoder 1.6e-5 at two window
  lengths, mel within torchaudio's OWN run-to-run envelope (~0.1 dB max, 0.02 median -
  torch disagrees with itself by the same amount, so the head already lives with it).
  int8 encoder (246 MB): whole-track worst-frame cosine 0.9696, head label agreement
  95.1% against the stored fp32 embeddings, ~0.6x realtime on a loaded CPU.
- Mapping: `sectionPosteriors` on AnalyzeInput; `applyHeadLabels` re-reads kinds by mean
  posterior per DP segment. Rules keep carves (group < 0), the settled-bars drop gate
  and club vocabulary coercion. Background refine can just re-run analyzeTrack with the
  posteriors - every downstream artifact (events, moments, spectrum AGC, key change)
  stays consistent for free, no blob surgery.
- End-to-end gate (`structscore --head`, posteriors from the stored corpus embeddings):
  Harmonix base 71.1% vs rules 53.1; Raveform 87.1% vs 33.6, with build F1 2.6 -> 82.7
  and drop 53.7 -> 90.0. The mapping through DP segments beats the head's own frame CV.

Remaining, in order:
1. Serving/refine plumbing in apps/web: track plays on rule labels, MusicFm relabels
   post-ready (minutes per track on CPU - int8 embed is ~0.6-1x realtime, so this is
   firmly a background job), analysis + show rewritten through the same stale-version
   machinery `prepare()` already has. THE OPEN UX QUESTION for the owner: a show
   changing under a PLAYING track - recompose only if unplayed, or on the next play.
2. Ship-form decision: int8 (246 MB, 95.1% label agreement) vs fp32 (977 MB, exact).
   Nothing measured yet says int8 costs accuracy where it matters (the gate above ran
   fp32 embeddings); either re-run the gate over TS-int8 embeddings for a few tracks or
   accept the 95% agreement and watch judgements. CoreML EP is the latency lever if the
   background refine feels slow.
3. Bump ANALYSIS_VERSION when the head path ships in the app, and re-run the full gate
   set. The model files live in models/ (musicfm_encoder_int8.onnx, musicfm_encoder.onnx
   + .data, musicfm_sectionhead.onnx, musicfm_mel_fb.bin, musicfm_config.json) - local
   artefacts, never committed, fetch story undecided.

### 3. Effect-pool saturation (the owner has now complained twice)

shockwave/kickCannon read as overused, and it is NOT stale cache - measured presence is
organic: thin pools at e4-5 mean the same few win everywhere (vortex/pump sit at ~95% of
all shows the same way). The signature-sampling fix does not apply (they are not
signatures). The honest fixes, pick one or both:
- Catalog breadth at the SAME energy distance (the catalog-pairs lesson, paid three
  times now: newcomers priced below the incumbents change nothing).
- A global exposure damper: track corpus-wide share per effect (the judging probe in
  scratch does this in 20 lines) and feed a small negative weight above a threshold -
  never a filter. No such mechanism exists yet; design carefully against the
  every-mechanism-becomes-a-mandate history.
Verdicts pending on: ricochet, snareBlade, counterweight, weave (still pending as of
2026-08-13 evening - every judge file on disk predates show v11, so nothing has yet been
heard under the burst cap). Burst-family exposure is
now structurally capped at one per show; if the owner still sees too many bursts, shrink
the draw (add a second none slot) rather than re-weighting.

### 4. Peak selection

Two judged complaints ("peak has no kick" on Ine Plemena, "I would not say this is peak"
on Self Aware). energyRank is by mean energy; the peak master and treatment hang off it.
Wait for 2-3 more examples before changing the rule; the judge files name the exact bars.

### 5. Smaller open threads

- Two pre-existing dark bars on cache114 (Eternal Youth bar 7, Shalom Margaret bar 20,
  verified present under the pre-round catalog too): a build cue carried by a lone
  `lavaBlobs` bed goes near-black for a bar at audible energy. A bed-only build cue is
  the suspect, not the analysis. Quiet-passages round material.

- boundlab still calls refineBoundaries with the old default floor (0.6), so its printout
  disagrees with the shipped pipeline (floor 2 via tuning); align when next used.
- quietprobe numbers were refreshed 2026-08-12; re-run after any quiet-pool/spectrum/floor
  change and paste back (nothing asserts them).
- The DMG bundling step of `tauri build` fails on this machine; `--bundles app` is the
  working path and the .app is all that is needed locally.
- JUST DANCE-class short tracks: watch the ten-section floor holds once more short edits
  arrive.
- `varietyprobe` predates the avoid/sampling mechanisms; its Jaccard held (0.200 -> 0.204)
  but it does not measure per-family saturation - the scratch usage probe should graduate
  into bench/ if saturation work continues.

## Tried and rolled back: the learned section labeller (2026-08-14)

Section 2 above describes the head as remaining work. It was built, shipped behind a
background re-read, judged in the room against two other builds, and **rolled back**. Do not
re-propose it from corpus scores alone.

What it did to a trance track, same grid both ways:

- head: `breakdown x6, groove x3` - no intro, no build, no drop anywhere
- rules: `intro, groove, breakdown, build, drop, groove, breakdown, build, drop`

Per track against annotated ground truth it cut single-label dominance 58.1% -> 43.7% on club
material with nothing degenerate in 25, and did the reverse on song material, 43.7% -> 51.9%,
two of 25 coming back one label end to end.

**Why the bench said otherwise, which is the part worth keeping:**

- `structscore`'s `base=` column collapses verse onto groove and chorus onto drop, so it is
  structurally blind to a verse/chorus error. It read 53.1 -> 71.1. The EXACT figure was 22.5%
  on song material against 87.1% on club, in the same output all along.
- `structscore` passes no `TrackContext`, so its rules baseline runs with **no lyrics** where
  the app has them, and `speaksClub` falls back to a kick heuristic that reads much of a pop
  corpus as club. The head was measured against a crippled arm on the families it hurt.
- Turning the head on turned the lyric promote/demote off - both lived in one branch in
  `analyze.ts`. What names a chorus is the words repeating.

The work is recoverable at tag `grok-work` and `origin/grok-work-branch`. What was kept from it:
the sACN sink and the `packages/transport` rename, `bench/beatscore.ts` and
`bench/export-beatthis.py`, and the `adtof.ts` onnxruntime fix.

### Two checkpoint decisions, measured

- **Keep Beat This `final0`, refuse the distilled `small0`.** On the 100-track GTZAN slice:
  beat F 0.884 -> 0.873, downbeat F 0.722 -> 0.704, downbeat **CMLt 0.605 -> 0.558**. The
  continuity number decides it - a constant grid fit and a bar phase are built on it, and every
  cue here is addressed by bar. The measured gap is three times the paper's published one, so
  quoting that figure would have undersold the cost. Re-ask with `bench/beatscore.ts --model`.
- **If MusicFM is ever revisited, int8 (246 MB) is enough**: Harmonix 68.9 against fp32's 69.3,
  Raveform 85.6 against 88.3, n=10 each.

### Considered and not built

Named so nobody proposes them cold: `bridge`/`inst`/`solo` as first-class kinds (a retrain, and
`bench/kinds.ts` already maps `bridge -> breakdown` for song families on purpose); a tempo
classifier as a third octave vote; N-bar autoloops when `gridTrust` fails; guided/template
authoring modes ("change only the chorus" - author-ai has no scoping at all, the most
interesting unbuilt item); a per-section colour script as an editable object; Key-CNN, refused
on its AGPL-3.0 licence; a pooled MusicFM embedding as a continuous taste vector.

## Operational knowhow

- **The full deploy loop** (any engine/effect change): quit app, `npm run bundle -w
  @mv/desktop`, `npx tauri build --bundles app` from apps/desktop, replace
  /Applications/LightningStrike.app, sync artifacts if regenerating them, relaunch, then
  curl the app's own `/api/library` and read the `current` count. The app build must be
  at least as new as any artifacts handed to it.
- **Caches**: desktop app `~/Library/Application Support/cz.drabek.lightningstrike/cache`
  (the owner's library + judge/ verdicts - 2026-08-13 wipe kept audio/meta/context and
  deleted analysis/show blobs, so everything regenerates lazily); repo `cache/` (dev);
  `cache114/` (gitignored bench corpus, full artifacts at v16 - do NOT wipe, the probes
  and sweeps run against it).
- **Versions**: analyser changes bump ANALYSIS_VERSION, engine/effect changes bump
  SHOW_VERSION, every time - the wipe does not remove the need, it only clears the current
  backlog once.
- **Judging**: verdicts land in the DESKTOP cache's judge/ dir (the owner judges in the
  app). Aggregate with a python one-liner over the JSONs; each is pinned to
  analysisHash+seed so stale complaints are detectable. Chips aggregate, notes diagnose.
- **The owner's standing taste verdicts**: no whole-field displacement (recoil), no
  fill-and-drain wipes (timedSweep), no strobing accents in rap verses, buildStrobe only
  in a build's back half, one wave-effect family at ~50-60% of its genre is the ceiling.
