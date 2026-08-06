import { error, json } from '@sveltejs/kit';
import { readFile, writeFile } from 'node:fs/promises';
import { isValidId, showPath } from '@mv/analysis';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
	if (!isValidId(params.id)) error(400, 'invalid track id');
	try {
		return json(JSON.parse(await readFile(showPath(params.id), 'utf8')));
	} catch {
		error(404, 'no show authored yet');
	}
};

export const PUT: RequestHandler = async ({ params, request }) => {
	if (!isValidId(params.id)) error(400, 'invalid track id');
	const body = await request.text();
	if (!body) error(400, 'empty body');
	await writeFile(showPath(params.id), body);
	return new Response(null, { status: 204 });
};
