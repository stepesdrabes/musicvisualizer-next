import type { EffectDef, LayerRole } from '../contracts/effect.ts';

import { ambientDrift } from './ambientDrift.ts';
import { anthemWash } from './anthemWash.ts';
import { aurora } from './aurora.ts';
import { auroraBorealis } from './auroraBorealis.ts';
import { bandBloom } from './bandBloom.ts';
import { barFill } from './barFill.ts';
import { bassRing } from './bassRing.ts';
import { beamFlick } from './beamFlick.ts';
import { blackout } from './blackout.ts';
import { blinderWall } from './blinderWall.ts';
import { breathe } from './breathe.ts';
import { buildStrobe } from './buildStrobe.ts';
import { cascade } from './cascade.ts';
import { chase } from './chase.ts';
import { chorusBloom } from './chorusBloom.ts';
import { chromaBurst } from './chromaBurst.ts';
import { clapAlong } from './clapAlong.ts';
import { colorBump } from './colorBump.ts';
import { comet } from './comet.ts';
import { crownSpill } from './crownSpill.ts';
import { confetti } from './confetti.ts';
import { discoBall } from './discoBall.ts';
import { doubleKickGatling } from './doubleKickGatling.ts';
import { emberStorm } from './emberStorm.ts';
import { embers } from './embers.ts';
import { feedbackSwell } from './feedbackSwell.ts';
import { flexStrobe } from './flexStrobe.ts';
import { glitchScan } from './glitchScan.ts';
import { gradientSpin } from './gradientSpin.ts';
import { halftimeBounce } from './halftimeBounce.ts';
import { harmonicRibbon } from './harmonicRibbon.ts';
import { hatTicker } from './hatTicker.ts';
import { harmonicHaze } from './harmonicHaze.ts';
import { headbang } from './headbang.ts';
import { heartbeat } from './heartbeat.ts';
import { hueCarousel } from './hueCarousel.ts';
import { iridescence } from './iridescence.ts';
import { kickCannon } from './kickCannon.ts';
import { kickTunnel } from './kickTunnel.ts';
import { laidbackWave } from './laidbackWave.ts';
import { lavaBlobs } from './lavaBlobs.ts';
import { lightning } from './lightning.ts';
import { meterBuild } from './meterBuild.ts';
import { mirrorBall } from './mirrorBall.ts';
import { moshSlam } from './moshSlam.ts';
import { nebula } from './nebula.ts';
import { phraseArc } from './phraseArc.ts';
import { pixelRain } from './pixelRain.ts';
import { pump } from './pump.ts';
import { pyroBursts } from './pyroBursts.ts';
import { rainbowRain } from './rainbowRain.ts';
import { riser } from './riser.ts';
import { rollerChase } from './rollerChase.ts';
import { shockwave } from './shockwave.ts';
import { shutterCut } from './shutterCut.ts';
import { sineRoll } from './sineRoll.ts';
import { slam } from './slam.ts';
import { snareWhip } from './snareWhip.ts';
import { sparkle } from './sparkle.ts';
import { spectrumBed } from './spectrumBed.ts';
import { spectrumRings } from './spectrumRings.ts';
import { splash } from './splash.ts';
import { stageBlinders } from './stageBlinders.ts';
import { strobe } from './strobe.ts';
import { subSwell } from './subSwell.ts';
import { subThrob } from './subThrob.ts';
import { sweep } from './sweep.ts';
import { tideBloom } from './tideBloom.ts';
import { undertow } from './undertow.ts';
import { vocalGlow } from './vocalGlow.ts';
import { vortex } from './vortex.ts';
import { vuTowers } from './vuTowers.ts';
import { wash } from './wash.ts';

export const BUILT_IN_EFFECTS: readonly EffectDef[] = [
	// bed
	wash,
	blackout,
	aurora,
	nebula,
	embers,
	ambientDrift,
	barFill,
	bassRing,
	lavaBlobs,
	iridescence,
	auroraBorealis,
	chorusBloom,
	anthemWash,
	undertow,
	subThrob,
	spectrumBed,
	harmonicHaze,
	phraseArc,
	// rhythm
	sweep,
	chase,
	comet,
	pump,
	riser,
	rollerChase,
	gradientSpin,
	halftimeBounce,
	pixelRain,
	sineRoll,
	vuTowers,
	meterBuild,
	glitchScan,
	heartbeat,
	cascade,
	hueCarousel,
	rainbowRain,
	vortex,
	headbang,
	feedbackSwell,
	moshSlam,
	hatTicker,
	laidbackWave,
	spectrumRings,
	// transient
	shockwave,
	splash,
	beamFlick,
	subSwell,
	lightning,
	kickTunnel,
	snareWhip,
	doubleKickGatling,
	pyroBursts,
	clapAlong,
	// accent
	sparkle,
	stageBlinders,
	vocalGlow,
	confetti,
	flexStrobe,
	buildStrobe,
	discoBall,
	emberStorm,
	harmonicRibbon,
	bandBloom,
	breathe,
	mirrorBall,
	kickCannon,
	crownSpill,
	// master
	blinderWall,
	slam,
	strobe,
	chromaBurst,
	colorBump,
	shutterCut,
	tideBloom
];

/** Mutable so a show's generated effects can join the vocabulary at load time. */
export class EffectRegistry {
	private readonly byId = new Map<string, EffectDef>();

	constructor(defs: readonly EffectDef[] = BUILT_IN_EFFECTS) {
		for (const d of defs) this.byId.set(d.id, d);
	}

	get(id: string): EffectDef | null {
		return this.byId.get(id) ?? null;
	}

	has(id: string): boolean {
		return this.byId.has(id);
	}

	add(def: EffectDef): void {
		this.byId.set(def.id, def);
	}

	/** Drop everything not built in. Called on track change. */
	clearGenerated(): void {
		const builtIn = new Set(BUILT_IN_EFFECTS.map((d) => d.id));
		for (const id of [...this.byId.keys()]) if (!builtIn.has(id)) this.byId.delete(id);
	}

	all(): EffectDef[] {
		return [...this.byId.values()];
	}

	forRole(role: LayerRole): EffectDef[] {
		return this.all().filter((d) => d.role === role);
	}
}
