import type { EffectDef, LayerRole, SectionKind } from '@mv/core';
import { Rng } from '@mv/core';

export interface PickRequest {
	role: LayerRole;
	section: SectionKind;
	lengthBars: number;
	/** 0..1. Decides which energy band of the catalog is in range. */
	energy: number;
	/** Allow an effect its author reserved for one moment per show. */
	allowPeakReserved?: boolean;
	/** This layer has to hold the room by itself, so anything that cannot is ineligible. */
	mustCarry?: boolean;
	/**
	 * True where there is nothing else happening, so what the layer shows of the music is most of
	 * what the room shows at all.
	 */
	bare?: boolean;
	/**
	 * Repeat identity of the passage being lit, from `SectionSpan.group`.
	 *
	 * A second chorus that looks nothing like the first says the room is not listening. Given
	 * one, the same effect that opened the group is returned, which is what makes a show read
	 * as having a structure rather than a sequence.
	 */
	group?: number;
}

/**
 * Chooses effects so the show does not repeat itself.
 *
 * The taste metadata on each effect is a hard filter, not a preference: it already says which
 * sections an effect belongs in and how long it can hold the room, and the linter rejects a
 * show that ignores it. What is left to decide is which of the survivors, and that is where a
 * show gets its character - so the score is mostly about what has not been used yet.
 */
/**
 * How hard a quiet cue leans toward the layers that actually show the music.
 *
 * A preference, never a filter. The carrying pool for a quiet section is seven beds and three
 * accents, and a threshold on top of that empties it - which is the mistake this project already
 * made once by requiring `carries` of an accent. Weighting instead keeps every option reachable
 * and simply makes the spectrum-led ones win the coin tosses.
 *
 * Measured on a real intro: the pair the picker chose delivered 1.27 bytes of movement where the
 * two most spectrum-led candidates in the same pool delivered 2.24, across 2.7x the spatial
 * spread. Scaled against 3 bytes of `taste.quiet` and weighted 4, so a genuinely reactive layer
 * outweighs both the novelty penalty (2.2 per prior use) and a one-band energy mismatch (1.6),
 * but three uses of the same effect still lose to a fresh one. Swept: at 2 nothing changed hands,
 * at 4 intro drift went 1.76 to 4.37 corpus-wide, at 6 it reached 4.75 and started spending
 * variety for it.
 */
const QUIET_WEIGHT = 4;
/** Bytes of movement at which a layer counts as fully reactive; above this it stops competing. */
const QUIET_FULL = 3;

export class EffectPicker {
	private readonly effects: readonly EffectDef[];
	private readonly used = new Map<string, number>();
	private readonly lastInRole = new Map<LayerRole, string>();
	private readonly byGroup = new Map<string, string>();
	private readonly rng: Rng;

	constructor(effects: readonly EffectDef[], rng: Rng) {
		this.effects = effects;
		this.rng = rng;
	}

	/** Marks an effect as spent without picking it, for one chosen ahead of time. */
	reserve(id: string): void {
		this.used.set(id, (this.used.get(id) ?? 0) + 1);
	}

	pick(req: PickRequest): EffectDef | null {
		const target = 1 + Math.round(Math.max(0, Math.min(1, req.energy)) * 4);
		const previous = this.lastInRole.get(req.role);

		const groupKey = req.group !== undefined && req.group >= 0 ? `${req.role}:${req.group}` : null;
		if (groupKey) {
			const held = this.byGroup.get(groupKey);
			const def = held ? this.effects.find((e) => e.id === held) : undefined;
			// Only when it still fits: a reprise that runs half as long as the original cannot
			// hold an effect that wanted the full length.
			if (def && req.lengthBars >= def.taste.minBars && req.lengthBars <= def.taste.maxBars) {
				this.used.set(def.id, (this.used.get(def.id) ?? 0) + 1);
				this.lastInRole.set(req.role, def.id);
				return def;
			}
		}

		const eligible = this.effects.filter((e) => {
			if (e.role !== req.role) return false;
			if (req.mustCarry && e.taste.carries === false) return false;
			if (!e.taste.sections.includes(req.section)) return false;
			if (req.lengthBars < e.taste.minBars || req.lengthBars > e.taste.maxBars) return false;
			if (e.taste.peakReserved) {
				if (!req.allowPeakReserved) return false;
				if ((this.used.get(e.id) ?? 0) > 0) return false;
			}
			return true;
		});
		if (eligible.length === 0) return null;

		const scored = eligible.map((e) => {
			// Two bands out is a different kind of moment, not a slightly wrong one.
			const distance = Math.abs(e.taste.energy - target);
			const seen = this.used.get(e.id) ?? 0;
			const score =
				-1.6 * distance -
				2.2 * seen -
				(e.id === previous ? 6 : 0) +
				// Only where it is the whole show. In a groove or a drop there is a kit, a
				// transient layer and a master doing the reacting, and a bed that fights them is
				// noise rather than information.
				(req.bare ? QUIET_WEIGHT * Math.min(1, (e.taste.quiet ?? 0) / QUIET_FULL) : 0) +
				// Enough jitter to break ties between equals, never enough to overrule the fit.
				this.rng.float() * 0.9;
			return { def: e, score };
		});

		scored.sort((a, b) => b.score - a.score || a.def.id.localeCompare(b.def.id));
		const chosen = scored[0].def;
		this.used.set(chosen.id, (this.used.get(chosen.id) ?? 0) + 1);
		this.lastInRole.set(req.role, chosen.id);
		if (groupKey) this.byGroup.set(groupKey, chosen.id);
		return chosen;
	}

	/**
	 * The strongest thing in the catalog that a given section can legally hold.
	 *
	 * The top of the catalog is a tie by construction: several effects are written to be the
	 * biggest thing in the room, which is the point of them. Breaking that tie alphabetically
	 * meant `chromaBurst` opened the peak of 68% of shows, so a corpus of nineteen tracks had
	 * four distinct biggest moments between them. The seed is the track's own hash, so the
	 * choice is still the same every time for the same track.
	 */
	strongest(role: LayerRole, section: SectionKind, lengthBars: number): EffectDef | null {
		const eligible = this.effects.filter(
			(e) =>
				e.role === role &&
				e.taste.sections.includes(section) &&
				lengthBars >= e.taste.minBars &&
				lengthBars <= e.taste.maxBars &&
				(this.used.get(e.id) ?? 0) === 0
		);
		if (eligible.length === 0) return null;

		const scored = eligible.map((e) => ({ def: e, score: e.taste.energy + this.rng.float() * 0.9 }));
		scored.sort((a, b) => b.score - a.score || a.def.id.localeCompare(b.def.id));
		return scored[0].def;
	}
}
