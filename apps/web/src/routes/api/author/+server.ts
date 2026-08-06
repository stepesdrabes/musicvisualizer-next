import { error } from '@sveltejs/kit';
import { readFile, writeFile } from 'node:fs/promises';
import {
	BUILT_IN_EFFECTS,
	DEFAULT_ROOM,
	buildGeometry,
	compileGenerated,
	type TrackAnalysis
} from '@mv/core';
import { analysisPath, findAudioFile, isValidId, showPath } from '@mv/analysis';
import { authorShow, formatFindings, lintShow, type AuthorEvent } from '@mv/author';
import type { RequestHandler } from './$types';

/**
 * Server-sent events, because authoring takes minutes. Every tool call the agent makes is
 * forwarded as it happens: watching it fetch bars 40-56, then reject its own effect, then
 * lint clean, is far more informative than a spinner.
 */
export const GET: RequestHandler = async ({ url, request }) => {
	const id = url.searchParams.get('id');
	if (!id || !isValidId(id)) error(400, 'valid track id required');

	let analysis: TrackAnalysis;
	try {
		analysis = JSON.parse(await readFile(analysisPath(id), 'utf8')) as TrackAnalysis;
	} catch {
		error(404, 'that track has not been analysed yet');
	}

	const audioPath = (await findAudioFile(id)) ?? undefined;
	const geometry = buildGeometry(DEFAULT_ROOM);
	const encoder = new TextEncoder();

	const stream = new ReadableStream({
		async start(controller) {
			let closed = false;
			const send = (event: string, data: unknown) => {
				if (closed) return;
				try {
					controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
				} catch {
					closed = true;
				}
			};
			request.signal.addEventListener('abort', () => (closed = true));

			// The agent may correct the tempo mid-run, which replaces the grid the show is
			// addressed against. Whatever it ends up with is what gets persisted and linted.
			let grid = analysis;

			try {
				send('event', { type: 'note', text: `authoring ${analysis.title}` } satisfies AuthorEvent);

				const result = await authorShow(grid, geometry, {
					audioPath,
					onAnalysis: (next) => (grid = next),
					onEvent: (e) => send('event', e)
				});
				grid = result.analysis;

				const effects = new Map(BUILT_IN_EFFECTS.map((e) => [e.id, e]));
				const rejected: string[] = [];
				for (const gen of result.show.generatedEffects) {
					const compiled = compileGenerated(gen, geometry);
					if (compiled.def) effects.set(gen.id, compiled.def);
					else rejected.push(`${gen.id} rejected: ${compiled.failures.join('; ')}`);
				}

				const verdict = lintShow(result.show, { analysis: grid, effects });
				if (!verdict.ok) {
					send('failed', `the authored show does not lint clean:\n${formatFindings(verdict)}`);
					controller.close();
					return;
				}

				await writeFile(showPath(id), JSON.stringify(result.show, null, '\t'));
				if (grid !== analysis) {
					await writeFile(analysisPath(id), JSON.stringify(grid, null, '\t'));
				}

				send('done', {
					id,
					show: result.show,
					analysis: grid,
					brief: result.brief,
					warnings: [...verdict.warnings.map((w) => `${w.rule}: ${w.message}`), ...rejected]
				});
			} catch (e) {
				send('failed', (e as Error).message);
			} finally {
				try {
					controller.close();
				} catch {
					// Already closed by an aborted request.
				}
			}
		}
	});

	return new Response(stream, {
		headers: {
			'content-type': 'text/event-stream',
			'cache-control': 'no-cache, no-transform',
			connection: 'keep-alive'
		}
	});
};
