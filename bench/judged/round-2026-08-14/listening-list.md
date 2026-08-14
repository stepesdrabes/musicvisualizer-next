# Round-1 listening list (v17 analysis / v13 show)

Short by design - re-listening is the expensive resource. Twelve tracks, each with the
one thing to listen for. Everything re-derives lazily on first play (~30-60 s per
track); the whole library is 45 tracks if you let it all rebuild.

## Consolidation verdicts (sections wrong)

1. **No One Knows** - the long verses no longer change look mid-verse with a slam
   (formerly at bars 18 and 82). Does the second verse now HOLD?
2. **Enter Sandman** - the false mid-run arrival near 2:35 (slam@79) is gone; the peak
   still lands on the battery at ~4:40. Does the chorus run read calmer without going flat?
3. **Self Esteem** - "sections almost randomly cut": the final chorus now holds to the
   end (the slam near bar 107 is gone).
4. **As It Was** - your "too busy" track: chorus 64-92 is one passage now.
5. **Roygbiv** - the first drop no longer splits at ~1:10; boundaries elsewhere
   unchanged (they measured real).

## Genre verdicts (effects mismatch / wrong drawer)

6. **Someone You Loved** - the big one: no more club drops on a piano ballad. It now
   reads verse/chorus with half the punctuation. Should feel like a song, not a rave.
7. **An Ending (Ascent)** - "Totally off, wtf": the beatless piece no longer has
   "drops" at all; treatment is the calm end of the catalog throughout.
8. **Get Lucky** - honest caveat: its cached context still says `ballad` (contexts do
   not re-derive on an analysis bump - the fix lands for fresh ingests; a context
   refresh mechanism is round-2 work). Sections may shift slightly from consolidation;
   the profile is unchanged this round. Say the word and I can clear the four misfiled
   tracks' contexts so they re-fetch on next play.

## Effects verdicts

9. **SICKO MODE** - the heartbeat now takes permission from the kick: it should rest
   when the 808s rest instead of arguing with them. Its peak also drew the new
   `silhouette` look (edge blazing, centre dark, held) at ~1:35.
10. **Hannah Montana** (4* guard) - sections untouched; the verse heartbeat you called
    "not great" is now kick-gated. Tighter, or still wrong?

## Regression guards (must not get worse)

11. **Pistácie** (5*) - unchanged in every table; the reference for "right".
12. **Sunset** (4*) - still house, still drops (the kit corroboration kept it club).

Also carrying the new silhouette peak if you want to see it elsewhere: Blinding Lights
(~bar 79), Painkillers (~bar 88), Xtal (~bar 68).

For any small difference, ask for the A/B copy rather than stars: the old build is
`/Applications/LightningStrike.app` until replaced - install the new one beside it under
another name and both keep their own libraries.
