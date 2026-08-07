# Handover, and the brief for the next session

The state of the repo as of commit `8dd074f`, and then a prompt to paste. Everything below
the line is the prompt; everything above it is for you.

## Where things stand

Three commits landed this session, on `master`:

- `edb0cd1` the analysis and mixing overhaul
- `11dc2ef` the bench probes each change was decided by
- `8dd074f` the audit page

321 tests green, `npm run check` clean, every engine-composed show lints with zero errors.
`ANALYSIS_VERSION` is 6 and `SHOW_VERSION` is 2, so any cached blob older than this session
re-analyses on load.

`docs/analysis-audit.html` is the running record. Twenty-nine findings carry a green "fixed"
chip and the number they became; three attempts that were tried, measured and reverted are
written up beside them rather than dropped.

**Your cache currently holds about five tracks**, because you cleared it and re-ingested during
the session. `node bench/reingest.ts --shards 2` re-analyses and re-composes whatever is in
`cache/` in place, keeping ids. It takes roughly ten minutes for nineteen tracks.

## What the next session is for

You asked for three things, and the decisions you made on each are baked into the prompt:

1. **Sections driven by the drums**, keeping the seven lighting kinds and detecting them better
   rather than adding a song-structure vocabulary. Research first.
2. **A per-frame spectrum in the contract** so effects can be genuinely reactive, and the effect
   catalog rewritten freely to use it. `author-ai` stays out of scope.
3. **Hard timing rules for punctuation**, enforced in the linter so they cannot regress.

Two facts were measured for the brief rather than guessed, and both are stronger than they
looked from the room: **78% of all bars come out `groove`**, not the 50% you estimated, and
**55 of 91 hits start off the 4-bar grid** with 43 of 91 not a whole number of bars long.

---

# Implementation session: intelligent scenes, reactive effects, punctual hits

You are continuing work on Room, a 1320-pixel LED show driven by DSP. The previous session
rebuilt the analysis and mixing path against annotated ground truth and left it measured; the
audit at `docs/analysis-audit.html` records what moved, what did not, and what was reverted.
This session is about the three things the owner can still see wrong in the room.

**Read these first, in this order.** They contain measured numbers you must not re-derive:

1. `docs/analysis-audit.html` - the full audit. Open it in a browser rather than grepping it.
   Green chips are closed; the reverted attempts are recorded beside them and are worth reading,
   because two of them are traps you could walk back into.
2. `CLAUDE.md` - house rules. Tabs, single quotes, ~100 columns, **no em-dashes anywhere**,
   comments say why and never what. `core` imports nothing at all. One effect per file.
3. `bench/METRICAL-VERDICTS.md` - four tempo-octave judgements made by ear by the repo owner.
4. The two memory files for this project, if your harness loads them.

## The measuring instrument

`bench/` is the only thing that decides whether a change is real. It is committed, so read it.

```sh
node bench/struct-cache.ts --dataset salami --shards 6   # once, ~8 min, freezes 374 tracks
node bench/struct-sweep.ts --label after --diff before    # sections, 4.4 SECONDS
node bench/tune.ts --run bench/<probe>.ts --in <file.ts> NAME=1,2,3   # grid-sweep constants
node bench/run-structure.ts --dataset salami --shards 6 --label x     # the full 7m36s run
node bench/run.ts --label after --diff baseline           # tempo/beat/downbeat, 764 tracks
node bench/levelprobe.ts        # delivered BYTES per section kind, and the share of LEDs lit
node bench/rotationprobe.ts     # catalog reach, peak variety, off-phrase cues, N seeded shows
node bench/hitprobe.ts          # which planned punctuation ever reaches the room
node bench/colourprobe.ts       # share of lit bytes on a hue the frame's palette can produce
node bench/contrastprobe.ts     # delivered drop-to-quiet ratio
node bench/flashprobe.ts <id>   # kick band vs the show's kickEnv, frame by frame
node bench/render.ts <id> [--from 60] [--seconds 45]      # show to video, audio muxed
node bench/reingest.ts --shards 2                         # re-analyse the cache in place
```

**The struct cache is why the last session got anywhere.** A full SALAMI pass is 7m36s and
almost all of it is decode, spectrogram and beat tracking, none of which a change to the
segmenter can touch. Freezing everything upstream of the bar table reproduces the full run's
figures **exactly** in 4.4 seconds. Rebuild it whenever you change anything upstream of
`barSynchronous`.

**Three traps that already cost time.** ONNX runs saturate the machine: use `--shards 2`.
Do not sweep a constant by re-importing a module with a cache-busting query string; the module
under test keeps the first instance of its dependency, so sweep in separate processes, which is
what `tune.ts` does. And never call `ingest()` on a path already inside `cache/`: it treats a
path as a new local file and re-keys the track by the hash of that path, writing a duplicate
under a `file-<hash>` id.

`bench/render.ts` and `bench/flashprobe.ts` are how you check what a number cannot. Use them on
every change in tasks 2 and 3, not only at the end.

## Ground rules

- **No change ships on vibes.** Run the relevant probe before and after. A change that helps the
  tracks in `cache/` and hurts the corpus is a regression.
- **Leave the suite green.** `npx vitest run` and `npm run check` both.
- **Do not touch `packages/author-ai`.** It benefits automatically from contract improvements.
  Keep it compiling; do not redesign it.
- **Do not commit** unless explicitly asked. Stage explicit paths, never `git add -A`.
- When a fix does not work, say so and revert it rather than tuning until the test passes. Three
  changes were abandoned on measurement last session and that was right every time.
- A contract change means `ANALYSIS_VERSION` (currently 6) and a re-analyse: `bench/reingest.ts`
  for the cache, `bench/struct-cache.ts` for the structure corpus.

---

## Task 1: the arrangement should come from the drums

**Measured, do not re-derive.** Across 374 SALAMI tracks, the share of BARS by section kind:

| kind | share of bars |
|---|---|
| groove | **78.0%** |
| breakdown | 8.1% |
| drop | 7.2% |
| intro | 2.5% |
| outro | 2.1% |
| build | 1.8% |
| void | 0.3% |

Four fifths of every track is labelled `groove`, which means the show has one instruction for
most of its runtime. That is the complaint, in a number.

**The hook already exists and is unused.** `arrange()` in `packages/analysis/src/arrange.ts`
receives `kicksPerBar` and `snaresPerBar` and uses them for **nothing but three event tags**
(`kick_in`, `kick_out`, `snare_roll`). Every label is decided by energy: a within-track quantile
for loud, `DROP_STEP` for whether a lift counts as a drop, `BREAKDOWN_STEP` for whether a dip
counts as a breakdown. Percussion never votes.

That is backwards for this repertoire. A drop is where the drums are densest and most complete;
a build is what precedes one, and is usually where the kick withdraws while the snare and the
noise floor climb; a breakdown is where the kit stops. The analysis now has good drum data to
decide with: onsets are punctual to 0.5 ms of the grid, sixteenth rolls resolve, each hit
carries a level, and only 4.5% of shipped kicks are inferred.

**The owner's decision: keep the seven lighting kinds** (`intro`, `groove`, `breakdown`,
`build`, `void`, `drop`, `outro`) and detect them better. Do not add a verse/chorus vocabulary.
If your research says the seven cannot express what the room needs, propose that as a finding
with evidence before building anything.

**Research before implementing, and say what you found.** Cover at least:

- drum-informed structure analysis: whether published segmenters use percussive features, and
  what they gain from them over timbre and chroma;
- what actually distinguishes a chorus or a drop from a verse in the literature, and how much of
  it is loudness against how much is arrangement density;
- how systems decide a *build*: it is the one section defined by its trajectory rather than its
  content, and the current detector only looks one segment back from a drop;
- whether `SectionSpan.group`, which already carries repeat identity, should decide labels: two
  sections of the same material arguably should not get different kinds.

Then design and implement, measuring at every step with `bench/struct-sweep.ts` (4.4 s) and
`bench/labelprobe.ts`. The targets, in order of importance:

1. `groove` well under 78% of bars, without inventing sections that are not there.
2. Boundary F0.5 and F3 not worse than **13.5% and 31.0%**, ideally better.
3. Pairwise F not worse than **53.8%**.

**A gotcha that will cost you an hour if you miss it.** The kick and snare counts inside the
struct cache were computed with the *old* drum detector. Rebuild the cache
(`node bench/struct-cache.ts --dataset salami --shards 6`) before trusting any drum-driven
result from `struct-sweep`.

Also open, and probably related: estimated sections currently overshoot at **16.25 against 11.68
annotated**, with over-segmentation NCE at 67.7%. `LAMBDA` in `structure.ts` is the dial and is
at 1.1; 2.2 gives 14.7 sections at the same F3 and 1.4 points less F0.5.

---

## Task 2: effects that react to the music

**The complaint, in the owner's words:** "when there are no drums/kicks in intro, the effects are
just plain color with a little drift, nothing fancy". That is accurate. The beds are slow
spatial fields modulated by four numbers.

**The decision: add a per-frame spectrum to the contract.** Roughly 16 to 24 log-spaced bands at
40 to 60 fps, precomputed at ingest, so an effect can do a real spectrum, VU or band-visualiser
look. Bump `ANALYSIS_VERSION`. Think about the cache cost before you choose the numbers: a
four-minute track at 50 fps by 20 bands is 240,000 values, so a compact encoding is worth ten
minutes of thought rather than shipping raw JSON floats.

What already exists, so you do not rebuild it:

- `TrackAnalysis.envelopes` carries energy and the four contract bands at **beat** resolution,
  added last session, and the player reads them there. The half-bar lead is fixed: an entry is
  the mean over its span so it is sampled half an entry back.
- `ShowFrame` carries `bands[0..3]` (sub/low/mid/air), `kick`/`snare`/`hat` with per-hit
  `kickEnv`/`snareEnv`/`hatEnv` levels, `pan` and `panWidth`, plus the grid and structure fields.
- `packages/analysis/src/dsp/spectrogram.ts` already builds a log filterbank; `features.ts`
  runs it at 100 fps with 24 bands per octave.

**The catalog may be rewritten freely.** Rework, replace or delete any of the 55 built-ins to
make them reactive. Every effect, old or new, must still pass `effects/gate.ts`: deterministic
(no `Math.random`, `Date`, `performance`), no allocation in `render`, `reset()` restores a fresh
instance, bounded and finite pixels. Colour goes through `SLOT` and `ctx.palette`; reach for
`paletteArc(u)` when an effect wants variety rather than one colour. Anything you add under
`src/dsl/` must be documented in `renderDslReference()` in `packages/author-ai/src/catalog.ts`.

Two constraints the last session established the hard way, both in the audit:

- **Gamma 2.2 is unforgiving at the bottom.** An authoring value under 0.081 quantises to byte 0
  and under 0.207 to byte 8. Judge brightness in bytes, with `bench/levelprobe.ts`, never in the
  authoring domain.
- **A bed is the floor of a cue**, and `EffectTaste.carries` marks the ones that cannot hold a
  room alone. The mixer has a house floor per section (`SECTION_FLOOR` in `player.ts`) which is
  what stops quiet passages going black; a void sets it to zero.

Measure with `bench/levelprobe.ts` (delivered bytes and coverage per section kind),
`bench/colourprobe.ts` (currently ~97% of lit bytes on a palette hue) and `bench/render.ts`.
Do not regress the delivered drop-to-quiet ratio far below **3.2** or the quiet sections below
**byte 32** with 100% coverage.

**One loose end worth fixing while you are here.** `carries` is enforced only for the bed. The
accent chosen for an intro or outro is very often `sparkle`, which contributes about 0.000, so
the second layer of a thin cue is a layer in name only. Requiring `carries` for that pick was
tried and reverted because only one accent in the catalog qualifies. Rewriting the catalog fixes
that properly.

---

## Task 3: punctuation that lands where the music does

**The complaint:** strobes are too long and sometimes start too early, and a blackout mixed in
with one ends before the phrase change so the room comes back up too soon.

**Measured across the cached shows, 91 hits:**

- **55 of 91 start off the 4-bar grid.**
- **43 of 91 have a length that is not a whole number of bars.**
- blackout: median **0.50 bars**, max 2.00; strobe: median 1.00 bars, max 2.00; bump 0.50; slam 1.00.

The blackout case is exactly what the owner described and you can read it in `planHits` in
`packages/author-engine/src/plan.ts`: the held-breath blackout is placed at `slot.bar - 1` with
`beats = max(1, round(beatsPerBar / 2))`, so it runs **half a bar from the start of the bar
before the drop** and the room comes back mid-bar, before the downbeat it exists to set up.

**Enforce hard rules, and enforce them in the linter so they cannot regress:**

- Every hit starts on a bar boundary; a hit that marks a structural change starts on a phrase
  boundary. `grid.ts` owns the arithmetic (`onPhraseGrid`, `nearestPhraseBar`, `phraseOffset`)
  and neither the analyser nor the linter may write the modulo out by hand.
- Every hit's length is a whole number of bars, or an explicitly justified fraction.
- The pre-drop blackout runs **to the drop downbeat**, not to somewhere inside the bar before it.
- Strobes are capped in bars **and** in seconds, because a bar is 1.4 s at 175 bpm and 3 s at 80,
  and the complaint is about how long it feels rather than how many bars it covers.

Useful context in `packages/core/src/player.ts`: overlapping hits now resolve by priority
(`HIT_PRIORITY`, blackout beats slam beats bump beats strobe) rather than by whichever started
first, which is what fixed the blackout never firing at all. All 91 planned hits currently fire;
keep it that way and verify with `bench/hitprobe.ts`.

There is deliberately no flash-rate ceiling in the linter and that is documented in `lint.ts`.
`FlashLimiter` in `output.ts` is WCAG 2.3.1 and was left alone on purpose. Do not weaken either
to make a number look better.

---

## Order

1. Task 3 first. It is the smallest, the rules are already decided, and it is the most visible
   thing in the room per hour spent.
2. Task 1, because the section labels decide which effects are chosen and when, so doing it
   before task 2 means the reactive work is measured against a sane arrangement.
3. Task 2, the largest, and the one that needs its research done before any code.

Then go back over all three and check nothing you did later undid something earlier. Re-run
`bench/run.ts`, `bench/run-structure.ts`, `levelprobe`, `rotationprobe`, `hitprobe` and
`colourprobe` end to end and put the final numbers in the audit.

## Keeping the audit current

`docs/analysis-audit.html` is the deliverable that records all of this. As you close an item:
mark its finding `class="f <severity> fixed"`, add `<span class="chip">fixed</span>` before the
title, append a short `<b style="color:var(--good)">Fixed: ...</b>` saying what the number
became, and update the cards and tables. Add findings for anything new you discover, in the same
form. The page is theme-aware and self-contained; keep it that way.

Report what each change did to the numbers. If something does not work, say so plainly and
revert it.
