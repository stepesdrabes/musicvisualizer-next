# Consolidation sweep records (2026-08-14). sweep1 = arrival-only merge; sweep2 = material-gated (shipped).

## sweep1 (arrival-only, superseded)
cons08/current    raveform   n=60  F0.5=0.381  F3=0.542  label=32.6%  base=33.6%  sections=14.7/9.4
cons12/current    raveform   n=60  F0.5=0.380  F3=0.541  label=32.6%  base=33.6%  sections=14.0/9.4
cons16/current    raveform   n=60  F0.5=0.379  F3=0.541  label=32.6%  base=33.6%  sections=13.8/9.4
cons20/current    raveform   n=60  F0.5=0.378  F3=0.539  label=32.6%  base=33.6%  sections=13.6/9.4
cons0/current     harmonix   n=60  F0.5=0.196  F3=0.530  label=10.5%  base=53.1%  sections=10.8/10.1
cons08/current    harmonix   n=60  F0.5=0.189  F3=0.513  label=10.5%  base=53.1%  sections=9.8/10.1
cons12/current    harmonix   n=60  F0.5=0.189  F3=0.512  label=10.5%  base=53.1%  sections=9.5/10.1
cons16/current    harmonix   n=60  F0.5=0.190  F3=0.513  label=10.5%  base=53.1%  sections=9.3/10.1
cons20/current    harmonix   n=60  F0.5=0.188  F3=0.508  label=10.5%  base=53.1%  sections=9.2/10.1
cons24/current    harmonix   n=60  F0.5=0.188  F3=0.503  label=10.5%  base=53.1%  sections=8.8/10.1
cons30/current    harmonix   n=60  F0.5=0.186  F3=0.498  label=10.5%  base=53.1%  sections=8.6/10.1

## sweep2 (material gate, shipped at consolidateFloor 1.6)
cons08/current    raveform   n=60  F0.5=0.388  F3=0.548  label=32.6%  base=33.6%  sections=17.5/9.4
cons12/current    raveform   n=60  F0.5=0.389  F3=0.550  label=32.6%  base=33.6%  sections=17.3/9.4
cons16/current    raveform   n=60  F0.5=0.390  F3=0.552  label=32.6%  base=33.6%  sections=17.2/9.4
cons20/current    raveform   n=60  F0.5=0.390  F3=0.552  label=32.6%  base=33.6%  sections=17.1/9.4
cons24/current    raveform   n=60  F0.5=0.390  F3=0.553  label=32.6%  base=33.6%  sections=17.0/9.4
cons08/current    harmonix   n=60  F0.5=0.195  F3=0.526  label=10.5%  base=53.1%  sections=10.5/10.1
cons12/current    harmonix   n=60  F0.5=0.195  F3=0.525  label=10.5%  base=53.1%  sections=10.4/10.1
cons16/current    harmonix   n=60  F0.5=0.195  F3=0.526  label=10.5%  base=53.1%  sections=10.4/10.1
cons20/current    harmonix   n=60  F0.5=0.194  F3=0.524  label=10.5%  base=53.1%  sections=10.4/10.1
cons24/current    harmonix   n=60  F0.5=0.194  F3=0.523  label=10.5%  base=53.1%  sections=10.4/10.1

## baselines
cons0 raveform: F0.5=0.368 F3=0.521 sections=20.0/9.4 (from sweep1 stream)
cons0/current     harmonix   n=60  F0.5=0.196  F3=0.530  label=10.5%  base=53.1%  sections=10.8/10.1

## sweep3 (guards from the adversary review + genre trio; SHIPPED at 1.6)
cons0/current     harmonix   n=60  F0.5=0.196  F3=0.530  label=10.5%  base=53.1%  sections=10.8/10.1
cons12/current    harmonix   n=60  F0.5=0.196  F3=0.528  label=10.5%  base=53.1%  sections=10.7/10.1
cons16/current    harmonix   n=60  F0.5=0.196  F3=0.528  label=10.5%  base=53.1%  sections=10.7/10.1
cons20/current    harmonix   n=60  F0.5=0.196  F3=0.526  label=10.5%  base=53.1%  sections=10.7/10.1
cons0/current     raveform   n=60  F0.5=0.368  F3=0.521  label=32.6%  base=33.6%  sections=20.0/9.4
cons12/current    raveform   n=60  F0.5=0.382  F3=0.539  label=32.6%  base=33.6%  sections=18.3/9.4
cons16/current    raveform   n=60  F0.5=0.383  F3=0.540  label=32.6%  base=33.6%  sections=18.1/9.4
cons20/current    raveform   n=60  F0.5=0.384  F3=0.542  label=32.6%  base=33.6%  sections=17.9/9.4

## round-5 boundary slice (v20: stay-pins physics-only@3 vote-split, restart noise floor, pin-aware fold)
current/current   raveform   n=60  F0.5=0.394  F3=0.540  label=32.6%  base=33.6%  sections=18.1/9.4
current/current   harmonix   n=60  F0.5=0.202  F3=0.532  label=10.5%  base=53.0%  sections=10.7/10.1
(v19 reference = sweep3 cons16: raveform 0.383/0.540/18.1, harmonix 0.196/0.528/10.7 - F0.5 up on both, F3 flat/up, sections flat)

## ponyboy slice (v21: pounding arm on hasDrops, club-family gated)
current/current   raveform   n=60  F0.5=0.394  F3=0.540  label=32.6%  base=33.6%  sections=18.1/9.4
current/current   harmonix   n=60  F0.5=0.202  F3=0.532  label=10.5%  base=53.0%  sections=10.7/10.1
(identical to v20 - the arm has zero corpus footprint; its effect is Ponyboy-specific by construction)

## finishing wave final (v22 / SHOW 16)
current/current   raveform   n=60  F0.5=0.394  F3=0.540  label=32.6%  base=33.6%  sections=18.1/9.4
current/current   harmonix   n=60  F0.5=0.202  F3=0.532  label=10.5%  base=53.0%  sections=10.7/10.1
showprobe cache114: 0 lint / 0 misfires / 100% quiet / dark 2 · contrast 2.76 (was 2.84) · hue jumps 2585 (was 2894)
(the contrast/jump softening is the leaving pass stepping fade tails down - coverage holds; judged-36 analysis-side zero drift, composition moved by design)
