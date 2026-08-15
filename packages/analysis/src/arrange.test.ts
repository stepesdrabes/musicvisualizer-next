import { describe, expect, it } from 'vitest';
import { carveRingOut, snapToPhrases, type Segment } from './arrange.ts';

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

describe('snapToPhrases', () => {
	it('yields to a pinned startBar one bar off the grid', () => {
		const make = (): Segment[] => [
			{ startBar: 0, endBar: 40, kind: 'groove', group: 0 },
			{ startBar: 40, endBar: 82, kind: 'groove', group: 1 },
			{ startBar: 82, endBar: 98, kind: 'drop', group: 2 }
		];
		const free = make();
		snapToPhrases(free, 98, 1, new Set());
		expect(free[2].startBar).toBe(81);
		const held = make();
		snapToPhrases(held, 98, 1, new Set([82]));
		expect(held[2].startBar).toBe(82);
	});

	it('prefers moving a pin over growing a void across a played bar', () => {
		// A one-bar sliver between a short void and a long pinned drop: redirecting the
		// fold into the void would black out a played bar in the room, which is worse
		// than the drop's cue starting one bar early. The length rule stands here.
		const segments: Segment[] = [
			{ startBar: 0, endBar: 4, kind: 'void', group: -1 },
			{ startBar: 4, endBar: 5, kind: 'build', group: -1 },
			{ startBar: 5, endBar: 98, kind: 'drop', group: 2 }
		];
		snapToPhrases(segments, 98, 1, new Set([5]));
		expect(segments).toEqual([
			{ startBar: 0, endBar: 4, kind: 'void', group: -1 },
			{ startBar: 4, endBar: 98, kind: 'drop', group: 2 }
		]);
	});

	it('folds a snapped-empty sliver away from a pinned boundary', () => {
		// The Vitej shape: the 2-bar kickless cut before the last drop. Snapping pulls the
		// cut's start onto the phrase line, leaving a one-bar sliver whose LONGER neighbour
		// is the drop - and folding into the longer side would drag the drop's pinned start
		// back onto a bar nothing arrives at, undoing the pin the arrival earned.
		const segments: Segment[] = [
			{ startBar: 0, endBar: 73, kind: 'groove', group: 0 },
			{ startBar: 73, endBar: 80, kind: 'groove', group: 1 },
			{ startBar: 80, endBar: 82, kind: 'build', group: -1 },
			{ startBar: 82, endBar: 98, kind: 'drop', group: 2 }
		];
		snapToPhrases(segments, 98, 1, new Set([82]));
		expect(segments).toEqual([
			{ startBar: 0, endBar: 73, kind: 'groove', group: 0 },
			{ startBar: 73, endBar: 82, kind: 'groove', group: 1 },
			{ startBar: 82, endBar: 98, kind: 'drop', group: 2 }
		]);
	});
});
