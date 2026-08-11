import type { SectionKind } from '@mv/core';

/**
 * Annotated musical function, read as a lighting instruction.
 *
 * Recovered from the deleted harness (bench/kinds.ts, removed in b94e2fa) and extended:
 * `SectionKind` has since grown 'verse' and 'chorus', so the one table is now two. Which one a
 * probe scores against is the probe's choice, not this file's.
 *
 * Harmonix annotates 912 pop, dance and hip-hop tracks with verse, chorus, prechorus and break.
 * Those are the only public labels that say what a section IS doing rather than merely which
 * other sections it resembles. Every line is a judgement, written out one per line rather than
 * folded into prefix rules so that disagreeing with one costs an edit rather than an
 * archaeology session.
 *
 * `prechorus` is the only annotated function whose definition is "the passage leading into the
 * chorus", which is exactly what a build is, and it is why this corpus can score builds at all.
 */

/**
 * The club reading: the original seven-kind table, unchanged. Two lines are arguable:
 *
 * - `bridge` is groove, not breakdown. Harmonix uses it for any contrasting section and most of
 *   them keep their kit; the ones that do not are annotated `break`.
 * - `postchorus` is drop. It is the hook continuing at the chorus's energy, and the room has no
 *   quieter instruction that would not read as the big moment ending early.
 */
export const KIND_CLUB: Record<string, SectionKind> = {
	intro: 'intro',
	fadein: 'intro',
	outro: 'outro',
	fadeout: 'outro',
	end: 'outro',
	verse: 'groove',
	bridge: 'groove',
	inst: 'groove',
	instrumental: 'groove',
	solo: 'groove',
	gtr: 'groove',
	section: 'groove',
	rap: 'groove',
	chorus: 'drop',
	altchorus: 'drop',
	postchorus: 'drop',
	instchorus: 'drop',
	prechorus: 'build',
	build: 'build',
	transition: 'build',
	break: 'breakdown',
	breakdown: 'breakdown',
	quiet: 'breakdown',
	silence: 'void'
};

/**
 * The song reading: verse and chorus keep their names now that the vocabulary has them, and
 * bridge moves to breakdown, since in a song a contrasting section is a lull between choruses
 * rather than more groove. Instrumental passages stay groove; a postchorus stays with the
 * chorus whose energy it continues.
 */
export const KIND_SONG: Record<string, SectionKind> = {
	intro: 'intro',
	fadein: 'intro',
	outro: 'outro',
	fadeout: 'outro',
	end: 'outro',
	verse: 'verse',
	rap: 'verse',
	bridge: 'breakdown',
	inst: 'groove',
	instrumental: 'groove',
	solo: 'groove',
	gtr: 'groove',
	section: 'groove',
	chorus: 'chorus',
	altchorus: 'chorus',
	postchorus: 'chorus',
	instchorus: 'chorus',
	prechorus: 'build',
	build: 'build',
	transition: 'build',
	break: 'breakdown',
	breakdown: 'breakdown',
	quiet: 'breakdown',
	silence: 'void'
};

/** The seven club kinds, in a fixed order so a confusion matrix means the same thing everywhere. */
export const KINDS_CLUB: SectionKind[] = [
	'intro',
	'groove',
	'build',
	'drop',
	'breakdown',
	'void',
	'outro'
];

/** The nine, with the song kinds beside their club ancestors. */
export const KINDS_SONG: SectionKind[] = [
	'intro',
	'groove',
	'verse',
	'build',
	'drop',
	'chorus',
	'breakdown',
	'void',
	'outro'
];

/** Strip Harmonix's repeat suffixes: `verse3`, `chorus2` and `inst2` are all the same function. */
export function kindOf(label: string, table: Record<string, SectionKind> = KIND_CLUB): SectionKind | null {
	const base = label.toLowerCase().replace(/[0-9]+$/, '').trim();
	return table[base] ?? null;
}

/** Below this the offset peak is not distinct and the upload is probably a different edit. */
export const MIN_SHARPNESS = 1.15;

/**
 * How far the decoded audio may differ in length from the master that was annotated.
 *
 * The gate that makes Harmonix usable. Its annotations are of Rock Band edits, and 139 of the
 * 254 uploads the old harness had on disk were a different length from the edit that was
 * annotated: usually the full single against a game-length cut with an internal section
 * removed. No constant offset reaches those, and asking the offset fit about them is asking a
 * question it cannot answer.
 */
export const MAX_DURATION_DRIFT = 0.02;
