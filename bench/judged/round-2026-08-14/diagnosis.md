# Diagnosis: judged round 2026-08-14 (build 337d06f)

Written 2026-08-14 from the mined round (`digest.md`, `snapshot.json` beside this file),
the cached artifacts, and the code at 337d06f. Nothing that renders has been changed.

**Liveness**: all 36 judge files match the cached analysisHash + show seed, and
`bench/recompose-judged.ts` recomposes all 36 shows bit-identically at HEAD.
Every complaint in this round is live against this tree. No stale-cache excuses.

## The two dominant chips, separated

The 47 notes hand-classified (`quantify` script; table embedded in the note ids in
snapshot.json): **22 "early" vs 7 "late" boundary notes, 8 naming notes, 5 praise,
1 missing-boundary, 4 other**. The two chips have different mechanisms and different
tracks prove it:

- HUMBLE., American Idiot, bad guy, EARFQUAKE carry both chips yet have **zero**
  same-base adjacent sections: they are pure boundary-placement failures.
- Roygbiv, Xtal, Enter Sandman, Stranded, Adele, No One Knows, Self Esteem have 4-9
  same-base adjacent splits each: they are fragmentation failures the owner reads as
  "sections wrong" ("effects switching in the middle of the actual song sections",
  "why are some choruses split like this unevenly?").

Cohort separation: 4-5* tracks have median **12%** same-base adjacent boundaries and
meter confidence **0.93**; 1-2* tracks have **36%** and **0.70**. Sections/minute barely
separates (3.03 vs 3.29) - the raw count is not what is heard; the phantom splits are.

## Ranked root causes

### RC1 - Same-material fragmentation reaches the room as false arrivals (sections wrong)

101 of 365 judged boundaries (28%) separate two sections of the same base kind.
Mechanism, in order:

- `structure.ts` `MAX_SEGMENT_BARS = 24` forces any longer passage to split in the DP.
- `arrange.ts` `snapToPhrases` merges same-kind neighbours only when the group ids also
  match AND the merged length stays under `MAX_MERGED_BARS = 32`. A homogeneous 96-bar
  drop (Xtal) mathematically cannot come out as fewer than four sections whatever the
  evidence says. Group mismatches (groupSegments length-ratio guard, 0.92 cohesion
  test) block the rest: Adele's 7 same-kind adjacencies have 0 group matches.
- The comment justifying the 32-bar cap says "the engine re-subdivides at sixteen bars
  anyway"; the engine actually subdivides at `MAX_CUE_BARS = 8` (plan.ts:49). The cap
  is not doing the job it thinks it is.
- Every analysis section boundary is a section-KIND transition in the show: intensity
  step, palette change, fade profile. And `planHits` marks **every** drop-base section
  opener (slot.index === 0) with a slam/bump ("the drop lands"), while interior 8-bar
  cue changes get no punctuation. So each phantom split is a punctuated false arrival,
  at a DP-chosen bar that is NOT on the section's own phrase grid - which is exactly
  the difference between it and the engine's interior splits the owner rarely minds.

Direct notes: Roygbiv, Hannah Montana @28 ("split unevenly" - chorus 16-32 with
interior cue at 28 off the material's real 8-grid... actually the section grid is the
issue), Vitej @19 ("if the drop got divided into 2 evenly it would not miss the second
part" - drop 11-25 split 8+6 by MAX_CUE_BARS from a boundary the DP chose), Cigo @24,
Je mi fajn @26/@51, Enter Sandman (6 consecutive chorus sections = 6 punctuated
"arrivals" through one passage).

Raveform over-segmentation (~20 emitted vs ~9.4 annotated) is the corpus-side view of
the same defect - known and unfixed.

### RC2 - Boundaries skew EARLY by 1-2 bars (boundary off)

22 early vs 7 late. Three producers, by evidence weight:

**(a) Arrival evidence prefers the fill/pickup bar over the downbeat it announces.**
Present on lyric AND no-lyric tracks, so it is not the hook snap alone. The bar windows
in the digest show the signature repeatedly: boundary bar carries the fill (high
kicks/snares or a riser, energy below the next bar), true arrival one bar later.
Titi 53 (e60 half-kit pickup) vs 54 (e95 k5s4); EARFQUAKE 38 (e7!) vs 40 (e93);
Killing In the Name 21 (k5s4 fill, vocal 0.26) vs 22 (vocal 1.0); Cigo 49 (e80) vs 50
(e95 k4s5); Le Freak 15 vs 16-17. `arrivalStrength` (structure.ts) rewards the bar
after a collapse (dip term reads b-1's floor), and the fill bar's own kit/novelty score
high - but the fill IS b-1 of the true arrival. With `REFINE_REACH = 1`, a DP boundary
2 bars early is also unfixable.

**(b) The v16 hook snap drags boundaries onto sung pickups and cannot fix late-ward
errors.** `snapToHooks` moves chorus/drop starts up to 2 bars EARLIER onto a hook
window edge; windows come from sung line starts, which precede the beat arrival on
pickup-led tracks. Live candidates from `bench/judged-hookcheck.ts`:
- EARFQUAKE chorus@38 sits IN window {37,38} while the energy arrival is 40 - the
  a-cappella "for real" pickup. If the DP said 40, the snap moved it -2. Owner:
  "Chorus starts too early again."
- bad guy chorus@23 sits IN window {22,23}; owner says the real drop is 24 ("duh").
  A DP answer of 24 would be outside the window and get pulled to 23. Owner: "chorus
  starts too early (later are kay)" - and the later choruses have no windows near them.
- Snooze chorus@17: owner marks the truth at 23, and there IS a hook window at 23 -
  but it is a non-restart window, and the snap can only move +1 toward RESTART hooks,
  so the evidence it had was unreachable by design. The asymmetry fails both ways.
Verification for (b) needs one re-analysis with the snap disabled (audio pipeline),
which is the first measurement of the fix round.

**(c) A residue of sub-bar / phase cases** (HUMBLE "missed by a tiny bit") that are
downbeat-phase, not section placement - not fixable by boundary work and honestly
smaller than a bar.

### RC3 - Genre vote pathologies put four tracks in the wrong drawer

Traced end to end (subagent, cache-verified). The vote is a keyword plurality
(`genreMap.ts`), audio (effnet) **unconditionally overrides** metadata whenever its
top-1 activation >= 0.15 (`ingest.ts:169-180`) - no comparison of vote shares - and
`genreConfidence` is written but read by nothing.

- **Someone You Loved -> house 0.44** (2*): effnet heard "Tropical House"/"House"
  in a piano ballad; 0.44 plurality beat iTunes' rock 1.0. house is a CLUB family, so
  the ballad got drop/build/groove vocabulary: six "drop" sections with kicksPerBeat
  0.0. Owner: "this should be as pop, so there should be choruses, verses...". The
  single worst family outcome in the round because it crossed the club/song line.
- **Get Lucky -> ballad 0.45** (2*): effnet's style parents are not stripped -
  "Folk, World, & Country African/Soukous" votes ballad via \bfolk\b|\bcountry\b
  (`ingest.ts:164-168` strips only `Electronic---`). Ballad profile = flashBudget 0,
  motionScale 0.5, transientEvery 0, peak swell on a 116 bpm funk record. NOTE: the
  owner's actual complaint was alignment; "effects nicely fitting". The misfile
  mattered less than the prompt's hypothesis expected.
- **bad guy -> rock 1.0**: one iTunes tag "Alternative" matching the w1 rock rule;
  1.0 means "one string, one rule", the opposite of strength. Damage small (rock is
  still song vocabulary).
- **An Ending -> ambient 1.0** (1*): the family is CORRECT; the damage is that
  `ambient` sits in CLUB_FAMILIES (`vocabulary.ts:36-43`), so a beatless piece keeps
  "drop" labels (energy swells pass `hasDrops` via DROP_STEP with zero kicks) and gets
  drop-class cue structure and peak treatment. Roygbiv (2*, ambient 0.52) same shape.
  All three ambient tracks scored 1-2*, corroborating the quiet-passages priority.

The genre hypothesis from the brief survives in refined form: family errors matter in
proportion to whether they flip the club/song vocabulary or land in ambient - Xtal
(techno 0.68, arguably right) and As It Was (rock 0.82 on a pop song) were NOT
primarily family failures; their complaints are RC1/RC2.

### RC4 - Endings: an outro only exists if the track ends quiet

5 "ending wrong" chips. `arrange.ts` labels the LAST segment outro only when its energy
is below the track median; `carveRingOut` adds at most 4 bars when the kick is already
gone. A song that ends inside its loudest material gets nothing (Killing In the Name
"also no outro"; Do I Wanna Know "does not end with some outro"; American Idiot), and
where the carve does fire it can read as a switch (Gojira: "outro is cut in way too
aggresively... should be there for a smooth transition"). Self-contained cluster.

### RC5 - Chorus dominance and demotion that cannot fire

Blinding Lights: "almost the whole track is labeled as chorus" - chorus = pooled
dropMargin > 0, and the demotion pass (`demoteVersesFromLyrics`) only demotes a chorus
whose lyric overlap is < 0.12 while an anchored chorus exists. The wrongly-chorused
sections sit at 0.27-0.31 overlap (because their BOUNDARIES are wrong, the spans bleed
in), so nothing fires. Le Freak's chorus@15 has overlap 0.08 and still survived
(group protection or ordering). Meanwhile the hook windows on these tracks are good:
Blinding Lights' true choruses at 33/72/104 are exactly where `hookStarts` puts
windows, and the analysis boundaries at 22/38/62 are visibly off them. The lyric
evidence is better than the use being made of it.

### RC6 - Effect-level clusters (smaller, noted for later rounds)

- heartbeat reads out of sync with the drums: SICKO MODE + Hannah Montana notes, plus
  American Idiot's bounce-lamp "reacting too much to all sounds" (drums wrong chip).
- Peak treatment under-delivers where the peak IS correctly chosen: Safir @73 ("should
  be peak, almost no energy in the effects" - hueCarousel/counterweight/discoBall on a
  rap climax), Hannah Montana @129 ("second effect looses the tension"). Related to the
  known open "peak selection" thread but distinct: these are treatment/pool, not rank.
- Known open: global exposure damper, peak-by-mean-energy.

## What the 5* and 4* tracks share

Pistacie (5*) + seven 4*: median meter confidence 0.93, phantom-split share 0.12,
families hiphop/house/pop/rock with the kick anchoring the grid, and correct
vocabulary. Structures are textbook alternations (Hannah Montana: intro verse chorus
verse chorus build void chorus). Notably Cigo (meter conf 0.32) and Safir (0.52) still
land 4*: low meter confidence does not doom a track whose boundaries fall on real
arrivals. Low genre confidence does not predict failure either (Pistacie is house
0.35, PROVENZA pop 0.33). What predicts failure is phantom splits and early
boundaries; what predicts success is their absence.

## Proposed working order (nothing implemented yet)

1. **Round 1 - RC1**: consolidate same-material runs at the analysis level (merge
   same-base adjacencies unless the seam carries real arrival evidence; lift or remove
   the 32-bar cap; let the engine's interior splits do the pacing they already do).
   Largest chip, most tracks, audible alone, measurable three ways: sections/min vs
   Raveform's 9.4, recomposed cue diffs on Xtal/Roygbiv/Sandman/Adele, phantom-split
   share on the judged 36.
2. **Round 2 - RC2(a)+(b)**: arrival scoring that prefers the sustained arrival bar
   over the fill before it, and the hook-snap asymmetry. Measured directly against the
   22 marked early bars (14+ have exact target bars).
3. **RC3 in whichever round it does not collide with** (blast radius: Someone You
   Loved, Get Lucky, Eno, Roygbiv + any future misfiles; disjoint from RC1/RC2 except
   Roygbiv/Eno): strip all Discogs parents, floor the audio override, decide what
   beatless-ambient should speak. Cheap, high yield per track.
4. RC4 endings, RC5 lyric assertiveness, RC6 effect clusters - later rounds.

Versions: RC1/RC2/RC5 are ANALYSIS_VERSION bumps; RC3 touches enrich/ingest (context
re-fetch or re-vote) + possibly vocabulary; RC4 analysis + engine. Every one of the 47
bar-references dies at the first bump - they are preserved forever in snapshot.json.
