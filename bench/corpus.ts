import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The annotated corpus the analyser is measured against.
 *
 * Not in the repo, and not redistributable: `bench/fetch.sh` pulls it. GTZAN carries beat,
 * downbeat and meter annotations; GiantSteps carries tempo only, which is why the two are
 * kept apart in the report rather than pooled into one number.
 */
export const CORPUS_DIR = join(import.meta.dirname, 'corpus');

export type Dataset = 'gtzan' | 'giantsteps';

export interface Reference {
	key: string;
	dataset: Dataset;
	audio: string;
	/** Empty when the dataset does not annotate beats. */
	beats: number[];
	downbeats: number[];
	/** 0 when the annotation does not determine it. */
	beatsPerBar: number;
	/** The annotated tempo. For GiantSteps, whichever of the two MIREX tempi is more salient. */
	bpm: number;
	/** GiantSteps annotates two tempi; the second is a genuine perceptual alternative. */
	altBpm: number;
}

function readGtzan(): Reference[] {
	const audioRoot = join(CORPUS_DIR, 'gtzan_mini-main', 'genres');
	const annRoot = join(CORPUS_DIR, 'gtzan_tempo_beat-main');
	if (!existsSync(audioRoot) || !existsSync(annRoot)) return [];

	const out: Reference[] = [];
	for (const genre of readdirSync(audioRoot)) {
		const dir = join(audioRoot, genre);
		let files: string[];
		try {
			files = readdirSync(dir).filter((f) => f.endsWith('.wav'));
		} catch {
			continue;
		}
		for (const file of files) {
			const stem = file.replace(/\.wav$/, '');
			const annKey = stem.replace('.', '_');
			const beatFile = join(annRoot, 'beats', `gtzan_${annKey}.beats`);
			const bpmFile = join(annRoot, 'tempo', `gtzan_${annKey}.bpm`);
			if (!existsSync(beatFile) || !existsSync(bpmFile)) continue;

			const beats: number[] = [];
			const downbeats: number[] = [];
			let maxInBar = 0;
			for (const line of readFileSync(beatFile, 'utf8').split('\n')) {
				const [t, b] = line.trim().split(/\s+/);
				const time = Number(t);
				const inBar = Number(b);
				if (!Number.isFinite(time)) continue;
				beats.push(time);
				if (inBar === 1) downbeats.push(time);
				if (Number.isFinite(inBar) && inBar > maxInBar) maxInBar = inBar;
			}
			const bpm = Number(readFileSync(bpmFile, 'utf8').trim());
			if (beats.length < 8 || !Number.isFinite(bpm)) continue;

			out.push({
				key: `gtzan/${stem}`,
				dataset: 'gtzan',
				audio: join(dir, file),
				beats,
				downbeats,
				// A meter of 2 or 5 in this annotation set is nearly always a partial bar at the
				// start rather than the track's meter, so only 3 and 4 are trusted as a label.
				beatsPerBar: maxInBar === 3 || maxInBar === 4 ? maxInBar : 0,
				bpm,
				altBpm: 0
			});
		}
	}
	return out.sort((a, b) => a.key.localeCompare(b.key));
}

function readGiantSteps(): Reference[] {
	const audioRoot = join(CORPUS_DIR, 'giantsteps', 'audio');
	const annRoot = join(CORPUS_DIR, 'giantsteps-tempo-dataset-master', 'annotations_v2', 'mirex');
	if (!existsSync(audioRoot) || !existsSync(annRoot)) return [];

	const out: Reference[] = [];
	for (const file of readdirSync(audioRoot)) {
		if (!file.endsWith('.mp3')) continue;
		const stem = file.replace(/\.mp3$/, '');
		const ann = join(annRoot, `${stem}.mirex`);
		if (!existsSync(ann)) continue;

		const [t1, t2, salience] = readFileSync(ann, 'utf8').trim().split(/\s+/).map(Number);
		if (!Number.isFinite(t1)) continue;
		// The salience is the weight of T1, so the dominant reading is T1 above a half.
		const dominant = Number.isFinite(salience) && salience < 0.5 && Number.isFinite(t2) ? t2 : t1;
		const other = dominant === t1 ? t2 : t1;

		out.push({
			key: `giantsteps/${stem}`,
			dataset: 'giantsteps',
			audio: join(audioRoot, file),
			beats: [],
			downbeats: [],
			beatsPerBar: 0,
			bpm: dominant,
			altBpm: Number.isFinite(other) ? other : 0
		});
	}
	return out.sort((a, b) => a.key.localeCompare(b.key));
}

export function loadCorpus(only?: Dataset): Reference[] {
	const all = [...readGtzan(), ...readGiantSteps()];
	return only ? all.filter((r) => r.dataset === only) : all;
}
