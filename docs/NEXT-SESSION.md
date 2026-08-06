# Implementation session: finish the analysis and mixing overhaul

Paste everything below the line as the opening prompt for a fresh session.

---

You are continuing an overhaul of music analysis and effect mixing in this repo (Room, a
1320-pixel LED show driven by DSP). A previous session audited the whole DSP-to-light path
against annotated ground truth, fixed part of it, and left the rest measured and open.

**Your job is to work until every item below is resolved.** Not triaged, not planned: resolved,
meaning either fixed with a measurement that proves it, or attempted, measured, found not to
work, reverted, and written up as such. Do not stop at the first hard one. Do not stop to ask
which to do next; the order is given at the end. Ask only when a decision is genuinely the
owner's, and keep working on everything else while you wait.

An item is done when all four are true: the change is in, the relevant benchmark moved (or is
explicitly recorded as flat), `npx vitest run` and `npm run check` are both green, and the entry
in `docs/analysis-audit.html` is marked fixed. Keep a running checklist and report progress
against it as you go.

**Read these first, in this order.** They contain measured numbers you must not re-derive:

1. `docs/analysis-audit.html` - the full audit. Items already fixed are marked in green with a
   "fixed" chip; everything else is open. Open it in a browser, do not just grep it.
2. `bench/METRICAL-VERDICTS.md` - four tempo-octave judgements made by ear by the repo owner,
   and the record of a corrector that was built, measured and abandoned.
3. `CLAUDE.md` - house rules. Tabs, single quotes, ~100 columns, **no em-dashes anywhere**,
   comments say why and never what. `core` imports nothing at all. One effect per file.
4. The two memory files for this project, if your harness loads them.

## The measuring instrument, which already exists

`bench/` at the repo root is gitignored and is the only thing that decides whether a change is
real. It is mir_eval 0.8 reimplemented in TypeScript and validated against degenerate cases.

```sh
bash bench/fetch.sh                                  # corpora, idempotent, resumes
node bench/run.ts --label before                     # tempo/beat/downbeat/meter, 764 tracks
node bench/run.ts --label after --diff before        # the delta
node bench/run-structure.ts --dataset salami --shards 3 --label s-after   # sections, 374 tracks
node bench/run-beatthis.ts --dataset gtzan --shards 2 # the model on its own
node bench/render.ts <trackId> [--from 60] [--seconds 45]   # show to video, audio muxed
node bench/clicktest.ts <trackId>...                 # A/B click test for tempo disputes
```

`MV_MODEL_DIR=<repo>/bench/models` if the Beat This weights are already there; otherwise they
are fetched on demand and SHA-pinned.

**Two traps that already cost time.** The ONNX runs saturate the machine: use `--shards 2` and
expect a load average near 40 if you do not, which makes every wall-clock measurement
meaningless. And do not sweep a constant by re-importing a module with a cache-busting query
string, because the module under test imports its dependency by the plain specifier and keeps
the first instance; sweep in separate processes.

`bench/render.ts` is how you check the things a number cannot: whether a flash lands on the
kick, whether a drop reads. Use it on every change in tasks 4 to 6, not just at the end.

## Ground rules

- **No change ships on vibes.** Run the relevant benchmark before and after. A change that
  helps the tracks in `cache/` and hurts the corpus is a regression.
- **Leave the suite green.** `npx vitest run` and `npm run check` both.
- **Do not touch `packages/author-ai`.** The owner has ruled the AI show-creation path out of
  scope. It benefits automatically from fixes to `barTimeAt` and friends.
- **Do not commit** unless explicitly asked. Stage explicit paths, never `git add -A`.
- When a fix does not work, say so and revert it rather than tuning until the test passes. The
  previous session abandoned two changes on measurement and that was the right call both times.

## Task 1: the one failing test, and the limitation under it

`packages/analysis/src/analyze.test.ts > sections > gives the peak rank to the loudest
arrangement stage` fails: the peak lands at bar 3, expected inside the drop at bar 26.

Diagnosed, do not re-diagnose: the segmenter places the drop boundary three bars early, pulling
the fixture's two silent void bars into the drop section and diluting its mean energy below an
earlier groove. The quantiser is correct here - it rightly invents no kicks in silence.

The root cause is a layer down. `barSynchronous` in `packages/analysis/src/structure.ts`
L2-normalises each bar's pattern vector, so **amplitude is invisible to `similarityMatrix`**. A
drop and the groove behind it playing the same figure at different levels are literally
identical to the segmenter, so it has no reason to put a boundary between them. `bars.rms` is
already computed and unused for this.

A naive level term (`0.62 * pattern + 0.22 * chroma + 0.16 * level`, level from a log-amplitude
ratio over 1.5 octaves) was tried and did not separate them, because the fixture's stages differ
by under 2 dB. Something better is needed: a tighter level tolerance, a contrast measure rather
than a ratio, or a separate novelty term over `bars.rms` added to the DP objective rather than
to the similarity. Measure on SALAMI, not on the fixture.

`MAX_SEGMENT_BARS` is pinned at 16 for the same reason. At 32 the synthetic control is correct
(five 32-bar blocks recover as 5 segments, not 20) but this invariant breaks. Once level is
represented, raise it and re-measure both.

## Task 2: sections

Measured on 374 SALAMI tracks, whose audio is the exact file that was annotated:

| metric | before | after | reference |
|---|---|---|---|
| boundary F0.5 | 8.6% | **11.6%** | |
| boundary F3 | 20.5% | **25.6%** | 0.505-0.582 for "a boundary every 3 s"; 0.6061 Marmoret et al. |
| pairwise F | 51.6% | 52.3% | 0.447-0.499 for one label over the whole track |
| over-segmentation | 59.0% | 63.0% | |
| under-segmentation | 36.0% | 33.3% | lower is better |
| sections found | 8.4 | **11.5** | 11.7 annotated |
| longest section | 42.6% | **21.1%** | of the track |

**The segmentation work stays.** F3 moved a quarter in relative terms, section count went from
under-counting by a third to essentially exact, and the longest section halved. Do not revert it.

It is still poor in absolute terms, and the shape of the error tells you where to go: F0.5 at
11.6% against F3 at 25.6% means **less than half the boundaries that land within three seconds
land within half a second**. They are near the truth, not on it. Task 1's level blindness is the
most likely reason a boundary lands three bars early, so do Task 1 first and re-measure this
before reaching for anything more elaborate.

Still open here:

- `arrange.ts:155` labels sections by within-track energy quantile, so `breakdown` does not mean
  quiet. Measured overlap across the cached tracks: breakdown spans energy 29-89 and groove
  spans 64-94. The `hasDrops` gate picks a vocabulary per track for the drop label only;
  nothing equivalent gates breakdown.
- `SectionSpan.group` now exists and carries repeat identity. Nothing consumes it yet.
- `PHRASE_BARS` is 4 but `tempo.barsPerPhrase` ships 8, and `phraseAnchorBar` is fitted mod 4
  and consumed mod 8 in `player.ts:243`. Only 54 of 115 section starts fire `f.phraseStart`.
- A section composed entirely of digital silence is still labelled `outro` and lit.

## Task 3: drum detection, and repetition as the correction

**The owner reports that drum detection sometimes plainly does not work.** That is consistent
with what was measured, and there are two separate faults.

Known and measured:

- **The kick curve peaks 24-42 ms behind the curve the beat grid is fitted to.** Two different
  onset functions feed the two things that must agree: `onsets.ts:74` subtracts a
  frequency-max-filtered reference frame, `drums.ts:31` does not. Measured signed offset to the
  nearest sixteenth: beat path +2.9 to +5.3 ms, kick path +24.1 to +42.1 ms. Every kick flash is
  systematically late. Fix this first; it is the most visible thing in the room.
- `kickGap = max(0.07, beatPeriod * 0.4)` makes sixteenth-note kicks undetectable at every
  reachable tempo: 67 of 144 detected at 120 bpm, 1 of 211 at 175 bpm.
- `kickCurve = kickBand - 0.8 * bassBand` subtracts two curves each normalised by its own
  99.5th percentile, so the effective weight lands anywhere from 1.16 to 4.08 depending on the
  track, and it defends a register the band edge already excludes (kick-band response at 110 Hz
  is 0.018).
- HPSS `BETA = 2` sends 46% of kick-band cells to neither side; only about 6% of the band's
  magnitude survives into `percussive`. A soft Wiener mask over the same medians keeps 21-34%.
- `invented[]` is computed by `quantiseOnsets` and thrown away by `analyze.ts`. 19.6% of shipped
  kicks (1249 of 6379) were completed from the pattern, not detected.
- Per-hit strength does not exist: `f.kickEnv` is exactly 1.0 on 6379 of 6379 kick frames, so
  `kickTunnel`'s ring power has one distinct value across the whole corpus. The peak strength is
  computed in `drums.ts` and dropped at the map. This needs a contract change: onset times gain
  an index-aligned level array and the player scales `FlashEnvelope.fire()` by it.

**Then the part to research before implementing.** Percussion in this repertoire is overwhelmingly
periodic, and that redundancy is evidence the detector is currently not using. The existing
pattern completion is a crude version of the idea and it is why a fifth of shipped kicks are
fabricated: it votes over fixed 8-bar windows, ignores how confident each detection was, and can
only add, never remove or move.

Research the literature before writing code, and say what you found. Cover at least:

- pattern- and template-based drum transcription: NMF with learned or track-adapted kick and
  snare templates, and the "partially fixed" NMF variants that adapt a template to the track;
- how published systems use periodicity to correct a detection rather than to invent one, and
  what they do about a fill or a break where the pattern legitimately stops;
- whether a per-section pattern is better than a per-window one, now that
  `SectionSpan.group` gives you repeat identity for free: two sections in the same group should
  have the same drum pattern, and disagreement between them is either a fill or a detector error;
- confidence-weighted decisions: keeping a detection's strength through the pipeline so a
  marginal hit can be promoted when the pattern expects it and demoted when it does not;
- what ADTOF-class systems score on kick and snare separately in polyphonic music, so you know
  what a good result looks like.

Then design and implement, measuring at each step. The target is fewer fabricated hits AND fewer
misses, not one at the cost of the other. Report both counts separately; a single F-measure will
hide the trade you are making. `bench/kickprobe.ts` already reports detected, shipped, invented
and displaced per track.

## Task 4: effect rotation, and the palette

**The owner reports three specific things.** All three are corroborated by the audit.

1. **After the strobe there should be another effect.** `planHits` in `author-engine/src/plan.ts`
   runs strobe out of the build, blackout for the held breath, slam on the drop downbeat for one
   bar, and then nothing for the rest of the drop. The drop is a static layer stack from there.
   Give the loud passages further punctuation after the slam, and make it different from the
   slam rather than a repeat of it.
2. **The rotation should introduce more effects within one song, and changes should land on the
   beat.** Measured: 11 of 55 built-ins are never placed in any cue on any track;
   `buildStrobe` and `colorBump` are unreachable by construction; `riser` never wins in 300
   seeded shows. Taste metadata does not discriminate - all twelve bed effects list all seven
   section kinds and the `maxBars` limits never bind - so `EffectPicker.strongest` breaks a
   three-way tie by id and **`chromaBurst` wins the peak on every single track**. `MAX_CUE_BARS`
   is 16, so a long section holds one look for four phrases. Widen the rotation, make the
   selection actually depend on the music, and put every change on a beat or phrase boundary
   (`grid.ts` has `onPhraseGrid` and `nearestPhraseBar`; the linter already enforces this for
   cues, so extend the same discipline to hits and interior look changes).
3. **Effects should use the song's palette.** Six of them do not read it at all and call
   `hsv2rgb` with their own hues: `auroraBorealis`, `chromaBurst`, `hueCarousel`, `iridescence`,
   `rainbowRain`, `vortex`. Combined with the tiebreak above, this means **the biggest moment of
   every show is lit by an effect that ignores the track's colour identity**, which is exactly
   the complaint. Route them through `SLOT` and `ctx.palette` like the rest. Where an effect is
   deliberately spectral (a rainbow is a rainbow), say so in a comment and keep it, but it must
   then not be reachable as the peak look on a track whose palette says otherwise.

Every effect you touch must still pass the gate in `effects/gate.ts`: deterministic, no
allocation in `render`, `reset()` restores a fresh instance, bounded and finite pixels. Use
`bench/render.ts` to watch the result against the audio; a rotation that reads well as a list of
cue names can still look mechanical in the room.

## Task 5: effect mixing and the output chain

- **`MeanLevel` deletes about three quarters of the show's contrast.** Measured by running the
  real player and mixer over 15 tracks with it live and stubbed: authored drop-to-breakdown
  ratio 8.03x, delivered 1.99x. `mixer.ts:143`.
- **The held-breath blackout before a drop never fires.** Overlapping hits resolve by `find()`,
  which returns the earliest match; 9 of 117 planned hits never fire and every one is that
  blackout - the move the README calls the strongest in the vocabulary. `player.ts:403`.
- `f.energy` and `f.bands` are per-bar means linearly interpolated, so they lead the audio by
  half a bar and 12-43% of the true band-envelope variance is within-bar and unreachable.
- `FlashLimiter` clamps 14.6% of all frames and sits pinned between 0.336 and 0.426 through the
  biggest drop of a track.
- Nothing reads `bars[].events`, `analysis.moments`, `loudnessRange` or `peakToLoudness`, and
  only two effects read stereo pan.

## Task 6: expose the tempo-octave correction

Metrical level is unreliable in both trackers on this repertoire and that is settled, not open:
the two disagree on 7 of the owner's 15 tracks and an ear test split those 2-2.

Measured on 664 GiantSteps dance tracks, the model is better on average and worse in the tail:
tempo Acc1 76.1% to **83.0%**, but Acc2 95.2% down to **92.2%**. So it picks the right tempo
more often, and when it fails it fails harder - three per cent more tracks land on a tempo that
is not even a metrical relative of the truth. Melanz is that case: 79 against a true 120, a
two-against-three relationship, which **a half/double control cannot repair**. So the control
below is necessary and not sufficient; offer thirds as well, or accept that a small tail needs
`reanalyse` with an explicit bpm.

`assessMetricalLevel` in `packages/analysis/src/metricalLevel.ts` already reports `ambiguous`
and a list of `alternatives`. Nothing surfaces it. Add a half/double control to the app for
tracks flagged ambiguous, re-running against the cached analysis.

## Task 7: keep the audit current

`docs/analysis-audit.html` is the deliverable that records all of this. As you finish each item:

- mark its finding `class="f <severity> fixed"` and add `<span class="chip">fixed</span>` before
  the title, which turns the title green;
- append a short `<b style="color:var(--good)">Fixed: ...</b>` to its body saying what the
  number became;
- update the cards at the top and the section table with the new measured values;
- add findings for anything new you discover, in the same form.

The page is theme-aware and self-contained; keep it that way. If the harness offers an Artifact
tool, republish the same file path so the existing URL keeps working.

## Order

1. Task 1, because the suite must be green before anything else is trustworthy.
2. Task 2's after-measurement, because it decides whether the segmentation work stays.
3. Task 3, kick timing first, then the repetition research and rebuild.
4. Task 4, palette first (it is small and the peak look is wrong on every track), then rotation.
5. Task 5, `MeanLevel` and the lost blackout first.
6. Tasks 6 and 7 as you go.

Then go back over tasks 2 to 5 and check nothing you did later undid something you did earlier;
re-run both benchmarks end to end and put the final numbers in the audit.

Report what each change did to the numbers. If something does not work, say so plainly and
revert it. Keep going until the checklist is empty.
