# Firmware

A Raspberry Pi Pico W that receives the DDP stream from `packages/transport`, lights what it
has, and reports what actually arrived. Source is in `firmware/`.

It builds as **two fixtures**, one per binary:

| feature | fixture | pixels | output |
|---|---|---|---|
| `frame` (default) | **The Frame**, 3 x 2 m of WS2815 at 60 LED/m | 720 | two PIO data lines on GP2 and GP3 |
| `bounce` | **The Bounce Lamp**, a salvaged analog RGBW strip | 1 | four MOSFET gates on PWM, GP6-9 |

Both run the same receive loop and answer the same two questions about themselves. The only
thing that differs is what they do with a frame once it has arrived, which is why `claim`,
`selftest`, `present` and `blank` are the whole surface between `node.rs` and either one.

The lamp is a **one-pixel fixture**: every LED on its strip shows the same thing, so the host
sends it one pixel and this only has to put that on four channels. Everything that used to shape
its response - a beat envelope, a passage envelope, a floor - is host-side now, in
`packages/core/src/bounce.ts`, where it can read the show's own `kickEnv` instead of inferring a
beat from how much of the room happened to be lit.

## What it measured

Run on real hardware, 2026-08-07, a Pico W on 2.4 GHz against a MacBook sender on the same
network. Repeated 20 and 30 second runs at the 1320-pixel fixture the room had then, which is
harder on the radio than the 720 it has now.

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
cd firmware/node
cargo build --release                                          # The Frame
cargo build --release --no-default-features --features bounce  # The Bounce Lamp

# hold BOOTSEL while plugging the board in, then
cargo run --release

screen /dev/tty.usbmodem* 115200 # the board reappears as a serial port a second after boot
```

The two features are mutually exclusive and one is required; asking for both or neither is a
`compile_error!` rather than a surprise on the wall.

The protocol half of the crate is a separate library, `firmware/wire`, which imports nothing from
Embassy and therefore builds and tests on the host:

```sh
cd firmware
cargo test -p room-wire --target "$(rustc -vV | sed -n 's/^host: //p')"
```

The target is spelled out because `.cargo/config.toml` points the default at the board. Those
tests are worth more than their size: `stats.rs` and `hello.rs` emit strings that
`apps/web/src/lib/hardware.ts` parses from the other end, and both sides are now pinned to the
same text rather than to a sample copied into this file.

The banner gives you the address:

```
room-frame on 192.168.1.57, DDP :4048, stats -> :4049
```

Put that address into the board panel in the app, top right. The panel has a row per device, so
the lamp's address goes in beside The Frame's. A DHCP reservation is worth setting up, since the
hostnames offered are `room-frame` and `room-bounce` and nothing else advertises them.

## What the host sends

Both fixtures receive gamma-corrected bytes and put them out untouched. **Nothing rescales
anything on the board, and nothing should.** The mixer auto-exposes at track scale, holds a house
floor under every cue and compresses its own highlights, so what arrives on the wire is already
the level the room is meant to sit at. A second gain here could only measure the show against
itself, and normalising against the loudest frame of the last half minute leaves every other
frame below it by construction - a room that reads bright on screen and dim on the wall. The host
owns exposure, the same way it owns gamma.

The Bounce Lamp's one pixel is derived rather than sampled: `packages/core/src/bounce.ts` takes
the show's **accent** slot for colour and splits the level between two envelopes, a passage
component over about two seconds carrying which section the track is in and a beat component with
an instant rise and a 100 ms fall carrying which beat. A fixture asked to be both is good at
neither; split, the hit reads as a shimmer over a steady wash instead of the whole lamp blinking.

That reduction used to run on the board, over whatever slice of the room it was fed, and the
reason it moved is worth keeping: a percentile over the whole fixture barely moves per beat,
because one kick lights a small share of a big frame. The board could only ever infer the beat
from pixels. The host has `kickEnv`.

The lamp also holds a floor. The one thing that makes a light distracting is going fully dark and
coming back: a fixture breathing between an eighth and full reads as alive, and the same fixture
between nothing and full reads as a fault. It matters more here than on the frame, because a lamp
standing in a corner sits in peripheral vision whenever the room is what is being looked at, and
the periphery is markedly more flicker-sensitive than the fovea. It costs range - measured
through the same mixer, a room running 0.28 at an intro and 0.90 at a drop arrives as 0.37 and
0.91, so 3.2:1 becomes 2.5:1 - and that cost is why it is not higher. A genuinely black room
still goes black, so a blackout in the show is still a blackout in the corner.

## The Bounce Lamp

An RGB lamp taken apart for its strip and its driver board, which is a generic `UL NR:E330731`
analog RGBW controller: 12 V common anode, four low-side MOSFETs, an unmarked SOIC-8 doing the
PWM, and a 38 kHz receiver for the remote it came with.

The board is kept and the brain is not. Its eight legs are snipped, the body lifted off, and the
Pico drives the four gate stubs directly. That works because `U2` is a `7533-1`, a 3.3 V
regulator, so the original chip had been driving those gates at 3.3 V for the lamp's whole life
and a Pico pin is an exact replacement. **No level shifter is needed here**, unlike the WS2815
line below. Which stub is which channel is found by touching 3.3 V through a 1k resistor to each
of the eight and watching what lights; the four that do nothing are Vdd, ground, the IR input
and a spare.

```
  GP6  physical  9  ->  R gate stub      the four pads the SOIC-8 used to drive
  GP7  physical 10  ->  G gate stub
  GP8  physical 11  ->  B gate stub
  GP9  physical 12  ->  W gate stub
  GND  physical 13  ->  GND-             the only wire that is not a gate

  12 V supply       ->  10V+ and GND-    despite the silkscreen; the board passes
  strip             ->  the 5-pin header  its input straight through to the strip
```

Ground is the only thing the two share. The Pico runs off USB, the board keeps its own supply,
and the strip stays on the five-pin header it came on. **The strip's current never touches that
ground jumper**: it runs from the supply through the strip, out through a MOSFET into the
board's ground plane and back, so the jumper only ever carries the microamps it takes to charge
four gates. Make it a solid connection anyway, because it is the Pico's entire voltage reference
and gates float if it lifts while both ends are powered.

A 12 V to 5 V buck into VSYS is the one-cable version, once the serial console stops being
worth a USB lead. **Do not tap `U2` for it** - it is a linear dropping 8.7 V, and the Pico W
near its 100 mA rating is 0.87 W in a SOT-89.

PWM slices 3 and 4, which nothing else wants: cyw43 holds PIO0 SM0, DMA_CH0 and GPIO 23, 24, 25
and 29, and wants no PWM at all. **On every boot it plays red, green, blue, then R+G+B, then W**,
half a second each, before the radio comes up. The first three answer a question the firmware
cannot - which gate is which channel - and the fix for a wrong order is moving a wire rather than
editing a constant. The last two are the trim measurement below, adjacent so the eye can compare
them, at raw duty with no trim applied so a badly wrong trim cannot hide a wiring fault.

Two things about the gates. RP2040 pads reset to input with the pull-down enabled, so the lamp
is dark through BOOTSEL and a reflash - but that is the Pico's doing and not the lamp's, so
**check for a pull-down from each gate to ground and fit 10k where there is none**, or the day a
wire falls off is the day the lamp decides for itself. And each gate carries an RC slew limiter;
if low duty cycles read non-linear or the lamp will not go fully dark, that is the suspect, and
the PWM frequency comes down rather than `TRIM`.

**White is added, not subtracted.** The textbook RGBW conversion moves the achromatic part of a
colour out of RGB and into W. It is more efficient, and it is only correct when the white
emitter shares a white point with the RGB mix. A warm phosphor against a mix near 6000 K does
not, so subtracting would tint every mid-saturation colour toward the lamp's own white. Adding
cannot: a saturated frame has no achromatic part to add, so hue survives untouched and only the
washed out frames reach for the extra emitters.

**White still has to be trimmed hard**, because adding it fairly is not the same as adding it at
equal duty. This strip carries two phosphor emitters to every RGB package and each is brighter
than a single die, so the white channel outruns the other three several times over. At unity it
swamps every desaturated colour and the lamp reads as a warm bulb rather than as the room.
`TRIM[3]` in `fixture/bounce.rs` ships at 64 of 256, a quarter, which is a starting point rather than a
measurement.

The measurement is the last two selftest steps: full R+G+B, then full W, the white the colour
dies make against the white the phosphor emitters make, both at raw duty. Set `TRIM[3]` near the
ratio between them and **err low**. Too little white costs a washed out frame some punch; too
much destroys the hue of every pastel in the show, and that is the failure that is hard to see
as a cause because it looks like the palette being wrong rather than the fixture being wrong.

That channel is also where the current limit lives. Additive white lights all four channels at
once, which is the most this strip can ever draw. **Measure the current on a full white frame
against what the supply is rated for**, and if it is over, pull white down rather than the other
three: white only carries how washed out a frame is, where the other three carry its colour.

`MAX_DUTY` in `fixture/bounce.rs` is full scale, because nothing about this fixture argues for less. A
small emitter at desk distance has to be held well under its maximum, since past a few
milliamps it stops reading as a colour and starts reading as glare; a diffused strip seen across
a room is a wash, and its ceiling is its own maximum. Pull it down if the strip is uncomfortable
out of the housing it came from.

## Answering "are you there"

The stats stream below only goes to whoever is already sending DDP, which leaves a host with
no way to tell a wrong address from an unplugged board until it starts streaming at the room.
So the board also answers a query, on the DDP port, at any time:

```
-> ?room-node
<- room-node host room-frame fw 0.1.0 up 42s px 720 ddp 4048 stats 4049 leds ws2815
```

The reply goes back to the asker's own source port, so nothing has to be listening on 4049 for
this to work. A leading `?` is `0x3f`, and DDP version 1 puts `0b01` in the top two bits of its
first byte, so `hello.rs` and `ddp.rs` can never both claim a datagram; the query is checked
first and never counts against `bad`.

`leds` lists one kind per output, `+`-separated, and every field on that line comes from the
binary rather than from `hello.rs` - the wire crate does not know which board it was linked into.
`ws2815` is The Frame and `lamp` is the Bounce Lamp; a kind the app has never heard of counts as
lit, because warning that a lit room is dark is the worse of the two mistakes. The host asks whether **any** kind in that list emits rather
than looking at the first, so a build that adds a second output cannot go quietly dark.

## Reading the stats line

One line a second on the console, and the same line as a UDP datagram to port 4049 on whichever
host last sent DDP. That second copy is for boards already on a wall: `nc -lu 4049`.

```
up 42s  720 px  120 pkt/s  127.7 KB/s  60.0 fps  gap 15.9/17.8 ms  late 0/0/0  asm 2.1 ms  led 210 us  seqgap 0  bad 0  oob 0  torn 0
```

| Field | Means |
|-------|-------|
| `px` | largest frame seen, so it confirms how much of the fixture this board is being fed |
| `pkt/s`, `KB/s` | what arrived, headers included |
| `fps` | PUSH flags per second. **This is the headline number.** 60.0 is the target |
| `gap` | shortest and longest PUSH to PUSH interval. The max is the jitter that matters |
| `late` | frames arriving more than 20 / 50 / 100 ms after the one before |
| `asm` | worst first-packet to PUSH span, so how long a frame took to arrive in pieces |
| `led` | worst frame pushed to the fixture. Every other field here measures the network; this is the only part of the 16.7 ms the board spends itself. On The Frame it is two DMA transfers of 300 and 420 pixels awaited together, around 12.6 ms, so watch it |
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
node --experimental-strip-types ddp-probe.ts 192.168.0.106 720 30 paced
node --experimental-strip-types ddp-probe.ts loopback 720 30 paced     # no radio, the control
node --experimental-strip-types ddp-probe.ts loopback 720 30 interval  # what apps/web does
```

The loopback mode is the one that matters. It scores packets locally with the same PUSH rule the
firmware uses, so whatever it reports is the sender and the operating system alone. Anything the
board reports beyond that is the radio path. Two rounds of this measurement went by before the
sender was checked, and it turned out to be contributing a 159 ms stall of its own.

Interleave firmware variants rather than batching them. Conditions on a 2.4 GHz network drift
enough over a few minutes to invent differences that are not there: an early comparison appeared
to show `PowerSave` beating `None` before repeat runs showed it was drift.

## How it is put together

Two crates. `wire` is the protocol and nothing else - no Embassy, no RP2040, no idea which board
it is on - which is what lets `cargo test` run it on the host. `node` is the firmware.

```
wire/src/ddp.rs      header parser
wire/src/frame.rs    the framebuffer, PUSH latch and tear detection, sized by a const generic
wire/src/hello.rs    the discovery query and its answer, from an Identity the binary fills in
wire/src/stats.rs    interval counters and the one line they format into

node/src/main.rs     claim the fixture, selftest it, join, run. Fifteen lines
node/src/board.rs    the pins cyw43 needs, handed back by whichever fixture did not want them
node/src/irq.rs      the interrupt table, since two modules bind against it
node/src/net.rs      console, radio, DHCP, heartbeat
node/src/node.rs     the socket and the one loop selecting a packet against the 1 Hz report
node/src/config.rs   credentials and the two ports
node/src/fixture/    one module per variant, cfg-selected in mod.rs
```

The receive loop is `recv_from -> parse -> apply -> on PUSH, present and score`. Everything runs
in the one thread-mode executor because embassy-net requires all its tasks at the same priority.

`Fixture::claim` takes the whole `Peripherals` by value, keeps what its variant needs and returns
the rest as a `Board`. That is what makes the pin budget a compile error instead of a comment,
and it is why `main.rs` carries no `#[cfg]` at all.

The framebuffer is sized to the whole fixture rather than to this board's share of it. DDP
offsets are device-local and always start at zero, so one binary receives any host-side split
without a rebuild, which is what makes the four-way comparison above a host config change rather
than a reflash.

The host owns gamma. `quantize()` in `packages/core/src/output.ts` encodes at 2.2 on the way to
the wire, so these bytes reach the strips untouched.

Resource split, fixed by cyw43 taking the first of everything: it holds **PIO0 SM0, DMA_CH0** and
GPIO 23, 24, 25 and 29, and wants no PWM at all. That leaves PIO1 and DMA_CH2/CH3 for the strips
and PWM slices 3 and 4 for the lamp. The onboard LED is on the CYW43 chip rather than a GPIO, so
it still cannot indicate anything before WiFi is up: solid means the join has not landed,
blinking means it has.

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

**None of the strip code has been run against a strip.** It compiles and it is what the
arithmetic and the datasheets ask for; it has never lit an LED. The first thing to do is wire one
run to line A and watch the boot selftest: line A red, line B green, then a single white pixel
travelling each line. If the order is wrong, or a line stops partway, that is wiring, and nothing
further up is worth reading until it is fixed.

**Level shift the data lines.** The Pico drives 3.3 V and WS2815 wants its logic high referenced
to 5 V, so a 74AHCT125 or SN74HCT245 sits between them. Without it the strip usually works, which
is worse than failing: it fails later, intermittently, and looks like a network fault. This is
the one item on this list that is not optional.

**Reconnect handling.** There is none: the join is retried at boot and that is all. Note before
building it that `is_link_up()` always returns true after the first connect (embassy #4612), so
it cannot be the trigger.

**Static IP**, as an alternative to a DHCP reservation.

**A watchdog**, so a wedged cyw43 recovers without someone walking to the board.

**Power.** Out of scope for the firmware but blocking for a lit room. The strips are WS2815,
12 V, 60 LED/m, one IC per LED: constant-current, so brightness does not fall off along a run,
and it carries a backup data line, so one dead LED does not take the rest of the strip with it.
720 pixels at full white is roughly **18 A at 12 V**, against about 43 A the same fixture would
have wanted at 5 V. The mixer's headroom and `compressHighlights` mean real shows never approach
either figure, but the supply and injection points have to be sized before any of this is
switched on. Line A is 300 pixels and about 7.5 A, which a 12 V 10 A supply covers outright, so
that is the run to build first.
