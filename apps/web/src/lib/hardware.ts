/**
 * The two lines the board speaks, and what they mean.
 *
 * Both are ASCII, both are parsed here rather than on the server so the shapes can be tested
 * against the samples in FIRMWARE.md without opening a socket. A field the firmware stops
 * sending reads as undefined rather than throwing: this parser is older than the next
 * firmware by construction.
 */

/** Answer to a discovery query. Available whether or not anything is streaming. */
export interface DeviceIdentity {
	host: string;
	/** DHCP hostname the board offers, which is what the router lists it as. */
	name: string;
	firmware: string;
	uptimeS: number;
	/** Pixels this build can hold, not what it is being sent. */
	pixels: number;
	ddpPort: number;
	statsPort: number;
	/**
	 * What each of the build's outputs does with a frame, `+`-separated: `stub` only scores it,
	 * `monitor` puts it on one RGB LED, `lamp` on an analog RGBW fixture, `ws2815` on the strips.
	 */
	leds: string;
}

/** Outputs that receive the whole fixture and light none of it. */
const DARK_OUTPUTS = new Set(['stub', 'monitor']);

/**
 * Whether a frame reaching this board reaches the room.
 *
 * Two outputs receive the whole fixture and light none of it, and the difference matters to
 * whoever is reading these numbers: `stub` only counts packets, `monitor` summarises the frame
 * onto a single RGB LED so the path can be judged before there are strips to judge it with.
 * Both leave the room dark, so both have to say so.
 *
 * A board can carry several outputs at once, so the question is whether any of them emits
 * light, not what the first one happens to be. An unrecognised kind counts as lit: this parser
 * is older than the next firmware by construction, and warning that a lit room is dark is the
 * worse of the two mistakes.
 */
export function lightsRoom(identity: DeviceIdentity | null): boolean {
	if (identity === null) return false;
	return identity.leds.split('+').some((kind) => !DARK_OUTPUTS.has(kind));
}

/** One second of what actually arrived, reported by the board itself. */
export interface DeviceTelemetry {
	uptimeS: number;
	/** Largest frame seen, so it confirms how much of the fixture this board is being fed. */
	pixels: number;
	packetsPerSecond: number;
	kbPerSecond: number;
	/** PUSH flags per second. The headline number; 60 is the target. */
	fps: number;
	gapMinMs: number;
	gapMaxMs: number;
	/** Frames arriving more than 20 / 50 / 100 ms after the one before. */
	late: [number, number, number];
	assemblyMaxMs: number;
	seqGaps: number;
	bad: number;
	outOfRange: number;
	torn: number;
	/** When this line arrived, epoch ms, stamped by the receiver. */
	at: number;
}

const num = (line: string, re: RegExp): number | null => {
	const m = re.exec(line);
	return m ? Number(m[1]) : null;
};

/**
 * `room-node host room-node fw 0.1.0 up 42s px 1320 ddp 4048 stats 4049 leds stub`
 *
 * The leading token is the magic that says this is ours; anything else on the port is some
 * other device answering something else.
 */
export function parseIdentity(line: string, host: string): DeviceIdentity | null {
	const text = line.trim();
	if (!text.startsWith('room-node')) return null;

	const word = (re: RegExp): string | null => {
		const m = re.exec(text);
		return m ? m[1] : null;
	};

	return {
		host,
		name: word(/\bhost\s+(\S+)/) ?? 'room-node',
		firmware: word(/\bfw\s+(\S+)/) ?? 'unknown',
		uptimeS: num(text, /\bup\s+(\d+)s/) ?? 0,
		pixels: num(text, /\bpx\s+(\d+)/) ?? 0,
		ddpPort: num(text, /\bddp\s+(\d+)/) ?? 4048,
		statsPort: num(text, /\bstats\s+(\d+)/) ?? 4049,
		leds: word(/\bleds\s+(\S+)/) ?? 'unknown'
	};
}

/**
 * `up 42s  1320 px  180 pkt/s  231.7 KB/s  60.0 fps  gap 15.9/17.8 ms  late 0/0/0
 *  asm 2.1 ms  seqgap 0  bad 0  oob 0  torn 0`
 *
 * `late` is absent from the sample in FIRMWARE.md but present in what the firmware writes, so
 * it is optional here rather than required.
 */
export function parseTelemetry(line: string, at: number): DeviceTelemetry | null {
	const text = line.trim();
	const fps = num(text, /([\d.]+)\s+fps/);
	// fps is the one field that makes a line a stats line rather than anything else on the port.
	if (fps === null) return null;

	const gap = /gap\s+([\d.]+)\/([\d.]+)\s+ms/.exec(text);
	const late = /late\s+(\d+)\/(\d+)\/(\d+)/.exec(text);

	return {
		uptimeS: num(text, /\bup\s+(\d+)s/) ?? 0,
		pixels: num(text, /(\d+)\s+px/) ?? 0,
		packetsPerSecond: num(text, /(\d+)\s+pkt\/s/) ?? 0,
		kbPerSecond: num(text, /([\d.]+)\s+KB\/s/) ?? 0,
		fps,
		gapMinMs: gap ? Number(gap[1]) : 0,
		gapMaxMs: gap ? Number(gap[2]) : 0,
		late: late ? [Number(late[1]), Number(late[2]), Number(late[3])] : [0, 0, 0],
		assemblyMaxMs: num(text, /asm\s+([\d.]+)\s+ms/) ?? 0,
		seqGaps: num(text, /seqgap\s+(\d+)/) ?? 0,
		bad: num(text, /\bbad\s+(\d+)/) ?? 0,
		outOfRange: num(text, /\boob\s+(\d+)/) ?? 0,
		torn: num(text, /\btorn\s+(\d+)/) ?? 0,
		at
	};
}

export type LinkState =
	| 'unconfigured'
	| 'searching'
	| 'offline'
	| 'online'
	| 'streaming'
	| 'degraded';

/**
 * How far the wire may be trimmed against the audio, milliseconds.
 *
 * Positive runs the room early, which is the direction that needs the range: DDP buffering,
 * WiFi jitter and WLED's own frame queue all delay the strips and none of them push the other
 * way. The negative end is there for a board on wired ethernet beating a Bluetooth speaker.
 */
export const OFFSET_MIN_MS = -100;
export const OFFSET_MAX_MS = 250;

export interface HardwareStatus {
	host: string;
	state: LinkState;
	streaming: boolean;
	identity: DeviceIdentity | null;
	telemetry: DeviceTelemetry | null;
	/** Round trip of the last discovery answer, ms. */
	latencyMs: number | null;
	message: string;
}

/**
 * Anything the board reports that means the room is not seeing a clean 60.
 *
 * `seqgap` is deliberately not one of them: it only counts loss while this board is the sole
 * DDP target, and the host's sequence counter strides rather than steps across a split
 * fixture, so it would cry wolf the moment a second board is added.
 */
export function faultsIn(t: DeviceTelemetry): string[] {
	const faults: string[] = [];
	if (t.torn > 0) faults.push(`${t.torn} torn frame${t.torn === 1 ? '' : 's'}`);
	if (t.outOfRange > 0) faults.push(`${t.outOfRange} out of range`);
	if (t.bad > 0) faults.push(`${t.bad} rejected`);
	if (t.late[2] > 0) faults.push(`${t.late[2]} stall${t.late[2] === 1 ? '' : 's'} over 100 ms`);
	else if (t.fps > 0 && t.fps < 55) faults.push(`${t.fps.toFixed(1)} fps`);
	return faults;
}
