import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RealFft, hannWindow } from './dsp/fft.ts';
import { MODEL_DIR } from './paths.ts';

/**
 * Beat This! (Foscarin, Schlüter & Widmer, ISMIR 2024) through onnxruntime.
 *
 * Measured against the in-repo tracker on the same 100 annotated GTZAN tracks and the same
 * metrics: beat F 0.884 against 0.781, CMLt 0.805 against 0.627, downbeat F 0.722 against
 * 0.498. That downbeat figure is the reason it is here - the hand-built path tops out around
 * 0.64 even with perfect weights, because the bar phase is 97% of its headroom and no
 * reweighting of band energies reaches it.
 *
 * What it does NOT decide is the metrical level. On this project's own repertoire it and the
 * local tracker disagree about the tempo octave on seven of fifteen tracks, and a listening
 * test split those two each: it halves confidently on dense hip-hop, which is exactly where a
 * kick on every beat removes the cues it leans on. `metricalLevel.ts` makes that call instead.
 *
 * The feature contract is exact. An `ffmpeg -ac 1` downmix is wrong here: it is
 * energy-preserving, lands a factor of root two hot, and `log1p(1000 x)` turns a gain into a
 * shape change rather than an offset, which moves beats. `decode.ts` averages the two channels,
 * which is what the reference does.
 */

const N_FFT = 1024;
const HOP = 441;
const MEL_BINS = 128;
const FPS = 50;
const CHUNK = 1500;
const BORDER = 6;
const LOG_MULTIPLIER = 1000;
/** Maxima over +/- 3 frames, which at 50 fps is the +/- 70 ms the paper picks. */
const PEAK_RADIUS = 3;

/** The rate the model was trained at. Happens to be this repo's analysis rate too. */
export const BEATTHIS_RATE = 22050;

const MODEL_HOST = 'https://huggingface.co/musetric/beat-this-onnx/resolve/main';
const FILES = [
	{
		name: 'beat_this.onnx',
		sha256: '078572af6ca47741e06a82d09525d13c793eaa8e311a8cf15e831dcd7e73f218',
		bytes: 83143431
	},
	{
		name: 'mel-filterbank.bin',
		sha256: '1ee975d96f44ccf2c3bfe37825c1c1f0b089f5703c7a12a84b1f0a3bce004533',
		bytes: 262656
	}
] as const;

/**
 * Where the weights live. Not in the repo: 79 MB of model does not belong in git, and it is
 * the same kind of artefact as the audio the cache already holds.
 */
export function modelDir(): string {
	return MODEL_DIR;
}

export function modelsPresent(): boolean {
	return FILES.every((f) => existsSync(join(modelDir(), f.name)));
}

/**
 * Fetch the weights once, verifying the published digest.
 *
 * The digest is the point: this is a third party's conversion of the upstream MIT checkpoint,
 * so the bytes are pinned rather than trusted. Written to a temporary name and renamed, so an
 * interrupted download cannot leave a half-file that passes the existence check.
 */
export async function ensureModels(onProgress?: (msg: string) => void): Promise<void> {
	const dir = modelDir();
	mkdirSync(dir, { recursive: true });

	for (const file of FILES) {
		const path = join(dir, file.name);
		if (existsSync(path)) {
			const have = createHash('sha256').update(readFileSync(path)).digest('hex');
			if (have === file.sha256) continue;
			onProgress?.(`${file.name} failed its digest, refetching`);
		}

		onProgress?.(`fetching ${file.name} (${(file.bytes / 1e6).toFixed(1)} MB)`);
		const res = await fetch(`${MODEL_HOST}/${file.name}`);
		if (!res.ok) throw new Error(`${file.name}: ${res.status} ${res.statusText}`);
		const buf = Buffer.from(await res.arrayBuffer());

		const got = createHash('sha256').update(buf).digest('hex');
		if (got !== file.sha256) {
			throw new Error(`${file.name}: sha256 ${got}, expected ${file.sha256}`);
		}
		const tmp = `${path}.part`;
		writeFileSync(tmp, buf);
		renameSync(tmp, path);
	}
}

export interface BeatThisResult {
	/** Beat times, seconds. */
	beats: number[];
	/** Downbeat times, a subset of `beats`. */
	downbeats: number[];
}

/**
 * log1p(1000 * mel) on a magnitude spectrogram, matching torchaudio's `LogMelSpect`.
 *
 * `center=True` with reflect padding, so frame f is centred on sample f*hop. Reflecting rather
 * than zero-padding only changes the two edges, and the first downbeat lives at one of them.
 */
export function logMelSpectrogram(mono: Float32Array): { frames: number; data: Float32Array } {
	const raw = readFileSync(join(modelDir(), 'mel-filterbank.bin'));
	const fb = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
	const bins = N_FFT / 2 + 1;
	if (fb.length !== bins * MEL_BINS) {
		throw new Error(`filterbank is ${fb.length} floats, expected ${bins * MEL_BINS}`);
	}

	const pad = N_FFT >> 1;
	const padded = new Float32Array(mono.length + 2 * pad);
	padded.set(mono, pad);
	for (let i = 0; i < pad; i++) {
		padded[pad - 1 - i] = mono[Math.min(i + 1, mono.length - 1)];
		padded[pad + mono.length + i] = mono[Math.max(mono.length - 2 - i, 0)];
	}

	const frames = 1 + Math.floor(mono.length / HOP);
	const fft = new RealFft(N_FFT);
	const window = hannWindow(N_FFT);
	const mags = new Float32Array(bins);
	const out = new Float32Array(frames * MEL_BINS);
	// torchaudio's normalized='frame_length' divides the magnitude by sqrt(win_length).
	const scale = 1 / Math.sqrt(N_FFT);

	for (let f = 0; f < frames; f++) {
		fft.magnitudes(padded, f * HOP, window, mags, scale);
		const o = f * MEL_BINS;
		for (let j = 0; j < MEL_BINS; j++) {
			let acc = 0;
			for (let i = 0; i < bins; i++) acc += mags[i] * fb[i * MEL_BINS + j];
			out[o + j] = Math.log1p(LOG_MULTIPLIER * acc);
		}
	}
	return { frames, data: out };
}

/** Chunk starts, following the reference `split_piece`. */
function chunkStarts(frames: number): number[] {
	const step = CHUNK - 2 * BORDER;
	const starts: number[] = [];
	for (let s = -BORDER; s < frames - BORDER; s += step) starts.push(s);
	if (starts.length === 0) starts.push(-BORDER);
	// The last chunk shifts left to finish on the piece rather than run short.
	if (frames > step) starts[starts.length - 1] = frames - (CHUNK - BORDER);
	return starts;
}

/** Adjacent peaks within `width` collapse to their running mean, so a peak can be fractional. */
function deduplicatePeaks(peaks: readonly number[], width = 1): number[] {
	if (peaks.length === 0) return [];
	const out: number[] = [];
	let p = peaks[0];
	let c = 1;
	for (let i = 1; i < peaks.length; i++) {
		const p2 = peaks[i];
		if (p2 - p <= width) {
			c++;
			p += (p2 - p) / c;
		} else {
			out.push(p);
			p = p2;
			c = 1;
		}
	}
	out.push(p);
	return out;
}

function pickPeaks(logits: Float32Array): number[] {
	const n = logits.length;
	const raw: number[] = [];
	for (let i = 0; i < n; i++) {
		const v = logits[i];
		if (!(v > 0)) continue;
		let isMax = true;
		for (let k = Math.max(0, i - PEAK_RADIUS); k <= Math.min(n - 1, i + PEAK_RADIUS); k++) {
			if (logits[k] > v) {
				isMax = false;
				break;
			}
		}
		if (isMax) raw.push(i);
	}
	return deduplicatePeaks(raw, 1);
}

interface Session {
	run(feeds: Record<string, unknown>): Promise<Record<string, { data: Float32Array }>>;
	release?(): Promise<void>;
}
type TensorCtor = new (type: string, data: Float32Array, dims: number[]) => unknown;

export class BeatThis {
	// Node strips types rather than compiling them, so no parameter properties here, any more
	// than in the packages this repo consumes as source.
	private session!: Session;
	private Tensor!: TensorCtor;

	static async create(): Promise<BeatThis> {
		if (!modelsPresent()) await ensureModels();
		const ort = (await import('onnxruntime-node')).default;
		const session = await ort.InferenceSession.create(join(modelDir(), 'beat_this.onnx'), {
			executionProviders: ['cpu'],
			graphOptimizationLevel: 'all'
		});
		const self = new BeatThis();
		self.session = session as unknown as Session;
		self.Tensor = ort.Tensor as unknown as TensorCtor;
		return self;
	}

	async close(): Promise<void> {
		await this.session.release?.();
	}

	/** `mono` must be at BEATTHIS_RATE and be the arithmetic mean of the channels. */
	async run(mono: Float32Array): Promise<BeatThisResult> {
		const { frames, data } = logMelSpectrogram(mono);
		const starts = chunkStarts(frames);

		// -1000 is the reference's "no prediction here": a logit that cannot clear the
		// threshold, so an unwritten frame can never be picked as a peak.
		const beat = new Float32Array(frames).fill(-1000);
		const downbeat = new Float32Array(frames).fill(-1000);
		const window = new Float32Array(CHUNK * MEL_BINS);

		// Reverse order under keep_first, so an earlier chunk wins the overlap.
		for (let c = starts.length - 1; c >= 0; c--) {
			const start = starts[c];
			window.fill(0);
			for (let t = 0; t < CHUNK; t++) {
				const src = start + t;
				if (src < 0 || src >= frames) continue;
				window.set(data.subarray(src * MEL_BINS, (src + 1) * MEL_BINS), t * MEL_BINS);
			}

			// One window per call: batching them materialises an attention tensor of
			// windows x 32 x 1500 x 1500 floats, which is gigabytes on a long track.
			const out = await this.session.run({
				spect: new this.Tensor('float32', window, [1, CHUNK, MEL_BINS]) as never
			});

			for (let t = BORDER; t < CHUNK - BORDER; t++) {
				const dst = start + t;
				if (dst < 0 || dst >= frames) continue;
				beat[dst] = out.beat.data[t];
				downbeat[dst] = out.downbeat.data[t];
			}
		}

		const beats = pickPeaks(beat).map((f) => f / FPS);
		let downbeats = pickPeaks(downbeat).map((f) => f / FPS);

		// Every downbeat is a beat, so each is snapped to the nearest one and then uniqued.
		if (beats.length > 0) {
			downbeats = downbeats.map((d) => {
				let best = beats[0];
				let bestD = Math.abs(beats[0] - d);
				for (const b of beats) {
					const delta = Math.abs(b - d);
					if (delta < bestD) {
						bestD = delta;
						best = b;
					}
				}
				return best;
			});
			downbeats = [...new Set(downbeats)].sort((a, b) => a - b);
		}

		return { beats, downbeats };
	}
}
