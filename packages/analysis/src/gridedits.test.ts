import { describe, expect, it } from 'vitest';
import { barStartsAtCuts, deriveGridCuts } from './gridedits.ts';

describe('barStartsAtCuts', () => {
	it('absorbs each cut as a short bar ending exactly on it', () => {
		// The Safir shape in beats: cuts at 134 and 268 on a phase-0 grid of 4.
		const starts = barStartsAtCuts(280, 4, 0, [134, 268]);
		expect(starts).toContain(134);
		expect(starts).toContain(268);
		const i = starts.indexOf(134);
		expect(starts[i] - starts[i - 1]).toBe(2);
		const j = starts.indexOf(268);
		expect(starts[j] - starts[j - 1]).toBe(2);
		// Between the cuts the grid rides the shifted phase in full bars.
		expect(starts[i + 1] - starts[i]).toBe(4);
	});

	it('ignores a cut already on the walking grid', () => {
		expect(barStartsAtCuts(17, 4, 0, [8])).toEqual([0, 4, 8, 12, 16]);
	});

	it('absorbs an odd offset when the map demands one', () => {
		const starts = barStartsAtCuts(20, 4, 0, [7]);
		expect(starts).toContain(7);
		const i = starts.indexOf(7);
		expect(starts[i] - starts[i - 1]).toBe(3);
	});
});

describe('deriveGridCuts', () => {
	// Beats every half second, bars of four: bar lines at 0, 2, 4... seconds.
	const beats = Float64Array.from({ length: 120 }, (_, i) => i * 0.5);

	it('derives the Safir shape from residue changes', () => {
		// Boundaries at 4s (res 0), 9s (res 2), 17s (res 2, same region), 24s (res 0 again).
		expect(deriveGridCuts([4, 9, 17, 24], beats, 4, 0)).toEqual([9, 24]);
	});

	it('implies nothing from a map on a correct grid', () => {
		expect(deriveGridCuts([4, 8, 16, 32], beats, 4, 0)).toEqual([]);
	});

	it('ignores a boundary that sits between beats', () => {
		const sparse = Float64Array.from({ length: 60 }, (_, i) => i * 1.0);
		expect(deriveGridCuts([4, 8.45], sparse, 4, 0)).toEqual([]);
	});
});
