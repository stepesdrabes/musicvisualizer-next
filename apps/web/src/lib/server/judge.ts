import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { CACHE_DIR } from '@mv/analysis';

/**
 * One listening note, anchored to a moment rather than to the track as a whole.
 *
 * The bar is captured beside the time because the two answer different questions later: the
 * time replays the moment, the bar names the cue and the section the complaint is about.
 */
export interface MomentNote {
	/** Seconds into the track when the mark was dropped. */
	t: number;
	/** The bar under the playhead at that moment; null when no analysis was loaded. */
	bar: number | null;
	text: string;
}

/**
 * The owner's verdict on one track's show, written by the judge panel.
 *
 * `analysisHash` and `showSeed` pin the feedback to the exact artifacts that were heard:
 * a complaint about a show that has since been recomposed is history, not a bug report,
 * and without the pin the two are indistinguishable.
 */
export interface Judgement {
	trackId: string;
	title: string;
	/** 1..5; null until scored. Half the value is knowing which tracks were heard at all. */
	rating: number | null;
	/** Which aspects failed, from the panel's fixed vocabulary, so reports aggregate. */
	tags: string[];
	notes: MomentNote[];
	comment: string;
	analysisHash: string | null;
	showSeed: number | null;
	authoredBy: string | null;
	updatedAt: number;
}

const JUDGE_DIR = join(CACHE_DIR, 'judge');

/** Track ids are cache filenames elsewhere too, but this one comes from the network. */
function safeId(id: string): string {
	return id.replace(/[^a-zA-Z0-9_-]/g, '_');
}

export async function readJudgements(): Promise<Judgement[]> {
	if (!existsSync(JUDGE_DIR)) return [];
	const files = (await readdir(JUDGE_DIR)).filter((f) => f.endsWith('.json'));
	const out: Judgement[] = [];
	for (const f of files) {
		try {
			out.push(JSON.parse(await readFile(join(JUDGE_DIR, f), 'utf8')) as Judgement);
		} catch {
			// A truncated file is one lost judgement, not a broken panel.
		}
	}
	return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function writeJudgement(judgement: Judgement): Promise<void> {
	await mkdir(JUDGE_DIR, { recursive: true });
	const path = join(JUDGE_DIR, `${safeId(judgement.trackId)}.json`);
	await writeFile(path, JSON.stringify({ ...judgement, updatedAt: Date.now() }, null, '\t'));
}

export async function clearJudgement(trackId: string): Promise<void> {
	const path = join(JUDGE_DIR, `${safeId(trackId)}.json`);
	if (existsSync(path)) await unlink(path);
}
