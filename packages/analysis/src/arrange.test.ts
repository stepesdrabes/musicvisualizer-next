import { describe, expect, it } from 'vitest';
import { carveRingOut, type Segment } from './arrange.ts';

/** A 16-bar final drop whose last `ring` bars have the kick out and the level collapsed. */
function ringOut(ring: number): { segments: Segment[]; energy: Float32Array; kicks: Int32Array } {
	const energy = new Float32Array(16).fill(0.8);
	const kicks = new Int32Array(16).fill(4);
	for (let b = 16 - ring; b < 16; b++) {
		energy[b] = 0.3;
		kicks[b] = 0;
	}
	return { segments: [{ startBar: 0, endBar: 16, kind: 'drop', group: 0 }], energy, kicks };
}

describe('carveRingOut', () => {
	it('carves the decaying tail of a final drop into an outro', () => {
		const { segments, energy, kicks } = ringOut(2);
		carveRingOut(segments, energy, kicks, 16);
		expect(segments).toEqual([
			{ startBar: 0, endBar: 14, kind: 'drop', group: 0 },
			{ startBar: 14, endBar: 16, kind: 'outro', group: -1 }
		]);
	});

	it('leaves a track that pounds to its last bar alone', () => {
		const { segments, energy, kicks } = ringOut(0);
		carveRingOut(segments, energy, kicks, 16);
		expect(segments).toHaveLength(1);
		expect(segments[0].endBar).toBe(16);
	});

	it('keeps the kick as the boundary even where the level already fell', () => {
		// Bar 13 is quiet but still kicking: the outro starts where the kick LEAVES.
		const { segments, energy, kicks } = ringOut(2);
		energy[13] = 0.3;
		carveRingOut(segments, energy, kicks, 16);
		expect(segments[1].startBar).toBe(14);
	});

	it('caps the carve at a ring-out, not a structure rewrite', () => {
		const { segments, energy, kicks } = ringOut(7);
		carveRingOut(segments, energy, kicks, 16);
		expect(segments[1].startBar).toBe(12);
	});

	it('does not touch a track that already ends in an outro or a breakdown', () => {
		const { energy, kicks } = ringOut(2);
		const segments: Segment[] = [
			{ startBar: 0, endBar: 12, kind: 'drop', group: 0 },
			{ startBar: 12, endBar: 16, kind: 'breakdown', group: 1 }
		];
		carveRingOut(segments, energy, kicks, 16);
		expect(segments).toHaveLength(2);
	});
});
