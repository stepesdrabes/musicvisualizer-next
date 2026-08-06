import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CORPUS_DIR } from './corpus.ts';
import type { Segment } from './segment-metrics.ts';

/**
 * The two structure corpora, and the one thing that separates them.
 *
 * SALAMI's audio is the exact file that was annotated, downloaded from the Internet Archive,
 * so its timing needs no correction and its numbers can be quoted without qualification. It is
 * mostly live concert recordings, which is not this project's repertoire.
 *
 * Harmonix is the repertoire (pop, dance, hip-hop, 912 tracks) but ships no audio, and the
 * YouTube uploads its own maintainers point at carry whatever intro the uploader added: the
 * measured offsets on the five best-aligned tracks were -0.20 s to +2.61 s. So a per-track
 * offset has to be fitted, which is why Harmonix is used for SEGMENTS ONLY here. Fitting the
 * offset against annotated beats and then also scoring beats or downbeats against those same
 * annotations would be marking its own homework.
 */

export type StructureDataset = 'harmonix' | 'salami';

export interface StructureReference {
	key: string;
	dataset: StructureDataset;
	audio: string;
	/** Reference segmentation, one annotator. SALAMI ships two, so it appears twice. */
	segments: Segment[][];
	/** Annotated beats, used only to fit the constant offset of a YouTube upload. */
	beats: number[];
	/** True when the audio is the annotated file and no offset fitting is needed. */
	aligned: boolean;
}

function toSegments(rows: [number, string][], stopLabels: readonly string[]): Segment[] {
	const out: Segment[] = [];
	for (let i = 0; i < rows.length - 1; i++) {
		const [start, label] = rows[i];
		const end = rows[i + 1][0];
		if (end <= start) continue;
		if (stopLabels.includes(label.toLowerCase())) continue;
		out.push({ start, end, label: label.toLowerCase() });
	}
	return out;
}

function readHarmonix(): StructureReference[] {
	const root = join(CORPUS_DIR, 'harmonixset-main', 'dataset');
	const audioDir = join(CORPUS_DIR, 'harmonix', 'audio');
	if (!existsSync(audioDir)) return [];

	const out: StructureReference[] = [];
	for (const file of readdirSync(audioDir)) {
		if (!file.endsWith('.m4a')) continue;
		const id = file.replace('.m4a', '');
		const segFile = join(root, 'segments', `${id}.txt`);
		const beatFile = join(root, 'beats_and_downbeats', `${id}.txt`);
		if (!existsSync(segFile) || !existsSync(beatFile)) continue;

		const rows: [number, string][] = [];
		for (const line of readFileSync(segFile, 'utf8').trim().split('\n')) {
			const [t, label] = line.trim().split(/\s+/);
			if (Number.isFinite(Number(t)) && label) rows.push([Number(t), label]);
		}
		const beats = readFileSync(beatFile, 'utf8')
			.trim()
			.split('\n')
			.map((l) => Number(l.trim().split(/\s+/)[0]))
			.filter(Number.isFinite);

		const segments = toSegments(rows, ['end', 'silence']);
		if (segments.length < 3 || beats.length < 32) continue;
		out.push({
			key: `harmonix/${id}`,
			dataset: 'harmonix',
			audio: join(audioDir, file),
			segments: [segments],
			beats,
			aligned: false
		});
	}
	return out.sort((a, b) => a.key.localeCompare(b.key));
}

function readSalami(): StructureReference[] {
	const root = join(CORPUS_DIR, 'salami-data-public-master', 'annotations');
	const audioDir = join(CORPUS_DIR, 'salami', 'audio');
	if (!existsSync(audioDir)) return [];

	const out: StructureReference[] = [];
	for (const file of readdirSync(audioDir)) {
		if (!file.endsWith('.mp3')) continue;
		const id = file.replace('.mp3', '');

		const annotations: Segment[][] = [];
		for (const which of ['textfile1', 'textfile2']) {
			const path = join(root, id, 'parsed', `${which}_uppercase.txt`);
			if (!existsSync(path)) continue;
			const rows: [number, string][] = [];
			for (const line of readFileSync(path, 'utf8').trim().split('\n')) {
				const parts = line.trim().split(/\s+/);
				const t = Number(parts[0]);
				if (Number.isFinite(t) && parts[1]) rows.push([t, parts[1]]);
			}
			// Z is SALAMI's silence class and End closes the last interval.
			const segments = toSegments(rows, ['end', 'z', 'silence']);
			if (segments.length >= 3) annotations.push(segments);
		}
		if (annotations.length === 0) continue;

		out.push({
			key: `salami/${id}`,
			dataset: 'salami',
			audio: join(audioDir, file),
			segments: annotations,
			beats: [],
			aligned: true
		});
	}
	return out.sort((a, b) => a.key.localeCompare(b.key));
}

export function loadStructureCorpus(only?: StructureDataset): StructureReference[] {
	const all = [...readHarmonix(), ...readSalami()];
	return only ? all.filter((r) => r.dataset === only) : all;
}

/**
 * The constant offset at which the annotated beats best explain the audio's onsets.
 *
 * Returned with a sharpness figure: the best score divided by the best score at least a
 * quarter-second away. A YouTube upload that is a different edit has no sharp peak, and a
 * track whose offset cannot be pinned should be dropped rather than scored.
 */
export function fitOffset(
	odf: Float32Array,
	fps: number,
	beats: readonly number[],
	range = 5
): { offset: number; sharpness: number } {
	const score = (off: number): number => {
		let acc = 0;
		let n = 0;
		for (const b of beats) {
			const i = Math.round((b + off) * fps);
			if (i < 0 || i >= odf.length) continue;
			acc += odf[i];
			n++;
		}
		return n > 20 ? acc / n : 0;
	};

	let best = 0;
	let bestScore = -1;
	const step = 0.01;
	for (let off = -range; off <= range + 1e-9; off += step) {
		const s = score(off);
		if (s > bestScore) {
			bestScore = s;
			best = off;
		}
	}

	let rival = 0;
	for (let off = -range; off <= range + 1e-9; off += step) {
		if (Math.abs(off - best) < 0.25) continue;
		rival = Math.max(rival, score(off));
	}
	return { offset: best, sharpness: rival > 1e-9 ? bestScore / rival : Infinity };
}
