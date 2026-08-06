import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

export interface DecodedAudio {
	mono: Float32Array;
	sampleRate: number;
	duration: number;
	/** Of the raw PCM, before normalisation, so the same file always hashes the same. */
	hash: string;
	integratedLufs: number;
}

const TARGET_LUFS = -14;

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

/** ffmpeg's own two-pass loudnorm measurement, which is exact and free. */
async function measureLoudness(path: string): Promise<number> {
	const { stderr } = await run('ffmpeg', [
		'-nostdin',
		'-hide_banner',
		'-i',
		path,
		'-af',
		'loudnorm=print_format=json',
		'-f',
		'null',
		'-'
	]);
	const match = stderr.match(/"input_i"\s*:\s*"(-?[\d.]+)"/);
	return match ? Number.parseFloat(match[1]) : TARGET_LUFS;
}

/**
 * Decode to mono f32 and apply a constant gain to hit -14 LUFS.
 *
 * Constant gain, not ffmpeg's dynamic loudnorm: the filter would compress the very
 * dynamics the analysis is trying to measure, and a breakdown would stop reading as
 * quieter than the drop.
 */
export async function decodeAudio(path: string, sampleRate = 44100): Promise<DecodedAudio> {
	const integratedLufs = await measureLoudness(path);

	const { stdout } = await run('ffmpeg', [
		'-nostdin',
		'-hide_banner',
		'-loglevel',
		'error',
		'-i',
		path,
		'-ac',
		'1',
		'-ar',
		String(sampleRate),
		'-f',
		'f32le',
		'-'
	]);

	const hash = createHash('sha256').update(stdout).digest('hex').slice(0, 16);
	const mono = new Float32Array(
		stdout.buffer,
		stdout.byteOffset,
		Math.floor(stdout.byteLength / 4)
	);

	const gain = Math.pow(10, (TARGET_LUFS - integratedLufs) / 20);
	if (Number.isFinite(gain) && Math.abs(gain - 1) > 0.01) {
		for (let i = 0; i < mono.length; i++) mono[i] *= gain;
	}

	return {
		mono: Float32Array.from(mono),
		sampleRate,
		duration: mono.length / sampleRate,
		hash,
		integratedLufs
	};
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
