<script lang="ts">
	import type { Judgement, MomentNote } from '$lib/types.ts';
	import Button from '$lib/ui/Button.svelte';
	import Icon from '$lib/ui/Icon.svelte';

	let {
		trackId,
		title,
		analysisHash = null,
		showSeed = null,
		authoredBy = null,
		position = 0,
		bar = 0,
		judgement = null,
		judged = 0,
		total = 0,
		editingSections = false,
		blindEditing = false,
		previewingArrangement = false,
		onsave,
		onnext,
		onseek,
		oneditsections = () => {},
		onblindsections = () => {},
		ondiscardsections = () => {},
		onpreviewarrangement = () => {},
		onclose
	}: {
		trackId: string | null;
		title: string;
		analysisHash?: string | null;
		showSeed?: number | null;
		authoredBy?: string | null;
		/** Playhead, seconds; captured into a note the moment the mark is dropped. */
		position?: number;
		/** The bar under the playhead, from the player's own readout. */
		bar?: number;
		judgement?: Judgement | null;
		judged?: number;
		total?: number;
		/** Whether the drawer's section lane is in hand-adjust mode right now. */
		editingSections?: boolean;
		/** Whether that sitting is blind: blank draft, analyser's answer hidden everywhere. */
		blindEditing?: boolean;
		/** Whether the room is playing the show composed from the hand-drawn map. */
		previewingArrangement?: boolean;
		onsave: (j: Judgement) => void;
		onnext: () => void;
		onseek: (t: number) => void;
		oneditsections?: (on: boolean) => void;
		onblindsections?: () => void;
		ondiscardsections?: () => void;
		onpreviewarrangement?: (on: boolean) => void;
		onclose: () => void;
	} = $props();

	/**
	 * The failure vocabulary. Fixed rather than free-form so a hundred judgements aggregate
	 * into "31 tracks flagged sections" instead of a hundred spellings of the same complaint.
	 * The free text and the moment notes carry everything the chips cannot.
	 */
	const TAGS = [
		'sections wrong',
		'boundary off',
		'beat off',
		'drums wrong',
		'effects mismatch',
		'too busy',
		'too flat',
		'colours wrong',
		'peak missed',
		'ending wrong',
		'great'
	];

	function fresh(): Judgement {
		return {
			trackId: trackId ?? '',
			title,
			rating: null,
			tags: [],
			notes: [],
			comment: '',
			analysisHash,
			showSeed,
			authoredBy,
			updatedAt: 0
		};
	}

	let draft = $state<Judgement>(fresh());
	let loadedFor = $state<string | null>(null);

	// Re-seat the draft when the track changes; edits for the old track were saved as they
	// were made, so nothing is flushed here.
	$effect(() => {
		if (trackId === loadedFor) return;
		loadedFor = trackId;
		draft = judgement ? { ...judgement, notes: judgement.notes.map((n) => ({ ...n })) } : fresh();
	});

	let saveTimer: ReturnType<typeof setTimeout> | null = null;
	function queueSave() {
		if (!trackId) return;
		// The artifacts the verdict is about are whatever is loaded NOW, not at first paint.
		draft.trackId = trackId;
		draft.title = title;
		draft.analysisHash = analysisHash;
		draft.showSeed = showSeed;
		draft.authoredBy = authoredBy;
		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = setTimeout(() => {
			saveTimer = null;
			onsave($state.snapshot(draft) as Judgement);
		}, 500);
	}

	function rate(n: number) {
		draft.rating = draft.rating === n ? null : n;
		queueSave();
	}

	function toggleTag(tag: string) {
		draft.tags = draft.tags.includes(tag)
			? draft.tags.filter((t) => t !== tag)
			: [...draft.tags, tag];
		queueSave();
	}

	type Hit = NonNullable<MomentNote['hit']>;

	/** The glyphs are ShowStrip's hit legend, so a typed mark reads the same in both places. */
	const HITS: { kind: Hit; glyph: string; label: string }[] = [
		{ kind: 'strobe', glyph: '⚡', label: 'Strobe' },
		{ kind: 'blackout', glyph: '■', label: 'Blackout' },
		{ kind: 'slam', glyph: '▲', label: 'Slam' }
	];

	function glyphFor(hit: Hit): string {
		return HITS.find((h) => h.kind === hit)?.glyph ?? '';
	}

	function mark(hit?: Hit) {
		const note: MomentNote = { t: Math.round(position * 10) / 10, bar, text: '' };
		if (hit) note.hit = hit;
		draft.notes = [...draft.notes, note].sort((a, b) => a.t - b.t);
		queueSave();
	}

	function removeNote(index: number) {
		draft.notes = draft.notes.filter((_, i) => i !== index);
		queueSave();
	}

	function clock(t: number): string {
		const m = Math.floor(t / 60);
		const s = Math.floor(t % 60);
		return `${m}:${String(s).padStart(2, '0')}`;
	}

	function onKey(e: KeyboardEvent) {
		if (e.metaKey || e.ctrlKey || e.altKey) return;
		const el = e.target as HTMLElement | null;
		if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
		if (e.key.toLowerCase() === 'n' && trackId) {
			e.preventDefault();
			mark();
		}
	}
</script>

<svelte:window onkeydown={onKey} />

<aside class="floats">
	<header>
		<h2>Judge</h2>
		<span class="progress mono">{judged} of {total}</span>
		<button class="ghost" onclick={onclose} aria-label="Close the judge panel">
			<Icon name="x" size={14} />
		</button>
	</header>

	{#if trackId}
		<div class="scroll">
			<section>
				<div class="stars" role="radiogroup" aria-label="How the show fit this track">
					{#each [1, 2, 3, 4, 5] as n (n)}
						<button
							class="star"
							class:lit={draft.rating !== null && n <= draft.rating}
							role="radio"
							aria-checked={draft.rating === n}
							aria-label={`${n} of 5`}
							onclick={() => rate(n)}>
							<Icon name="star" size={16} />
						</button>
					{/each}
					<span class="hint">{draft.rating === null ? 'unrated' : ''}</span>
				</div>
			</section>

			<section>
				<div class="chips">
					{#each TAGS as tag (tag)}
						<button
							class="chip"
							class:on={draft.tags.includes(tag)}
							class:praise={tag === 'great'}
							onclick={() => toggleTag(tag)}>
							{tag}
						</button>
					{/each}
				</div>
			</section>

			<section>
				<div class="markrow">
					<Button variant={editingSections ? 'primary' : 'outline'} size="sm" onclick={() => oneditsections(!editingSections)}>
						<Icon name="bands" size={13} />
						{editingSections ? 'Done adjusting' : 'Adjust sections'}
					</Button>
					{#if judgement?.sections?.length}
						<span class="hint">
							{judgement.sections.length} hand-drawn{judgement.blind ? ' · blind' : ''}{judgement.editSeconds
								? ` · ${clock(judgement.editSeconds)}`
								: ''}
						</span>
						<button
							class="ghost"
							onclick={ondiscardsections}
							aria-label="Discard the hand-drawn sections">
							<Icon name="trash" size={12} />
						</button>
					{/if}
				</div>
				{#if !editingSections}
					<div class="markrow blindrow">
						<Button variant="ghost" size="sm" onclick={onblindsections}>
							<Icon name="blind" size={13} />
							Draw blind
						</Button>
						<span class="hint">
							{judgement?.sections?.length ? 'replaces the map' : 'for the eval set'}
						</span>
					</div>
				{/if}
				{#if judgement?.sections?.length}
					<div class="markrow previewrow">
						<Button
							variant={previewingArrangement ? 'primary' : 'outline'}
							size="sm"
							onclick={() => onpreviewarrangement(!previewingArrangement)}>
							<Icon name="play" size={13} />
							{previewingArrangement ? 'Original show' : 'Preview arrangement'}
						</Button>
					</div>
				{/if}
			</section>

			<section>
				<div class="markrow">
					<Button variant="outline" size="sm" onclick={() => mark()}>
						<Icon name="pin" size={13} />
						Mark this moment
					</Button>
					<span class="hint">n</span>
				</div>
				<div class="hitrow">
					{#each HITS as h (h.kind)}
						<button class="hitmark" onclick={() => mark(h.kind)}>
							<span class="glyph">{h.glyph}</span>
							{h.label}
						</button>
					{/each}
				</div>
				{#each draft.notes as note, i (i)}
					<div class="note">
						<button class="at mono" onclick={() => onseek(note.t)}>
							{#if note.hit}<span class="glyph">{glyphFor(note.hit)}</span>{/if}
							{clock(note.t)}{note.bar !== null ? ` · bar ${note.bar}` : ''}
						</button>
						<input
							type="text"
							placeholder="what happened here"
							bind:value={note.text}
							oninput={queueSave} />
						<button class="ghost" onclick={() => removeNote(i)} aria-label="Remove this note">
							<Icon name="x" size={12} />
						</button>
					</div>
				{/each}
			</section>

			<section>
				<textarea
					rows="3"
					placeholder="anything else about this one"
					bind:value={draft.comment}
					oninput={queueSave}></textarea>
			</section>
		</div>

		<footer>
			<Button variant="outline" size="sm" onclick={onnext}>Next unjudged</Button>
		</footer>
	{:else}
		<div class="empty">Play a track to judge it.</div>
	{/if}
</aside>

<style>
	aside {
		width: var(--rail-right);
		flex: none;
		display: flex;
		flex-direction: column;
		background: var(--panel);
		backdrop-filter: var(--panel-blur);
		border-left: 1px solid var(--border);
		min-height: 0;
	}
	header {
		display: flex;
		align-items: center;
		gap: 9px;
		flex: none;
		padding: 12px 14px;
		border-bottom: 1px solid var(--border);
	}
	h2 {
		font-size: 13.5px;
		font-weight: 600;
	}
	.progress {
		margin-left: auto;
		font-size: 12px;
		color: var(--muted-foreground);
	}
	.ghost {
		display: grid;
		place-items: center;
		width: 22px;
		height: 22px;
		flex: none;
		border-radius: var(--radius-sm);
		color: var(--subtle-foreground);
	}
	.ghost:hover {
		background: var(--muted);
		color: var(--foreground);
	}

	.scroll {
		flex: 1;
		overflow-y: auto;
		min-height: 0;
	}
	section {
		padding: 12px 14px;
		border-bottom: 1px solid var(--border-soft);
	}

	.stars {
		display: flex;
		align-items: center;
		gap: 2px;
	}
	.star {
		display: grid;
		place-items: center;
		width: 26px;
		height: 26px;
		border-radius: var(--radius-sm);
		color: var(--subtle-foreground);
	}
	.star:hover {
		color: var(--foreground);
	}
	.star.lit {
		color: var(--live);
	}
	.hint {
		margin-left: auto;
		font-size: 11.5px;
		color: var(--subtle-foreground);
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.chip {
		padding: 4px 9px;
		font-size: 12px;
		border-radius: 999px;
		background: var(--muted);
		color: var(--muted-foreground);
	}
	.chip:hover {
		color: var(--foreground);
	}
	.chip.on {
		background: color-mix(in srgb, var(--foreground) 82%, transparent);
		color: var(--background);
	}
	.chip.on.praise {
		background: color-mix(in srgb, var(--live) 24%, transparent);
		color: var(--live);
	}

	.markrow {
		display: flex;
		align-items: center;
		gap: 9px;
	}
	.previewrow {
		margin-top: 8px;
	}
	.blindrow {
		margin-top: 6px;
	}
	.hitrow {
		display: flex;
		gap: 6px;
		margin-top: 8px;
	}
	.hitmark {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 3px 9px;
		font-size: 11.5px;
		border-radius: var(--radius-sm);
		background: var(--muted);
		color: var(--muted-foreground);
	}
	.hitmark:hover {
		color: var(--foreground);
	}
	.glyph {
		/* The filled shapes print heavier than digits at equal size, so they sit a step down. */
		font-size: 11px;
		line-height: 1;
	}
	.note {
		display: flex;
		align-items: center;
		gap: 7px;
		margin-top: 8px;
	}
	.at {
		flex: none;
		font-size: 11.5px;
		padding: 3px 7px;
		border-radius: var(--radius-sm);
		background: var(--muted);
		color: var(--muted-foreground);
	}
	.at:hover {
		color: var(--foreground);
	}
	.note input {
		flex: 1;
		min-width: 0;
		padding: 5px 8px;
		font-size: 12.5px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--border);
		background: transparent;
		color: var(--foreground);
	}
	.note input::placeholder {
		color: var(--subtle-foreground);
	}

	textarea {
		width: 100%;
		resize: vertical;
		padding: 7px 9px;
		font-size: 12.5px;
		font-family: inherit;
		border-radius: var(--radius-sm);
		border: 1px solid var(--border);
		background: transparent;
		color: var(--foreground);
	}
	textarea::placeholder {
		color: var(--subtle-foreground);
	}

	footer {
		flex: none;
		padding: 12px 14px;
		border-top: 1px solid var(--border);
	}
	footer :global(.btn) {
		width: 100%;
	}

	.empty {
		padding: 24px 14px;
		font-size: 12.5px;
		color: var(--muted-foreground);
	}
</style>
