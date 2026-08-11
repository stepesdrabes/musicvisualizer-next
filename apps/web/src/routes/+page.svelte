<script lang="ts">
	import type { Show, TrackAnalysis, TrackContext } from '@mv/core';
	import { Viz, type Readout } from '$lib/viz.svelte.ts';
	import { QueueClient } from '$lib/queue.svelte.ts';
	import { HardwareClient } from '$lib/hardware.svelte.ts';
	import { installHint, readShell } from '$lib/shell.svelte.ts';
	import { indexOfKey } from '$lib/queueModel.ts';
	import type { Candidate } from '$lib/search.svelte.ts';
	import type {
		AuthorBackend,
		AuthorEvent,
		LibraryEntry,
		LoadState,
		Settings,
		Step,
		TrackMeta
	} from '$lib/types.ts';
	import Backdrop from '$components/Backdrop.svelte';
	import HardwareModal from '$components/HardwareModal.svelte';
	import Inspector from '$components/Inspector.svelte';
	import PlayerBar from '$components/PlayerBar.svelte';
	import QueuePanel from '$components/QueuePanel.svelte';
	import RoomModal from '$components/RoomModal.svelte';
	import SearchModal from '$components/SearchModal.svelte';
	import Stage from '$components/Stage.svelte';
	import TimelineDrawer from '$components/TimelineDrawer.svelte';
	import TopBar from '$components/TopBar.svelte';

	let viz: Viz | null = $state(null);
	const queue = new QueueClient();
	const hardware = new HardwareClient();

	let readout = $state<Readout>({
		fps: 0,
		position: 0,
		duration: 0,
		playing: false,
		bar: 0,
		section: 'intro',
		energy: 0,
		bpm: 0,
		cueBar: -1,
		headroom: 1
	});

	let analysis = $state<TrackAnalysis | null>(null);
	let context = $state<TrackContext | null>(null);
	let show = $state<Show | null>(null);
	let meta = $state<TrackMeta | null>(null);
	let trackId = $state<string | null>(null);
	let load = $state<LoadState>({ phase: 'idle', message: '', progress: null });
	let log = $state<string[]>([]);
	let steps = $state<Step[]>([]);
	let warnings = $state<string[]>([]);
	let library = $state<LibraryEntry[]>([]);
	let settings = $state<Settings>({
		hasDeepseekKey: false,
		authorBackend: 'claude',
		outputOffsetMs: 0
	});

	let searchOpen = $state(false);
	let searchSeed = $state('');
	let hardwareOpen = $state(false);

	// Read once: the shell injects it before any of this runs and never changes it.
	const shell = readShell();
	let leftOpen = $state(true);
	let rightOpen = $state(true);
	let timelineOpen = $state(false);

	let volume = $state(0.8);
	let relevelling = $state(false);
	let rerolling = $state(false);

	// Deliberately not `$state`: the sync effect below reads it, and a reactive read there would
	// re-subscribe on every step of the trim, tearing down the interval it just built. The slider
	// displays `settings.outputOffsetMs`; this is the copy the wire is driven from.
	let wireOffsetMs = 0;

	// The server owns the address and whether it is streaming; this only ever reads them.
	const ddpHost = $derived(hardware.status.host);
	const ddpRunning = $derived(hardware.status.streaming);

	const current = $derived(queue.current);
	const currentIndex = $derived(indexOfKey(queue.state, queue.state.currentKey));
	const hasPrev = $derived(currentIndex > 0);
	const hasNext = $derived(currentIndex >= 0 && currentIndex < queue.items.length - 1);

	const busy = $derived(
		load.phase === 'authoring' ||
			(current !== null && current.status !== 'ready' && current.status !== 'error')
	);
	const busyLabel = $derived(
		load.phase === 'authoring' ? load.message : (current?.message ?? 'Working')
	);
	const failure = $derived(
		shell.missingTools.length > 0
			? `${shell.missingTools.join(', ')} not found. ${installHint(shell.platform, shell.missingTools)}`
			: load.phase === 'error'
				? load.message
				: current?.status === 'error'
					? current.message
					: ''
	);

	function note(line: string) {
		log = [...log.slice(-400), line];
	}

	function setPhase(phase: LoadState['phase'], message: string, progress: number | null = null) {
		load = { phase, message, progress };
	}

	function postJson(url: string, body: unknown) {
		return fetch(url, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		});
	}

	async function refreshLibrary() {
		try {
			const res = await fetch('/api/library');
			if (res.ok) library = ((await res.json()) as { entries: LibraryEntry[] }).entries;
		} catch {
			// A missing library only costs the palette its first group.
		}
	}

	async function refreshSettings() {
		try {
			const res = await fetch('/api/settings');
			if (res.ok) {
				settings = (await res.json()) as Settings;
				wireOffsetMs = settings.outputOffsetMs;
			}
		} catch {
			// Loopback only, so a failure here means a guest page, where authoring is not offered.
		}
	}

	/** Persisted, because which model to spend is a decision that outlives one track. */
	async function patchSettings(patch: Partial<Settings & { deepseekApiKey: string }>) {
		const res = await fetch('/api/settings', {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(patch)
		});
		if (res.ok) settings = (await res.json()) as Settings;
		else note(`settings: ${await res.text()}`);
	}

	function chooseBackend(backend: AuthorBackend) {
		settings = { ...settings, authorBackend: backend };
		void patchSettings({ authorBackend: backend });
	}

	function saveDeepseekKey(key: string) {
		void patchSettings({ deepseekApiKey: key });
	}

	/** Dragging: the running stream takes it on its next sync, half a second at the worst. */
	function moveOffset(ms: number) {
		wireOffsetMs = ms;
		settings = { ...settings, outputOffsetMs: ms };
	}

	/** Released. One write, rather than one per step of the drag. */
	function saveOffset(ms: number) {
		moveOffset(ms);
		void patchSettings({ outputOffsetMs: ms });
	}

	$effect(() => {
		const v = new Viz();
		v.onReadout = (r) => (readout = r);
		// The queue decides what comes next, not this tab: a skip from anywhere lands the same way.
		v.onEnded = () => void queue.next();
		v.start();
		viz = v;
		queue.connect();
		hardware.connect();
		void refreshLibrary();
		void refreshSettings();
		return () => {
			v.dispose();
			queue.dispose();
			hardware.dispose();
		};
	});

	$effect(() => {
		viz?.setVolume(volume);
	});

	// Keep the hardware clock aligned with the audio that is actually playing. Half a second
	// is plenty: the server extrapolates between syncs from its own monotonic clock.
	//
	// `heardPosition`, not `position`: the preview already subtracts the output latency so it
	// lines up with what reaches the ear, and sending the raw audio clock instead put the room
	// that far ahead of both. Read off the viz rather than the readout for the same reason it
	// is not read from anywhere else here - the readout is a `$state` object republished at
	// 20 Hz, and touching it inside this effect re-subscribed that often, which cleared the
	// interval before it could ever fire and turned two posts a second into twenty.
	$effect(() => {
		const v = viz;
		if (!ddpRunning || !v) return;
		const send = () =>
			postJson('/api/output', {
				action: 'sync',
				position: v.heardPosition,
				playing: v.isPlaying,
				offsetMs: wireOffsetMs
			}).catch(() => {});
		void send();
		const timer = setInterval(send, 500);
		return () => clearInterval(timer);
	});

	/**
	 * Follow the server's idea of what is playing.
	 *
	 * The queue is server state so that a phone in the room can change it, which means this
	 * tab is a follower: it reacts to the current row becoming ready rather than deciding
	 * anything. Keyed on the track id so a row being re-titled mid-download does not reload
	 * audio that is already decoded.
	 */
	let loadedTrackId = $state<string | null>(null);
	$effect(() => {
		const item = current;
		if (!viz) return;

		// An emptied queue leaves the room running. Stopping the music because somebody cleared
		// a list would be the one thing a room full of people would not forgive, and the loaded
		// track stays addressable so it can still be handed to Claude.
		if (!item || item.status !== 'ready' || !item.trackId) return;
		if (item.trackId === loadedTrackId) return;

		loadedTrackId = item.trackId;
		void openTrack(item.trackId);
	});

	async function openTrack(id: string) {
		if (!viz) return;
		warnings = [];
		steps = [];
		show = null;
		analysis = null;
		context = null;
		viz.clearShow();
		setPhase('analysing', 'Loading');

		try {
			const [bundleRes, audioRes] = await Promise.all([
				fetch(`/api/track/${id}/bundle`),
				fetch(`/api/track/${id}/audio`)
			]);
			if (!bundleRes.ok) throw new Error((await bundleRes.text()).slice(0, 300));
			if (!audioRes.ok) throw new Error('audio not cached');

			const bundle = (await bundleRes.json()) as {
				analysis: TrackAnalysis;
				show: Show | null;
				meta: TrackMeta | null;
				context: TrackContext | null;
			};

			await viz.loadAudio(await audioRes.arrayBuffer());
			trackId = id;
			analysis = bundle.analysis;
			meta = bundle.meta;
			context = bundle.context;

			if (bundle.show) {
				show = bundle.show;
				viz.loadShow(bundle.analysis, bundle.show);
				note(`${bundle.meta?.title ?? id}: ${bundle.show.cues.length} cues, ${bundle.show.hits.length} hits`);
			} else {
				note(`${id}: analysed, no show yet`);
			}

			setPhase('ready', '');
			// Starting here rather than on the queue event: a track that is not decoded yet
			// cannot play, and asking it to would just silently do nothing.
			await viz.play();
			if (ddpRunning) void startOutput(id);
		} catch (e) {
			setPhase('error', (e as Error).message);
			note(`ERROR ${(e as Error).message}`);
		}
	}

	function hosts(): string[] {
		return ddpHost
			.split(',')
			.map((h) => h.trim())
			.filter(Boolean);
	}

	/**
	 * Point the server's own renderer at a track.
	 *
	 * Also how a changed show reaches the strips: the output reads the show from disk when it
	 * starts and never again, so rerolling or authoring one while streaming leaves the room
	 * playing the composition it was handed.
	 */
	function startOutput(id: string) {
		return postJson('/api/output', {
			action: 'start',
			trackId: id,
			hosts: hosts(),
			offsetMs: wireOffsetMs
		});
	}

	async function toggleOutput() {
		if (ddpRunning) {
			await postJson('/api/output', { action: 'stop' });
			note('DDP output stopped');
			return;
		}
		if (!trackId || hosts().length === 0) return;
		const res = await startOutput(trackId);
		note(res.ok ? `DDP output to ${ddpHost}` : `ERROR ${await res.text()}`);
	}

	function openSearch(seed: string) {
		searchSeed = seed;
		searchOpen = true;
	}

	async function pick(candidate: Candidate, how: 'queue' | 'now' | 'next') {
		const wasEmpty = queue.items.length === 0;
		await queue.add([
			{
				source: candidate.source,
				trackId: candidate.origin === 'link' ? null : candidate.id,
				title: candidate.origin === 'link' ? candidate.source : candidate.title,
				uploader: candidate.uploader,
				thumbnail: candidate.thumbnail,
				duration: candidate.duration,
				authored: candidate.authored
			}
		]);
		note(`queued ${candidate.title}`);
		void refreshLibrary();

		if (how === 'queue' || wasEmpty) return;
		// The row that was just appended is the last one, and the server has told us about it
		// by the time the POST resolves.
		const added = queue.items[queue.items.length - 1];
		if (!added) return;
		if (how === 'now') await queue.jump(added.key);
		else await queue.playNext(added.key);
	}

	/**
	 * Re-read the track at a different metrical level.
	 *
	 * The whole show is re-composed rather than rescaled, because every cue is addressed by bar
	 * and the bars have moved: a rescaled show would point the entire night at the wrong music.
	 */
	async function relevel(level: number) {
		const source = meta?.source;
		if (!source || relevelling || !viz) return;
		relevelling = true;
		setPhase('analysing', 'Re-reading the grid');
		try {
			const res = await postJson('/api/ingest', { source, metricalLevel: level });
			if (!res.ok) throw new Error((await res.text()).slice(0, 300));
			const data = (await res.json()) as {
				id: string;
				analysis: TrackAnalysis;
				meta: TrackMeta;
				show: Show | null;
			};
			analysis = data.analysis;
			meta = data.meta;
			show = data.show;
			if (data.show) viz.loadShow(data.analysis, data.show);
			note(`re-read at ${data.analysis.tempo.bpm} bpm`);
			setPhase('ready', '');
		} catch (e) {
			setPhase('error', (e as Error).message);
		} finally {
			relevelling = false;
		}
	}

	/**
	 * Compose the same track again with a different roll.
	 *
	 * The engine composes in about a millisecond, so this is a parameter and a button rather
	 * than a feature: the show that comes back is the same composer's work under a different
	 * seed, not a different composer.
	 */
	async function reroll() {
		if (!trackId || !viz || rerolling) return;
		rerolling = true;
		try {
			const res = await postJson(`/api/track/${trackId}/show`, {});
			if (!res.ok) throw new Error((await res.text()).slice(0, 300));
			const data = (await res.json()) as { show: Show };
			show = data.show;
			viz.loadShow(analysis!, data.show);
			warnings = [];
			note(`rerolled: ${data.show.cues.length} cues, seed ${data.show.seed}`);
			if (ddpRunning) void startOutput(trackId);
			void refreshLibrary();
		} catch (e) {
			note(`ERROR ${(e as Error).message}`);
		} finally {
			rerolling = false;
		}
	}

	function author(backend: AuthorBackend) {
		if (!trackId || !analysis || !viz) return;
		warnings = [];
		steps = [];
		setPhase('authoring', 'Starting');
		note('authoring started');

		let seq = 0;
		const nextId = () => `s${seq++}`;

		function push(step: Omit<Step, 'id'>) {
			steps = [...steps, { ...step, id: nextId() }];
		}

		function settle(state: Step['state'], result?: string) {
			// Close the most recent pending step. Tool results arrive in order, so the newest
			// pending step is always the one they belong to.
			for (let i = steps.length - 1; i >= 0; i--) {
				if (steps[i].state !== 'pending') continue;
				steps[i] = { ...steps[i], state, result };
				steps = [...steps];
				return;
			}
		}

		function handle(e: AuthorEvent) {
			switch (e.type) {
				case 'phase':
					settle('done');
					push({ kind: 'phase', label: e.label, state: 'done' });
					setPhase('authoring', e.label);
					note(`== ${e.label}`);
					break;

				case 'tool':
					push({ kind: 'tool', label: e.name, detail: e.detail, state: 'pending' });
					setPhase('authoring', `${e.name}${e.detail ? ` ${e.detail}` : ''}`);
					note(`-> ${e.name} ${e.detail}`);
					break;

				case 'result':
					settle(e.ok ? 'done' : 'failed', e.summary);
					note(`   ${e.ok ? '' : 'FAILED '}${e.summary}`);
					break;

				case 'thinking': {
					const text = e.text.replace(/\s+/g, ' ').trim();
					if (text.length < 12) break;
					settle('done');
					push({ kind: 'think', label: text.slice(0, 200), state: 'done' });
					note(text.slice(0, 400));
					break;
				}

				case 'analysis':
					push({ kind: 'note', label: `Tempo corrected: ${e.reason}`, state: 'done' });
					analysis = e.analysis as TrackAnalysis;
					note(`** grid corrected: ${e.reason}`);
					break;

				case 'brief':
					push({ kind: 'note', label: 'Design brief written', state: 'done' });
					break;

				case 'note':
					note(e.text);
					break;
			}
		}

		const es = new EventSource(
			`/api/author?id=${encodeURIComponent(trackId)}&backend=${encodeURIComponent(backend)}`
		);

		es.addEventListener('event', (ev) => handle(JSON.parse((ev as MessageEvent).data) as AuthorEvent));

		es.addEventListener('failed', (ev) => {
			const message = String(JSON.parse((ev as MessageEvent).data));
			settle('failed');
			setPhase('error', message.slice(0, 300));
			note(`ERROR ${message}`);
			es.close();
		});

		// EventSource fires a bare `error` with no data when the stream simply closes.
		es.addEventListener('error', (ev) => {
			if ((ev as MessageEvent).data) return;
			if (load.phase === 'authoring') {
				setPhase('error', 'the authoring stream closed unexpectedly');
				settle('failed');
			}
			es.close();
		});

		es.addEventListener('done', (ev) => {
			const data = JSON.parse((ev as MessageEvent).data) as {
				show: Show;
				analysis: TrackAnalysis;
				brief: string;
				warnings: string[];
			};
			settle('done');
			analysis = data.analysis;
			show = data.show;
			warnings = data.warnings;
			viz!.loadShow(data.analysis, data.show);
			push({
				kind: 'phase',
				label: `Show ready: ${data.show.cues.length} cues, ${data.show.hits.length} hits`,
				state: 'done'
			});
			note(`show ready: ${data.show.cues.length} cues, ${data.show.generatedEffects.length} generated`);
			setPhase('ready', '');
			// The server's renderer read the old show off disk when it started and will not look
			// again, so without this the strips keep playing the draft the agent just replaced.
			if (ddpRunning && trackId) void startOutput(trackId);
			void refreshLibrary();
			es.close();
		});
	}

	/**
	 * Previous means the previous section until the track is barely started, then the previous
	 * track. Same gesture as every player: what it does depends on where you are in the song.
	 */
	// The audio clock, not the readout: the readout is published at 20 Hz and stops entirely
	// while the tab is in the background, where the audio keeps playing regardless.
	function prev() {
		const v = viz;
		if (!v || !analysis || v.position < 3) {
			void queue.prev();
			return;
		}
		const now = v.position;
		const bounds = analysis.sections.map((s) => s.startTime);
		v.seek([...bounds].reverse().find((t) => t < now - 2) ?? 0);
	}

	function next() {
		const v = viz;
		if (!v || !analysis) {
			void queue.next();
			return;
		}
		const now = v.position;
		const target = analysis.sections.map((s) => s.startTime).find((t) => t > now + 0.05);
		if (target === undefined) void queue.next();
		else v.seek(target);
	}

	function onKey(e: KeyboardEvent) {
		if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
			e.preventDefault();
			openSearch('');
			return;
		}
		if (searchOpen) return;
		if (e.target instanceof HTMLInputElement) return;

		if (e.code === 'Space') {
			e.preventDefault();
			void viz?.toggle();
		} else if (e.code === 'ArrowLeft' && viz) {
			viz.seek(Math.max(0, viz.position - (e.shiftKey ? 30 : 5)));
		} else if (e.code === 'ArrowRight' && viz) {
			viz.seek(Math.min(viz.duration, viz.position + (e.shiftKey ? 30 : 5)));
		} else if (e.key === '[') {
			leftOpen = !leftOpen;
		} else if (e.key === ']') {
			rightOpen = !rightOpen;
		}
	}
</script>

<svelte:window onkeydown={onKey} />

<Backdrop thumbnail={meta?.thumbnail ?? ''} />

<div class="shell">
	<TopBar
		{busy}
		{busyLabel}
		{failure}
		hardware={hardware.status}
		{leftOpen}
		{rightOpen}
		onsearch={openSearch}
		onhardware={() => (hardwareOpen = true)}
		ontoggleLeft={() => (leftOpen = !leftOpen)}
		ontoggleRight={() => (rightOpen = !rightOpen)} />

	<div class="body">
		{#if leftOpen}
			<QueuePanel
				items={queue.items}
				currentKey={queue.state.currentKey}
				playing={readout.playing}
				onjump={(k) => void queue.jump(k)}
				onremove={(k) => void queue.remove(k)}
				onplayNext={(k) => void queue.playNext(k)}
				onmove={(k, to) => void queue.move(k, to)}
				onretry={(k) => void queue.retry(k)}
				onclear={() => void queue.clear(true)}
				onsearch={() => openSearch('')} />
		{/if}

		<Stage {viz} {readout} {load} {steps} hasShow={!!show} queued={queue.items.length} />

		{#if rightOpen}
			<Inspector
				{analysis}
				{context}
				{show}
				{readout}
				{log}
				{steps}
				{warnings}
				{settings}
				canAuthor={!!analysis}
				authoring={load.phase === 'authoring'}
				onauthor={author}
				onbackend={chooseBackend}
				onkey={saveDeepseekKey}
				onrelevel={relevel}
				onreroll={reroll}
				{relevelling}
				{rerolling} />
		{/if}
	</div>

	<PlayerBar
		{meta}
		{analysis}
		{show}
		{readout}
		bind:volume
		{timelineOpen}
		{hasPrev}
		{hasNext}
		ontoggle={() => void viz?.toggle()}
		onseek={(t) => viz?.seek(t)}
		onprev={prev}
		onnext={next}
		ontimeline={() => (timelineOpen = !timelineOpen)} />

	{#if timelineOpen}
		<TimelineDrawer
			{viz}
			{analysis}
			{show}
			position={readout.position}
			duration={readout.duration}
			onseek={(t) => viz?.seek(t)} />
	{/if}
</div>

<SearchModal bind:open={searchOpen} bind:query={searchSeed} {library} onpick={pick} />

<RoomModal />

<HardwareModal
	open={hardwareOpen}
	status={hardware.status}
	canStream={!!show}
	onclose={() => (hardwareOpen = false)}
	offsetMs={settings.outputOffsetMs}
	onhost={(h) => void hardware.setHost(h)}
	onprobe={(h) => void hardware.probe(h)}
	onoffset={moveOffset}
	onoffsetdone={saveOffset}
	ontoggleOutput={toggleOutput} />

<style>
	/* No z-index of its own: the room layer inside it has to stay under the panels, which is
	   only possible while they all share the root stacking context. */
	.shell {
		display: flex;
		flex-direction: column;
		height: 100vh;
	}
	.body {
		display: flex;
		flex: 1;
		min-height: 0;
	}
</style>
