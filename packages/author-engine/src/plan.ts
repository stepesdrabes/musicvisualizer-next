import type {
	Cue,
	CuePalette,
	EffectDef,
	Hit,
	LayerRole,
	LayerSpec,
	SectionKind,
	SectionSpan,
	Show,
	ShowPalette,
	TrackAnalysis
} from '@mv/core';
import { BUILT_IN_EFFECTS, PHRASE_BARS, SHOW_VERSION, Rng } from '@mv/core';
import { choosePalette, lerpHue } from './palette.ts';
import { EffectPicker } from './select.ts';

export interface EngineOptions {
	/** Built-ins by default; pass a superset to let generated effects be chosen too. */
	effects?: readonly EffectDef[];
	/** Overrides the seed taken from the analysis hash. */
	seed?: number;
}

/** No cue holds the room longer than this before something has to change. */
const MAX_CUE_BARS = 16;
/** Matches the linter: punctuation inside this many bars spends the biggest card too early. */
const SETTLE_BARS = 16;

interface Slot {
	bar: number;
	endBar: number;
	section: SectionKind;
	span: SectionSpan;
	/** 0..1 within the track. */
	energy: number;
	/** Which cue this is inside its section; 0 is the one that opens it. */
	index: number;
	/** How many cues the section is split into. */
	of: number;
	/** True for the one slot that opens the peak section. */
	peak: boolean;
	/** What was playing before, which decides how fast this one is allowed to arrive. */
	from: SectionKind | null;
	/** Which drop this is, counting from zero; -1 when the slot is not a drop. */
	dropIndex: number;
}

/**
 * A show from the analysis alone: no model, no network, and the same bytes every time for
 * the same track.
 *
 * The taste metadata on the effects and the rules in the linter already encode most of what a
 * lighting designer would decide, so this does not need judgement so much as bookkeeping:
 * cover every bar, hold back in the build, spend the biggest look inside the peak, and do not
 * play the same trick twice running. What it cannot do is interpret - it has no idea what the
 * song is about - which is exactly the part left for `author-ai` to revise.
 */
export function composeShow(analysis: TrackAnalysis, opts: EngineOptions = {}): Show {
	const effects = opts.effects ?? BUILT_IN_EFFECTS;
	const rng = new Rng(opts.seed ?? seedFrom(analysis.hash));
	const picker = new EffectPicker(effects, rng);
	const palette = choosePalette(analysis, rng);

	const peakSpan = analysis.sections.find((s) => s.energyRank === 1) ?? null;

	// Reserved before anything else is chosen, so it cannot be spent on an ordinary drop
	// earlier in the track. The biggest thing in the catalog is worth more as the one moment
	// nobody saw coming.
	const peakMaster =
		peakSpan && peakSpan.startBar >= SETTLE_BARS
			? picker.strongest('master', peakSpan.kind, 1)
			: null;
	if (peakMaster) picker.reserve(peakMaster.id);

	// A master effect is a moment, not a look: they are written to hold the room for a bar or
	// two and the linter says so. The peak therefore gets a short cue carrying the burst and a
	// second one right behind it for the rest of the section, which is how a desk would run it.
	const slots = buildSlots(analysis, peakMaster?.taste.maxBars ?? 0);

	const cues: Cue[] = [];
	let grooveIndex = 0;

	for (const slot of slots) {
		const layers: Partial<Record<LayerRole, LayerSpec>> = {};
		const add = (role: LayerRole, def: EffectDef | null) => {
			if (!def) return;
			const params = paramsFor(def, slot, analysis);
			layers[role] = params ? { effect: def.id, params } : { effect: def.id };
		};

		const bedEnergy = Math.min(slot.energy, 0.75);
		add('bed', picker.pick({ role: 'bed', section: slot.section, lengthBars: slot.endBar - slot.bar, energy: bedEnergy }));

		const length = slot.endBar - slot.bar;
		switch (slot.section) {
			case 'void':
				break;

			case 'intro':
			case 'outro':
				break;

			case 'breakdown':
				// One texture on top of the bed, and only sometimes: a breakdown that keeps
				// everything running is not a breakdown.
				if (rng.float() < 0.5) {
					add('accent', picker.pick({ role: 'accent', section: slot.section, lengthBars: length, energy: slot.energy }));
				}
				break;

			case 'build':
				add('rhythm', picker.pick({ role: 'rhythm', section: slot.section, lengthBars: length, energy: slot.energy }));
				break;

			case 'groove':
				add('rhythm', picker.pick({ role: 'rhythm', section: slot.section, lengthBars: length, energy: slot.energy }));
				// Every other groove cue leaves the drum layer out. Firing a light at every hit
				// is the documented failure of audio-to-light mapping: it reads as mechanical
				// however well timed it is, and leaving it out is what makes it land on return.
				if (grooveIndex % 2 === 1) {
					add('transient', picker.pick({ role: 'transient', section: slot.section, lengthBars: length, energy: slot.energy }));
				}
				grooveIndex++;
				break;

			case 'drop':
				add('rhythm', picker.pick({ role: 'rhythm', section: slot.section, lengthBars: length, energy: slot.energy }));
				add('transient', picker.pick({ role: 'transient', section: slot.section, lengthBars: length, energy: slot.energy }));
				add('accent', picker.pick({ role: 'accent', section: slot.section, lengthBars: length, energy: slot.energy }));
				break;
		}

		if (slot.peak && peakMaster) layers.master = { effect: peakMaster.id };

		cues.push({
			bar: slot.bar,
			section: slot.section,
			layers,
			palette: paletteFor(slot, palette),
			intensity: intensityFor(slot),
			motion: motionFor(slot),
			fadeBeats: fadeFor(slot),
			note: noteFor(slot)
		});
	}

	stripBuilds(cues);

	return {
		version: SHOW_VERSION,
		trackId: analysis.trackId,
		title: analysis.title,
		analysisHash: analysis.hash,
		brief: writeBrief(analysis, palette.name ?? 'unnamed'),
		palette,
		defaults: { intensity: 0.7, motion: 1, fadeBeats: 2 },
		generatedEffects: [],
		cues,
		hits: planHits(analysis, slots, rng)
	};
}

/**
 * One cue where each section starts, plus interior cues so nothing holds the room for more
 * than four phrases. The interior ones land on the phrase grid because the linter rejects a
 * section change anywhere else, and a cue that arrives off-phrase reads as wrong even when
 * nobody can say why.
 */
function buildSlots(analysis: TrackAnalysis, peakMasterBars: number): Slot[] {
	const slots: Slot[] = [];
	const peakIndex = analysis.sections.find((s) => s.energyRank === 1)?.index ?? -1;
	let dropCount = 0;

	for (const span of analysis.sections) {
		const energy = span.meanEnergy / 100;
		const isPeak = span.index === peakIndex;
		const dropIndex = span.kind === 'drop' ? dropCount++ : -1;
		const first = slots.length;
		let bar = span.startBar;
		let index = 0;

		while (bar < span.endBar) {
			const remaining = span.endBar - bar;
			// The peak's opening cue is only as long as the burst it carries, so a master effect
			// written to hold the room for a bar is never asked to hold it for eight.
			const take =
				isPeak && index === 0 && peakMasterBars > 0
					? Math.min(peakMasterBars, remaining)
					: // Leaving a stub shorter than a phrase behind is worse than one long cue.
						remaining > MAX_CUE_BARS + PHRASE_BARS
						? MAX_CUE_BARS
						: remaining;

			slots.push({
				bar,
				endBar: bar + take,
				section: span.kind,
				span,
				energy,
				index,
				of: 0,
				peak: isPeak && index === 0,
				from: slots[slots.length - 1]?.section ?? null,
				dropIndex
			});
			bar += take;
			index++;
		}

		for (let i = first; i < slots.length; i++) slots[i].of = index;
	}

	return slots;
}

function intensityFor(slot: Slot): number {
	const base: Record<SectionKind, number> = {
		intro: 0.4,
		groove: 0.68,
		breakdown: 0.42,
		build: 0.62,
		void: 0.05,
		drop: 0.9,
		outro: 0.32
	};
	// The peak is the only cue allowed the top of the range, because the linter checks that the
	// brightest thing in the show happens in the biggest moment of the track.
	if (slot.peak) return 1;
	// A build that sits at one level is not a build. Climbing across its cues is what makes the
	// drop feel arrived at rather than merely loud.
	const climb = slot.section === 'build' && slot.of > 1 ? (slot.index / (slot.of - 1)) * 0.16 : 0;
	return Math.min(0.92, base[slot.section] + slot.energy * 0.08 + climb);
}

function motionFor(slot: Slot): number {
	const base: Record<SectionKind, number> = {
		intro: 0.6,
		groove: 1,
		breakdown: 0.7,
		build: 1.15,
		void: 0.4,
		drop: 1.25,
		outro: 0.55
	};
	const climb = slot.section === 'build' && slot.of > 1 ? (slot.index / (slot.of - 1)) * 0.2 : 0;
	return Math.round((base[slot.section] + climb) * 100) / 100;
}

/**
 * A drop and a void arrive on the downbeat; everything else can afford to be eased into. How
 * long depends on what came before: a breakdown after a drop is a collapse and wants two
 * beats, the same breakdown after a groove is a settling and wants eight.
 */
function fadeFor(slot: Slot): number {
	if (slot.section === 'drop' || slot.section === 'void') return 0;
	// Inside a section nothing has changed but the look, so the change should be barely felt.
	if (slot.index > 0) return 4;
	if (slot.section === 'intro' || slot.section === 'outro') return 8;
	if (slot.from === 'drop') return 2;
	return 8;
}

/**
 * One colour identity, read six ways.
 *
 * The hues never change: base and accent are the track's, and every section varies only how
 * saturated and how deep they sit. That restraint is the point - a declared colour that drifts
 * from section to section stops being an identity, and the base/accent swap at a drop only
 * reads as an event because nothing else about the colour has moved all night.
 */
function paletteFor(slot: Slot, show: ShowPalette): CuePalette | undefined {
	const sat = show.sat ?? 0.94;
	const shade = show.shade ?? 0.14;
	const { base, accent } = show;
	const third = show.third ?? accent;

	switch (slot.section) {
		case 'drop':
			// The first drop inverts, which is the loudest thing colour can do without leaving
			// the identity. A later one promotes the third hue instead, so it tops the first
			// rather than repeating it.
			return slot.dropIndex % 2 === 0
				? 'swap'
				: { base: third, accent: base, third: accent, sat: Math.min(1, sat * 1.05), shade };

		case 'intro':
		case 'outro':
			return { base, accent, third, sat: sat * 0.7, shade: shade * 0.7, white: 0.3 };

		case 'breakdown':
			// A breakdown is somewhere else. Turning the room to the third hue is the cheapest
			// way to say so, and it costs no hue the show has not already declared.
			return { base: third, accent: base, third: accent, sat: sat * 0.62, shade: shade * 1.5, white: 0.25 };

		case 'build':
			// The base walks toward the accent across the build, so the drop's inversion is
			// arriving at somewhere the room has already started moving.
			return {
				base: lerpHue(base, accent, slot.of > 1 ? 0.2 + (slot.index / (slot.of - 1)) * 0.2 : 0.3),
				accent,
				third,
				sat: Math.min(1, sat * 1.02),
				shade: shade * 0.8,
				white: 0.08
			};

		default:
			return undefined;
	}
}

/**
 * Parameters an effect cannot pick for itself, because they depend on what the track is doing
 * rather than on what the effect is.
 *
 * Only where the analysis genuinely knows better than the default. An effect's defaults are
 * its author's opinion, and overriding them from here on anything else would be guessing with
 * extra steps.
 */
function paramsFor(
	def: EffectDef,
	slot: Slot,
	analysis: TrackAnalysis
): Record<string, number> | undefined {
	const spec = def.params.find((x) => x.key === 'perBeat');
	if (!spec) return undefined;

	// Hats carry the subdivision a track is actually played at, so a flicker locked to them
	// lands where the producer put it rather than on a guess about the genre.
	let hats = 0;
	let bars = 0;
	for (let b = slot.bar; b < Math.min(slot.endBar, analysis.bars.length); b++) {
		hats += analysis.bars[b].hats;
		bars++;
	}
	const perBeat = bars > 0 ? hats / bars / Math.max(1, analysis.tempo.beatsPerBar) : 0;
	const wanted = perBeat >= 3 ? 4 : perBeat >= 1.5 ? 2 : 1;
	return { perBeat: Math.max(spec.min, Math.min(spec.max, wanted)) };
}

function noteFor(slot: Slot): string {
	if (slot.peak) return 'the peak: full stack, palette swapped, biggest look of the night';
	switch (slot.section) {
		case 'intro':
			return 'bed only, the room waking up';
		case 'groove':
			return 'the groove: bed and pulse, drums held back';
		case 'breakdown':
			return 'stripped back so the next lift has somewhere to come from';
		case 'build':
			return 'holding layers back so the drop has something to add';
		case 'void':
			return 'the light cuts with the bass; this is what makes the drop a release';
		case 'drop':
			return 'full stack on the downbeat';
		case 'outro':
			return 'letting the room go dark';
	}
}

/**
 * A build must run fewer layers than the drop it leads into. Lighting strips in parallel with
 * the music: a build reintroduces at the drop, it does not add before it.
 */
function stripBuilds(cues: Cue[]): void {
	for (let i = 0; i < cues.length - 1; i++) {
		if (cues[i].section !== 'build') continue;
		const drop = cues.slice(i + 1).find((c) => c.section === 'drop');
		if (!drop) continue;
		const dropLayers = countLayers(drop);
		while (countLayers(cues[i]) >= dropLayers) {
			// Strip from the top down: the drum layer is what the drop wants back most.
			const order: LayerRole[] = ['transient', 'accent', 'rhythm', 'master'];
			const victim = order.find((r) => cues[i].layers[r]);
			if (!victim) break;
			delete cues[i].layers[victim];
		}
	}
}

function countLayers(cue: Cue): number {
	return Object.values(cue.layers).filter(Boolean).length;
}

/**
 * Punctuation. The part that puts hands on the show.
 *
 * Every drop gets the same treatment the genre has used for thirty years: the room strobes
 * through the last bars of the build, cuts to black on the bar before, and slams back on the
 * downbeat. Doing it once and calling it restraint is how a show ends up boring - the move is
 * the vocabulary, not the surprise, and what makes the peak the peak is everything around it.
 */
function planHits(analysis: TrackAnalysis, slots: Slot[], rng: Rng): Hit[] {
	const hits: Hit[] = [];
	const beatsPerBar = analysis.tempo.beatsPerBar;
	const perBeat = strobeRate(analysis.tempo.bpm);

	for (const span of analysis.sections) {
		if (span.kind !== 'void') continue;
		hits.push({
			bar: span.startBar,
			kind: 'blackout',
			beats: Math.min(2, span.lengthBars) * beatsPerBar,
			note: 'cut with the bass'
		});
	}

	for (const slot of slots) {
		if (slot.section !== 'drop' || slot.index > 0) continue;

		hits.push({
			bar: slot.bar,
			kind: 'slam',
			beats: beatsPerBar,
			note: slot.peak ? 'the drop this whole track has been about' : 'the drop lands'
		});

		const before = slots.find((s) => s.endBar === slot.bar);
		if (!before || before.section === 'void') continue;

		// The strobe runs out of the build and stops dead on the downbeat, so the slam has a
		// silence to land in. Two bars on the peak, one elsewhere: the difference is what
		// tells an audience which of the three drops was the one.
		const want = slot.peak ? 2 : 1;
		const runFor = Math.min(want, before.endBar - before.bar - 1);
		if (perBeat > 0 && runFor > 0) {
			hits.push({
				bar: slot.bar - runFor,
				kind: 'strobe',
				beats: runFor * beatsPerBar,
				params: { perBeat },
				note: 'strobing out of the build'
			});
		}

		// No void of its own, so the cut is made here: half a bar of black immediately before.
		if (before.section === 'build' && before.endBar - before.bar >= 2) {
			hits.push({
				bar: slot.bar - 1,
				kind: 'blackout',
				beats: Math.max(1, Math.round(beatsPerBar / 2)),
				note: 'the held breath'
			});
		}
	}

	// Inside the loud passages, on the phrase. A drop that strobes once on its downbeat and
	// then runs eight bars of steady wash is the definition of a show going flat: the genre
	// punctuates all the way through, and the energy of the passage is what says how often.
	for (const slot of slots) {
		if (slot.section !== 'drop' && slot.section !== 'groove') continue;
		if (slot.bar < SETTLE_BARS) continue;
		if (slot.energy < 0.55) continue;
		// Energy is normalised within the track, so a ballad's loudest passage reads as high as
		// a techno drop's. Kick density is not: four to the floor is about one a beat and a
		// ballad is a quarter of that, which is the difference between a room that should be
		// strobing and one that should not.
		if (kickDensity(analysis, slot) < 0.6) continue;

		// Every phrase in a drop, every other phrase in a groove, and nothing at all where the
		// passage is not carrying the track.
		const every = slot.section === 'drop' ? PHRASE_BARS : PHRASE_BARS * 2;
		for (let bar = slot.bar + every; bar < slot.endBar; bar += every) {
			if (hits.some((h) => Math.abs(h.bar - bar) < 2)) continue;
			const heavy = slot.energy > 0.8 && rng.float() < 0.5;
			hits.push({
				bar: bar - 1,
				kind: 'strobe',
				beats: heavy ? beatsPerBar : Math.max(1, Math.round(beatsPerBar / 2)),
				params: { perBeat },
				note: 'punctuating the phrase'
			});
		}
	}

	return hits.sort((a, b) => a.bar - b.bar || a.kind.localeCompare(b.kind));
}

/** Kicks per beat over a slot: how hard the track is actually going, in absolute terms. */
function kickDensity(analysis: TrackAnalysis, slot: Slot): number {
	let kicks = 0;
	let bars = 0;
	for (let b = slot.bar; b < Math.min(slot.endBar, analysis.bars.length); b++) {
		kicks += analysis.bars[b].kicks;
		bars++;
	}
	return bars > 0 ? kicks / bars / Math.max(1, analysis.tempo.beatsPerBar) : 0;
}

/**
 * Flashes per beat. Four is a sixteenth-note strobe, which is what the genre actually does;
 * nothing here caps the rate, so this is about musical fit rather than safety.
 */
function strobeRate(bpm: number): number {
	if (bpm >= 150) return 2;
	return 4;
}

function writeBrief(analysis: TrackAnalysis, paletteName: string): string {
	const t = analysis.tempo;
	const drops = analysis.sections.filter((s) => s.kind === 'drop').length;
	const peak = analysis.sections.find((s) => s.energyRank === 1);
	const shape = analysis.sections.map((s) => s.kind).join(' > ');

	return [
		`${t.bpm} bpm in ${t.beatsPerBar}/4, ${analysis.key.name}, ${analysis.bars.length} bars.`,
		`Arrangement: ${shape}.`,
		`Palette "${paletteName}": one base hue with a complementary answer, no third colour to mud`,
		`the walls. Intensity follows the arrangement rather than the waveform, so the room sits`,
		`back through the ${drops > 0 ? 'grooves' : 'verses'} and has somewhere to go.`,
		peak
			? `Everything is held for bars ${peak.startBar}-${peak.endBar}, the loudest passage in the track: full stack, palette swapped, and the one look nothing else in the show is allowed to use.`
			: 'No single passage dominates, so the show keeps an even hand throughout.',
		'Generated without a model, so it is a starting point rather than an interpretation.'
	].join(' ');
}

function seedFrom(hash: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < hash.length; i++) {
		h ^= hash.charCodeAt(i);
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return h >>> 0 || 1;
}
