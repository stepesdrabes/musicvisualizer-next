import { describe, expect, it } from 'vitest';
import { coerceShow } from './showSchema.ts';

const valid = {
	analysisHash: 'abc123',
	brief: 'Amber and deep blue. Void at 31 cut hard.',
	palette: { base: 32, accent: 214, sat: 0.94 },
	defaults: { intensity: 0.85, motion: 1, fadeBeats: 8 },
	cues: [
		{
			bar: 0,
			section: 'intro',
			layers: { bed: { effect: 'wash', opacity: 0.5, params: { breath: 0.2 } } },
			intensity: 0.3,
			note: 'Barely there.'
		}
	],
	hits: [{ bar: 32, beat: 0, kind: 'slam', beats: 1, note: 'Blinder.' }]
};

describe('coerceShow', () => {
	it('accepts a well-formed object', () => {
		const { show, error } = coerceShow(valid);
		expect(error).toBeNull();
		expect(show?.cues).toHaveLength(1);
		expect(show?.hits).toHaveLength(1);
	});

	it('fills the fields the author is not asked for', () => {
		const { show } = coerceShow({ ...valid, hits: undefined });
		expect(show?.version).toBe(1);
		expect(show?.hits).toEqual([]);
		expect(show?.generatedEffects).toEqual([]);
	});

	// The bug this file exists for: z.any() gave the MCP layer no schema, so the argument
	// arrived as a JSON string and `show.cues` was undefined.
	it('accepts a JSON string, which is how the argument used to arrive', () => {
		const { show, error } = coerceShow(JSON.stringify(valid));
		expect(error).toBeNull();
		expect(show?.cues).toHaveLength(1);
	});

	it('reports unparseable JSON rather than throwing', () => {
		const { show, error } = coerceShow('{ this is not json');
		expect(show).toBeNull();
		expect(error).toMatch(/not valid JSON/);
	});

	it('names the offending path when the shape is wrong', () => {
		const bad = { ...valid, cues: [{ ...valid.cues[0], bar: 'seven' }] };
		const { show, error } = coerceShow(bad);
		expect(show).toBeNull();
		expect(error).toMatch(/cues\.0\.bar/);
	});

	it('rejects an unknown section name', () => {
		const bad = { ...valid, cues: [{ ...valid.cues[0], section: 'chorus' }] };
		expect(coerceShow(bad).show).toBeNull();
	});

	it('rejects an empty cue list', () => {
		expect(coerceShow({ ...valid, cues: [] }).show).toBeNull();
	});

	it('rejects a non-object', () => {
		expect(coerceShow(42).show).toBeNull();
		expect(coerceShow(null).show).toBeNull();
	});
});
