import { error, json } from '@sveltejs/kit';
import { readFile } from 'node:fs/promises';
import {
	DEFAULT_ROOM,
	EffectRegistry,
	Mixer,
	ShowPlayer,
	buildGeometry,
	compileGenerated,
	type LedSink,
	type Show,
	type TrackAnalysis
} from '@mv/core';
import { analysisPath, isValidId, showPath } from '@mv/analysis';
import { createDdpSink, type DdpTarget } from '@mv/transport-ddp';
import { currentItem } from '$lib/queueModel.ts';
import { queue } from '$lib/server/queueStore.ts';
import { hardware } from '$lib/server/hardware.ts';
import { isLocal } from '$lib/server/access.ts';
import type { RequestHandler } from './$types';

/**
 * Hardware output runs its own copy of the show, server-side.
 *
 * The browser cannot open a UDP socket, and streaming 60 frames a second of pixels over a
 * socket to the server would be silly when the show is fully deterministic: given the same
 * analysis, the same show and the same position, this renders bit-identical bytes to the
 * preview. So the browser only reports where the audio actually is, and the room keeps
 * running even if the tab goes away.
 */
class Output {
	private geometry = buildGeometry(DEFAULT_ROOM);
	private registry = new EffectRegistry();
	private mixer = new Mixer(this.geometry);
	private player = new ShowPlayer(this.mixer, this.registry);
	private sink: LedSink | null = null;
	private timer: NodeJS.Timeout | null = null;

	private position = 0;
	private syncedAt = 0;
	private playing = false;
	private offsetMs = 0;
	private frames = 0;

	targets: DdpTarget[] = [];

	get running(): boolean {
		return this.timer !== null;
	}

	get status() {
		return {
			running: this.running,
			playing: this.playing,
			position: this.position,
			frames: this.frames,
			targets: this.targets.map((t) => `${t.host}:${t.port ?? 4048}`)
		};
	}

	load(analysis: TrackAnalysis, show: Show): void {
		this.registry.clearGenerated();
		for (const gen of show.generatedEffects) {
			const compiled = compileGenerated(gen, this.geometry);
			if (compiled.def) this.registry.add(compiled.def);
		}
		this.player.load(analysis, show);
	}

	async start(targets: DdpTarget[], offsetMs: number): Promise<void> {
		await this.stop();
		this.targets = targets;
		this.offsetMs = offsetMs;
		this.sink = createDdpSink({ targets });
		await this.sink.open();

		let last = performance.now();
		this.frames = 0;
		// This loop is the only clock, and it sends directly. A separate re-clocking sender on
		// top would double the per-frame work in one event loop and cost a third of the frame
		// rate; the keep-alive it exists to provide is already inherent here, because this loop
		// runs whether or not a browser is attached.
		this.timer = setInterval(() => {
			const now = performance.now();
			const dt = Math.min((now - last) / 1000, 0.05);
			last = now;
			const t = this.playing
				? this.position + (now - this.syncedAt) / 1000 + this.offsetMs / 1000
				: this.position;
			const frame = this.player.update(Math.max(0, t), dt);
			this.mixer.render(frame);
			this.sink?.send({
				rgb: this.mixer.bytes,
				dt,
				frameId: this.frames,
				presentAtMs: now
			});
			this.frames++;
		}, 1000 / 60);
	}

	sync(position: number, playing: boolean): void {
		this.position = position;
		this.playing = playing;
		this.syncedAt = performance.now();
	}

	async stop(): Promise<void> {
		if (this.timer) clearInterval(this.timer);
		this.timer = null;
		await this.sink?.close();
		this.sink = null;
	}

	/** Which track this output is currently rendering, so the queue can tell when to re-point. */
	trackId: string | null = null;
}

const output = new Output();

/** Load a track's analysis and show, or explain why it cannot be loaded. */
async function loadTrack(id: string): Promise<{ analysis: TrackAnalysis; show: Show } | null> {
	try {
		return {
			analysis: JSON.parse(await readFile(analysisPath(id), 'utf8')) as TrackAnalysis,
			show: JSON.parse(await readFile(showPath(id), 'utf8')) as Show
		};
	} catch {
		return null;
	}
}

/**
 * The hardware follows the queue on its own.
 *
 * The queue is server state and so is this, so there is no reason for a track change to have
 * to round-trip through a browser. It also means the room keeps up with a skip made from
 * somebody's phone even when no tab is open.
 */
queue.subscribe((state) => {
	if (!output.running) return;
	const id = currentItem(state)?.trackId ?? null;
	if (!id || id === output.trackId) return;
	void loadTrack(id).then((loaded) => {
		if (!loaded || !output.running) return;
		output.load(loaded.analysis, loaded.show);
		output.trackId = id;
		// A new track starts at its own beginning, not wherever the last one had got to.
		output.sync(0, false);
	});
});

export const GET: RequestHandler = async () => json(output.status);

export const POST: RequestHandler = async (event) => {
	if (!isLocal(event)) error(403, 'the hardware belongs to the machine running the show');

	const body = (await event.request.json()) as {
		action: 'start' | 'stop' | 'sync';
		trackId?: string;
		hosts?: string[];
		offsetMs?: number;
		position?: number;
		playing?: boolean;
	};

	if (body.action === 'stop') {
		await output.stop();
		hardware.setStreaming(false);
		return json(output.status);
	}

	if (body.action === 'sync') {
		output.sync(body.position ?? 0, body.playing ?? false);
		return json(output.status);
	}

	const id = body.trackId;
	if (!id || !isValidId(id)) error(400, 'valid trackId required');
	if (!body.hosts?.length) error(400, 'at least one host required');

	const loaded = await loadTrack(id);
	if (!loaded) error(404, 'no analysis or show cached for this track');

	output.load(loaded.analysis, loaded.show);
	output.trackId = id;

	// One target per host, splitting the fixture evenly. WS2812 is 30 us per LED, so 1320 on
	// one data line caps at 25 Hz; several controllers is how 60 fps is actually reached.
	const total = buildGeometry(DEFAULT_ROOM).count;
	const per = Math.ceil(total / body.hosts.length);
	const targets: DdpTarget[] = body.hosts.map((host, i) => ({
		host,
		firstLed: i * per,
		ledCount: Math.min(per, total - i * per),
		deviceFirstLed: 0
	}));

	await output.start(targets, body.offsetMs ?? 0);
	// The first host is the one the readout is about: the board only reports to whoever sends
	// it DDP, so on a split fixture each would need its own listener and its own port.
	hardware.setHost(body.hosts[0]);
	hardware.setStreaming(true);
	return json(output.status);
};
