import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

export interface DecodedAudio {
	mono: Float32Array;
	/** Interleaved is avoided on purpose: every consumer wants one side at a time. */
	left: Float32Array;
	right: Float32Array;
	sampleRate: number;
	duration: number;
	/** Of the decoded PCM, so the same file always hashes the same. */
	hash: string;
}

/**
 * 22.05 kHz. Halving the rate halves every spectral pass and, at a fixed window length,
 * doubles the frequency resolution where it is scarce: a 2048-point window puts bins 10.8 Hz
 * apart rather than 21.5, which is the difference between four and eight of them between
 * 20 and 100 Hz. What is lost is everything above 11 kHz, which is cymbal shimmer rather
 * than cymbal attack, and which a lossy source has usually thrown away already.
 */
export const ANALYSIS_RATE = 22050;

function run(cmd: string, args: string[]): Promise<{ stdout: Buffer; stderr: string }> {
	return new Promise((resolve, reject) => {
		const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
		const out: Buffer[] = [];
		let err = '';
		child.stdout.on('data', (d: Buffer) => out.push(d));
		child.stderr.on('data', (d: Buffer) => (err += d.toString()));
		child.on('error', (e) =>
			reject(new Error(`${cmd} failed to start (is it installed?): ${e.message}`))
		);
		child.on('close', (code) => {
			if (code !== 0) reject(new Error(`${cmd} exited ${code}: ${err.slice(-2000)}`));
			else resolve({ stdout: Buffer.concat(out), stderr: err });
		});
	});
}

/**
 * Decode to f32 at the analysis rate, keeping both channels.
 *
 * Stereo is kept because where a sound sits across the room is a thing the show can use, and
 * it is the one property that a mono downmix destroys rather than merely blurs. The mono sum
 * every other stage works from is derived here rather than asked of ffmpeg, so the two can
 * never disagree.
 *
 * Deliberately does not ask for soxr. It resamples better, but it is a separate library that
 * a stock Homebrew ffmpeg is not built with, and naming an unavailable engine is a hard error
 * rather than a fallback. The built-in resampler is what every accuracy figure in this package
 * was measured through; `filter_size` buys a longer kernel from it for nothing.
 *
 */
export async function decodeAudio(path: string, sampleRate = ANALYSIS_RATE): Promise<DecodedAudio> {
	const { stdout } = await run('ffmpeg', [
		'-nostdin',
		'-hide_banner',
		'-loglevel',
		'error',
		'-i',
		path,
		'-af',
		`aresample=${sampleRate}:filter_size=64:cutoff=0.98`,
		'-ac',
		'2',
		'-f',
		'f32le',
		'-'
	]);

	const hash = createHash('sha256').update(stdout).digest('hex').slice(0, 16);
	// Buffer.concat can land on any byte offset, and a Float32Array view demands a multiple
	// of four, so the copy is not optional.
	const frames = Math.floor(stdout.byteLength / 8);
	const left = new Float32Array(frames);
	const right = new Float32Array(frames);
	const mono = new Float32Array(frames);
	for (let i = 0; i < frames; i++) {
		const l = stdout.readFloatLE(i * 8);
		const r = stdout.readFloatLE(i * 8 + 4);
		left[i] = l;
		right[i] = r;
		mono[i] = (l + r) * 0.5;
	}

	return { mono, left, right, sampleRate, duration: frames / sampleRate, hash };
}

export interface ProbeResult {
	id: string;
	title: string;
	uploader: string;
	duration: number;
	thumbnail: string;
	webpageUrl: string;
}

export async function probe(url: string): Promise<ProbeResult> {
	const { stdout } = await run('yt-dlp', [
		'--no-playlist',
		'--skip-download',
		'--dump-single-json',
		'--no-warnings',
		url
	]);
	const j = JSON.parse(stdout.toString()) as Record<string, unknown>;
	return {
		id: String(j.id ?? ''),
		title: String(j.title ?? 'Unknown'),
		uploader: String(j.uploader ?? ''),
		duration: Number(j.duration ?? 0),
		thumbnail: String(j.thumbnail ?? ''),
		webpageUrl: String(j.webpage_url ?? '')
	};
}

/**
 * Downloads bestaudio without `-x --audio-format`, which would transcode a lossy source
 * into another lossy format for no benefit.
 */
export async function downloadAudio(url: string, outTemplate: string): Promise<void> {
	await run('yt-dlp', [
		'--no-playlist',
		'--no-warnings',
		'-f',
		'140/251/bestaudio[ext=m4a]/bestaudio',
		'-o',
		outTemplate,
		url
	]);
}
