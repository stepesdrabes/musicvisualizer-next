import type { EffectDef, LayerRole, Show, TrackAnalysis } from '@mv/core';
import { LAYER_ROLES, PHRASE_BARS, onPhraseGrid, phraseOffset } from '@mv/core';

export type Severity = 'error' | 'warning';

export interface Finding {
	severity: Severity;
	rule: string;
	message: string;
	/** Bar the finding attaches to, when it has one. */
	bar?: number;
}

export interface LintResult {
	ok: boolean;
	errors: Finding[];
	warnings: Finding[];
}

export interface LintContext {
	analysis: TrackAnalysis;
	/** Built-ins plus anything the show generated. */
	effects: Map<string, EffectDef>;
}

/** Below the 3 Hz accessibility ceiling, and never anywhere near the 10-25 Hz danger band. */
const FLASH_HZ_CEILING = 3;
const DANGER_HZ_LO = 10;
const DANGER_HZ_HI = 25;
const MAX_STROBE_FRACTION = 0.08;
const MIN_STROBE_GAP_BARS = 8;
const SETTLE_BARS = 16;
const MAX_BRIEF_CHARS = 1100;
const MAX_NOTE_CHARS = 90;
const MIN_GENERATED_EFFECTS = 2;

export function lintShow(show: Show, ctx: LintContext): LintResult {
	const findings: Finding[] = [];
	const err = (rule: string, message: string, bar?: number) =>
		findings.push({ severity: 'error', rule, message, bar });
	const warn = (rule: string, message: string, bar?: number) =>
		findings.push({ severity: 'warning', rule, message, bar });

	const { analysis, effects } = ctx;
	const lastBar = analysis.bars.length - 1;
	const tempo = analysis.tempo;
	const cues = [...show.cues].sort((a, b) => a.bar - b.bar);

	if (show.analysisHash !== analysis.hash) {
		err(
			'stale-analysis',
			`show pins analysisHash ${show.analysisHash} but the analysis is ${analysis.hash}`
		);
	}

	if (cues.length === 0) {
		err('no-cues', 'a show needs at least one cue');
		return split(findings);
	}

	// --- grid ---------------------------------------------------------------------------

	if (cues[0].bar !== 0) {
		warn('opening-cue', `first cue is at bar ${cues[0].bar}; bars 0-${cues[0].bar - 1} are dark`);
	}

	const seen = new Set<number>();
	for (const cue of cues) {
		if (!Number.isInteger(cue.bar) || cue.bar < 0 || cue.bar > lastBar) {
			err('bar-out-of-grid', `bar ${cue.bar} is not in the analysed grid (0-${lastBar})`, cue.bar);
		}
		if (seen.has(cue.bar)) err('duplicate-bar', `two cues share bar ${cue.bar}`, cue.bar);
		seen.add(cue.bar);
		if (!cue.note?.trim()) {
			warn('undocumented-cue', `cue at bar ${cue.bar} has no note explaining it`, cue.bar);
		}
	}

	// Structural changes land on a phrase multiple. Off-phrase cues read as wrong even when
	// the audience cannot say why.
	//
	// A void is the exception, and necessarily so: it is phrase-TERMINAL, occupying the last
	// bar or two before a drop, so its start is never on a phrase multiple. What has to be
	// on-grid is where it ends, which is the drop cue that follows it.
	const onPhrase = (bar: number) => onPhraseGrid(bar, tempo.phraseAnchorBar);

	for (let i = 1; i < cues.length; i++) {
		const cue = cues[i];
		if (cue.section === cues[i - 1].section) continue;

		if (cue.section === 'void') {
			const next = cues[i + 1];
			if (next && !onPhrase(next.bar)) {
				err(
					'off-phrase-change',
					`the void at bar ${cue.bar} resolves at bar ${next.bar}, which is off the ${PHRASE_BARS}-bar grid`,
					next.bar
				);
			}
			const lengthBars = (next ? next.bar : lastBar + 1) - cue.bar;
			if (lengthBars > 2) {
				warn(
					'void-too-long',
					`the void at bar ${cue.bar} runs ${lengthBars} bars; past two it stops reading as a held breath`,
					cue.bar
				);
			}
			continue;
		}

		if (!onPhrase(cue.bar)) {
			const down = cue.bar - phraseOffset(cue.bar, tempo.phraseAnchorBar);
			err(
				'off-phrase-change',
				`section change to ${cue.section} at bar ${cue.bar} is off the ${PHRASE_BARS}-bar grid; use ${down} or ${down + PHRASE_BARS}`,
				cue.bar
			);
		}
	}

	// --- effects ------------------------------------------------------------------------

	const peakUses = new Map<string, number[]>();
	const stacks: string[] = [];

	for (let i = 0; i < cues.length; i++) {
		const cue = cues[i];
		const endBar = i + 1 < cues.length ? cues[i + 1].bar : lastBar + 1;
		const lengthBars = endBar - cue.bar;
		const parts: string[] = [];

		for (const role of LAYER_ROLES) {
			const spec = cue.layers[role];
			if (!spec) continue;
			parts.push(`${role}:${spec.effect}`);

			const def = effects.get(spec.effect);
			if (!def) {
				const legal = [...effects.values()]
					.filter((e) => e.role === role)
					.map((e) => e.id)
					.join(', ');
				err(
					'unknown-effect',
					`cue at bar ${cue.bar} names unknown effect "${spec.effect}"; ${role} effects available: ${legal}`,
					cue.bar
				);
				continue;
			}
			if (def.role !== role) {
				err(
					'role-mismatch',
					`"${def.id}" is a ${def.role} effect but sits in the ${role} layer at bar ${cue.bar}; move it to "${def.role}"`,
					cue.bar
				);
			}
			if (!def.taste.sections.includes(cue.section)) {
				warn(
					'effect-out-of-place',
					`"${def.id}" is not intended for a ${cue.section} (allowed: ${def.taste.sections.join(', ')})`,
					cue.bar
				);
			}
			if (lengthBars < def.taste.minBars) {
				warn(
					'cue-too-short',
					`"${def.id}" wants at least ${def.taste.minBars} bars but gets ${lengthBars} at bar ${cue.bar}`,
					cue.bar
				);
			}
			if (lengthBars > def.taste.maxBars) {
				warn(
					'cue-too-long',
					`"${def.id}" outstays its welcome after ${def.taste.maxBars} bars; it runs ${lengthBars} from bar ${cue.bar}`,
					cue.bar
				);
			}
			if (def.taste.peakReserved) {
				const uses = peakUses.get(def.id) ?? [];
				uses.push(cue.bar);
				peakUses.set(def.id, uses);
			}
			for (const key of Object.keys(spec.params ?? {})) {
				if (!def.params.some((p) => p.key === key)) {
					warn('unknown-param', `"${def.id}" has no param "${key}" (bar ${cue.bar})`, cue.bar);
				}
			}
		}

		stacks.push(parts.sort().join(' '));
		if (parts.length === 0) {
			warn('empty-cue', `cue at bar ${cue.bar} lights nothing`, cue.bar);
		}
	}

	for (const [id, bars] of peakUses) {
		if (bars.length > 1) {
			err(
				'peak-effect-reused',
				`"${id}" is reserved for one moment but appears at bars ${bars.join(', ')}`,
				bars[1]
			);
		}
	}

	// Your best trick loses value with every repeat.
	for (let i = 1; i < stacks.length; i++) {
		if (stacks[i] && stacks[i] === stacks[i - 1]) {
			warn(
				'repeated-stack',
				`bar ${cues[i].bar} repeats the previous cue's stack exactly; change a fixture group or direction`,
				cues[i].bar
			);
		}
	}

	// --- energy discipline --------------------------------------------------------------

	const peakSection = analysis.sections.find((s) => s.energyRank === 1);
	if (peakSection) {
		const maxIntensity = Math.max(...cues.map((c) => c.intensity ?? show.defaults.intensity));
		const loudest = cues.filter((c) => (c.intensity ?? show.defaults.intensity) === maxIntensity);
		const inPeak = loudest.some(
			(c) => c.bar >= peakSection.startBar && c.bar < peakSection.endBar
		);
		if (!inPeak) {
			warn(
				'peak-not-brightest',
				`the brightest cue is not in the peak section (bars ${peakSection.startBar}-${peakSection.endBar}); save the biggest look for the biggest moment`,
				loudest[0]?.bar
			);
		}
	}

	// Lighting strips in parallel with the music: a build reintroduces at the drop, it does
	// not add before it.
	for (let i = 0; i < cues.length - 1; i++) {
		if (cues[i].section !== 'build') continue;
		const next = cues.slice(i + 1).find((c) => c.section === 'drop');
		if (!next) continue;
		const buildLayers = countLayers(cues[i].layers);
		const dropLayers = countLayers(next.layers);
		if (buildLayers >= dropLayers) {
			warn(
				'build-not-stripped',
				`the build at bar ${cues[i].bar} runs ${buildLayers} layers and the drop at ${next.bar} runs ${dropLayers}; a build should hold less back`,
				cues[i].bar
			);
		}
	}

	for (const span of analysis.sections) {
		if (span.kind !== 'void') continue;
		const covering = lastCueAtOrBefore(cues, span.startBar);
		if (!covering) continue;
		const intensity = covering.intensity ?? show.defaults.intensity;
		if (intensity > 0.25 && covering.bar !== span.startBar) {
			warn(
				'void-not-honoured',
				`the void at bar ${span.startBar} inherits intensity ${intensity}; cutting the light with the bass is what makes the drop a release`,
				span.startBar
			);
		}
	}

	// --- punctuation and safety ---------------------------------------------------------

	const hits = [...show.hits].sort((a, b) => a.bar - b.bar);
	let strobeBars = 0;
	let lastStrobeBar = -Infinity;

	for (const hit of hits) {
		if (!Number.isInteger(hit.bar) || hit.bar < 0 || hit.bar > lastBar) {
			err('hit-out-of-grid', `hit at bar ${hit.bar} is not in the analysed grid`, hit.bar);
			continue;
		}
		if (hit.beats <= 0) err('hit-zero-length', `hit at bar ${hit.bar} has no duration`, hit.bar);

		if (hit.bar < SETTLE_BARS && (hit.kind === 'slam' || hit.kind === 'strobe')) {
			warn(
				'early-punctuation',
				`a ${hit.kind} at bar ${hit.bar} spends the show's biggest card in the first ${SETTLE_BARS} bars`,
				hit.bar
			);
		}

		if (hit.kind === 'strobe') {
			const perBeat = hit.params?.perBeat ?? 2;
			const rawHz = (perBeat * tempo.bpm) / 60;
			// The strobe effect alternates wall pairs, so a point in the room sees half the rate.
			const perceivedHz = rawHz / 2;
			if (perceivedHz > FLASH_HZ_CEILING) {
				err(
					'flash-rate',
					`strobe at bar ${hit.bar} flashes at ${perceivedHz.toFixed(1)} Hz, over the ${FLASH_HZ_CEILING} Hz ceiling`,
					hit.bar
				);
			}
			if (rawHz >= DANGER_HZ_LO && rawHz <= DANGER_HZ_HI) {
				err(
					'flash-danger-band',
					`strobe at bar ${hit.bar} runs at ${rawHz.toFixed(1)} Hz, inside the ${DANGER_HZ_LO}-${DANGER_HZ_HI} Hz seizure-risk band`,
					hit.bar
				);
			}
			const bars = hit.beats / tempo.beatsPerBar;
			if (bars > 2) {
				err('strobe-too-long', `strobe at bar ${hit.bar} runs ${bars} bars; 2 is the maximum`, hit.bar);
			}
			if (hit.bar - lastStrobeBar < MIN_STROBE_GAP_BARS) {
				warn(
					'strobe-too-frequent',
					`strobe at bar ${hit.bar} is only ${hit.bar - lastStrobeBar} bars after the last one; it stops being special`,
					hit.bar
				);
			}
			lastStrobeBar = hit.bar;
			strobeBars += bars;
		}

		if (hit.kind === 'blackout') {
			const bars = hit.beats / tempo.beatsPerBar;
			if (bars > 2) {
				err(
					'blackout-too-long',
					`blackout at bar ${hit.bar} runs ${bars} bars; an unintended black stage reads as failure, so keep it to 2`,
					hit.bar
				);
			}
			const section = analysis.bars[hit.bar]?.section;
			if (section && section !== 'void' && section !== 'breakdown' && section !== 'outro') {
				warn(
					'blackout-placement',
					`blackout at bar ${hit.bar} lands in a ${section}; it reads as a mistake outside a void or breakdown`,
					hit.bar
				);
			}
		}
	}

	const totalBars = analysis.bars.length;
	if (strobeBars / totalBars > MAX_STROBE_FRACTION) {
		err(
			'strobe-budget',
			`strobe covers ${Math.round((strobeBars / totalBars) * 100)}% of the track; ${Math.round(MAX_STROBE_FRACTION * 100)}% is the budget, and continuous flashing is visual fatigue`
		);
	}

	// --- colour -------------------------------------------------------------------------

	const hues = new Set<number>([show.palette.base, show.palette.accent]);
	if (show.palette.third !== undefined) hues.add(show.palette.third);
	for (const cue of cues) {
		if (cue.palette && cue.palette !== 'swap' && cue.palette !== 'inherit') {
			hues.add(cue.palette.base);
			hues.add(cue.palette.accent);
			if (cue.palette.third !== undefined) hues.add(cue.palette.third);
		}
	}
	if (hues.size > 3) {
		warn(
			'too-many-hues',
			`the show uses ${hues.size} hues (${[...hues].join(', ')}); three or more competing hues turn to mud when walls inter-reflect`
		);
	}

	const separation = hueDistance(show.palette.base, show.palette.accent);
	if (separation < 90) {
		warn(
			'palette-no-contrast',
			`base ${show.palette.base} and accent ${show.palette.accent} are only ${Math.round(separation)} degrees apart; a warm/cool pair is what makes colour read as emotion`
		);
	}

	// --- anti-monotony ------------------------------------------------------------------
	// The documented failure mode of mechanical audio-to-light mapping: one light event per
	// audio event, which reads as repetitive and too explicit however well timed it is.
	const withTransient = cues.filter((c) => c.layers.transient).length;
	if (cues.length >= 4 && withTransient / cues.length > 0.8) {
		warn(
			'monotonous-transients',
			`${withTransient} of ${cues.length} cues fire on every drum hit; leaving the transient layer out is what makes it land when it returns`
		);
	}

	const distinctBeds = new Set(cues.map((c) => c.layers.bed?.effect).filter(Boolean));
	if (cues.length >= 6 && distinctBeds.size === 1) {
		warn(
			'single-bed',
			`every cue uses the same bed (${[...distinctBeds][0]}); the room never changes character`
		);
	}

	if (!show.brief?.trim()) {
		warn('no-brief', 'the show has no brief explaining its design');
	} else if (show.brief.length > MAX_BRIEF_CHARS) {
		// Asking for brevity in the prompt is not enough on its own; the effort belongs in the
		// effects, not in prose about them.
		warn(
			'brief-too-long',
			`the brief is ${show.brief.length} characters; keep it under ${MAX_BRIEF_CHARS}, roughly 150 words`
		);
	}

	const rambling = cues.filter((c) => (c.note?.length ?? 0) > MAX_NOTE_CHARS);
	if (rambling.length > 0) {
		warn(
			'notes-too-long',
			`${rambling.length} cue note(s) run past ${MAX_NOTE_CHARS} characters; a note says why the cue exists in a handful of words`,
			rambling[0].bar
		);
	}

	if (show.generatedEffects.length < MIN_GENERATED_EFFECTS) {
		warn(
			'few-generated-effects',
			`only ${show.generatedEffects.length} effect(s) written for this track; two to five is the target, and they are where the show gets its character`
		);
	}

	return split(findings);
}

function countLayers(layers: Show['cues'][number]['layers']): number {
	return LAYER_ROLES.filter((r: LayerRole) => layers[r]).length;
}

function lastCueAtOrBefore(cues: Show['cues'], bar: number): Show['cues'][number] | null {
	let best: Show['cues'][number] | null = null;
	for (const c of cues) if (c.bar <= bar && (!best || c.bar > best.bar)) best = c;
	return best;
}

function hueDistance(a: number, b: number): number {
	const d = Math.abs(((a - b) % 360 + 360) % 360);
	return Math.min(d, 360 - d);
}

function split(findings: Finding[]): LintResult {
	const errors = findings.filter((f) => f.severity === 'error');
	const warnings = findings.filter((f) => f.severity === 'warning');
	return { ok: errors.length === 0, errors, warnings };
}

export function formatFindings(result: LintResult): string {
	if (result.ok && result.warnings.length === 0) return 'Clean: no errors, no warnings.';
	const lines: string[] = [];
	for (const f of [...result.errors, ...result.warnings]) {
		const at = f.bar !== undefined ? ` (bar ${f.bar})` : '';
		lines.push(`${f.severity.toUpperCase()} [${f.rule}]${at}: ${f.message}`);
	}
	lines.push('');
	lines.push(
		`${result.errors.length} error(s), ${result.warnings.length} warning(s). ${
			result.ok ? 'Errors must be zero before the show is accepted.' : 'Fix the errors.'
		}`
	);
	return lines.join('\n');
}
