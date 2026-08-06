import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { CORPUS_DIR } from './corpus.ts';

/**
 * Audio for the two structure corpora.
 *
 * SALAMI and Harmonix both publish annotations without audio, and they are unalike in exactly
 * the way that matters: SALAMI's Internet Archive subset points at the very file that was
 * annotated, so it needs no alignment and can be trusted absolutely; Harmonix is this project's
 * actual repertoire (pop, dance, hip-hop) but its audio has to come from YouTube, where an
 * upload carries whatever intro the uploader felt like. So SALAMI is the honest benchmark and
 * Harmonix is the relevant one, and the report keeps them apart.
 *
 * Idempotent: a file already present and non-empty is left alone.
 */

const which = process.argv[2] ?? 'both';
const limit = Number(process.argv[3] ?? 400);

async function head(url: string): Promise<boolean> {
	try {
		const r = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(20000) });
		return r.ok;
	} catch {
		return false;
	}
}

async function download(url: string, out: string): Promise<boolean> {
	try {
		const r = await fetch(url, { signal: AbortSignal.timeout(180000) });
		if (!r.ok) return false;
		const buf = Buffer.from(await r.arrayBuffer());
		if (buf.byteLength < 20000) return false;
		writeFileSync(out, buf);
		return true;
	} catch {
		return false;
	}
}

/** Run `worker` over `items` with at most `width` in flight. */
async function pool<T>(items: readonly T[], width: number, worker: (item: T) => Promise<void>): Promise<void> {
	let next = 0;
	await Promise.all(
		Array.from({ length: Math.min(width, items.length) }, async () => {
			for (;;) {
				const i = next++;
				if (i >= items.length) return;
				await worker(items[i]);
			}
		})
	);
}

async function salami(): Promise<void> {
	const root = join(CORPUS_DIR, 'salami-data-public-master');
	const audioDir = join(CORPUS_DIR, 'salami', 'audio');
	mkdirSync(audioDir, { recursive: true });
	const annotated = new Set(readdirSync(join(root, 'annotations')));

	const lines = readFileSync(join(root, 'metadata', 'id_index_internetarchive.csv'), 'utf8')
		.trim()
		.split('\n')
		.slice(1)
		.filter((l) => annotated.has(l.slice(0, l.indexOf(','))));

	let ok = 0;
	let fail = 0;
	// Each track is several megabytes from archive.org, so this is bandwidth-bound rather than
	// rate-limited; serialising it takes hours for what eight at a time does in minutes.
	await pool(lines, 8, async (line) => {
		const id = line.slice(0, line.indexOf(','));
		const out = join(audioDir, `${id}.mp3`);
		if (existsSync(out) && statSync(out).size > 20000) {
			ok++;
			return;
		}
		const raw = line.match(/https?:\/\/[^,]+/)?.[0];
		if (!raw) return;

		// The index was written against archive.org's old `_vbr` derivatives, which are long
		// gone; the plain mp3 of the same track is what the item serves now.
		const modern = raw.replace('http://www.archive.org', 'https://archive.org');
		for (const url of [modern.replace('_vbr.mp3', '.mp3'), modern]) {
			if (!(await head(url))) continue;
			if (await download(url, out)) {
				ok++;
				if ((ok + fail) % 25 === 0) console.error(`  salami ${ok} ok, ${fail} missing`);
				return;
			}
		}
		fail++;
	});
	console.error(`salami: ${ok} present, ${fail} unavailable`);
}

function ytdlp(url: string, out: string): Promise<boolean> {
	return new Promise((resolve) => {
		const child = spawn(
			'yt-dlp',
			['--no-playlist', '--no-warnings', '-q', '-f', '140/251/bestaudio[ext=m4a]/bestaudio', '-o', out, url],
			{ stdio: 'ignore' }
		);
		child.on('error', () => resolve(false));
		child.on('close', (code) => resolve(code === 0));
	});
}

async function harmonix(): Promise<void> {
	const root = join(CORPUS_DIR, 'harmonixset-main', 'dataset');
	const audioDir = join(CORPUS_DIR, 'harmonix', 'audio');
	mkdirSync(audioDir, { recursive: true });

	const urls = new Map<string, string>();
	for (const line of readFileSync(join(root, 'youtube_urls.csv'), 'utf8').trim().split('\n').slice(1)) {
		const i = line.indexOf(',');
		urls.set(line.slice(0, i), line.slice(i + 1).trim());
	}
	const scores: [string, number][] = readFileSync(join(root, 'youtube_alignment_scores.csv'), 'utf8')
		.trim()
		.split('\n')
		.slice(1)
		.map((l) => {
			const p = l.split(',');
			return [p[0], Number(p[1])] as [string, number];
		});

	// Best-aligned first: a low DTW score means the upload is a different edit, and no constant
	// offset will rescue that.
	const wanted = scores.sort((a, b) => b[1] - a[1]).slice(0, limit);

	let ok = 0;
	let fail = 0;
	for (const [id] of wanted) {
		const out = join(audioDir, `${id}.m4a`);
		if (existsSync(out) && statSync(out).size > 20000) {
			ok++;
			continue;
		}
		const url = urls.get(id);
		if (!url) continue;
		if (await ytdlp(url, join(audioDir, `${id}.%(ext)s`))) ok++;
		else fail++;
		if ((ok + fail) % 25 === 0) console.error(`  harmonix ${ok} ok, ${fail} missing`);
	}
	console.error(`harmonix: ${ok} present, ${fail} unavailable`);
}

if (which === 'salami' || which === 'both') await salami();
if (which === 'harmonix' || which === 'both') await harmonix();
