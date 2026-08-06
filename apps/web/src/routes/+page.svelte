<script lang="ts">
	import type { EffectDef, Show, TrackAnalysis } from '@mv/core';
	import { Viz, type Readout } from '$lib/viz.svelte.ts';
	import type { AuthorEvent, LoadState, Step, TrackMeta } from '$lib/types.ts';
	import Inspector from '$components/Inspector.svelte';
	import PlayerBar from '$components/PlayerBar.svelte';
	import ShowStrip from '$components/ShowStrip.svelte';
	import LedBands from '$components/LedBands.svelte';
	import Stage from '$components/Stage.svelte';
	import TopBar from '$components/TopBar.svelte';

	let viz: Viz | null = $state(null);
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
	let show = $state<Show | null>(null);
	let meta = $state<TrackMeta | null>(null);
	let trackId = $state<string | null>(null);
	let load = $state<LoadState>({ phase: 'idle', message: '', progress: null });
	let log = $state<string[]>([]);
	let steps = $state<Step[]>([]);
	let warnings = $state<string[]>([]);
	let previewing = $state<string | null>(null);
	let previewParams = $state<Record<string, number>>({});

	// Whatever this show wrote for itself, so the gallery shows the full deck rather than only
	// the built-ins. Compilation already happened when the show loaded; this reads the registry.
	const generatedDefs = $derived(
		(show?.generatedEffects ?? [])
			.map((g) => viz?.registry.get(g.id) ?? null)
			.filter((d): d is EffectDef => d !== null)
	);

	function preview(def: EffectDef | null) {
		if (!viz) return;
		viz.setPreview(def);
		previewing = def?.id ?? null;
		previewParams = { ...viz.previewValues };
	}

	function previewParam(key: string, value: number) {
		if (!viz) return;
		viz.setPreviewParam(key, value);
		previewParams = { ...viz.previewValues };
	}
	let volume = $state(0.8);
	let ddpHost = $state('');
	let ddpRunning = $state(false);

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

	$effect(() => {
		const v = new Viz();
		v.onReadout = (r) => (readout = r);
		v.start();
		viz = v;
		return () => v.dispose();
	});

	$effect(() => {
		viz?.setVolume(volume);
	});

	// Keep the hardware clock aligned with the audio that is actually playing. Half a second
	// is plenty: the server extrapolates between syncs from its own monotonic clock.
	$effect(() => {
		if (!ddpRunning) return;
		const send = () =>
			postJson('/api/output', {
				action: 'sync',
				position: readout.position,
				playing: readout.playing
			}).catch(() => {});
		void send();
		const timer = setInterval(send, 500);
		return () => clearInterval(timer);
	});

	async function loadTrack(source: string) {
		if (!viz) return;
		warnings = [];
		show = null;
		setPhase(/^https?:/.test(source) ? 'resolving' : 'analysing', 'Resolving');
		note(`load ${source}`);

		try {
			const res = await postJson('/api/ingest', { source });
			if (!res.ok) throw new Error((await res.text()).slice(0, 300));

			const data = (await res.json()) as {
				id: string;
				analysis: TrackAnalysis;
				meta: TrackMeta;
				show: Show | null;
				fromCache: boolean;
			};
			trackId = data.id;
			analysis = data.analysis;
			meta = data.meta;
			note(
				`analysed ${data.analysis.tempo.bpm} bpm, ${data.analysis.bars.length} bars, ${data.analysis.sections.length} sections${data.fromCache ? ' (cached)' : ''}`
			);

			setPhase('analysing', 'Decoding audio');
			const audio = await fetch(`/api/track/${data.id}/audio`);
			if (!audio.ok) throw new Error('audio not cached');
			await viz.loadAudio(await audio.arrayBuffer());

			// Ingest composes a show from the analysis before it returns, so the room is lit as
			// soon as the audio is, without waiting on anybody's decision to spend a model.
			if (data.show) {
				show = data.show;
				viz.loadShow(data.analysis, data.show);
				note(`show loaded: ${data.show.cues.length} cues, ${data.show.hits.length} hits`);
			} else {
				note('no show yet');
			}
			setPhase('ready', '');
		} catch (e) {
			setPhase('error', (e as Error).message);
			note(`ERROR ${(e as Error).message}`);
		}
	}

	function author() {
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

		const es = new EventSource(`/api/author?id=${encodeURIComponent(trackId)}`);

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
			es.close();
		});
	}

	/** Jump to the previous or next section boundary, the way a track skip would. */
	function step(dir: -1 | 1) {
		if (!viz || !analysis) return;
		const bounds = analysis.sections.map((s) => s.startTime);
		const now = readout.position;
		if (dir < 0) {
			// Within the first 2 s of a section, skip past it to the one before.
			const prev = [...bounds].reverse().find((t) => t < now - 2);
			viz.seek(prev ?? 0);
		} else {
			const next = bounds.find((t) => t > now + 0.05);
			viz.seek(next ?? readout.duration);
		}
	}

	async function toggleOutput() {
		if (ddpRunning) {
			await postJson('/api/output', { action: 'stop' });
			ddpRunning = false;
			note('DDP output stopped');
			return;
		}
		if (!trackId || !ddpHost.trim()) return;
		const res = await postJson('/api/output', {
			action: 'start',
			trackId,
			hosts: ddpHost
				.split(',')
				.map((h) => h.trim())
				.filter(Boolean)
		});
		if (res.ok) {
			ddpRunning = true;
			note(`DDP output to ${ddpHost}`);
		} else {
			note(`ERROR ${await res.text()}`);
		}
	}

	function onKey(e: KeyboardEvent) {
		if (e.target instanceof HTMLInputElement) return;
		if (e.code === 'Space') {
			e.preventDefault();
			void viz?.toggle();
		} else if (e.code === 'ArrowLeft') {
			viz?.seek(Math.max(0, readout.position - (e.shiftKey ? 30 : 5)));
		} else if (e.code === 'ArrowRight') {
			viz?.seek(Math.min(readout.duration, readout.position + (e.shiftKey ? 30 : 5)));
		}
	}
</script>

<svelte:window onkeydown={onKey} />

<div class="shell">
	<TopBar
		{load}
		canAuthor={!!analysis}
		hasShow={!!show}
		onload={loadTrack}
		onauthor={author} />

	<div class="body">
		<Stage {viz} {readout} {load} {steps} hasShow={!!show} {previewing} />
		<Inspector
			{analysis}
			{show}
			{readout}
			{log}
			{steps}
			{warnings}
			bind:ddpHost
			{ddpRunning}
			ontoggleOutput={toggleOutput}
			generatedEffects={generatedDefs}
			{previewing}
			{previewParams}
			onpreview={preview}
			onparam={previewParam} />
	</div>

	<PlayerBar
		{meta}
		{analysis}
		{show}
		{readout}
		bind:volume
		ontoggle={() => void viz?.toggle()}
		onseek={(t) => viz?.seek(t)}
		onstep={step} />

	<LedBands {viz} />

	<ShowStrip
		{analysis}
		{show}
		position={readout.position}
		duration={readout.duration}
		onseek={(t) => viz?.seek(t)} />
</div>

<style>
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
