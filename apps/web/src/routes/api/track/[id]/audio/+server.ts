import { error } from '@sveltejs/kit';
import { readFile } from 'node:fs/promises';
import { findAudioFile, isValidId } from '@mv/analysis';
import type { RequestHandler } from './$types';

const TYPES: Record<string, string> = {
	'.m4a': 'audio/mp4',
	'.mp4': 'audio/mp4',
	'.webm': 'audio/webm',
	'.opus': 'audio/ogg',
	'.mp3': 'audio/mpeg',
	'.wav': 'audio/wav',
	'.flac': 'audio/flac'
};

export const GET: RequestHandler = async ({ params }) => {
	if (!isValidId(params.id)) error(400, 'invalid track id');

	const path = await findAudioFile(params.id);
	if (!path) error(404, 'not cached');

	const data = await readFile(path);
	const ext = path.slice(path.lastIndexOf('.'));

	return new Response(new Uint8Array(data), {
		headers: {
			'content-type': TYPES[ext] ?? 'application/octet-stream',
			'content-length': String(data.byteLength),
			'cache-control': 'private, max-age=3600'
		}
	});
};
