# Handover, and the brief for the next session

The state of the repo as of commit `4629f2c`, and then three recommendations. Everything below
the line is a prompt to paste; everything above it is for you.

## Where things stand

Eight commits landed this session, on `master`:

- `8ccb6cb` the Harmonix corpus, which had never scored a single track
- `34f4f42` sections decided by a fitted model, and the spectrum given a shared reference
- `ef01931` the catalog audited, three systematic bug classes fixed, `barFill` added
- `f600e9d` `drift` and `colour`, which measure movement at musical timescales
- `9932f41` the palette actually taken from the cover
- `3099393` the planner preferring layers that show the music in a quiet cue
- `627bfc7` the audit page
- `4629f2c` the AI author's description of the spectrum, which the contract change had falsified

381 tests green, `npm run check` clean. `ANALYSIS_VERSION` is 9 and `SHOW_VERSION` is 3, so every
cached blob older than this session re-analyses on load. The cache holds 45 tracks. The catalog is
64 effects.

`docs/analysis-audit.html` is the running record and now carries ten passes. Read the seventh
through tenth before touching any of this: they contain measured numbers you must not re-derive,
and eight attempts that were tried, measured and abandoned.

## What this session did not do, in order of how much it matters

**Nobody looked at the room.** Everything here is defended by numbers and nothing was watched.
`bench/render.ts <id>` renders a show to video with the audio muxed and was never run. Both of the
owner's complaints this session were real and both were invisible to every metric the repo had at
the time; each took hours of new instrumentation to locate. Render two or three tracks and watch
them before believing any of the numbers below.

**Drum separation, which was an explicitly chosen target.** No clean drum stem, no vocal signal.
The audit calls snare detection the weak link and it is untouched.

**MusicFM, measured and not shipped.** Worth +3.3 points of section accuracy and +5.8 macro F1 over
the hand-built features, earned mostly on intro and outro. Deferred deliberately in favour of the
no-model win, which was worth +16. The bench-side extractor and the 115-track feature cache are
reproducible from `bench/kindfit.ts --embed`; nothing in `packages/` depends on them.

**Most of what the LedFx research turned up.** Only the normalisation lesson was taken. Left on the
table: the `peak_isolation` power law, the pre-emphasis tilt, rise-faster-than-fall smoothing as a
general rule, and `melbank_filtered` - band level minus a slowly-rising baseline, which the
research called the second half of the answer to a loud passage having no reaction left.

**A full `run-structure` pass on SALAMI after the section model landed.** Only `struct-sweep`, the
4.4 s frozen-cache proxy, was used throughout. The audit's own note is that the two are not
identical instruments: on the same code they gave pairwise 53.0 and 53.3.

Also open: 11 effects still score under 0.02 on `quiet` and 11 still reach past the palette;
`taste.quiet` has no test guarding it because the probe needs the audio cache; and reverting six
effects wholesale threw away whatever genuine fixes sat alongside the regressions in those files.

---

# Session: give the room a way to tell you it is wrong

You are continuing work on Room, a 1320-pixel LED show compiled offline from a DSP analysis. The
last session rebuilt the section labeller, the spectrum and most of the effect catalog against
measured ground truth, and left the audit at `docs/analysis-audit.html` recording ten passes.

**Read these first, in this order.** They contain measured numbers you must not re-derive:

1. `docs/analysis-audit.html`, passes seven to ten. Open it in a browser rather than grepping it.
   The reverted attempts are recorded beside the changes they were tried against and several of
   them look obvious enough to walk back into.
2. `CLAUDE.md` - house rules. Tabs, single quotes, ~100 columns, **no em-dashes anywhere**,
   comments say why and never what. `core` imports nothing at all. One effect per file.
3. The project's memory files, if your harness loads them.

## The instruments

`bench/` is the only thing that decides whether a change is real. It is committed, so read it.

```sh
node bench/render.ts <id> [--from 60] [--seconds 45]   # show to video, audio muxed. USE THIS.
node bench/levelprobe.ts        # delivered bytes, move, shape, drift and colour per section kind
node bench/flickerprobe.ts      # ripple, and how many effects shimmer. The blinking guard.
node bench/effectprobe.ts       # fill, concentration, palette fidelity, reactivity, quiet
node bench/quietprobe.ts        # what each bed and accent delivers over REAL quiet sections
node bench/kindprobe.ts         # the seven lighting kinds against annotated function, Harmonix
node bench/kindfit.ts           # what a classifier gets from the same features, k-fold by track
node bench/ceilingprobe.ts      # how much of the structure loss is boundaries and how much labels
node bench/struct-sweep.ts --label x --diff y         # sections over 374 SALAMI tracks, 4.4 s
node bench/rotationprobe.ts     # catalog reach, peak variety, off-phrase cues
node bench/hitprobe.ts          # which planned punctuation ever reaches the room
node bench/reingest.ts [--compose-only]               # re-analyse or re-compose the cache
```

**Constraints that must not regress**, all currently held: drop-to-quiet contrast at or above
**3.2** (now 3.45), quiet sections at or above byte **32** with 100% of LEDs lit (now 33.0), zero
shimmering effects (now zero, mean flicker 0.48), and every planned hit firing (now 461 of 461).

**Traps that have already cost time.** ONNX runs saturate the machine: use `--shards 2`. Do not
sweep a constant by re-importing a module with a cache-busting query string; sweep in separate
processes, which is what `tune.ts` does. Never call `ingest()` on a path already inside `cache/`.
And a metric measured on synthesised frames can rank effects backwards against real audio: that
mistake shipped once this session and made the room worse, which is why `quietprobe` exists.

---

## Task 1: let the owner mark a moment

**This is the important one, and it is not a lighting change.**

Both complaints raised last session were correct and both were invisible to every number the repo
had. Locating each one meant building a new instrument first. Everything in Room is defended by
measurement except the only thing that finally matters, which is whether it looks good, and the
owner is the sole instrument for that. The app gives them three keys: space and two arrows.

Add a way to record what they see, while it plays. A key that writes the current
`{bar, section, layers, intensity, motion, t}` into the track's cache, and a second key for the
opposite sign, because knowing which cues are GOOD is worth as much as knowing which are wrong when
the catalog holds 64 effects and nothing knows which ones this owner actually likes.

What that buys, immediately: a marked cue is a render command and a diff, so "the intro feels dead"
becomes a list of bars to look at. Over a few sessions it becomes the only training signal in the
project that is about taste rather than about agreement with an annotation.

Keep it small. It is a key handler, a cache file and a line in the inspector. Do not build a review
UI, and do not let it touch the show contract.

## Task 2: let them reroll a show

`composeShow` already takes a seed and the app never passes one, so the seed is the analysis hash
and **the same track is the same show forever**. That is right for reproducibility and wrong for
living with the room.

A button that re-composes with a different seed, and keeps the last few so one can be pinned. The
engine is deterministic and a show is about a millisecond to compose, so this is nearly free.

Together with task 1 this is a taste loop: mark what is wrong, reroll, compare. Without task 1 it
is only a shuffle button, so do them in this order.

## Task 3: separate the stems

The biggest missing musical input, and the one target chosen last session that was never touched.

`vocalGlow` is in the catalog and is driven by `f.bands` and `f.pan`. It is guessing from the mid
band, and the word "vocal" appears in the contracts only as prose. This repertoire is song-led, and
the voice is what a listener follows.

One separation model gives three things at once: a real vocal presence curve, the clean drum stem
that would fix the snare detection the audit calls the weak link, and an instrumental signal for
the very common moment where the vocal drops out and the beat takes over, which Room cannot see at
all today.

**Research the licence before anything else.** MIT or Apache on both the code AND the weights; the
owner has accepted CC-BY-NC weights for personal use but MIT is available in this space and is
better. Then measure the drum stem against `bench/drumlab.ts` before designing any contract change,
because a stem that does not move kick and snare F is not worth an `ANALYSIS_VERSION` bump.

This is the expensive one: a model download, ingest time, and a contract change. Do not start it
before tasks 1 and 2 are in, because task 1 is what tells you whether it was worth it.

## A smaller one, if there is room

The hit anticipation in `player.ts` is a compile-time constant set from perceptual research
(`HIT_LEAD_BEATS`, `HIT_LEAD_CAP`). DDP and WLED add transport delay in the opposite direction that
the compiler cannot know. A live trim in the player bar would let the owner dial it against the
real strips in about a minute; today it needs a code edit and a re-render.

## Ground rules

- **No change ships on vibes.** Run the relevant probe before and after. A change that helps the
  cached tracks and hurts the corpus is a regression.
- **Watch the room.** `bench/render.ts` on at least two tracks per visible change, not only at the
  end. This is the rule the last session broke.
- Leave the suite green: `npx vitest run` and `npm run check` both.
- **Do not commit** unless explicitly asked. Stage explicit paths, never `git add -A`: there is
  untracked work in `firmware/` that a blanket add will sweep in.
- When a fix does not work, say so and revert it rather than tuning until the number moves. Eight
  changes were abandoned on measurement last session and that was right every time.
- A contract change means bumping `ANALYSIS_VERSION` (currently 9) and re-analysing:
  `bench/reingest.ts` for the cache, `bench/struct-cache.ts` for the structure corpus.
- Keep `docs/analysis-audit.html` current as you close items, in the form the existing findings
  use. Add findings for anything new, including the ones you abandon.
