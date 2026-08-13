# Handover

State of the analysis/authoring overhaul as of 2026-08-13, what remains, and the knowhow a
continuation needs. `docs/EFFECT_POLISHING.md` carries the method; this file carries the
open work. The session memory has the same facts with more numbers.

## Where things stand

Shipped and verified across the overhaul and two judged rounds (analysis v15, show v10,
nothing regressed - the gate at every step was 0 lint errors, 0 misfires, 100% quiet
coverage over the 114-track corpus, full suite green):

- Build-labelling discipline: Harmonix 7-way agreement 50.5 -> 53.1, build share on the
  owner's corpus 17.0 -> 9.6% (annotated 6.1 pop / 9.6 EDM), consecutive-build chains 80 -> 2.
- ADTOF drum model beside the DSP (model kick+snare, DSP hats - its hat class halves the
  true rate), ~7 s/track, optional file like the other models.
- Genre avoid-lists, per-show signature sampling with the undrawn half foreign for the
  night, crash-answer budget, per-slot bloom->slam aggression, quiet-to-quiet 3-bar fades,
  wildcard honesty, key-change palette lift, trust gate with a ten-section floor.
- Judge mode in the app (J / N; verdicts pinned to analysisHash+seed in `<cache>/judge/`).
- New effects through the full gate; the owner deleted recoil and timedSweep on sight.
  91 effects. Every drop-class bed must carry (generalised from the peak-only rule after a
  seed reshuffle produced eight dark bars under an all-event stack).
- The kick-on-switch bug: the anticipation lead consumed boundary hits into the outgoing
  effect; the player re-asserts fresh edges on the install frame. Test proven both ways.

## Remaining work, in order

### 1. Hook-snap boundaries (top item; the owner's biggest complaint class)

~14 judged tracks carry one-bar section offsets, mixed directions, worst near track starts.
The diagnosis is done: LRCLIB hook-line timing reliably marks the true chorus bar
(`chorusSpansFromLyrics` span starts; verified on Safir where the boundary sat at 11 and 43
against hooks at 9 and 42). The refiner already takes vocal-entrance and hook-start terms
(weight 1.2, tip-only) but they cannot move a boundary that is 2 bars out (refine reach 1)
or beat a strong incumbent times the 1.45 margin.

The mechanism to build: a post-vocabulary hook-SNAP - after promote/demote in analyze.ts,
move a chorus-class startBar onto an adjacent hook bar (reach 1, maybe 2 for decisive
hooks). THE TRAP: `arrange()` has already emitted `drop_downbeat`/events at the old bars
and carved voids/ring-outs; either snap before events are placed or move the events with
the boundary. Wall-to-wall-vocal tracks have no entrance edge, which is why the hook (not
coverage) is the signal. Acceptance test: the 14 marked bars in the desktop cache's
judge/ files (each carries t + bar + direction in the note text); the bench is blind to
lyric evidence (structscore fetches no contexts), so structscore is only the
no-regression guard, not the target.

### 2. P6 production: the learned section labeller

The head is trained and validated: 5-fold grouped CV 66.8% +-1.8 on the nine-way lighting
vocabulary; Harmonix 62.6 (rules: 53.1 on the easier 7-way), Raveform 69.8 (rules: 33.6).
EDM drop/breakdown/build is where it doubles the rules - which also covers the judged
rock/SOPHIE complaints. Artifacts: `bench/corpus/.musicfm/sectionhead.pt` + config;
embeddings for all 270 annotated tracks in the same dir; checkpoint at
`bench/.musicfm-weights/` (1.3 GB, MIT); vendored model source at `bench/.musicfm-src/`.
Training is ~3 min on MPS via `bench/train-sectionhead.py` - iterate freely (layer-10
fusion and more depth untried).

Remaining, in order:
1. Export the MusicFM conformer to ONNX (+int8, ~350 MB). The frontend does NOT export:
   reimplement in TS - torchaudio MelSpectrogram (24 kHz, n_fft 2048, hop 240, 128 mels),
   AmplitudeToDB, drop the last frame, normalise by the two scalars in msd_stats.json.
   Validate numerics against saved probe vectors the way `bench/export-adtof.py` did
   (that script is the template; ONNX matched torch to 5.7e-7).
2. Mind the windowing: embeddings were extracted in 30 s windows with 5 s pad discarded
   each side (`bench/extract-musicfm.py`); production inference must match or the head
   sees unfamiliar edge effects.
3. Head to ONNX or a TS matmul (it is tiny); serve-time mapping = mean posterior per DP
   segment, argmax, keep the rule overrides for void (silence is a fact) and the
   settled-bars drop gates.
4. BACKGROUND REFINE plumbing (the owner chose this over in-ingest): track plays on rule
   labels, the model relabels post-ready, the engine show recomposes through the same
   stale-version machinery `prepare()` already has. A show changing under a PLAYING track
   is the open UX question - recompose only if unplayed, or on the next play.
5. Gate end-to-end with structscore using head labels, and bump ANALYSIS_VERSION.

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
Verdicts pending from the owner on the surviving newcomers: ricochet, snareBlade,
counterweight, weave (one word deletes any of them - recoil and timedSweep precedent).

### 4. Peak selection

Two judged complaints ("peak has no kick" on Ine Plemena, "I would not say this is peak"
on Self Aware). energyRank is by mean energy; the peak master and treatment hang off it.
Wait for 2-3 more examples before changing the rule; the judge files name the exact bars.

### 5. Smaller open threads

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

## Operational knowhow

- **The full deploy loop** (any engine/effect change): quit app, `npm run bundle -w
  @mv/desktop`, `npx tauri build --bundles app` from apps/desktop, replace
  /Applications/LightningStrike.app, sync artifacts if regenerating them, relaunch, then
  curl the app's own `/api/library` and read the `current` count. The app build must be
  at least as new as any artifacts handed to it.
- **Caches**: desktop app `~/Library/Application Support/cz.drabek.lightningstrike/cache`
  (the owner's library + judge/ verdicts - 2026-08-13 wipe kept audio/meta/context and
  deleted analysis/show blobs, so everything regenerates lazily); repo `cache/` (dev);
  `cache114/` (gitignored bench corpus, full artifacts at v15 - do NOT wipe, the probes
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
