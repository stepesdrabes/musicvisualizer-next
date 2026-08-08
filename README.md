# Room

A lighting show for a 5 x 4 m room with five addressable LED strips: four wall runs at
2.4 m forming a closed perimeter ring, plus one ceiling beam. 1320 pixels at 60 LED/m.

The same bytes drive a three.js preview of the room and the real strips over DDP.

## The idea

Claude has no ears. As of August 2026 there is no audio input modality, and feeding a
vision model a spectrogram does not rescue it: VLMs sit near chance on spectrogram tasks,
and at Opus 5's resolution cap a four-minute track is about 2.6 s per image patch column.
Audio models that *do* have ears score under 30% on structural segmentation with
timestamps, and collapse their answers to round numbers like "60s".

So the split is:

**DSP decides *when*. Claude decides *what* and *why*.**

Local analysis produces a bar-indexed table of the track: tempo grid, downbeat phase,
sections with energy ranks, per-bar band energies, onset lists, and a list of cue-worthy
moments. Claude only ever emits bar indices, and a linter rejects anything that is not in
the supplied grid. It cannot invent a timestamp because it is never asked for one.

What is left for the model is the part DSP cannot do: pacing, restraint, colour discipline,
interpretation, and knowing which single moment deserves the biggest move.

It is not working blind, either. It gets the audio file and a shell, so it can run ffprobe and
ffmpeg against it; and web search, so it looks the track up - artist, scene, published tempo
and key, lyrics, whether the act has a visual identity - and designs for what the song
actually is rather than for its genre. Tempo is the one thing research may override: if the
detected figure disagrees with a published one by a suspicious ratio, it can call `reanalyse`
and the whole grid is rebuilt around the corrected value.

The system prompt is written to Anthropic's Opus 5 guidance (no self-verification
instructions, no shouted emphasis, the hardest constraint restated last) and the craft in it
is attributed - Rosenberg on spending strong colour sparingly, Sinclair on putting the darkest
cue immediately before the brightest, Rutherford on which colours mechanically dominate which,
the Pixar colour-script idea, and Mickey Mousing as the name for the trap of illustrating
every lyric.

## Layout

Dependencies flow downward only. `core` imports nothing at all, which is what lets the same
show run in a browser, in headless Node, and eventually on an ESP32.

```
apps/web              SvelteKit, one screen
packages/preview3d    three.js room view          -> core
packages/transport-ddp  DDP over UDP              -> core
packages/author-ai    Claude Agent SDK, tools, sandbox  -> core, analysis, author-engine
packages/author-engine  deterministic show generation + the linter  -> core
packages/analysis     ffmpeg -> PCM -> SuperFlux -> beat grid -> bars -> sections  -> core
packages/core         contracts, geometry, colour, DSL, 12 effects, mixer, player
```

The layering is enforced by separate `package.json` files rather than by convention: `core`
physically cannot reach `node:dgram` or `three`.

## Three contracts

`TrackAnalysis` is what the DSP emits and Claude reads. One row per bar, energies
normalised across the whole track so relative judgement is trivial.

`Show` is what Claude emits. Cues are addressed **by bar, never by time**, and compose an
inline layer stack from the effect library plus any effect generated for that song.

`ShowFrame` is what an effect sees. Every field is exact arithmetic on the tempo grid or a
sample of the baked timeline, so there is no realtime DSP anywhere and no estimate to carry
a confidence.

## Two authors

The room is lit before anyone decides whether to spend a model on it. `author-engine` composes
a complete show from the analysis alone in about a millisecond: it covers every bar, keeps
each effect inside the taste metadata it declares, reserves the biggest look in the catalog
for the peak section and nowhere else, climbs the intensity through a build, cuts the light in
every void, and lints clean. It is deterministic - the seed is the analysis hash, so the same
track is the same show every time, and a different track is a different one.

What it cannot do is know what the song is. So `author-ai` does not write a show; it revises
that one. Handing the agent a draft that already satisfies every structural rule spends it on
the part only it can do - what the track is, which moment deserves the biggest move, and the
two to five effects written for this song and no other - instead of on bookkeeping it is worse
at than a loop. If it fails, the engine's show is still there.

This is the one place the old iteration of this project was clearly right and worth copying:
compile the whole show ahead of time from a structural analysis, then execute it as timecode.
Its two acknowledged weaknesses are fixed here rather than carried over - the peak is reserved
before anything else is chosen rather than every drop being identical, and no two consecutive
cues may share a layer stack.

## Effects

One effect per file in `packages/core/src/effects/`. Each declares taste metadata (energy
1-5, allowed sections, min/max bars, whether it is reserved for one moment per show) so
restraint is structural rather than something the author has to remember.

Claude writes two to five more per track, specific to that song. Each is admitted only after
passing the same gate the built-ins pass: finite, non-negative, bounded pixels across a
synthesised groove/build/void/drop journey; bitwise-identical output from two fresh
instances, which catches a smuggled `Math.random`; and `reset()` restoring a fresh state.

Brevity is enforced rather than requested: the linter warns on a brief over ~150 words, on
long cue notes, and on a show with fewer than two effects of its own. The effort belongs in
the effects, not in prose about them.

## How the grid is found

Onset strength is SuperFlux: spectral flux on a log-frequency, log-magnitude spectrogram
where the frame being subtracted has first been passed through a maximum filter across
frequency, which is what stops a detuned supersaw reading as a continuous onset.

Tempo comes from a tempogram built two ways and multiplied. Autocorrelation asks "does this
curve repeat at this lag" and is strong at a tempo and every multiple of it; the Fourier
magnitude asks "is there energy at this rate" and is strong at a tempo and every divisor.
Their product keeps only what both agree on. A log-normal prior around 120 bpm and a test of
whether the resulting beats group into bars of three or four settle the metrical level, which
is the only part that is genuinely hard: on 245 annotated tracks from GTZAN and GiantSteps
this lands **75.9% exact and 91.8% up to a metrical factor**, which is where non-neural tempo
estimation sits. `tempo.confidence` reports the margin over the runner-up rather than a
goodness of fit, so a track whose octave was a coin toss says so, and `reanalyse` is there for
when Claude finds a published tempo that disagrees.

A constant grid is fitted rather than a beat sequence tracked, because programmed music has
no local wobble to follow and a constant grid keeps its phase across a quiet passage where a
tracker slips half a bar and slips back. Ellis' dynamic-programming tracker still runs, to
decide whether one period can describe the whole track at all; when it cannot, `constant` is
false and the bar table is the authority.

## How sections are found

Bar by bar, not frame by frame, and each bar keeps its own time axis: one row per beat across
thirty-two bands, so two bars match when they play the same pattern rather than merely
averaging to the same spectrum. That single choice is worth more than the algorithm on top of
it - published boundary accuracy rises by about a third for the same detector. The vector is
written with sixteen sub-frames per bar, but the rows underneath it are per beat, so in four-four
each group of four is a copy: it is beat resolution, not sixteenth.

Boundaries are then chosen by dynamic programming over the whole track at once, maximising
similarity inside each segment minus a cost for lengths that are not phrase multiples. The
cost is the point: hard-snapping to an eight-bar grid throws away nearly 40% of real
boundaries even in dance music, where a soft cost lets the evidence overrule the prior when
the music really does move at six bars.

Which sections repeat which is a transitive closure over segment similarity, so a third
chorus that only directly matches the second is still a chorus.

Only then are they named, and the vocabulary is chosen per track first: a ballad has no drop,
and announcing its loudest eight bars as one would be an invention. A loud passage is a drop
when something set it up - a rise across the boundary into it - and when the track has had two
phrases to establish what it is dropping from. `energyRank` is by mean rather than peak, so a
long mid-energy verse containing one loud bar cannot outrank a short chorus that is loud
throughout.

## The app

One screen. The room is the hero; the chrome stays quiet so the room's colours are the only
saturated thing on screen.

- **Top bar** takes a YouTube link or a local path. The engine's show is lit as soon as the
  audio is; Design with Claude hands it over to be revised.
- **Stage** is the 3D room, with view presets, a diffuser/raw-pixel toggle and bloom.
  Empty-state text reports which phase the pipeline is in.
- **Player bar** is Spotify-shaped: art, title, prev-section / play / next-section, and a
  scrubber. The scrubber is the timeline: sections are drawn as coloured segments and what
  has not played yet is veiled rather than covered, so the arrangement stays readable ahead
  of the playhead. Hits are ticks on it. Hovering shows bar number and section.
- **Inspector** has four tabs: the show (tempo, arrangement, palette, Claude's brief, the
  generated effect, linter notes, DDP output), the cue sheet with the live cue highlighted,
  **design** (a live feed of what the agent is doing - every tool call, its arguments and its
  result, as it happens), and the raw log. It switches to design automatically while a show
  is being authored.

Space plays and pauses. Arrows seek 5 s, shift-arrows 30 s.

## Setup

Needs `ffmpeg`, `ffprobe` and `yt-dlp` on PATH, and Node 22+.

```sh
npm install
npm run dev            # http://localhost:5180
```

Authoring uses the Claude Agent SDK through your logged-in `claude` CLI. Note that since
2026-06-15, Agent SDK usage on a subscription plan draws from a separate monthly credit
pool.

## Commands

```sh
npm run dev            # the app
npm test               # 293 tests
npm run check          # tsc --build across all packages, then svelte-check
```

Everything else happens in the app: paste a link and the room lights. Artifacts land in `cache/`:
`<id>.<ext>` audio, `<id>.analysis.json`, `<id>.show.json`. The cache is anchored to the
workspace root rather than to cwd, so the dev server and a production build share it.
`MV_CACHE_DIR` overrides it.

The packages are consumed as TypeScript source rather than built to `dist/`, so there is no
build step between editing a package and seeing it in the app.

## Hardware

DDP over UDP on port 4048, which is what WLED listens on with no configuration. Three
packets per 1320-LED frame at 94.9% wire efficiency, against eight for sACN with universe
maths on top.

Two things to get right:

- **PUSH only on a frame's last packet.** Set it on every packet and WLED renders three
  times per frame and tears.
- **The host owns gamma.** WLED's `arlsDisableGammaCorrection` defaults to true, so stock
  config already expects the source to have gamma-corrected. This does, once, at the
  byte-encode boundary, and both the preview and the wire get the same corrected bytes.

Hardware output runs server-side: the browser cannot open a UDP socket, and streaming 60
frames a second of pixels to the server would be pointless when the show is deterministic.
The server renders its own bit-identical copy from the same show and the same position; the
browser only reports where the audio actually is. The room keeps running if the tab closes.

WS2812 is 30 us per LED, so 1320 pixels on one data line caps at 25 Hz. Reaching 60 needs
roughly one output per strip: a 4- or 8-output ESP32 board, wired ethernet rather than WiFi.
Pass several comma-separated hosts and the fixture is split across them.
