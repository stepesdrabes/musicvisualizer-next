import { describe, expect, it } from 'vitest';
import { parseSearchOutput } from './search.ts';

const row = (over: Record<string, unknown> = {}) =>
	JSON.stringify({
		id: 'UtF6Jej8yb4',
		title: 'Avicii - The Nights',
		channel: 'Avicii',
		uploader: 'AviciiOfficial',
		duration: 176,
		...over
	});

describe('parseSearchOutput', () => {
	it('reads one result per line', () => {
		const out = parseSearchOutput(`${row()}\n${row({ id: 'FGBhQbmPwH8', title: 'One More Time' })}`);
		expect(out).toHaveLength(2);
		expect(out[0].title).toBe('Avicii - The Nights');
		expect(out[1].id).toBe('FGBhQbmPwH8');
	});

	it('prefers the channel over the uploader, which is the name shown on the video', () => {
		expect(parseSearchOutput(row())[0].uploader).toBe('Avicii');
		expect(parseSearchOutput(row({ channel: undefined }))[0].uploader).toBe('AviciiOfficial');
	});

	it('builds a thumbnail and a watch URL from the id', () => {
		const [hit] = parseSearchOutput(row());
		expect(hit.thumbnail).toBe('https://i.ytimg.com/vi/UtF6Jej8yb4/mqdefault.jpg');
		expect(hit.webpageUrl).toBe('https://www.youtube.com/watch?v=UtF6Jej8yb4');
	});

	it('skips a malformed line rather than losing the whole search', () => {
		const out = parseSearchOutput(`${row()}\nnot json at all\n${row({ id: 'FGBhQbmPwH8' })}`);
		expect(out).toHaveLength(2);
	});

	it('drops entries whose id is not a video id', () => {
		expect(parseSearchOutput(row({ id: 'PLsomeplaylist' }))).toHaveLength(0);
		expect(parseSearchOutput(row({ id: '' }))).toHaveLength(0);
	});

	it('reads a missing or null duration as zero rather than NaN', () => {
		expect(parseSearchOutput(row({ duration: null }))[0].duration).toBe(0);
		expect(parseSearchOutput(row({ duration: undefined }))[0].duration).toBe(0);
	});

	it('tolerates blank lines and trailing newlines', () => {
		expect(parseSearchOutput(`\n${row()}\n\n`)).toHaveLength(1);
		expect(parseSearchOutput('')).toEqual([]);
	});
});
