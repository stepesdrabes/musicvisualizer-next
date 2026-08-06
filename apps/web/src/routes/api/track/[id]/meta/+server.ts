import { error, json } from '@sveltejs/kit';
import { isValidId, readMeta } from '@mv/analysis';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
	if (!isValidId(params.id)) error(400, 'invalid track id');
	const meta = await readMeta(params.id);
	if (!meta) error(404, 'no metadata cached');
	return json(meta);
};
