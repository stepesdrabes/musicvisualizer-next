# Three things worth adding

Room measures almost everything. The analysis is scored against annotated corpora, the catalog
against synthesised journeys and the delivered room against its own probes, and the discipline of
reverting whatever fails to move a number has been right every time it was applied.

It measures everything except whether the room looks good.

That gap has a cost, and it is now documented rather than suspected. Two faults reported from the
room by the owner - a full-stack drop that read as "just colour with basically no reaction", and an
intro and outro with almost no movement in them - were both real, and both were invisible to every
number the repo had at the time. Locating each one meant building a new instrument first: the drop
needed a level-versus-movement correlation over the corpus, the intro needed `drift`, a metric for
movement at musical timescales, because the existing one was a per-frame delta and an intro has no
drums in it by construction.

Each of those took hours. The information needed to point at them directly was available in about
a second, to the person watching.

The three proposals below are ordered by that argument. The first is not a lighting change at all.

> **Written 2026-08-09, before the bench harness was removed.** Every instrument it names is gone,
> deliberately: the measurement apparatus is being rebuilt from nothing rather than extended. The
> argument survives that and the ordering was right, so this is kept and corrected rather than
> rewritten. Proposal 2 and the smaller one shipped on 2026-08-10.

---

## 1. A way to mark a moment

> **Declined 2026-08-10.** Built and reverted the same day. The capture works and is cheap; what
> it has no answer for is who reads it. Nothing in the repo consumes a mark, so until something
> does it is a write-only log that costs a habit to keep up, and the owner talks to an agent that
> can already open the show, the analysis and the cue sheet when told which passage looked wrong.
> Worth revisiting only alongside the thing that would read it.

**The app has no way to record what the owner sees.** The only route from "that looked wrong" to
a fix runs through prose, a guess about which subsystem is responsible, and a new probe.

Record it instead. While the show plays, one key writes the current moment into the track's cache:
bar, section, the cue's layer stack, its intensity and motion, and the time. A second key records
the opposite sign.

Both signs matter, and the second one is easy to skip. The catalog holds 63 effects and nothing in
the system knows which of them this owner actually likes; every ranking in the repo is agreement
with an annotation or movement against a probe, and neither is taste. A list of cues that looked
good is the only signal in the project that would be.

What it buys immediately is a shorter loop. A marked bar is a place to go back to and a diff, so
"the intro feels dead" becomes a specific passage, a specific layer stack, and a comparison against
a rerolled version of the same bars. Over a few sessions the marks accumulate into something
better: a record of which effects, in which sections, at which intensities, this room is actually
liked in.

**Scope it small.** A key handler, a file in `cache/`, a line in the inspector. It should not build
a review interface and it must not touch the show contract. The value is in the capture, and a
capture that takes a week will not get used.

> **Keys already taken**, since the frontend overhaul landed: space plays, the arrows seek,
> shift-arrows seek further, `Cmd-K` opens the search palette, and `[` and `]` collapse the two
> rails. A mark wants something under the other hand; `m` and `n` are both free.

## 2. Let a show be rerolled

> **Shipped**, and without the first proposal, against the ordering below. Reroll, in the show
> panel. The seed the engine resolved is written onto the show and each roll steps from the last,
> so the third reroll of a track is the same third reroll next week and a composition that looked
> good can be reached again. It is offered on engine shows only: rerolling runs the engine, so on
> a Claude or DeepSeek show it would spend nothing and destroy something that cost credits. Not
> built: pinning. Rolls are a sequence rather than a shortlist.

`composeShow` already accepts a seed. The app never passes one, so the seed falls back to the
analysis hash and **the same track is the same show forever**.

That is deliberate and it is right for reproducibility: a given track compiles to a given show, the
tests can assert it, and a bug reproduces. It is wrong for living with the room, where the second
and fiftieth play of a favourite track are the same picture.

A control that re-composes with a different seed, keeping the last few so one can be pinned, is
close to free. The engine is deterministic and composes a complete show in about a millisecond, so
this is a parameter and a button rather than a feature.

Do it after the first proposal, not before. On its own it is a shuffle control. Combined with
marking it is a loop: see something wrong, mark it, reroll, compare the marks. That loop is the
reason to build either one.

## 3. Separate the stems

The largest missing musical input, and the only one of these that is expensive.

`vocalGlow` is in the catalog, and it is driven by `f.bands` and `f.pan`. It is guessing at the
voice from the mid band and the stereo image, because there is nothing better to read: the word
"vocal" appears in the contracts only as prose, in a comment describing what the mid band tends to
contain. This repertoire is song-led, and in a song the voice is what a listener is following.

One separation model yields three things at once:

- **A vocal presence curve.** The room could follow the singer, which is the most direct thing a
  song-led show can do and is currently impossible.
- **A clean drum stem.** The audit calls snare detection the weak link, with a measured F-measure
  well below the kick's, and every drum-derived decision in `arrange()` rests on it.
- **An instrumental signal.** The moment where the vocal drops out and the beat takes over is one
  of the most common gestures in this music, and Room cannot see it at all.

Two gates before any of it is built. **Licence first**: MIT or Apache on the code *and* the
weights, checked on the actual model card rather than the repository badge, because the two differ
constantly in this field. Permissive options exist here, so there is no need to spend the owner's
tolerance for non-commercial weights. **Then measure the stem against annotated drum onsets**
before designing any contract change: a stem that does not move kick and snare F-measure is not
worth an `ANALYSIS_VERSION` bump and the re-analysis of the whole cache that comes with it. That
instrument no longer exists, so this gate now has to be built before the model is worth
downloading, which pushes the whole proposal further out than it reads here.

This should be last. It is a model download, real ingest time and a contract change, and the first
proposal is what would tell you whether it was worth its cost.

---

## A smaller one

> **Shipped, on a different knob than this asks for.** `HIT_LEAD` shifts only where drum onsets
> are read, while DDP and WLED delay the whole frame, so exposing it would have left the rest of
> the show late and dragged the drums out of the picture they belong to. The frame-wide knob
> already existed at both ends and was reachable from neither: `previewOffsetMs` on the browser's
> renderer, written by nothing, and `offsetMs` on the server's, accepted in the API and never
> sent. The trim is the server one, since that is the one that moves the wire and leaves the
> preview alone. It lives in the board panel beside the round-trip figure it compensates, rides
> along on the half-second sync so it can be dialled against lit strips, and is persisted per
> installation rather than per track.

The hit anticipation added this session is a compile-time constant in `player.ts`
(`HIT_LEAD_BEATS`, `HIT_LEAD_CAP`). It leads the playhead by 21 to 45 milliseconds depending on
tempo, on the grounds that frame quantisation alone is up to 16.7 ms late and that the perceptual
tolerance is strongly asymmetric: detectability is around 45 ms when the picture leads against 125
ms when it lags.

DDP and WLED add transport delay in the opposite direction, and the compiler cannot know how much.
A live trim would let the owner dial it against the real strips in about a minute. Today it needs
a code edit and a re-render.

## What is deliberately not proposed

Two things were investigated this session, measured, and left out on purpose. They are recorded
here so they are not mistaken for oversights.

**MusicFM.** A music foundation model with MIT code and MIT weights, and the best published on this
exact task. Measured on 115 annotated tracks it is worth about +3.3 points of section accuracy and
+5.8 macro F1 over the hand-built features, earned mostly on intro and outro. It was not shipped
because the same measurement showed a plain classifier over the features the analysis *already*
computes was worth +16, and that landed instead. Shipping the model means a 1.3 GB checkpoint
exported to ONNX and a second decode pass, for a fifth of the gain. Worth revisiting only once the
cheap win has been watched in the room and found wanting.

**Most of LedFx's audio path.** Only the normalisation lesson was taken, and it was the large one.
Left deliberately: the `peak_isolation` power law, the pre-emphasis tilt, rise-faster-than-fall
smoothing as a general rule, and `melbank_filtered`, which is band level minus a slowly-rising
baseline and is aimed squarely at a sustained loud passage having no reaction left in it. That last
one is the most promising and would be the first to try if a drop still reads flat.

## Known gaps these build on

- **Nobody has watched the room.** Every result from the last session is a number, and the
  renderer that would have produced a picture was never run before it was removed. This is still
  open, and declining the first proposal leaves it open by a route nobody has chosen yet.
- 11 effects still scored under 0.02 on reactivity, and 10 of the ones that may appear in a quiet
  section scored under 0.02 there. Both figures came from the effect probe and neither can be
  reproduced today; `measureEffect` in `packages/core` still computes the same columns for one
  effect at a time, so what is missing is the sweep over the catalog, not the measurement.
- **No effect reaches past the palette for a colour.** The eleven that were reported as doing so
  were an artefact of the probe, which compared each delivered pixel's hue against the palette's
  hue in *degrees*. `hsv2rgb` is FastLED's rainbow ramp and spends no coordinates at all between
  about 150 and 223 degrees, so a correctly addressed cyan accent left the room near 150 and was
  counted as a colour the show never declared - exactly the trap `rampHueFor` was written to
  document. Measured against the hues the palette actually delivers, the count is zero, and
  `packages/core/src/effects/probe.test.ts` proves the column can still fail by failing a
  hardcoded magenta.
- `taste.quiet` has no test guarding it, unlike `carries`, because the measurement it comes from
  needs the audio cache and a test may not depend on that. It now has no producer either: 27
  effects declare a number that nothing in the tree can regenerate or falsify, and the planner
  chooses on it. Changing a quiet-pool effect, the spectrum or the house floor silently
  invalidates it.
- Six effects were reverted wholesale during the catalog audit to remove measured regressions,
  which also discarded whatever genuine fixes sat alongside them in those files. They were not
  sifted.
