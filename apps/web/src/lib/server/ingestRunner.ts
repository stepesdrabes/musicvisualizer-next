import { readFile, writeFile } from 'node:fs/promises';
import { BUILT_IN_EFFECTS, type Show } from '@mv/core';
import { showPath } from '@mv/analysis';
import { composeShow, lintShow } from '@mv/author-engine';
import { currentItem, nextItem, type ItemStatus, type QueueItem } from '$lib/queueModel.ts';
import { ingestDetached } from './ingestDetached.ts';
import { queue } from './queueStore.ts';

/**
 * yt-dlp's own stage words, and the analyser's, mapped onto the four the queue row draws.
 * Anything unrecognised leaves the status alone and only updates the message, so a new stage
 * appearing upstream shows up as text rather than as a wrong chip.
 */
const STAGES: Record<string, ItemStatus> = {
	resolving: 'resolving',
	downloading: 'downloading',
	cached: 'analysing',
	decoding: 'analysing',
	'tracking beats': 'analysing',
	analysing: 'analysing'
};

const LABELS: Record<string, string> = {
	resolving: 'Resolving',
	downloading: 'Downloading',
	cached: 'Reading cache',
	decoding: 'Decoding',
	'tracking beats': 'Tracking beats',
	analysing: 'Analysing',
	composing: 'Composing the show'
};

/**
 * Prepare a track: download it if needed, analyse it, and compose the engine's show so the
 * room is lit the moment the audio is.
 *
 * Lifted from the ingest route unchanged in behaviour. An existing show for the same grid is
 * left alone because it may be one Claude has already revised.
 */
async function prepare(item: QueueItem, onStage: (stage: string) => void) {
	const result = await ingestDetached(item.source, { onProgress: onStage });

	let show: Show | null = null;
	try {
		const existing = JSON.parse(await readFile(showPath(result.id), 'utf8')) as Show;
		if (existing.analysisHash === result.analysis.hash) show = existing;
	} catch {
		// No show yet, or one written against a grid that has since been re-analysed.
	}

	if (!show) {
		onStage('composing');
		const composed = composeShow(result.analysis, {
			artHue: result.meta.artHue,
			context: result.context
		});
		const verdict = lintShow(composed, {
			analysis: result.analysis,
			effects: new Map(BUILT_IN_EFFECTS.map((e) => [e.id, e])),
			context: result.context
		});
		// A show the linter rejects would be rejected on load too; better to say so here.
		if (verdict.ok) {
			await writeFile(showPath(result.id), JSON.stringify(composed, null, '\t'));
			show = composed;
		}
	}

	const authored: QueueItem['authored'] = show
		? (show.authoredBy ?? (show.generatedEffects.length > 0 ? 'claude' : 'engine'))
		: 'none';

	return { result, authored };
}

/**
 * One ingest at a time, ever.
 *
 * The beat tracker is an ONNX graph that will happily take every core it is offered, so two
 * of them running together is slower than the same two in sequence and starves the render
 * loop besides. Serialising also means the track about to play is never queued behind three
 * speculative ones.
 */
class IngestRunner {
	private running: string | null = null;

	/** Prepare the current row, then the one after it, and stop. */
	async pump(): Promise<void> {
		if (this.running !== null) return;
		const state = await queue.ready();
		const target = [currentItem(state), nextItem(state)].find(
			(i): i is QueueItem => i !== null && i.status === 'pending'
		);
		if (!target) return;

		this.running = target.key;
		try {
			await this.run(target);
		} finally {
			this.running = null;
		}
		// The queue may have moved on while that was happening, so ask again rather than
		// assuming the next candidate is the one that was next when this started.
		void this.pump();
	}

	private async run(item: QueueItem): Promise<void> {
		queue.patch(item.key, { status: 'resolving', message: 'Resolving' });
		try {
			const { result, authored } = await prepare(item, (stage) => {
				queue.patch(item.key, {
					status: STAGES[stage] ?? 'analysing',
					message: LABELS[stage] ?? stage
				});
			});

			queue.patch(item.key, {
				status: 'ready',
				message: '',
				trackId: result.id,
				title: result.meta.title,
				uploader: result.meta.uploader,
				thumbnail: result.meta.thumbnail,
				duration: result.meta.duration ?? result.analysis.duration,
				authored
			});
		} catch (e) {
			// yt-dlp and ffmpeg messages are the useful part; keep them rather than a generic one.
			queue.patch(item.key, {
				status: 'error',
				message: (e as Error).message.split('\n')[0].slice(0, 200)
			});
		}
	}

	/** Put a failed row back in line, which is what a retry button means. */
	async retry(key: string): Promise<void> {
		queue.patch(key, { status: 'pending', message: '' });
		void this.pump();
	}
}

export const runner = new IngestRunner();
