# Adversarial review of the round-1 designs, and what was done about it

A refutation-tasked subagent attacked the consolidation pass, the genre-vote fixes and
the diagnosis's own causal claim (2026-08-14). 25 findings; dispositions below. The
review's strongest general point: structscore is structurally blind to most consolidation
mistakes (same-kind merges change no frame labels), which is the P6 lesson's shape - so
the judged-36 recompose diff (sections, peak bar, hit set, cue count) is the acceptance
instrument, not corpus F alone.

## Consolidation findings -> guards shipped

1. Peak relocation (merging into the rank-1 section moves the peak cue/master/intensity
   ceiling to the wrong bar; Safir's would open 24 bars early): ADOPTED - the loudest
   input segment's seams are untouchable.
2. Mean dilution reshuffles energyRank: rank-1 protected by the same guard; reordering
   among ranks 2..n accepted (flash allocation order, lower stakes).
3. Seam-bar-only arrival test deletes the early-boundary class RC2 exists to fix
   (arrival sits at seam+1 on the judged failures): ADOPTED - keep test reads
   max(arrivals[seam-1..seam+1]).
4. The pass could undo snapToHooks' restart placements: ADOPTED - snap targets and
   pipeline pins are passed as protected seams.
5. Gradual-morph merges (seam-locally same, endpoint-different): ACCEPTED RESIDUAL -
   seam-local sameness is the design's claim; both corpora improved under it.
6. Pairwise group relabelling wrong under chains (A8+B12+C16 -> B): ADOPTED - plurality
   of constituent bars via a tally.
7. finalOfGroup migration: mitigated by 1+6; residual accepted.
8. Interior cues of merged spans land off the absorbed material's phrase grid,
   recreating the "split unevenly" complaint: ADOPTED - a seam only merges when it is a
   whole number of phrases from the merged start.
9. Key-change detection over merged mixed-key spans loses confidence: ADOPTED - reads
   the pre-consolidation table.
10. gridTrust disarmed by merging (a wreck merges past the lounge gate): ADOPTED -
    `rawSectionCount` on TrackAnalysis; trust reads it.
11. Floors above pinScore delete the pipeline's own pins: shipped floor 1.6 < pinScore 2,
    and pinned seams are in the protected set regardless.
12. Metric blindness: ADOPTED - judged-after.ts now diffs peak bar and hit sets.
13. Behaviour change without version bump: was already handled (v17 same commit).

## Genre findings -> the fixes as shipped

14. Blanket parent-stripping flips rap to bass ("Hip Hop Trap" -> "Trap" votes bass;
    "Gangsta" orphans): ADOPTED-NARROWED - only the "Folk, World, & Country" catch-all
    is struck (regression test pins the Hip Hop parents surviving).
15. Share-comparison override reverts the flagship (one-tag metadata always has share
    1.0; Blinding Lights' synthwave correction dies): DESIGN REJECTED - no share
    comparison anywhere.
16. A confidence floor cannot separate the judged right (Sunset, house 0.44, kicks
    0.93/beat) from the judged wrong (Someone You Loved, house 0.44, kicks 0.0):
    ADOPTED the reviewer's own guard - club vocabulary now requires kit corroboration
    (CLUB_KICK_FLOOR 0.4 kicks/beat over the loud half) in speaksClub. This also fixes
    An Ending (ambient family, 0 kicks -> song vocabulary) without touching the family.
17. Cached `genres` are polluted by effnet's own echo, so any context re-vote no-ops:
    DEFERRED - the vocabulary-level corroboration self-heals the catastrophic class at
    re-analysis without context surgery; per-source provenance + CONTEXT_VERSION is a
    follow-up (in HANDOVER).
18. hasDrops-on-audible survives the judged set (every real-drop club track is q90-
    audible; the beatless two fail correctly): ADOPTED exactly - both arms of hasDrops
    behind `audible` (q90-based, so Someone You Loved's single hallucinated snare stays
    false). Roygbiv keeps its drops (audible, kicks ~0.55) - filed under the
    CLUB_FAMILIES/ambient decision, deliberately unchanged this round.

## Steelman watchlist (tracks where fewer sections could read worse)

- Je mi fajn seam 28: arrival ~1.5-2.5, knife-edge at floor 1.6. Verify it SURVIVES in
  the scratch readout; the owner rated the track 4* and wants MORE subdivision, not less.
- Titi seam 53: the owner confirms the seam is real, one bar early. The +-1 window
  protects it; verify.
- Blinding Lights seams 38/62: merging is neutral-to-harmful until RC5 relabels; watch.
- SICKO MODE medley seams 84/88/104: the owner wants MORE boundaries here; watch.
- Enter Sandman: the 6-chorus run is a LABEL failure over real alternation (kit
  densities differ per section) - the material gate should keep several seams; verify
  the peak stays at 143.
- Adele: drumless, so arrivals degenerate to voice-or-nothing; chorus-chorus seams at
  43/88 are real second-chorus arrivals - watch whether hook evidence saves them.
