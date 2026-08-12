# Effect polishing

How to take a complaint like "moshSlam slams when there are no kicks" from a listening note to
a shipped fix, and the rules this repo has already paid for. Written after the 2026-08-12 pass
that fixed seven of them; the method is what transfers to the next sweep.

## Diagnose from the cache, not from the code

Every complaint names a track, and the track's whole story is already on disk. The desktop app
keeps its artifacts in `~/Library/Application Support/cz.drabek.lightningstrike/cache`, the dev
server in `cache/` at the repo root - `<id>.analysis.json`, `<id>.show.json`, `<id>.meta.json`,
`<id>.context.json` beside the audio. Before touching anything:

1. Find the track's id by grepping the meta files for the title.
2. Read the analysis against the complaint: sections with per-slot drum densities
   (kicks/snares/hats per beat), tempo and meter confidence, the events column. Most
   complaints are visible as numbers - "slams with no kicks" was a groove at 0.00 kicks/beat
   carrying `moshSlam`; "plays to the very end" was a `kick_out` event nothing read.
3. Read the show's cues and hits against those numbers. The `<kit>` tags, params and hit notes
   say what the planner believed.
4. **Recompose the cached analysis with the current code and diff it against the cached
   show.** Same seed reproduces the same show, so `cached == fresh` proves the complaint is
   live at HEAD; a diff means the user tested a stale build - which happens, see the version
   discipline section. Half of one session's "bugs" turned out to be one already-fixed bug
   that had never reached the cache.

The complaint list itself is evidence about coverage: three of seven complaints in one pass
shared a single root cause (nothing was kit-aware), which no amount of per-effect fixing would
have found.

## The kit is a fact, not a vibe

`BarRow.kicks/snares/hats` and the onset streams are measurements. The rules built on them:

- An effect whose whole gesture answers one drum declares `taste.kit` (`'kick' | 'snare' |
  'hat' | 'any'`). The picker refuses it where that stream runs under 0.2 hits/beat over the
  slot - a shade under the 0.25 the breakdown transient gate uses, because that one asks "is
  there enough kit to answer" and this one asks "is the stream absent". A sparse half-time
  kick at one hit per bar is still a kick pattern.
- The veto **falls back to the unfiltered pool rather than emptying one**. A hard requirement
  that can empty a pool is a mistake this repo has now made twice (`carries`, then nearly
  again here). Filters guarantee absence; preferences guarantee presence.
- Tag by what the gesture IS, not by what it reads. `moshSlam` and `headbang` are `'kick'`,
  not `'any'`: the passage they pounded through had a clap backbeat at 1.0 snares/beat and
  zero kicks, and a unison white slam is a kick gesture. `stageBlinders` stays `'any'`
  because backbeat blinders are honest stagecraft.
- Grid-locked pulsers keep their timing from the grid and take **permission to strike** from
  a `Presence` of the hit envelope (dsl/env.ts): full through the gaps a pattern actually
  contains (hold 4 beats), resting within a couple of bars of real silence, rising only to
  the envelope's own peak so a ghost note arms a ghost of a pulse. Timing is the grid's;
  permission is the kit's. That split is what lets a suspension rest the room without the
  pattern drifting.
- Punctuation obeys the same honesty: a drop-class arrival whose opening bar has no kick gets
  a colour bump, not a slam. The slam stays saved for a downbeat that hits back.

## Rates have ceilings; subdivisions stay musical

- The strobe picks the fastest of 16th/8th/quarter-per-beat that fits under
  `STROBE_MAX_HZ = 8` total. Sixteenths survive only to 120 bpm. The number came from the
  room: 9.4 Hz on a 140 bpm track had fused into a texture, the same gesture at 4.7 Hz still
  read as events. The alternating wall pairs mean any one wall sees half the rate.
- `strobePerBeat` lives in core beside `HIT_RULES` and is imported by the planner that writes
  hits AND the linter that checks them (`strobe-too-fast` is an error). One function, two
  consumers - two implementations of one allowance is how they come to disagree, the lesson
  `hitSeconds` and `allowedFlashes` already carry.
- Anything that accelerates through a ladder (`buildStrobe`'s half -> quarter -> 8th -> 16th)
  holds at the same ceiling: the roll tops out at eighths and the drop still owns the step up.

## Param semantics are contracts

`paramsFor` in the planner writes values into any effect that declares a matching param key.
That makes the KEY a contract about units:

- `perBeat` means events per beat, a rate. `cycleBeats` means beats per cycle, a period.
  sineRoll ran at four times its designed speed on every sparse track because it named its
  period `perBeat` and the planner wrote a rate into it. Never reuse a key across opposite
  units; rename the param instead, and migrate every scene or show that set it (the lagoon
  lounge scene carried `perBeat: 12`).
- Speeds with a felt size get planner-set params derived from the **median** tempo, decided
  once at compose: `rollerChase.lapBars` is 1 bar only when a bar runs at least 2.2 s. Derive
  it per frame and a track drifting around the threshold flips lap length mid-song.
- Grid-locked phase comes off the absolute bar clock (`(barIndex + barPhase) / lapBars`) so a
  seek reproduces the frame. Never multiply an absolute clock by `ctx.motion` - the player
  cross-fades motion between cues and the pattern jumps by the whole elapsed length.

## Peaks escalate by contrast, from both directions

"The peak feels less peak" is almost never about the peak alone - it is ordinary drops
getting the peak's gestures for free.

- Demote where the music is soft: kickless arrivals bump instead of slam (above).
- Escalate where the music has earned it: a bloom-family peak that measurably pounds
  (>= 0.8 kicks/beat, four-on-the-floor territory) takes slam treatment anyway - slam-class
  master pool, the strobe into it, and up to two phrase-locked slams inside the peak section,
  free of the flash budget. Light the record that is playing, not the genre card. Swell
  families are never overridden; their peak is a rise by definition.
- Genre remaps are the LAST resort. The audit over the full cache showed the mapping sane;
  Galantis files as house because the audio classifier heard house, and the aggression
  override fixes what the file-cabinet label got wrong without moving every other track in
  the drawer.

## Endings are arrangement too

- A track that ends inside its loudest section still ends. The DP rarely pays for a boundary
  two bars from the finish, so `carveRingOut` walks back from the last bar while the kick is
  absent and the level has clearly left the section's own body (under 0.6x its first-half
  mean), caps at four bars, and pins the boundary like a void's edges.
- A void at the END of a track is a labelling error by definition: the void instruction is
  the held breath before a drop, and silence after the last note is the record being over.
  The trailing void relabels to outro - after the phrase snap, so it keeps a void's edge
  protections on the way there. Symmetric with opening silence relabelling to intro.
- A carve can leave a one-bar outro that no bed accepts (every bed wants two bars). An empty
  cue inherits the previous cue's bed - the look it is winding down from - because a room
  that cuts to black on the last bar reads as a fault, not an ending.

## Trust the analysis to distrust itself

Some grids defeat the analyser, and a show composed on a broken grid is worse than no show.
`gridTrust` (core, beside the contracts) trips on **fragmentation** - over 5.2 sections a
minute, or over 4.5 with meter confidence at or below 0.55 or a 2/4 verdict - and never on
confidence alone: calibrated over a 113-track cache, one track sits at meter confidence 0.55
with clean structure while another at 0.88 is chopped to bits. Confidence tightens the test;
it must not trip it.

Calibrate any gate like this against the real cache before freezing thresholds, and price the
false positive honestly: a good show replaced by lounge costs more than a bad one let
through, so the gate stays conservative and the queue row carries an override the meta
remembers. Two of the three original calibration offenders were healed by plain re-analysis -
their blobs were stale versions - which is itself a lesson: **re-analyse before concluding
the analyser is wrong.**

The verdict must be EXPLICIT everywhere it matters: the queue row (chip + override), the
inspector (why, in words), and the show's own brief - the agent revising a show should know
the engine does not believe the grid under it.

## Version discipline, or fixes never arrive

The audio hash identifies the RECORDING; it cannot see that the engine or the analyser
changed. Three rules keep cached artifacts honest:

- A change to what the analyser emits bumps `ANALYSIS_VERSION`; a change to what the engine
  composes bumps `SHOW_VERSION`. Both are cheap - everything re-derives lazily per track.
- `prepare()` keeps an existing show only when nothing under it moved: hash matches AND the
  show is current-version AND the analysis came from cache. A fresh analysis recomposes an
  engine show even at the same hash, because the section table may have moved under the
  cues. Model-authored shows are exempt - they are the one artifact money was spent on.
- The library reports version-currency (a 2 kB head-read of the analysis, same trick as
  duration), the ready-shortcut on cached adds requires it, and the queue demotes stale rows
  at load. Before these existed, a track added from the palette NEVER re-analysed - the
  owner heard a fixed bug for a full day because the fix could not reach the cache.

And when handing regenerated artifacts to a running installation: the app build must be at
least as new as the artifacts, or the old build will see a version from the future as merely
"not mine", re-analyse, and overwrite the fix.

## Prove it before claiming it

The order that worked: unit tests per rule (the engine fixture takes a bpm and mutates
cleanly), then `composeShow` over the real cached analyses of the named tracks with cue/hit
diffs, then a scratch-copy re-analysis (`MV_CACHE_DIR` + `bench/reanalyse.ts`) so the live
cache is never mutated during validation, then `bench/showprobe.ts` over the corpus for the
numbers that must not regress: **0 lint errors, 0 misfires, 100% quiet coverage**, contrast
mean, flashes spent of allowed. The engine-never-fails-its-own-linter sweep
(58-175 bpm, drifting grids, a dozen seeds each) is the cheapest high-yield test in the
suite - run it against any planner change.

A fix that cannot be seen in a recomposed cue list, a hit diff or a probe number is not
finished; it is intended.
