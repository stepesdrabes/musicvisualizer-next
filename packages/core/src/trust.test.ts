import { describe, expect, it } from 'vitest';
import type { TrackAnalysis } from './contracts/analysis.ts';
import { gridTrust } from './trust.ts';

/** Only what the verdict reads: duration, section count, meter. */
function sketch(input: {
	duration: number;
	sections: number;
	meterConfidence?: number;
	beatsPerBar?: number;
}): TrackAnalysis {
	return {
		duration: input.duration,
		sections: Array.from({ length: input.sections }, (_, index) => ({ index })),
		tempo: {
			meterConfidence: input.meterConfidence ?? 0.9,
			beatsPerBar: input.beatsPerBar ?? 4
		}
	} as unknown as TrackAnalysis;
}

describe('gridTrust', () => {
	it('trips on the catastrophically fragmented grid', () => {
		// I Don't Care: 23 sections in 220 s on a 2/4 grid at meter confidence 0.50.
		const verdict = gridTrust(
			sketch({ duration: 220, sections: 23, meterConfidence: 0.5, beatsPerBar: 2 })
		);
		expect(verdict.trusted).toBe(false);
		expect(verdict.reasons.length).toBeGreaterThan(0);
	});

	it('trips on heavy fragmentation even with a confident meter', () => {
		// A half-time misread chops a Czech rap track to 5.5 s sections at confidence 0.88.
		const verdict = gridTrust(
			sketch({ duration: 180, sections: 17, meterConfidence: 0.88, beatsPerBar: 2 })
		);
		expect(verdict.trusted).toBe(false);
	});

	it('lets a busy but honest structure through', () => {
		// Like a Prayer: 10 sections in 131 s (4.6 a minute) at meter confidence 0.67.
		expect(
			gridTrust(sketch({ duration: 131, sections: 10, meterConfidence: 0.67 })).trusted
		).toBe(true);
	});

	it('does not read low meter confidence alone as failure', () => {
		// Whip: clean structure at meter confidence 0.55 - confidence only ever tightens the
		// fragmentation test, it never trips on its own.
		expect(
			gridTrust(sketch({ duration: 154, sections: 9, meterConfidence: 0.55 })).trusted
		).toBe(true);
	});

	it('tightens the borderline with a shaky meter', () => {
		// 4.8 sections a minute is honest at confidence 0.97 and suspect at 0.53.
		expect(
			gridTrust(sketch({ duration: 150, sections: 12, meterConfidence: 0.97 })).trusted
		).toBe(true);
		expect(
			gridTrust(sketch({ duration: 150, sections: 12, meterConfidence: 0.53 })).trusted
		).toBe(false);
	});

	it('leaves stubs and empty analyses alone', () => {
		expect(gridTrust(sketch({ duration: 30, sections: 5 })).trusted).toBe(true);
		expect(gridTrust(sketch({ duration: 200, sections: 0 })).trusted).toBe(true);
	});
});
