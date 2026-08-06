# CLAUDE.md

House rules for this repo. `README.md` explains what Room is and why it is built this way;
this file is only the conventions.

## Commands

```sh
npm run dev      # the app on http://localhost:5180
npm test         # vitest over packages/*/src/**/*.test.ts
npm run check    # tsc --build across the packages, then svelte-check
npm run build    # production build of apps/web
```

Needs `ffmpeg`, `ffprobe` and `yt-dlp` on PATH, and Node 22+. Keep `check` and `test` green
before committing.

## Layering

```
apps/web      -> preview3d, transport-ddp, author-ai, author-engine, analysis, core
author-ai     -> author-engine, analysis, core
author-engine -> core
analysis      -> core
core          -> nothing
```

`core` imports nothing at all: no `node:`, no `three`, no framework. That is what lets the
same show run in a browser, in headless Node and eventually on a microcontroller. The
`package.json` files enforce the direction; do not route around them.

The app is the only entry point. No CLIs, no `scripts/`.

## Comments

Let the code speak for itself. A comment earns its place by saying **why**, not what:

- keep the reason a value is what it is, a hardware or perceptual constraint, a trap that
  looks like a mistake until you know the reason, and units or ranges on interface fields;
- drop anything that restates the line below it, and do not narrate fixed bugs - keep only
  the invariant that stops the bug coming back;
- one rationale, one place. If the contract already explains it, the implementation does not
  repeat it.

No em-dashes anywhere: code, comments, docs or commit messages. Use a plain hyphen.

## Effects

One effect per file in `packages/core/src/effects/`, exported as an `EffectDef` and listed in
`effects/index.ts`. Every effect, built-in or generated for a track, must pass the same gate
in `effects/gate.ts`:

- **Deterministic.** No `Math.random`, `Date` or `performance`. Use `Rng` or `hash01`, so a
  seek reproduces the frame exactly.
- **No allocation in `render`.** Allocate in `create`.
- `reset()` restores a fresh instance.
- Bounded, finite, non-negative pixels across the gate's groove/build/void/drop journey.

Colour goes through `SLOT` so a show's palette reaches the effect without it knowing any
hues. Multiply speeds by `ctx.motion`; derive time constants from `ctx.f.beatPeriod`, never
from bpm. `taste` metadata is what the linter enforces restraint with, so fill it in honestly.

Reach for the DSL before writing the loop by hand: `ringU`, `alphaFor`, `setPixel`,
`fillSolid`, `stampOnStrip`, `ringsFor`/`scatter`, `fadeToBlack`, `PulseEnv`. Anything added
under `src/dsl/` also becomes vocabulary for Claude-generated effects, so document it in
`renderDslReference()` in `packages/author/src/catalog.ts`.

## Contracts

`TrackAnalysis`, `Show` and `ShowFrame` in `packages/core/src/contracts/` are the seams
between the DSP, the model and the renderer. Change them there and update both sides.

Cues are addressed **by bar, never by time**. All grid arithmetic lives in
`packages/core/src/grid.ts` (`barTimeAt`, `onPhraseGrid`, `nearestPhraseBar`); the analyser
and the linter have to agree on it, so neither writes the modulo out by hand.

Bump `ANALYSIS_VERSION` when the analysis shape changes, or cached blobs go silently stale
rather than obviously broken.

## Style

- TypeScript, `strict`, tabs, single quotes, semicolons, around 100 columns.
- Packages are consumed as `.ts` source, so there is no build step between editing one and
  seeing it in the app.
- `noUnusedLocals` and `noUnusedParameters` are on: delete unused code rather than `void`-ing
  it to keep the compiler quiet.
- Effect imports group contracts -> color -> dsl -> helpers.
- Client-side mirrors of server types (`apps/web/src/lib/types.ts`) are duplicated on
  purpose, so the browser bundle never reaches into a server-only package. Keep them in sync
  by hand.

## Commits

Conventional Commits: `type(scope): subject`, imperative, body only when the reasoning is not
obvious from the subject. Never add a co-author trailer.

Only commit when asked. Stage explicit paths rather than `git add -A`: this repo has
untracked work in `firmware/` that a blanket add will sweep into an unrelated commit.
