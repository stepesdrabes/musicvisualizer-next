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
	TrackAnalysis,
	TrackContext
} from '@mv/core';
import {
	BUILT_IN_EFFECTS,
	HIT_RULES,
	PHRASE_BARS,
	SHOW_VERSION,
	Rng,
	hitSeconds,
	sectionBase
} from '@mv/core';
import { allowedFlashes, profileFor, type GenreProfile } from './genre.ts';
import { choosePalette, lerpHue } from './palette.ts';
import { EffectPicker } from './select.ts';

export interface EngineOptions {
	/** Built-ins by default; pass a superset to let generated effects be chosen too. */
	effects?: readonly EffectDef[];
	/** Overrides the seed taken from the analysis hash. */
	seed?: number;
	/** Dominant hue of the cover art, degrees. The room takes the record's own colour. */
	artHue?: number | null;
	/** What the track is. Decides the genre profile; absent falls back to the default row. */
	context?: TrackContext | null;
}

/**
 * No cue holds the room longer than this before something has to change.
 *
 * Two phrases, not four. At sixteen a long groove held one look for a minute at 120 bpm, which
 * is most of the reason a show that reaches for half the catalog still feels like it reaches
 * for none of it: the variety was there and the room never got to it.
 */
const MAX_CUE_BARS = 8;
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
	/** True when this section is the LAST appearance of its material: the final chorus. */
	finalOfGroup: boolean;
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
	const seed = opts.seed ?? seedFrom(analysis.hash);
	const rng = new Rng(seed);
	const profile = profileFor(opts.context);
	// The allowance governs the effects as well as the hits: a family that has earned no
	// flashes does not get blinder slams by the accent door instead.
	const flashes = allowedFlashes(analysis, opts.context);
	// vocalGlow answers "the voice", which post-revert means the mid band: on a track with
	// no singing that is a glow named after something absent. The vocal column is nonzero
	// only where synced lyrics put words, which makes it the honest gate.
	const sung = analysis.bars.some((b) => (b.vocal ?? 0) > 0.05);
	const picker = new EffectPicker(
		sung ? effects : effects.filter((e) => e.id !== 'vocalGlow'),
		rng,
		{ vetoCharacter: flashes === 0 }
	);
	const palette = choosePalette(analysis, rng, opts.artHue, profile);

	const peakSpan = analysis.sections.find((s) => s.energyRank === 1) ?? null;

	// Reserved before anything else is chosen, so it cannot be spent on an ordinary drop
	// earlier in the track. The biggest thing in the catalog is worth more as the one moment
	// nobody saw coming. A swell genre spends nothing here: its peak is a rise, not a hit.
	const peakMaster =
		profile.peak !== 'swell' && peakSpan && peakSpan.startBar >= SETTLE_BARS
			? picker.strongest('master', peakSpan.kind, 1, profile.peak)
			: null;
	if (peakMaster) picker.reserve(peakMaster.id);

	// A master effect is a moment, not a look: they are written to hold the room for a bar or
	// two and the linter says so. The peak therefore gets a short cue carrying the burst and a
	// second one right behind it for the rest of the section, which is how a desk would run it.
	// A swell peak carries no burst at all: rnb and ballads bloom into their biggest passage.
	const slots = buildSlots(analysis, profile.peak === 'swell' ? 0 : (peakMaster?.taste.maxBars ?? 0));

	// A squashed master has almost no per-bar level left to read, so the arrangement has to
	// supply the dynamics the waveform no longer does. Under about 8 LU of peak-to-loudness the
	// track is limited hard enough that its own energy curve is nearly flat.
	const spread = analysis.peakToLoudness > 0 ? clamp01((10 - analysis.peakToLoudness) / 6) : 0;

	const cues: Cue[] = [];
	let grooveIndex = 0;
	let peakCue = -1;

	for (const slot of slots) {
		const layers: Partial<Record<LayerRole, LayerSpec>> = {};
		const add = (role: LayerRole, def: EffectDef | null) => {
			if (!def) return;
			const params = paramsFor(def, slot, analysis);
			layers[role] = params ? { effect: def.id, params } : { effect: def.id };
		};

		const length = slot.endBar - slot.bar;
		// The bed a repeat shares is the one its FIRST cue opened with; interior cues pick freely,
		// or a long section would hold one look for its whole length again by another route.
		const bedEnergy = Math.min(slot.energy, 0.75);
		// A quiet section is a bed and one texture, so the bed genuinely is the room.
		// The quiet three. Every layer in one of these has to be able to hold a room on its own,
		// because there are only two of them and nothing else is running: a breakdown was drawing
		// from the same accent pool as a drop, which is how a passage with the drums taken out
		// ended up lit by stage blinders.
		const bare =
			slot.section === 'intro' || slot.section === 'outro' || slot.section === 'breakdown';
		// The peak section's floor has to hold the room too: its other layers are the
		// spikiest things in the catalog, and a sub-driven bed under them measured 18% of
		// the room lit on the biggest bars of the night.
		const carrier = bare || slot.span === peakSpan;
		add('bed', picker.pick({ role: 'bed', section: slot.section, lengthBars: length, energy: bedEnergy, mustCarry: carrier, bare, group: slot.index === 0 ? slot.span.group : undefined, prefer: profile.signatures }));
		switch (sectionBase(slot.section)) {
			case 'void':
				break;

			case 'intro':
			case 'outro':
				// One texture over the bed, as a breakdown gets, and it has to be one that carries.
				// A bed is written to sit UNDER something, so a cue whose other layer contributes
				// nothing asks the dimmest thing in the system to hold the room alone.
				//
				// This used to be unfiltered, because requiring it once left most of these cues
				// with no accent at all: only a single accent in the catalog qualified. There are
				// now enough that the rule can be what it should always have been.
				add('accent', picker.pick({ role: 'accent', section: slot.section, lengthBars: length, energy: slot.energy, mustCarry: true, bare, prefer: profile.signatures }));
				break;

			case 'breakdown':
				// A texture on top of the bed, always. This used to be a coin toss, on the grounds
				// that a breakdown which keeps everything running is not a breakdown - but what it
				// actually produced was a passage lit by one slow bed and nothing else, half the
				// time. Taking the drums out is what makes a breakdown; taking the light out makes
				// it look broken.
				add('accent', picker.pick({ role: 'accent', section: slot.section, lengthBars: length, energy: slot.energy, mustCarry: true, bare, prefer: profile.signatures }));
				// The kit, where the passage still has one. A breakdown with a beat under it is
				// common in this repertoire and the room should be answering it; a genuinely
				// stripped one has no onsets to answer and gets nothing, which is the difference
				// the coin toss was reaching for and could not see.
				if (profile.transientEvery > 0 && kickDensity(analysis, slot) > 0.25) {
					add('transient', picker.pick({ role: 'transient', section: slot.section, lengthBars: length, energy: slot.energy, prefer: profile.signatures }));
				}
				break;

			case 'build':
				add('rhythm', picker.pick({ role: 'rhythm', section: slot.section, lengthBars: length, energy: slot.energy, prefer: profile.signatures }));
				// A build is the one place an accent belongs before the drop rather than in it, and
				// without one the two effects written for exactly this moment were unreachable.
				add('accent', picker.pick({ role: 'accent', section: slot.section, lengthBars: length, energy: slot.energy, prefer: profile.signatures }));
				break;

			case 'groove':
				add('rhythm', picker.pick({ role: 'rhythm', section: slot.section, lengthBars: length, energy: slot.energy, prefer: profile.signatures }));
				// The drum layer runs at the genre's cadence, never in every cue. Firing a light
				// at every hit is the documented failure of audio-to-light mapping: it reads as
				// mechanical however well timed it is, and leaving it out is what makes it land
				// on return. A ballad leaves it out entirely; punk and funk barely rest it.
				if (profile.transientEvery > 0 && grooveIndex % profile.transientEvery === profile.transientEvery - 1) {
					add('transient', picker.pick({ role: 'transient', section: slot.section, lengthBars: length, energy: slot.energy, prefer: profile.signatures }));
				}
				grooveIndex++;
				break;

			case 'drop':
				// The rhythm layer shares the group's identity the way the bed does: a second
				// chorus whose VISIBLE layers look nothing like the first says the room is not
				// listening, and without the group the novelty penalty actively pushes the
				// repeat away from what the first one used.
				add('rhythm', picker.pick({ role: 'rhythm', section: slot.section, lengthBars: length, energy: slot.energy, group: slot.index === 0 ? slot.span.group : undefined, prefer: profile.signatures }));
				if (profile.transientEvery > 0) {
					add('transient', picker.pick({ role: 'transient', section: slot.section, lengthBars: length, energy: slot.energy, prefer: profile.signatures }));
				}
				// The first appearance of material that returns holds its accent back, so the
				// return ADDS something: escalation by vocabulary rather than by brightness,
				// which prompt.ts warns is the cliche. The peak section and material that never
				// returns get the full stack from the start.
				if (!(slot.dropIndex === 0 && !slot.finalOfGroup && slot.span !== peakSpan)) {
					add('accent', picker.pick({ role: 'accent', section: slot.section, lengthBars: length, energy: slot.energy, prefer: profile.signatures }));
				}
				break;
		}

		if (slot.peak && peakMaster) {
			layers.master = { effect: peakMaster.id };
			peakCue = cues.length;
		}

		const intensity = intensityFor(slot, spread, profile);
		cues.push({
			bar: slot.bar,
			section: slot.section,
			layers,
			palette: paletteFor(slot, palette, intensity),
			intensity,
			motion: motionFor(slot, profile),
			fadeBeats: fadeFor(slot, profile),
			note: noteFor(slot)
		});
	}

	carryThePeak(cues, peakCue);
	stripBuilds(cues);
	shapeApproaches(cues, profile);
	plantWildcard(cues, slots, picker);

	return {
		version: SHOW_VERSION,
		trackId: analysis.trackId,
		title: analysis.title,
		analysisHash: analysis.hash,
		brief: writeBrief(analysis, palette.name ?? 'unnamed', opts.context),
		authoredBy: 'engine',
		seed,
		palette,
		defaults: { intensity: 0.7, motion: 1, fadeBeats: 2 },
		generatedEffects: [],
		cues,
		hits: planHits(analysis, slots, profile, flashes)
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

	// The final appearance of each material, so the last chorus can outrank its siblings.
	const lastOfGroup = new Map<number, number>();
	for (const s of analysis.sections) {
		if (s.group >= 0) lastOfGroup.set(s.group, s.index);
	}

	for (const span of analysis.sections) {
		const energy = span.meanEnergy / 100;
		const isPeak = span.index === peakIndex;
		const dropIndex = sectionBase(span.kind) === 'drop' ? dropCount++ : -1;
		const first = slots.length;
		let bar = span.startBar;
		let index = 0;

		while (bar < span.endBar) {
			const remaining = span.endBar - bar;
			// The peak's opening cue is only as long as the burst it carries, so a master effect
			// written to hold the room for a bar is never asked to hold it for eight.
			// Interior changes land on the phrase grid counted FROM THE SECTION'S OWN START:
			// that is the grid the audience counts on, and on a track whose phase shifts
			// mid-song it is the only phrase grid that exists at all.
			const burst = isPeak && index === 0 && peakMasterBars > 0;
			let take = burst
				? Math.min(peakMasterBars, remaining)
				: // Leaving a stub shorter than a phrase behind is worse than one long cue.
					remaining > MAX_CUE_BARS + PHRASE_BARS
					? MAX_CUE_BARS
					: remaining;
			// The burst cue is deliberately shorter than a phrase and must not be re-rounded;
			// everything after it re-lands on the section's own grid.
			if (take < remaining && !burst) {
				const into = bar + take - span.startBar;
				const landed = span.startBar + Math.round(into / PHRASE_BARS) * PHRASE_BARS;
				if (landed > bar && landed < span.endBar) take = landed - bar;
			}

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
				dropIndex,
				finalOfGroup: span.group >= 0 && lastOfGroup.get(span.group) === span.index
			});
			bar += take;
			index++;
		}

		for (let i = first; i < slots.length; i++) slots[i].of = index;
	}

	return slots;
}

function clamp01(v: number): number {
	return v < 0 ? 0 : v > 1 ? 1 : v;
}


/**
 * `spread` widens the gap between the quiet sections and the loud ones, for a master with none
 * of its own left. It only ever pushes the quiet end down: the loud end is already at the top
 * of the range and the peak owns 1.0.
 *
 * Deliberately NOT corrected for how thin the stack is, though it was tried. Compensating a
 * one-layer cue back up to what a four-layer cue delivers takes the drop-to-quiet ratio from
 * 8.5x to 2.8x, which is the same contrast collapse the auto-exposure fix existed to undo. The
 * intro was black because two beds emitted a twentieth of what their peers did and the cue had
 * nothing else in it, and both of those are fixed where they were: in the effects, and in the
 * plan.
 */
function intensityFor(slot: Slot, spread = 0, profile?: GenreProfile): number {
	const base: Record<SectionKind, number> = {
		intro: 0.46,
		groove: 0.68,
		verse: 0.64,
		// Not 0.42, for the reason the outro is not 0.32: gamma 2.2 leaves very little room
		// under byte 10 to say anything in, and movement is delivered in bytes, so a passage
		// held down there cannot react however reactive its layers are. A breakdown also sits
		// mid-track with the room already warm, so it has less to prove than the intro does.
		breakdown: 0.54,
		build: 0.62,
		void: 0.05,
		drop: 0.9,
		// A chorus is as loud as a drop and arrives by lift; the last one gets the extra step.
		chorus: 0.86,
		// Not 0.32. "Letting the room go dark" is not the same instruction as "off", and gamma
		// 2.2 leaves very little room below byte 10 to say the difference in.
		outro: 0.5
	};
	// The peak is the only cue allowed the top of the range, because the linter checks that the
	// brightest thing in the show happens in the biggest moment of the track.
	if (slot.peak) return 1;
	let floor = base[slot.section] * (1 - spread * 0.35);
	// The families that sit in near-black between their loud passages get the darkness the
	// genre expects; everyone else keeps a lit room playing quietly.
	if (profile?.darkBreakdowns && slot.section === 'breakdown') floor = Math.min(floor, 0.42);
	// A build that sits at one level is not a build. Climbing across its cues is what makes the
	// drop feel arrived at rather than merely loud.
	const climb = slot.section === 'build' && slot.of > 1 ? (slot.index / (slot.of - 1)) * 0.16 : 0;
	// The final chorus outranks its siblings: everything the room has, short of the peak's 1.0.
	const finale = slot.section === 'chorus' && slot.finalOfGroup ? 0.05 : 0;
	return Math.min(0.92, floor + slot.energy * 0.08 + climb + finale);
}

/**
 * How fast a cue's effects are allowed to move, which every effect multiplies its own speeds by.
 *
 * The quiet three are far below where they were. A passage with nothing happening in it should
 * look like the room holding its position, drifting over tens of seconds; at 0.6 an intro was
 * still moving fast enough to read as restless, and the light was answering noise in the
 * spectrum rather than anything in the music. The loud sections are untouched.
 */
function motionFor(slot: Slot, profile?: GenreProfile): number {
	const base: Record<SectionKind, number> = {
		intro: 0.28,
		groove: 1,
		verse: 0.9,
		// Not 0.34. Motion scales every speed an effect declares, so a third of it turned the one
		// layer a breakdown had into a still picture. A breakdown is quieter than a groove, not
		// slower than one: what comes out is the arrangement, not the clock.
		breakdown: 0.7,
		build: 1.15,
		void: 0.4,
		drop: 1.25,
		// A chorus moves like an anthem, not like an impact: full, not frantic.
		chorus: 1.1,
		outro: 0.24
	};
	const climb = slot.section === 'build' && slot.of > 1 ? (slot.index / (slot.of - 1)) * 0.2 : 0;
	// An outro that is still the whole band playing is not a fade, and an intro that opens on the
	// full arrangement is not a hush. These two carry the lowest motion in the table because they
	// usually deserve it; where the passage is as loud as the track gets, that assumption throttles
	// every speed its layers declare and lights a live room at a quarter speed. Energy is
	// normalised within the track, so a genuinely quiet one is untouched.
	const bookend = slot.section === 'intro' || slot.section === 'outro';
	const lively = bookend ? (0.85 - base[slot.section]) * slot.energy : 0;
	// The genre's clock. Scaled before rounding, and the quiet floor stands: a ballad's 0.5
	// on an already-slow outro is a room that has stopped, which is what a ballad's end is.
	const scale = profile?.motionScale ?? 1;
	return Math.round(Math.max(0.15, base[slot.section] + climb + lively) * scale * 100) / 100;
}

/**
 * A drop and a void arrive on the downbeat; everything else can afford to be eased into. How
 * long depends on what came before: a breakdown after a drop is a collapse and wants two
 * beats, the same breakdown after a groove is a settling and wants eight.
 */
function fadeFor(slot: Slot, profile?: GenreProfile): number {
	// A swell family's biggest arrival is a rise, not a step - the planner reserves no master
	// and plans no hits for it, so this ramp IS the arrival. Two bars of fade complete on the
	// cue's own downbeat: the room lifts through the end of the verse and peaks exactly where
	// the chorus lands, which is what a designer's swell is.
	if (profile?.peak === 'swell' && sectionBase(slot.section) === 'drop' && slot.index === 0) {
		return 8;
	}
	if (slot.section === 'drop' || slot.section === 'void') return 0;
	// A chorus arrives ON its downbeat and still blooms rather than detonating: one beat of
	// fade is the difference between a lift and a cut, and it is over before anyone sees it
	// as a fade.
	if (slot.section === 'chorus') return slot.index > 0 ? 4 : 1;
	// Inside a section nothing has changed but the look, so the change should be barely felt.
	if (slot.index > 0) return 4;
	if (slot.section === 'intro' || slot.section === 'outro') return 8;
	if (slot.from === 'drop' || slot.from === 'chorus') return 2;
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
function paletteFor(slot: Slot, show: ShowPalette, intensity = 0.7): CuePalette | undefined {
	const sat = show.sat ?? 0.94;
	const shade = show.shade ?? 0.14;
	const { base, accent } = show;
	const third = show.third ?? accent;
	// The Hunt effect: perceived colorfulness falls with luminance, so a dim cue rendered at
	// reduced saturation reads grey rather than hushed. The quiet sections therefore get MORE
	// chroma as the intensity drops, never less - stage practice's saturated "night", not a
	// pale one - and the hush stays where it belongs, in shade, white and the intensity itself.
	const hunt = Math.min(1, sat * (1 + 0.35 * (1 - intensity)));

	switch (slot.section) {
		case 'drop':
			// The first drop inverts, which is the loudest thing colour can do without leaving
			// the identity. A later one promotes the third hue instead, so it tops the first
			// rather than repeating it.
			return slot.dropIndex % 2 === 0
				? 'swap'
				: { base: third, accent: base, third: accent, sat: Math.min(1, sat * 1.05), shade };

		case 'chorus':
			// A chorus owns the song's signature colour: the base stays put all song and the
			// room simply blooms in it - saturation up, whites up, no inversion. The FINAL
			// chorus is the one allowed the drop's inversion, which is how it outranks every
			// earlier one without being a byte brighter.
			return slot.finalOfGroup
				? 'swap'
				: { base, accent, third, sat: Math.min(1, sat * 1.06), shade: shade * 0.85, white: 0.14 };

		case 'intro':
		case 'outro':
			return { base, accent, third, sat: hunt, shade: shade * 0.7, white: 0.3 };

		case 'breakdown':
			// A breakdown is somewhere else. Turning the room to the third hue is the cheapest
			// way to say so, and it costs no hue the show has not already declared.
			return { base: third, accent: base, third: accent, sat: hunt, shade: shade * 1.5, white: 0.25 };

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
			return 'the room waking up, bed and one texture';
		case 'groove':
			return 'the groove: bed and pulse, drums held back';
		case 'verse':
			return 'the verse sits back so the chorus has somewhere to go';
		case 'breakdown':
			return 'stripped back so the next lift has somewhere to come from';
		case 'build':
			return 'holding layers back so the drop has something to add';
		case 'void':
			return 'the light cuts with the bass; this is what makes the drop a release';
		case 'drop':
			return 'full stack on the downbeat';
		case 'chorus':
			return slot.finalOfGroup
				? 'the last chorus: colours invert, everything the song has been saving'
				: 'the chorus blooms in the signature colour';
		case 'outro':
			return 'letting the room go dark';
	}
}

/**
 * The peak's burst rides on the peak's look rather than replacing it with a one-bar one.
 *
 * That opening cue is only as long as the master effect holds the room, which is a bar. Almost
 * nothing in the catalog is legal in a bar - no rhythm effect at all - so picking layers for it
 * drew from a pool of one or none, and the biggest moment of the show came out as a bed that
 * emits nothing, no kit, and whatever single accent happened to be short enough. Deterministic,
 * so it happened in every show.
 *
 * A burst is a moment on top of a look, not a look. Taking the one the section goes on to hold
 * means the room does not drop out underneath the hit, and the master is still the only thing
 * that changes when it lands.
 */
function carryThePeak(cues: Cue[], at: number): void {
	if (at < 0) return;
	const burst = cues[at];
	const next = cues[at + 1];
	// Only from the same section. If the peak is one cue long there is nothing to inherit and
	// its own picks, degenerate or not, are all there is.
	if (!burst || !next || next.section !== burst.section) return;
	const master = burst.layers.master;
	burst.layers = { ...next.layers };
	if (master) burst.layers.master = master;
}

/**
 * A build must run fewer layers than the drop it leads into. Lighting strips in parallel with
 * the music: a build reintroduces at the drop, it does not add before it.
 */
function stripBuilds(cues: Cue[]): void {
	for (let i = 0; i < cues.length - 1; i++) {
		if (cues[i].section !== 'build') continue;
		const drop = cues.slice(i + 1).find((c) => sectionBase(c.section) === 'drop');
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
 * The bar before a drop-class arrival dips instead of peaking.
 *
 * "Darkest immediately before brightest" is the most reliable contrast gesture a designer
 * has, and until now it existed only as the held-breath blackout: budget-gated, build-only,
 * so a verse running straight into a chorus never got any approach shaping at all. This is
 * the free version - a one-bar cue inside the preceding section, same bed so the layer run
 * survives, everything above it removed, the level pulled down - and the drop's own snap
 * cut (fadeBeats 0) then fires out of a hollow instead of out of the loudest bar so far.
 *
 * Builds keep their climb: the held breath is theirs when the budget allows, and dipping a
 * ramp that exists to rise reads as a stumble. Swell families are shaped the other way, by
 * the two-bar fade in `fadeFor`.
 */
function shapeApproaches(cues: Cue[], profile: GenreProfile): void {
	if (profile.peak === 'swell') return;
	for (let i = cues.length - 1; i >= 1; i--) {
		const opener = cues[i];
		const prev = cues[i - 1];
		if (sectionBase(opener.section) !== 'drop') continue;
		if (prev.section === opener.section) continue;
		if (prev.section === 'build' || prev.section === 'void') continue;
		if (opener.bar < SETTLE_BARS) continue;
		// A short predecessor has no room to give a bar away.
		if (opener.bar - prev.bar < 3) continue;
		if (!prev.layers.bed) continue;
		cues.splice(i, 0, {
			bar: opener.bar - 1,
			section: prev.section,
			layers: { bed: prev.layers.bed },
			palette: prev.palette,
			intensity: (prev.intensity ?? 0.7) * 0.6,
			motion: prev.motion,
			fadeBeats: 4,
			note: 'the breath before it lands'
		});
	}
}

/**
 * One look per track that belongs to no section, planted midway through the longest steady
 * passage.
 *
 * Judged against human designers, the axis rule-built shows lose worst on is surprise - the
 * fiftieth listen knows every move before it lands. A single stranger, once, is the smallest
 * honest answer: the seed keeps it the same stranger every time, the accent slot keeps it
 * opacity-bounded, and planting it mid-passage keeps it away from every structural moment
 * the show is already spending real cards on.
 */
function plantWildcard(cues: Cue[], slots: Slot[], picker: EffectPicker): void {
	const steady = slots.filter(
		(s) => sectionBase(s.section) === 'groove' && s.of >= 3 && !s.peak && s.index > 0
	);
	if (steady.length === 0) return;

	let host = steady[0];
	for (const s of steady) {
		if (s.span.lengthBars > host.span.lengthBars) host = s;
		else if (s.span.lengthBars === host.span.lengthBars && s.index === Math.floor(s.of / 2)) host = s;
	}

	const def = picker.pick({
		role: 'accent',
		section: host.section,
		lengthBars: host.endBar - host.bar,
		energy: host.energy,
		anySection: true
	});
	if (!def) return;
	const cue = cues.find((c) => c.bar === host.bar);
	if (!cue) return;
	cue.layers.accent = { effect: def.id };
	cue.note = `${cue.note}; one stranger, once`;
}

/**
 * Punctuation. The part that puts hands on the show.
 *
 * Every drop slams on its downbeat, and the phrases inside the loud passages are answered with
 * colour. What happens at most once is the flash: one strobe or one blackout in the whole show,
 * never both and never twice.
 *
 * That is a correction rather than a preference. This used to strobe out of every build, cut to
 * black before every drop and strobe again on alternate phrases inside them, on the grounds that
 * the move is the vocabulary rather than the surprise. On a four-minute rock track it produced
 * five strobes and two blackouts, and past the second one the room has said the only thing a
 * flash says. Spent once, on the biggest moment that can hold it, it is the loudest thing in the
 * show again.
 */
function planHits(
	analysis: TrackAnalysis,
	slots: Slot[],
	profile: GenreProfile,
	allowance: number
): Hit[] {
	const hits: Hit[] = [];
	const { tempo } = analysis;
	const beatsPerBar = tempo.beatsPerBar;
	const perBeat = strobeRate(tempo.bpm);

	// Every gesture below is counted in whole bars, so each one starts on a downbeat and ends on
	// one. Anything shorter came back mid-bar, and a room that comes back mid-bar has answered
	// nothing: the phrase it was pointing at has not arrived yet.
	const bars = (n: number) => n * beatsPerBar;
	// Two bars of clearance either side, so gestures read as separate events rather than one
	// smear, and so nothing is planned where a bigger card will mask it.
	const clear = (from: number, to: number) =>
		!hits.some((h) => from - 2 < h.bar + h.beats / beatsPerBar && h.bar < to + 2);
	// A strobe is lit for exactly as long as it is held, so its length is capped in seconds as
	// well as in bars. Whole bars only, and none at all where one bar already runs too long:
	// a tempo that cannot fit a bar of strobe inside the cap should not be strobing.
	// Measured over the span the hit will OCCUPY, using the same function the linter checks it
	// with. Sizing it against one bar and placing it at another is how a show came back failing
	// its own linter on a track whose tempo drifts by a per cent, and a rejected show is a dark
	// room rather than a slightly long strobe.
	const strobeBars = (endBar: number, want: number) => {
		const cap = HIT_RULES.strobe.maxSeconds ?? Infinity;
		let bars = Math.min(want, HIT_RULES.strobe.maxBars);
		while (bars > 0 && hitSeconds(tempo, endBar - bars, 0, bars * beatsPerBar) > cap) bars--;
		return bars;
	};
	// Black is counted in beats rather than bars, because a bar of it is four beats and at the
	// tempos this repertoire sits at that is three seconds of nothing. Whole beats still, so it
	// lands on the grid, and never more than the rule allows in either unit.
	const blackBeats = (atBar: number, wantBars: number) => {
		const cap = HIT_RULES.blackout.maxSeconds ?? Infinity;
		let beats = Math.min(HIT_RULES.blackout.maxBars, wantBars) * beatsPerBar;
		while (beats > 1 && hitSeconds(tempo, atBar, 0, beats) > cap) beats--;
		return Math.max(1, beats);
	};
	/** Placed so it finishes exactly on `endBar`'s downbeat, however few beats long it is. */
	const endingAt = (endBar: number, beats: number): { bar: number; beat?: number } => {
		const barsBack = Math.ceil(beats / beatsPerBar);
		const bar = endBar - barsBack;
		const beat = barsBack * beatsPerBar - beats;
		return beat > 0 ? { bar, beat } : { bar };
	};
	/**
	 * Strobes and blackouts share one allowance for the whole show, scaled by genre and by
	 * how hard the track actually goes: a techno night earns several, a ballad none.
	 *
	 * Counted together because they are the same gesture from the audience's side: the room
	 * stops being a room and becomes an event. Whatever the budget, each one still needs a
	 * moment big enough to hold it - the allowance is a ceiling, never a quota.
	 */
	let flashes = 0;
	const spendFlash = (hit: Hit): boolean => {
		if (flashes >= allowance) return false;
		flashes++;
		hits.push(hit);
		return true;
	};

	// Every drop-class arrival gets its downbeat marked - with what depends on the genre.
	// A slam is an impact; a bump is the bloom genres mark a chorus with; a swell genre
	// lets the cue's own rise carry it and plans nothing at all.
	const dropOpeners = slots.filter((s) => sectionBase(s.section) === 'drop' && s.index === 0);
	for (const slot of dropOpeners) {
		const anthem = slot.section === 'chorus' && profile.peak !== 'slam';
		if (profile.peak === 'swell') continue;
		hits.push({
			bar: slot.bar,
			kind: anthem ? 'bump' : 'slam',
			beats: bars(1),
			note: slot.peak
				? 'the moment this whole track has been about'
				: anthem
					? 'the chorus arrives'
					: 'the drop lands'
		});
	}

	// The peak first, then by how loud the passage is, so the flashes land on the biggest
	// moments that can hold them rather than on whichever drop happens to come first.
	// Ordering by bar instead put it on the opening drop of a track whose third one was
	// the point.
	const byImportance = [...dropOpeners].sort(
		(a, b) => Number(b.peak) - Number(a.peak) || a.span.energyRank - b.span.energyRank || a.bar - b.bar
	);
	for (const slot of byImportance) {
		if (flashes >= allowance) break;
		if (slot.bar < SETTLE_BARS) continue;
		const before = slots.find((s) => s.endBar === slot.bar);
		// A drop arriving out of a void is already the silence-then-slam figure and does not need
		// a card spent on saying so again.
		if (!before || before.section === 'void') continue;

		// Strobe first, because it is the bigger of the two - except where the genre marks its
		// peaks with light rather than with flash, where a strobe into a chorus is a rig
		// malfunction however well placed. Those families keep the held-breath blackout only.
		const room = before.endBar - before.bar - 1;
		const runFor = strobeBars(slot.bar, Math.min(slot.peak ? 2 : 1, room));
		if (perBeat > 0 && runFor > 0 && profile.peak === 'slam') {
			spendFlash({
				bar: slot.bar - runFor,
				kind: 'strobe',
				beats: bars(runFor),
				params: { perBeat },
				note: slot.peak ? 'strobing into the one that matters' : 'strobing out of the build'
			});
			continue;
		}

		// The held breath: black ending exactly ON the drop downbeat, and only as many beats of
		// it as read as a breath rather than as a fault. The fallback rather than the partner -
		// at a tempo too slow to strobe inside the cap, silence is the gesture still available -
		// and it wants a build behind it, because holding a breath needs something to hold it
		// out of.
		if (before.section !== 'build' || before.endBar - before.bar < 2) continue;
		const heldBeats = blackBeats(slot.bar - 1, 1);
		if (heldBeats > 0) {
			spendFlash({ ...endingAt(slot.bar, heldBeats), kind: 'blackout', beats: heldBeats, note: 'the held breath' });
		}
	}

	// A void that never got the allowance still goes dark: the void CUE carries intensity 0.05
	// and a house floor of zero, so the room is already black there without a hit saying so.
	// This is only worth spending on where nothing bigger wanted it.
	if (flashes < allowance && allowance > 0) {
		const hush = analysis.sections.find((s) => s.kind === 'void');
		if (hush) {
			spendFlash({
				bar: hush.startBar,
				kind: 'blackout',
				beats: blackBeats(hush.startBar, hush.lengthBars),
				note: 'cut with the bass'
			});
		}
	}

	// Inside the loud passages, on the phrase. A drop that slams once on its downbeat and then
	// runs eight bars of steady wash is the definition of a show going flat: the genre
	// punctuates all the way through, and the genre also says how often - a techno floor is
	// answered every phrase, a ballad never.
	//
	// Colour only. This used to alternate a flood with a strobe, which is where most of a show's
	// strobes came from: three or four of them inside the drops, none of which was the one the
	// build had been pointing at. A flood is the same size of gesture reached without spending
	// the card the whole show is saving.
	let phraseIndex = 0;
	for (const slot of slots) {
		if (profile.bumpEvery === 0) break;
		const kind = sectionBase(slot.section);
		if (kind !== 'drop' && kind !== 'groove') continue;
		if (slot.bar < SETTLE_BARS) continue;
		if (slot.energy < 0.55) continue;
		// Energy is normalised within the track, so a ballad's loudest passage reads as high as
		// a techno drop's. Kick density is not: four to the floor is about one a beat and a
		// ballad is a quarter of that, which is the difference between a room that should be
		// strobing and one that should not.
		if (kickDensity(analysis, slot) < 0.6) continue;

		// Denser in the loud sections, on the phrase grid counted from the section's own
		// start - the grid the audience is counting on.
		const every = PHRASE_BARS * profile.bumpEvery * (kind === 'drop' ? 1 : 2);
		const origin = slot.span.startBar;
		for (
			let bar = origin + Math.ceil(Math.max(1, slot.bar + every - 1 - origin) / every) * every;
			bar < slot.endBar;
			bar += every
		) {
			// Every other phrase, so the passage is punctuated without the answer becoming the
			// thing that is expected. The skipped one is what makes the next one land.
			if (phraseIndex++ % 2 === 0) continue;
			if (clear(bar, bar + 1)) {
				hits.push({ bar, kind: 'bump', beats: bars(1), note: 'colour flood on the phrase' });
			}
		}
	}

	// A cymbal crash is a hit the arrangement already contains, and the analyser has been
	// tagging them all along with nothing reading the tag. Outside a drop downbeat, which has a
	// slam of its own, one is worth a bump: it is the one moment the room can answer something
	// the track did rather than something the grid predicted.
	const dropStarts = new Set(
		analysis.sections.filter((s) => sectionBase(s.kind) === 'drop').map((s) => s.startBar)
	);
	for (const row of analysis.bars) {
		// A swell genre marks nothing with hits, crashes included: the family already said
		// its arrivals rise rather than strike.
		if (profile.peak === 'swell') break;
		if (!row.events.includes('crash') || dropStarts.has(row.bar)) continue;
		if (row.bar < SETTLE_BARS) continue;
		// Last in, so the bigger cards are already placed: a crash landing under a slam or a
		// blackout is answered by those, and planning a hit that can never fire is a lie about
		// what the show does.
		if (!clear(row.bar, row.bar + 1)) continue;
		hits.push({ bar: row.bar, kind: 'bump', beats: bars(1), note: 'answering the crash' });
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

function writeBrief(
	analysis: TrackAnalysis,
	paletteName: string,
	context?: TrackContext | null
): string {
	const t = analysis.tempo;
	const quiet = analysis.sections.some((s) => s.kind === 'verse') ? 'verses' : 'grooves';
	const peak = analysis.sections.find((s) => s.energyRank === 1);
	const shape = analysis.sections.map((s) => s.kind).join(' > ');
	const who =
		context?.artist && context.title ? `${context.artist} - ${context.title}. ` : '';
	const family = context?.genreFamily ? ` Lit as ${context.genreFamily}.` : '';

	return [
		`${who}${t.bpm} bpm in ${t.beatsPerBar}/4, ${analysis.key.name}, ${analysis.bars.length} bars.${family}`,
		`Arrangement: ${shape}.`,
		`Palette "${paletteName}": one base hue with a complementary answer, no third colour to mud`,
		`the walls. Intensity follows the arrangement rather than the waveform, so the room sits`,
		`back through the ${quiet} and has somewhere to go.`,
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
