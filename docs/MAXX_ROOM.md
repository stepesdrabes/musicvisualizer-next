# MAXX Room

A section labeller trained here rather than tuned by hand, released from the lab as its own
model. This file is the campaign's record: the protocol, the numbers that decide it, and the
lessons already paid for.

`docs/HANDOVER.md` is the room's state. `docs/EFFECT_POLISHING.md` is the judge-loop method.
This is only the model.

## What it is, and what it is not

**MAXX Room predicts boundaries and labels.** It is scored on Raveform's own eight published
folds, so its number is comparable to All-In-One, LinkSeg and SongFormer, and it is released
under Apache-2.0 with weights.

**LightningStrike consumes only the labels.** `earlybars` sits at 20 hit / 0 worse of 28 and the
DP owns the boundaries; a learned 8 Hz posterior cannot outplace a bar-refined arrival. The
model is served through the seam that already exists - `sectionPosteriors` into
`applyHeadLabels` at `analyze.ts:352` - as a background refine, after the track is already lit.

The two halves are separate on purpose. A model whose only evaluation is one person's private
maps cannot be published or checked; a model that only labels segments somebody else found is
not a structure model anyone would download.

## The vocabulary

Eight kinds, not nine. `void` stays a rules carve: it is a lighting instruction rather than a
musical section, no public corpus has an equivalent, and it was the weakest class in the P6 run
at F1 around 15.

**Mixing club and song words inside one track is correct.** `sectionBase()` already says a
chorus and a drop are one structural slot; what separates them is how the room answers, and a
rap record genuinely has a hook that wants a bloom and a beat drop that wants a slam. The
analyser's per-track club-or-song commitment in `vocabulary.ts` is a simplification the rules
needed. Training one model over both vocabularies costs almost nothing: All-In-One trained on
pop and EDM together scores 0.835 / 0.842 on Raveform against 0.835 / 0.847 for the EDM-only
specialist.

## The labelling rule

> **Label each passage by how it should be lit.**

Not "decide what kind of track this is". The question at every boundary is what the room should
do, and the eight words are the answers:

| kind | the room |
|---|---|
| `intro` | arriving, not yet committed |
| `groove` | the engine running, nothing being declared |
| `verse` | a groove carrying words, held back so the hook can be more |
| `build` | climbing toward something, and it must land |
| `drop` | an impact to slam |
| `chorus` | an anthem to bloom |
| `breakdown` | the floor removed, air and space |
| `outro` | leaving |

## Phase 0: the evaluation set

**Fifteen tracks, drawn blind, frozen before anything trains.** This is the whole defence
against repeating P6, and it is first because it cannot be added later.

1. Play a track, open the judge panel (`J`), press **Draw blind**.
2. The editor starts from one empty span and the chrome hides the analyser's answer: the
   scrubber goes plain, the section badge, the cue lane, the hit lane and the LED bands all go
   away. The drum-density lane stays - it is a measurement of the record, not a claim about its
   form.
3. Split with a double-click, drag boundaries, alt-click a handle to merge, click a span for its
   kind. Boundaries snap to the beat grid.
4. Press **Done adjusting**. The map saves with `blind: true` and the seconds it took.
5. `MV_CACHE_DIR=<cache> node bench/mapsfreeze.ts` copies the blind maps into
   `bench/maps-eval/`, which is committed and **never overwritten**.

Stratify across the families actually played: club and song, and at least three of the tracks
the room already gets wrong. Do not draw all fifteen in one sitting - SALAMI's own annotators
got a third faster over their first sixty days, and a set drawn entirely on the learning curve's
steep part is not the set you would draw now.

**The residual leak.** The stage still renders the room, and a cue change there is the analyser
saying where it thinks a section began. Collapse the rails (`[`, `]`) or look away; blind mode
cannot hide the product itself.

### The fifteen

Assembled 2026-08-16 into `cache-eval/` (gitignored, 54 MB, audio + meta + context only; the
analyses re-derive at the current version rather than arriving stale). Chosen from 41 judged
tracks and 168 with audio, on the tags actually recorded: 22 `sections wrong` and 20
`boundary off`.

Melanž and Ponyboy are deliberately absent. Both already carry a hand-drawn map, so neither can
be drawn blind by someone who remembers drawing it.

| track | family | judged | meter conf | s | why it is in the set |
|---|---|---|---|---|---|
| As It Was | rock | 1 star | 0.6 | 167 | 1 star, sections wrong + boundary off; guitar-pop with a soft chorus edge |
| Someone Like You | pop | 1 star | 0.74 | 285 | 1 star; 18 sections in 285 s, the over-fragmentation case |
| Best Part (feat. H.E.R.) | rnb | 1 star | 0.58 | 210 | 1 star; slow rnb, almost no kit to key boundaries off |
| bad guy | rock | 2 star | 0.47 | 194 | 2 stars; meter confidence 0.47 and a mid-track tempo break |
| Xtal | techno | 1 star | 0.68 | 294 | 1 star; ambient techno whose form is genuinely ambiguous |
| Le Freak | disco | 1 star | 1 | 328 | 1 star at meter confidence 1.00 - so a naming failure, not a grid one |
| Someone You Loved | house | 2 star | 0.98 | 182 | 2 stars; a piano ballad filed as house, the vocabulary test |
| Thinkin Bout You | hiphop | 2 star | 0.36 | 201 | 2 stars; the low-meter-confidence cohort at 0.36 |
| SICKO MODE | hiphop | 3 star | 0.39 | 313 | 3 stars; a medley - three tracks in one, the hardest form here |
| I Don't Care | latin | not yet | 0.5 | 220 | unjudged; 23 sections in 220 s, the fragmentation extreme |
| An Ending (Ascent) (Remastered 2019) | ambient | 1 star | 0.21 | 265 | 1 star; beatless ambient, no grid to lean on |
| Desire | trance | not yet | 0.74 | 159 | unjudged trance; club reading with a clean build/drop form |
| Self Aware | bass | 4 star | 0.99 | 152 | 4 stars, praised; bass sentinel a model must not break |
| EARFQUAKE | hiphop | 5 star | 1 | 190 | 5 stars, "sectioning is great"; the strongest sentinel |
| Pistácie (feat. Sofian Medjmedj) | house | 5 star | 1 | 174 | 5 stars; house sentinel |

Eleven are known-wrong or unjudged; three are praise sentinels, there so a labeller that helps
the hard tracks and quietly ruins the good ones is caught. Club-reading families (techno, house,
trance, bass, disco) are six of fifteen against eight song-reading, which is roughly the mix the
room actually plays. Meter confidence spans 0.21 to 1.00 on purpose: the low cohort is where the
handover's unresolved off-feel lives.

**The sentinels carry a caveat.** EARFQUAKE was praised specifically for its sectioning, so
there is some chance of drawing the analyser's answer from memory rather than from the record.
That is the price of having sentinels at all; draw them first, before re-reading anything about
them.

### Two things to record that cannot be reconstructed later

- **How long each map takes.** Saved automatically as `editSeconds`. No published figure exists
  for correction-based structure annotation, so this is a contribution in itself. SALAMI's
  unaided median was 15 minutes a track, about 4.3x playing time.
- **Your agreement with yourself.** Re-draw three of the fifteen a month later, blind again, with
  the old ones hidden, and score the two runs against each other. Intra-rater agreement in music
  annotation runs around r = 0.80 against 0.73-0.75 between people. **That number is the ceiling
  for everything else in this campaign** and nobody currently knows it.

## Why blind, and why frozen

Correcting a pre-annotation is 14-40% faster with no measured quality loss, and it raises
apparent agreement - but it raises it because both drafts came from the same place. Model-sourced
ground truth that is not provenance-audited has been measured inflating evaluation of models from
the same family by up to 17 points. A corrected map may train a labeller. Only a blind one can
grade one.

`bench/mapscore.ts` prints the split and warns when a corrected map is in the pool.
`bench/mapsfreeze.ts` refuses to overwrite a frozen file, because an evaluation set that can be
quietly refreshed against a model's mistakes is not an evaluation set.

## The numbers this starts from

Measured 2026-08-16 on the two maps that existed, both drawn as experiments rather than careful
work - so these are model error and annotation noise together, and Phase 0 exists to separate
them.

| | Melanž | Ponyboy |
|---|---|---|
| rules, strict nine-way | 45% | 35% |
| rules with the vocabulary folded | 59% | 35% |
| the shelved P6 head | 22% | 13% |
| hand boundaries the analyser landed | 3 of 15 | 4 of 6 |

The shelved head loses decisively, which reconfirms the August rollback from an instrument that
has nothing to do with listening. It also ran at about 0.55x realtime on an M1 Pro.

### The label-count ladder

`bench/learncurve.py`, 270 corpus tracks, three repeats, fixed held-out fifth, nested subsets.
Results in `bench/corpus/.musicfm/learncurve.json` (gitignored).

| tracks | accuracy | macro F1 | classes ever predicted |
|---|---|---|---|
| 10 | 46.5 +-3.3 | 31.4 | 7-8 of 9 |
| 20 | 51.6 +-4.3 | 35.8 | 7-8 of 9 |
| 40 | 53.7 +-4.1 | 39.6 | 8-9 of 9 |
| 80 | 59.7 +-0.3 | 46.5 | 9 of 9 |
| 120 | 65.3 +-1.9 | 52.3 | 9 of 9 |
| 160 | 65.5 +-1.5 | 54.2 | 9 of 9 |
| 216 | 67.1 +-1.9 | 55.0 | 9 of 9 |

The knee is around 120 tracks, not the 30 the generic 32-examples-per-class figure extrapolates
to. Variance collapses at 80. **Below 80 the head stops emitting one or two classes altogether**,
which is single-label collapse - the P6 failure - appearing as a data shortage.

This measures training from scratch on n tracks, which is the regime the PUBLIC half is in;
Raveform plus Harmonix supply about 2,300. The owner's maps are adaptation on an already-trained
head, a different regime. So the ladder does not raise the labelling budget - it says training a
head from fifty hand maps alone would land near 55%, worse than the head already rolled back.

## The corpora

| corpus | tracks | hours | licence | role |
|---|---|---|---|---|
| Raveform | 1,423 | 160.4 | CC BY 4.0 | the club half; ships 8 CV folds |
| Harmonix | 912 | 56.2 | MIT | the song half |
| `bench/maps-eval/` | 15 | ~1 | ours | the only honest gate |

Raveform is verified on disk: 1,423 entries, per-track `fold`, labels by share of time drop
40.1%, breakdown 20.9%, intro 10.2%, buildup 9.2%, outro 8.4%, cooldown 6.7%, altintro 1.6%,
end 1.4%, altoutro 1.2%, bridge 0.2%. Neither corpus distributes audio; both key on YouTube ids.
**`groove` has no source outside the owner's maps** and will be the weakest column.

Across the whole open web there are about 161 hours of drop/build/breakdown-labelled audio, and
effectively all of it is Raveform. There is no second option.

## Licences

MusicFM is the only strong music encoder that is commercially clean (MIT). MERT and MuQ are both
CC BY-NC 4.0, which also makes SongFormer's shipped stack non-commercial since it loads MuQ.
MATPAC's Apache tag is contaminated by NTT's evaluation-only M2D licence.

Use the **FMA** checkpoint rather than MSD: MusicFM's own README says FMA was published to avoid
licensing complications with the MSD training data, and the current export is MSD. Measure both
before committing; ship FMA unless it loses more than two points.

Two of the three models shipped today cannot legally ship: `discogs-effnet` and `adtof` are both
CC BY-NC-SA. Only Beat This is MIT.

## Lessons already paid for

- **Never headline a metric that collapses the classes under test.** `structscore`'s `base=`
  folds verse onto groove and chorus onto drop, so it was structurally blind to the error P6 was
  making. It reported 53.1 -> 71.1 while the exact figure was 22.5% on song material.
- **Check what the baseline arm actually has.** The bench ran its rules baseline with no lyrics,
  so the head was measured against a crippled comparison on exactly the families it hurt.
- **Corpus scores did not predict room behaviour.** Raveform said 0 of 25 collapsed and a real
  trance track collapsed anyway. The room is the final gate, always.
- **CoreML is not a free speedup and not off the table.** It partitions the graph and round-trips
  to CPU on unsupported ops, so it is a large win on some architectures and a large loss on
  others; it must be measured, not assumed. Moot under background refine.
- `bench/kindfit.ts` and `bench/ceilingprobe.ts` were deleted at `b94e2fa`; the probe numbers
  attributed to them (66.0% against `arrange()`'s 46.0%, labels worth 3x boundaries) are recorded
  in no document and should be re-derived before anything is built on them. The source survives
  at commit `1753335`.

## Instruments

| script | asks |
|---|---|
| `bench/mapscore.ts` | how well a labeller agrees with the hand maps, strict, with a degeneracy row |
| `bench/mapsfreeze.ts` | freeze blind maps into the eval set; refuses to overwrite |
| `bench/headmap.ts` | the shelved MusicFM head against the hand maps, beside the rules |
| `bench/learncurve.py` | what the n-th labelled track buys |
| `bench/judgemap.ts` | per-track readout: kind agreement, boundary distances, hit marks |

## The order of work

0. **Fifteen blind maps, frozen.** Nothing trains. Produces the real rules baseline.
1. **Score the shelved head on them**, then widen the MusicFM window from 30 s to 150 s - worth
   +6.2 accuracy in the literature, five times what thirty times more data buys, and a constant
   in `musicfm.ts` rather than an architecture. *Kill criterion: if a re-windowed head still
   loses on blind maps, Phase 2 will not rescue it.*
2. **Train on Raveform + Harmonix only**, with SongFormer's learned source embedding so two
   mismatched vocabularies train together. Publishable, needs none of the owner's maps.
   *Gate: within a few points of All-In-One's in-domain 0.835 / 0.847 on Raveform.*
3. **Adapt on 35-45 more maps**, drawn by correcting the model's draft. Private, never in a
   published number. *Gate: beats the rules on the frozen fifteen, zero degenerate tracks, no
   class collapsed. Then the room decides.*
4. **Distil into a standalone student**, noisy-student over Raveform's unlabelled mixes, export,
   publish under Apache-2.0. The released weights then carry no third-party weights at all, which
   is the only version of "our own" that survives a licence page.
