import { json } from '@sveltejs/kit';
import { readLibrary } from '@mv/analysis';
import type { RequestHandler } from './$types';

/** Everything already analysed, newest first. These load without touching the network. */
export const GET: RequestHandler = async () => json({ entries: await readLibrary() });
