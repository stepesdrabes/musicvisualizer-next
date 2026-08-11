import { spawn } from 'node:child_process';
import { ingest } from '@mv/analysis';

/**
 * Download and analyse the tuning corpus: a spread across the four genre families the room
 * actually plays, plus edge cases and one reported repro (NOTION - The Days, whose first drop
 * is labelled groove and lands a bar late).
 *
 * Serial on purpose: the beat tracker is an ONNX graph that takes every core it is offered,
 * so two at once is slower than the same two in sequence.
 */
const TRACKS: { query: string; note?: string }[] = [
	// EDM / house / techno / DnB
	{ query: 'NOTION The Days', note: 'repro: first drop labelled groove, ~a bar late' },
	{ query: 'Fred again Skrillex Flowdan Rumble' },
	{ query: 'FISHER Losing It' },
	{ query: 'Charlotte de Witte Doppler' },
	{ query: 'Boris Brejcha Purple Noise' },
	{ query: 'Swedish House Mafia Don\'t You Worry Child' },
	{ query: 'Martin Garrix Animals' },
	{ query: 'Eric Prydz Opus' },
	{ query: 'deadmau5 Strobe', note: 'edge: ten minutes, ambient intro' },
	{ query: 'Skrillex Scary Monsters and Nice Sprites' },
	{ query: 'Wilkinson Afterglow' },
	{ query: 'Sub Focus Dimension Desire' },
	// Pop
	{ query: 'The Weeknd Blinding Lights' },
	{ query: 'Dua Lipa Don\'t Start Now' },
	{ query: 'Taylor Swift Cruel Summer' },
	{ query: 'Harry Styles As It Was' },
	{ query: 'Billie Eilish bad guy' },
	{ query: 'Adele Someone Like You', note: 'edge: ballad, no drop anywhere' },
	{ query: 'Calin je mi fajn' },
	{ query: 'Mirai Když nemůžeš tak přidej' },
	// Hip-hop / trap / RnB
	{ query: 'Kendrick Lamar HUMBLE' },
	{ query: 'Travis Scott SICKO MODE', note: 'edge: beat switches mid-track' },
	{ query: 'Drake God\'s Plan' },
	{ query: 'Eminem Lose Yourself' },
	{ query: 'Doja Cat Paint The Town Red' },
	{ query: 'SZA Kill Bill' },
	{ query: 'Viktor Sheen Návykový' },
	{ query: 'Ektor Fenomén' },
	// Rock / metal
	{ query: 'AC/DC Thunderstruck' },
	{ query: 'Nirvana Smells Like Teen Spirit' },
	{ query: 'Metallica Enter Sandman' },
	{ query: 'System of a Down Chop Suey' },
	{ query: 'Foo Fighters Everlong' },
	{ query: 'Linkin Park In the End' },
	{ query: 'Bring Me The Horizon Can You Feel My Heart' },
	{ query: 'Arctic Monkeys Do I Wanna Know' },
	// Edge cases
	{ query: 'Queen Bohemian Rhapsody', note: 'edge: multi-part, tempo changes' },
	{ query: 'Daft Punk One More Time', note: 'edge: filtered breakdown at groove loudness' }
];

function resolveId(query: string): Promise<string | null> {
	return new Promise((resolve) => {
		const child = spawn('yt-dlp', [
			`ytsearch1:${query}`,
			'--flat-playlist',
			'--dump-json',
			'--no-warnings'
		]);
		let out = '';
		child.stdout.on('data', (d: Buffer) => (out += d.toString()));
		child.on('close', () => {
			try {
				resolve(String(JSON.parse(out.split('\n')[0]).id ?? '') || null);
			} catch {
				resolve(null);
			}
		});
		child.on('error', () => resolve(null));
	});
}

let done = 0;
for (const track of TRACKS) {
	const at = `[${++done}/${TRACKS.length}]`;
	try {
		const id = await resolveId(track.query);
		if (!id) {
			console.log(`${at} ${track.query}: search failed`);
			continue;
		}
		const result = await ingest(`https://www.youtube.com/watch?v=${id}`, {
			onProgress: (stage) => console.log(`${at} ${track.query}: ${stage}`)
		});
		console.log(
			`${at} ${track.query} -> ${result.id} ${result.fromCache ? '(cached)' : ''} ` +
				`${result.analysis.tempo.bpm} bpm, ${result.analysis.sections.length} sections`
		);
	} catch (e) {
		console.log(`${at} ${track.query}: ${(e as Error).message.split('\n')[0]}`);
	}
}
console.log('corpus fetch complete');
