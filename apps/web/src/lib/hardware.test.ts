import { describe, expect, it } from 'vitest';
import { faultsIn, parseIdentity, parseTelemetry, type DeviceTelemetry } from './hardware.ts';

// The exact line firmware/src/hello.rs formats.
const HELLO = 'room-node host room-node fw 0.1.0 up 42s px 1320 ddp 4048 stats 4049 leds stub';

// The exact line firmware/src/stats.rs formats, and the shorter one FIRMWARE.md documents.
const STATS =
	'up 42s  1320 px  180 pkt/s  231.7 KB/s  60.0 fps  gap 15.9/17.8 ms  late 0/0/0  ' +
	'asm 2.1 ms  seqgap 0  bad 0  oob 0  torn 0';
const STATS_NO_LATE =
	'up 42s  1320 px  180 pkt/s  231.7 KB/s  60.0 fps  gap 15.9/17.8 ms  asm 2.1 ms  ' +
	'seqgap 0  bad 0  oob 0  torn 0';

describe('parseIdentity', () => {
	it('reads every field of the discovery answer', () => {
		const id = parseIdentity(HELLO, '192.168.0.106');
		expect(id).toEqual({
			host: '192.168.0.106',
			name: 'room-node',
			firmware: '0.1.0',
			uptimeS: 42,
			pixels: 1320,
			ddpPort: 4048,
			statsPort: 4049,
			leds: 'stub'
		});
	});

	it('reports a real LED output once the firmware drives one', () => {
		expect(parseIdentity(HELLO.replace('leds stub', 'leds ws2812'), 'h')?.leds).toBe('ws2812');
	});

	it('ignores whatever else is on the port', () => {
		expect(parseIdentity('OK 200 something-else', 'h')).toBeNull();
		expect(parseIdentity('', 'h')).toBeNull();
	});

	it('survives a firmware that drops a field rather than throwing', () => {
		const id = parseIdentity('room-node up 9s px 1320', 'h');
		expect(id?.uptimeS).toBe(9);
		expect(id?.firmware).toBe('unknown');
	});
});

describe('parseTelemetry', () => {
	it('reads the whole stats line', () => {
		expect(parseTelemetry(STATS, 1000)).toEqual({
			uptimeS: 42,
			pixels: 1320,
			packetsPerSecond: 180,
			kbPerSecond: 231.7,
			fps: 60,
			gapMinMs: 15.9,
			gapMaxMs: 17.8,
			late: [0, 0, 0],
			assemblyMaxMs: 2.1,
			seqGaps: 0,
			bad: 0,
			outOfRange: 0,
			torn: 0,
			at: 1000
		});
	});

	it('treats late as optional, since the documented sample predates it', () => {
		expect(parseTelemetry(STATS_NO_LATE, 0)?.late).toEqual([0, 0, 0]);
	});

	it('reads the bad numbers the bench actually produced', () => {
		const bad = STATS.replace('late 0/0/0', 'late 322/98/30').replace('60.0 fps', '57.8 fps');
		const t = parseTelemetry(bad, 0);
		expect(t?.late).toEqual([322, 98, 30]);
		expect(t?.fps).toBe(57.8);
	});

	it('rejects a line with no frame rate in it', () => {
		expect(parseTelemetry('up 42s  1320 px', 0)).toBeNull();
		expect(parseTelemetry('', 0)).toBeNull();
	});
});

describe('faultsIn', () => {
	const clean = parseTelemetry(STATS, 0) as DeviceTelemetry;

	it('says nothing about a clean line', () => {
		expect(faultsIn(clean)).toEqual([]);
	});

	it('reports torn frames, which stay valid however the fixture is split', () => {
		expect(faultsIn({ ...clean, torn: 3 })[0]).toContain('3 torn frames');
	});

	it('stays silent about seqgap, which is not a loss count on a split fixture', () => {
		expect(faultsIn({ ...clean, seqGaps: 40 })).toEqual([]);
	});

	it('reports a stall over 100 ms ahead of a merely low frame rate', () => {
		expect(faultsIn({ ...clean, fps: 40, late: [0, 0, 2] })).toEqual(['2 stalls over 100 ms']);
	});

	it('falls back to the frame rate when nothing stalled outright', () => {
		expect(faultsIn({ ...clean, fps: 41.2 })).toEqual(['41.2 fps']);
	});
});
