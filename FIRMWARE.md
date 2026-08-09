# Firmware

A Raspberry Pi Pico W that receives the DDP stream from `packages/transport-ddp` and reports
what actually arrived. Source is in `firmware/`.

This is the measurement build, not the product. It joins WiFi, listens on port 4048,
reassembles frames, and once a second says how many packets and frames it got, how far apart
they were, and what went missing. **It does not drive the strips.** What it does instead is
summarise each frame onto one RGB LED (`src/leds.rs`), which is enough to watch a show arrive
before there are any strips to watch it on, and cheap enough not to confound the numbers the
way the 30 us per LED of the strips would.

## What it measured

Run on real hardware, 2026-08-07, a Pico W on 2.4 GHz against a MacBook sender on the same
network. Repeated 20 and 30 second runs at the full 1320-pixel fixture.

**Reception is not a problem.** Zero loss, every run, at 180 packets a second:
`seqgap 0  bad 0  oob 0  torn 0`, sustained, tracking the sender's frame rate exactly. The
concern that shaped the original design, cyw43's four fixed receive buffers
(`ch::State<1514, 4, 4>`) against three datagrams per frame, **did not materialise**. Dropping
to 330 px and one datagram per frame changed nothing measurable, so the fixture does not need
splitting for throughput. The README's "one output per strip" remains true for the strips'
own timing, but not for the network.

**Delivery timing is the problem, and it is the radio.** Per 30 second run, counting frames
arriving more than 20 / 50 / 100 ms after the one before:

| | frames sent | late 20/50/100 |
|---|---|---|
| Loopback, paced sender, no radio | 1800 | 18 / 1 / **0** |
| Loopback, `setInterval` sender | 1761 | 28 / 0 / **0** |
| Board, paced sender | 1800 | ~322 / 98 / **30** |
| Board, `setInterval` sender | 1733 | ~382 / 90 / **30** |

With no radio in the path the sender never once exceeds 100 ms. The board sees about one stall
per second over 100 ms, worst observed 316 ms. Roughly a fifth of frames arrive more than 20 ms
late. The sender accounts for about 5% of the mild lateness and none of the severe.

Control pings put this on the network rather than the board: another wireless host on the same
LAN measured avg 67.8 / max 191 ms against the Pico's avg 32.2 / max 320, while the router
managed avg 11.5 / max 31.

**Power management is a no-op here.** `PowerManagementMode::None` and `PowerSave` produce an
identical idle-ping distribution, 64% of replies under 5 ms with no cluster at the DTIM
interval, and it makes no difference whether the call is made before or after the join. If
power save were active the AP would hold downlink frames until the next beacon and the
histogram would show it. So the chip is already awake, there is no latency left to win from
this knob, and the tail is simply what this 2.4 GHz network does. To re-test after a cyw43
update, swap the mode at `src/main.rs:105` and compare ping histograms.

**Pace the sender.** A deadline-based pacer delivers exactly 60.0 fps where
`setInterval(1000/60)` gives 57.8 to 58.7. That is 2 to 4% of frames lost to timer drift, and
`apps/web/src/routes/api/output/+server.ts:79` currently uses `setInterval`. Worth fixing
independently of anything wireless.

## Setup

Once, on the machine that builds:

```sh
brew install picotool          # flashes the ELF over BOOTSEL USB, no debug probe needed
rustup target add thumbv6m-none-eabi
```

`rust-toolchain.toml` pins the rest. Credentials are compiled in, so export them first:

```sh
export WIFI_SSID='your-network'
export WIFI_PASSWORD='your-password'
```

`build.rs` marks both as rebuild triggers, so changing one actually recompiles.

## Build, flash, watch

```sh
cd firmware
cargo build --release            # or cargo clippy --release

# hold BOOTSEL while plugging the board in, then
cargo run --release

screen /dev/tty.usbmodem* 115200 # the board reappears as a serial port a second after boot
```

The banner gives you the address:

```
room-node on 192.168.1.57, DDP :4048, stats -> :4049
```

Put that address into the board panel in the app, top right. A DHCP reservation is worth
setting up, since the hostname offered is `room-node` and nothing else advertises it.

## The monitor LED

Two common-cathode RGB LEDs, which are the whole 1320-pixel fixture reduced to a point. They
are the answer to a real gap in this build: `fps 60.0 seqgap 0` says the bytes arrived, and says
nothing about whether they are a show.

```
                             resistor
  LED 1   GP18  physical 24  --[ 330 ]--  R
          GP19  physical 25  --[ 100 ]--  G
          GP20  physical 26  --[ 100 ]--  B
          GND   physical 23  -----------  -

  LED 2   GP26  physical 31  --[ 330 ]--  R
          GP27  physical 32  --[ 100 ]--  G
          GP28  physical 34  --[ 100 ]--  B
          GND   physical 38  -----------  -
```

Each LED takes one PWM slice for red and green on channels A and B, plus channel A of a second
slice for blue. Nothing there is contended: cyw43 holds PIO0 SM0, DMA_CH0 and GPIO 23, 24, 25
and 29, and wants no PWM at all. **Both LEDs always show the same colour**, and a second LED
that is not fitted costs nothing but two idle slices, so one is a valid setup too.

Two rather than one because of what limits this thing. Brightness is total flux; glare is flux
per unit of solid angle. Driving one LED harder raises both, and past a few milliamps the second
one wins: the die stops reading as a colour and starts reading as white, taking the top of the
range with it. A second emitter at the same current is twice the light and no more glare. Spread
them apart, or sit them behind one diffuser, and it is a straight gain. `MAX_DUTY` is the lever
that trades the two against each other; this is the one that does not.

The resistors are unequal because the supply is: red drops 1.3 V across its own where green and
blue have barely 0.2 V to give, so at equal resistance the red swamps them. If green or blue read
weak, drop to 68 ohm before touching `TRIM` in `leds.rs`; if red dominates, `TRIM` is the cheaper
fix, and it applies to both LEDs. **Never wire an LED without resistors** - at 3.3 V the red
junction has nothing limiting it but the pad.

**On every boot it plays red, green, blue, half a second each**, before the radio comes up. Which
leg of an RGB LED is which is not something the firmware can discover, and a swapped pair looks
exactly like the show being wrong - the right light, at the wrong time, in the wrong colour. If
the order that lights is not red, green, blue, the wiring is the fault and nothing further up is
worth reading.

What it shows once frames arrive:

- **Colour** is the frame's mean, per channel, divided by whichever channel is largest. Dark
  pixels contribute nothing to a sum, so that is already weighted toward the lit part of the
  room, and the division leaves hue and saturation exactly as they arrived.
- **Brightness** is the **90th percentile** of `max(r,g,b)`, so a tenth of the fixture is above
  it, taken straight to the duty cycle with no gain of its own. A 256-bin histogram gets it in
  one pass and 512 bytes, where a percentile would otherwise want a sort.

**Nothing rescales that on the board, and nothing should.** The mixer auto-exposes at track
scale, holds a house floor under every cue and compresses its own highlights, so what arrives on
the wire is already the level the room is meant to sit at. A second gain here can only measure
the show against itself, and normalising against the loudest frame of the last half minute
leaves every other frame below it by construction - a room that reads bright on screen and dim
on the LED. That is the invariant worth keeping: the host owns exposure, the same way it owns
gamma.

A percentile rather than a mean because **a room is not as bright as its average**. Half the
fixture lit at full reads as a bright room; averaging over the dark half calls it half lit,
which is the one error a single LED standing in for 1320 cannot afford. Measured through the
same mixer that feeds the wire, per section:

| section | perceived brightness |
|---|---|
| drop | 0.90 |
| groove | 0.66 |
| build | 0.61 |
| outro / breakdown / intro | 0.28 to 0.34 |
| void | 0.00 |

Median 0.70 across a whole track, dark 2% of the time. The arrangement is legible on one LED,
which is what it is for.

One constant scales all of that: `MAX_DUTY` in `leds.rs`, the duty a full-scale room gets. The
room and this LED are not the same instrument. A wall of 1320 diffused pixels seen from across a
room is a wash; a 5 mm die seen from a desk is a point source, and past a few milliamps it stops
reading as a colour and starts reading as glare - white, whatever it is emitting, because the
cones under that small an angle saturate. That takes the top of the range away and flattens
everything below it into one bright smear. Raise it if the LED is dim, lower it if bright
sections stop being distinguishable. **A diffuser over the dome buys more than any value here
does**, because it is the angular size causing the glare: a water-clear LED shows three separate
dies that bloom together into white, where a frosted one mixes them.

None of this is DSP the board invented. It is arithmetic on the bytes the strips would have
got, so a wrong colour or a pulse on the offbeat is a wrong colour or a pulse on the offbeat.

A single LED cannot show light moving across a room, so everything a show says at constant flux
is lost on it. That is the ceiling on what this can tell you, and it is why the strips are still
the next thing on the list.

## Answering "are you there"

The stats stream below only goes to whoever is already sending DDP, which leaves a host with
no way to tell a wrong address from an unplugged board until it starts streaming at the room.
So the board also answers a query, on the DDP port, at any time:

```
-> ?room-node
<- room-node host room-node fw 0.1.0 up 42s px 1320 ddp 4048 stats 4049 leds monitor
```

The reply goes back to the asker's own source port, so nothing has to be listening on 4049 for
this to work. A leading `?` is `0x3f`, and DDP version 1 puts `0b01` in the top two bits of its
first byte, so `hello.rs` and `ddp.rs` can never both claim a datagram; the query is checked
first and never counts against `bad`.

`leds` is read from `leds.rs` rather than written in `hello.rs`, so it changes with the output
and not with a string somebody remembered to update. `stub` and `monitor` both leave the walls
dark, and the app warns on both; only `ws2815` will mean the room is lit.

## Reading the stats line

One line a second on the console, and the same line as a UDP datagram to port 4049 on whichever
host last sent DDP. That second copy is for boards already on a wall: `nc -lu 4049`.

```
up 42s  1320 px  180 pkt/s  231.7 KB/s  60.0 fps  gap 15.9/17.8 ms  late 0/0/0  asm 2.1 ms  led 210 us  seqgap 0  bad 0  oob 0  torn 0
```

| Field | Means |
|-------|-------|
| `px` | largest frame seen, so it confirms how much of the fixture this board is being fed |
| `pkt/s`, `KB/s` | what arrived, headers included |
| `fps` | PUSH flags per second. **This is the headline number.** 60.0 is the target |
| `gap` | shortest and longest PUSH to PUSH interval. The max is the jitter that matters |
| `late` | frames arriving more than 20 / 50 / 100 ms after the one before |
| `asm` | worst first-packet to PUSH span, so how long a frame took to arrive in pieces |
| `led` | worst frame summarised onto the monitor LED. Every other field here measures the network; this is the only part of the 16.7 ms the board spends itself, so it is what says whether they still do |
| `seqgap` | DDP sequence steps that were not +1 |
| `bad` | datagrams rejected by the parser |
| `oob` | writes past the end of the buffer, meaning the host drives more pixels than this build holds |
| `torn` | frames where PUSH arrived before every byte did |

Two of those need a caveat. `seqgap` is only a loss count while this board is the **sole** DDP
target: the host's counter spans every target it sends to, so a split fixture makes the sequence
stride rather than step, and the gaps are then expected rather than lost packets. `torn` has no
such caveat and stays valid however the fixture is split, so trust it first.

A reappearing banner means the board panicked and rebooted. It uses `panic-reset` deliberately:
a silent halt would look exactly like a WiFi drop, and cyw43 has open panics on a bad password
and on rejoining while already associated.

## Reproducing the measurement

`tools/ddp-probe.ts` drives the real `createDdpSink` from `packages/transport-ddp`, so it
exercises the actual wire format rather than a replica, and reports its own timing in the same
shape as the board so the two subtract.

```sh
cd firmware/tools
node --experimental-strip-types ddp-probe.ts 192.168.0.106 1320 30 paced
node --experimental-strip-types ddp-probe.ts loopback 1320 30 paced     # no radio, the control
node --experimental-strip-types ddp-probe.ts loopback 1320 30 interval  # what apps/web does
```

The loopback mode is the one that matters. It scores packets locally with the same PUSH rule the
firmware uses, so whatever it reports is the sender and the operating system alone. Anything the
board reports beyond that is the radio path. Two rounds of this measurement went by before the
sender was checked, and it turned out to be contributing a 159 ms stall of its own.

Interleave firmware variants rather than batching them. Conditions on a 2.4 GHz network drift
enough over a few minutes to invent differences that are not there: an early comparison appeared
to show `PowerSave` beating `None` before repeat runs showed it was drift.

## How it is put together

```
main.rs    bringup, then one loop selecting between a packet and the 1 Hz report
ddp.rs     header parser, no Embassy imports
frame.rs   the framebuffer, PUSH latch and tear detection
stats.rs   interval counters and the one line they format into
leds.rs    the frame reduced to one RGB LED, on PWM
config.rs  compile-time knobs
```

The receive loop is `recv_from -> parse -> apply -> on PUSH, present and score`. Everything runs
in the one thread-mode executor because embassy-net requires all its tasks at the same priority.

The framebuffer is sized to the whole room rather than to this board's share of it. DDP offsets
are device-local and always start at zero, so one binary receives any host-side split without a
rebuild, which is what makes the four-way comparison above a host config change rather than a
reflash.

The host owns gamma. `quantize()` in `packages/core/src/output.ts` encodes at 2.2 on the way to
the wire, so these bytes reach the strips untouched.

Resource split, fixed by cyw43 taking the first of everything: it holds **PIO0 SM0, DMA_CH0** and
GPIO 23, 24, 25 and 29. That leaves PIO1 entirely free for LED output, and the monitor LED takes
only PWM slices 1 and 2, which nothing else here wants. The onboard LED is on the CYW43 chip
rather than a GPIO, so it still cannot indicate anything before WiFi is up: solid means the join
has not landed, blinking means it has.

Current cost: **343 KiB of 2 MB flash** (235 KiB of that is the three cyw43 blobs) and **37 KiB
of 264 KiB RAM**.

## What is left

**A jitter buffer, if the room is to stay on WiFi.** This is the one that decides whether WiFi
is viable. Present frames on the board's own 60 Hz clock out of a small FIFO instead of on
packet arrival, so a burst fills the buffer rather than stuttering the strips. Depth follows
from the measured tail: about 6 frames covers the p98 100 ms stall, 10 frames leaves headroom,
and the rare 316 ms outlier would still glitch through. The added lag need not cost anything,
because the show is deterministic and the host can render that far ahead and cancel it with the
`offsetMs` trim it already has. Two things to get right: the board's clock and the host's will
drift apart over a track, so occupancy has to steer the present period slowly; and a seek or
pause has to flush, or the room replays stale frames.

**The strips are WS2815**, 12 V, 60 LED/m, one IC per LED. Decided before any were bought, and
the reasons are all at the scale this room is: 300 pixels is a 5 m run, which is where 5 V sags
badly enough to need injecting at both ends, and the finished room is **79 A at 5 V against about
33 A at 12 V**. WS2815 is constant-current, so brightness does not fall off along a run, and it
carries a backup data line, so one dead LED does not take the rest of the strip with it - which
matters rather more in 1320 soldered-up pixels than on a bench.

None of that reaches the firmware. It is the same single-wire 800 kHz protocol as WS2812B, so the
driver, the pin plan and the timing arithmetic below are unchanged. The two places it does show
up are the reset gap and the power budget, both noted here.

**Drive the strips.** `embassy_rp::pio_programs::ws2812::PioWs2812` is a first-party driver, so
this is wiring rather than writing. Put it on PIO1 SM0 to SM3 with DMA_CH2 to CH5. The arithmetic
that decides the layout: 30 us per LED, so 16.7 ms buys about 555 pixels on one line and the
room's 1320 need at least three lines, four for margin. They have to be awaited together with
`join!`. Awaiting them one after another costs 39.6 ms no matter how many state machines are
involved, which is 25 fps.

One 5 m strip is 300 pixels, which is exactly `Wall N` in `geometry.ts` and 9 ms of data, so a
single run fits one line at 60 Hz with room to spare. That is the case to build first.

**The reset gap has to be lengthened.** Embassy's driver has a private `RESET_DELAY` of 55 us,
which satisfies the original WS2812B datasheet and nothing since: WS2815 wants **280 us**, as does
WS2812B-V5. Below it, back-to-back frames merge and colour walks down the strip. 280 us is 1.7% of
a frame, so the fix is free, but the constant is private and needs either a vendored driver or an
added delay. With WS2815 chosen this is no longer conditional on which reel arrives.

**Level shift the data line.** The Pico drives 3.3 V and WS2815 wants its logic high referenced to
5 V, so a 74AHCT125 or SN74HCT245 sits between them. Without it the strip usually works, which is
worse than failing: it fails later, intermittently, and looks like a network fault.

**Reconnect handling.** There is none: the join is retried at boot and that is all. Note before
building it that `is_link_up()` always returns true after the first connect (embassy #4612), so
it cannot be the trigger.

**Static IP**, as an alternative to a DHCP reservation.

**Host-testable `ddp.rs`.** It deliberately imports nothing from Embassy, so lifting it into its
own crate with `#[cfg(test)]` tests is a move rather than a rewrite. Until then it is verified
only against captured output from the real sender.

**A watchdog**, so a wedged cyw43 recovers without someone walking to the board.

**Power.** Out of scope for the firmware but blocking for a lit room: 1320 WS2815s at full white
draw roughly **33 A at 12 V**, against the 79 A the same room would have wanted at 5 V. The
mixer's headroom and `compressHighlights` mean real shows never approach either figure, but the
supply and injection points have to be sized before any of this is switched on. One 5 m test run
is 300 pixels and about 7.5 A, which a 12 V 10 A supply covers outright.
