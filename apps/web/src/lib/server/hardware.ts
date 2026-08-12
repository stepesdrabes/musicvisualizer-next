import { createSocket, type Socket } from 'node:dgram';
import {
	faultsIn,
	parseIdentity,
	parseTelemetry,
	type DeviceIdentity,
	type DeviceTelemetry,
	type HardwareStatus,
	type LinkState
} from '$lib/hardware.ts';

const DDP_PORT = 4048;
const STATS_PORT = 4049;
const QUERY = Buffer.from('?room-node');

/** How often to ask a configured board whether it is there. */
const PROBE_INTERVAL_MS = 4000;
const PROBE_TIMEOUT_MS = 900;
/** A stats line arrives every second, so two missed ones is a stream that has stopped. */
const TELEMETRY_STALE_MS = 2600;

type Listener = (status: HardwareStatus) => void;

/**
 * What the app knows about the board, from the two things the board says.
 *
 * Discovery is a question the host asks and can ask at any time; telemetry is a stream the
 * board only sends to whoever is already sending it DDP. So the two answer different
 * questions - "is it there" and "is it keeping up" - and neither substitutes for the other.
 */
class Hardware {
	private host = '';
	private regionId = 'all';
	private streaming = false;
	private identity: DeviceIdentity | null = null;
	private telemetry: DeviceTelemetry | null = null;
	private latencyMs: number | null = null;
	private message = '';

	private listeners = new Set<Listener>();
	private stats: Socket | null = null;
	private probeTimer: NodeJS.Timeout | null = null;
	private probing = false;
	private watchers = 0;

	get region(): string {
		return this.regionId;
	}

	get status(): HardwareStatus {
		return {
			host: this.host,
			region: this.regionId,
			state: this.state,
			streaming: this.streaming,
			identity: this.identity,
			telemetry: this.fresh,
			latencyMs: this.latencyMs,
			message: this.message
		};
	}

	/** Telemetry only counts as current while it keeps arriving. */
	private get fresh(): DeviceTelemetry | null {
		if (!this.telemetry) return null;
		return Date.now() - this.telemetry.at < TELEMETRY_STALE_MS ? this.telemetry : null;
	}

	private get state(): LinkState {
		if (!this.host) return 'unconfigured';
		const telemetry = this.fresh;
		if (telemetry) return faultsIn(telemetry).length > 0 ? 'degraded' : 'streaming';
		if (this.identity) return 'online';
		return this.probing ? 'searching' : 'offline';
	}

	subscribe(listener: Listener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private publish(): void {
		const status = this.status;
		for (const listener of this.listeners) listener(status);
	}

	/**
	 * Point at a board. An empty host forgets everything, because a stale identity beside a
	 * blank address is the panel claiming to know something it does not.
	 */
	setHost(host: string): void {
		const next = host.trim();
		if (next === this.host) return;
		this.host = next;
		this.identity = null;
		this.telemetry = null;
		this.latencyMs = null;
		this.message = '';
		this.publish();
		if (next) void this.probe();
	}

	/**
	 * Point at a part of the room. Takes effect the next time output starts, the same as the
	 * address does: re-pointing a running stream mid-track would step the room, and the show is
	 * the thing being judged.
	 */
	setRegion(id: string): void {
		if (id === this.regionId) return;
		this.regionId = id;
		this.publish();
	}

	setStreaming(on: boolean): void {
		this.streaming = on;
		if (on) this.openStats();
		else this.closeStats();
		this.publish();
	}

	/**
	 * Poll only while somebody is watching, counted rather than flagged so a second tab
	 * closing does not stop the first one's readout.
	 */
	watch(): () => void {
		this.watchers++;
		if (this.probeTimer === null) {
			this.probeTimer = setInterval(() => void this.probe(), PROBE_INTERVAL_MS);
			void this.probe();
		}
		return () => {
			this.watchers = Math.max(0, this.watchers - 1);
			if (this.watchers > 0 || this.probeTimer === null) return;
			clearInterval(this.probeTimer);
			this.probeTimer = null;
		};
	}

	/** Ask one address who it is. Resolves to null on anything that is not our firmware. */
	async probe(host = this.host): Promise<DeviceIdentity | null> {
		if (!host) return null;
		const forCurrent = host === this.host;
		if (forCurrent) {
			this.probing = true;
			this.publish();
		}

		const started = Date.now();
		const identity = await ask(host, PROBE_TIMEOUT_MS);

		if (forCurrent) {
			this.probing = false;
			this.identity = identity;
			this.latencyMs = identity ? Date.now() - started : null;
			// A board that has never answered is a different situation from one that answered
			// before and has now gone quiet, and only the second is worth a message.
			this.message = identity ? '' : 'No answer from that address.';
			this.publish();
		}
		return identity;
	}

	/**
	 * Bind the stats port and listen.
	 *
	 * Held only while streaming so `firmware/tools/ddp-probe.ts`, which binds the same port,
	 * still works whenever the app is idle.
	 */
	private openStats(): void {
		if (this.stats) return;
		const socket = createSocket({ type: 'udp4', reuseAddr: true });
		this.stats = socket;

		socket.on('message', (buf) => {
			const telemetry = parseTelemetry(buf.toString(), Date.now());
			if (!telemetry) return;
			this.telemetry = telemetry;
			this.publish();
		});
		// Losing the port is not worth taking output down for; it only costs the readout.
		socket.on('error', () => this.closeStats());
		socket.bind(STATS_PORT);

		// Nothing else republishes while a stream is healthy, so the transition from fresh to
		// stale needs its own nudge or the panel would show 60 fps forever after a board dies.
		const tick = setInterval(() => this.publish(), 1000);
		socket.once('close', () => clearInterval(tick));
	}

	private closeStats(): void {
		this.stats?.close();
		this.stats = null;
		this.telemetry = null;
	}
}

/**
 * One discovery query and the first answer to it.
 *
 * The board replies to the source port rather than to the stats port, so this needs no
 * standing listener and works whether or not anything is streaming.
 */
function ask(host: string, timeoutMs: number): Promise<DeviceIdentity | null> {
	return new Promise((resolve) => {
		let socket: Socket;
		try {
			socket = createSocket('udp4');
		} catch {
			resolve(null);
			return;
		}

		let settled = false;
		const finish = (value: DeviceIdentity | null) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			try {
				socket.close();
			} catch {
				// Already closed by the error path.
			}
			resolve(value);
		};

		const timer = setTimeout(() => finish(null), timeoutMs);
		socket.on('message', (buf) => finish(parseIdentity(buf.toString(), host)));
		socket.on('error', () => finish(null));
		socket.send(QUERY, DDP_PORT, host, (err) => {
			if (err) finish(null);
		});
	});
}

export const hardware = new Hardware();
export { DDP_PORT, STATS_PORT };
