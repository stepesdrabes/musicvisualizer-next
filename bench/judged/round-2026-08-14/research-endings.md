# Research: how lit performances end (for the endings round)

Subagent research, 2026-08-14, citations verified by refutation (VERIFIED = fetched text
confirms the claim; the refutation log at the end lists what was DROPPED). Feeds the
"ending wrong" x5 cluster: RC4 in diagnosis.md.

## The two findings that reframe the fix

**Endings are anchored to the finish line, not to the outro boundary.** Every documented
convention pins the lighting gesture to the last accent or the decay after it; none makes
the ENTRY into an outro an event. Stage practice is simultaneous release - tableau, fade,
final chord together (Derek Miller, "On Bow and Exit Music", Journal of American Drama
and Theatre - VERIFIED). The judged complaint "the outro is cut in way too aggresively...
not to be there BECAUSE" (Gojira) is this: the app treats the outro boundary as a section
contrast where concert grammar treats the ending as a release begun from the existing look.

**Offsets are less salient than onsets** (Zhang et al. 2025, bioRxiv EEG - VERIFIED), and
audiences carry film grammar: fades signal "this episode is over", cuts read as continuity
(Magliano & Zacks 2011, Cognitive Science - VERIFIED from full PDF). Consequence: a DECAY
may be long and loose and still read intentional; a HIT (button/bump) must land exactly on
the beat or it reads as error. Hard black is punctuation inside a show; the slow dim is
the show's own end (Playwriting 101 ch.14 - VERIFIED).

## Treatments, selected by the measured terminal envelope

- **T1 Button/out** (cold ending: steep terminal drop, ring-out under ~a beat - the
  "no outro detected" case): hold the full look to the final downbeat, bump ON the last
  audible hit to a brighter/whiter version of the SAME look, autofollow to near-black one
  beat later, in rhythm (beat-period-derived). Source: musical-theatre button/out
  sequence, "the button always happens in rhythm" (Looking at Light - VERIFIED).
- **T2 Ring-out decay at the audio's own rate** (ringing tail - the carved ring-out
  case): hold through the last downbeat, then track a level follower on the tail so light
  leaves at the rate the sound does; floor at afterglow, not zero. Never begin before the
  last accent - a fade under still-loud music reads as a false ending.
- **T3 Track the studio fade** (monotonic fade-out with pattern unchanged): brightness
  follows the fade envelope, motion slows with it, end in afterglow.
- **T4 Afterglow, not dead black**: after T1/T2/T3, a low warm still wash rather than
  zero (the applause-light / house-lights gesture); short between queue tracks, lingering
  at end of session.
- **T5 The seam in a continuous queue**: outro = transition window, NOT an event - no
  look-change at outro start (DJ tooling semantics: Mixxx Auto DJ outro cues - VERIFIED);
  through the outro the existing look thins (fewer strikes, slower motion), T2 finishes
  it, then one or two seconds of near-dark breath before the next intro rises in ITS OWN
  palette from dark. Never crossfade palettes mid-air; handover happens in the gap.
  Failure mode named in club culture: "lights are flicked on abruptly, the music cuts
  out, and the night just... ends" (NTIA nightlife #84 - VERIFIED verbatim).

## Implementation note

T1/T2/T3 select by terminal envelope (steep drop / ringing tail / monotonic fade), which
the analyser already distinguishes when carving ring-outs. The "ends inside its loudest
section" case needs NO outro section at all - only the last-downbeat anchor and the
terminal envelope. The abrupt-switch case is fixed by removing the look-change from the
outro boundary and moving the gesture to the finish line.

## Refutation log (what did not survive)

- Moody "Concert Lighting", Shelley "A Practical Guide to Stage Lighting": books exist,
  no specific ending passage confirmable - DROPPED (nothing above relies on them).
- "Blinders on the final chorus/last note": claiming page unreachable; only the
  restraint principle (climactic beats, sparingly - Marslite, VERIFIED) survives.
- "Slow fades of 3-5 s suit emotional transitions": fetched page had no numeric fade
  guidance - DROPPED.
- ControlBooth practitioner threads: 403 - not cited.
