import { error } from '@sveltejs/kit';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { CACHE_DIR, isValidId } from '@mv/analysis';
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

	const files = await readdir(CACHE_DIR).catch(() => [] as string[]);
	const name = files.find((f) => f.startsWith(`${params.id}.`) && !f.includes('.json'));
	if (!name) error(404, 'not cached');

	const path = join(CACHE_DIR, name);
	const data = await readFile(path);
	const ext = name.slice(name.lastIndexOf('.'));

	return new Response(new Uint8Array(data), {
		headers: {
			'content-type': TYPES[ext] ?? 'application/octet-stream',
			'content-length': String(data.byteLength),
			'cache-control': 'private, max-age=3600'
		}
	});
};
