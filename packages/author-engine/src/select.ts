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
}

/**
 * Chooses effects so the show does not repeat itself.
 *
 * The taste metadata on each effect is a hard filter, not a preference: it already says which
 * sections an effect belongs in and how long it can hold the room, and the linter rejects a
 * show that ignores it. What is left to decide is which of the survivors, and that is where a
 * show gets its character - so the score is mostly about what has not been used yet.
 */
export class EffectPicker {
	private readonly effects: readonly EffectDef[];
	private readonly used = new Map<string, number>();
	private readonly lastInRole = new Map<LayerRole, string>();
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

		const eligible = this.effects.filter((e) => {
			if (e.role !== req.role) return false;
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
				// Enough jitter to break ties between equals, never enough to overrule the fit.
				this.rng.float() * 0.9;
			return { def: e, score };
		});

		scored.sort((a, b) => b.score - a.score || a.def.id.localeCompare(b.def.id));
		const chosen = scored[0].def;
		this.used.set(chosen.id, (this.used.get(chosen.id) ?? 0) + 1);
		this.lastInRole.set(req.role, chosen.id);
		return chosen;
	}

	/** The strongest thing in the catalog that a given section can legally hold. */
	strongest(role: LayerRole, section: SectionKind, lengthBars: number): EffectDef | null {
		const eligible = this.effects
			.filter(
				(e) =>
					e.role === role &&
					e.taste.sections.includes(section) &&
					lengthBars >= e.taste.minBars &&
					lengthBars <= e.taste.maxBars &&
					(this.used.get(e.id) ?? 0) === 0
			)
			.sort((a, b) => b.taste.energy - a.taste.energy || a.id.localeCompare(b.id));
		return eligible[0] ?? null;
	}
}
