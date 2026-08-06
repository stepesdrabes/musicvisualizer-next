import type { EffectDef, LayerRole } from '../contracts/effect.ts';

import { ambientDrift } from './ambientDrift.ts';
import { aurora } from './aurora.ts';
import { auroraBorealis } from './auroraBorealis.ts';
import { bassRing } from './bassRing.ts';
import { beamFlick } from './beamFlick.ts';
import { blackout } from './blackout.ts';
import { buildStrobe } from './buildStrobe.ts';
import { cascade } from './cascade.ts';
import { chase } from './chase.ts';
import { chorusBloom } from './chorusBloom.ts';
import { chromaBurst } from './chromaBurst.ts';
import { clapAlong } from './clapAlong.ts';
import { colorBump } from './colorBump.ts';
import { comet } from './comet.ts';
import { confetti } from './confetti.ts';
import { discoBall } from './discoBall.ts';
import { doubleKickGatling } from './doubleKickGatling.ts';
import { emberStorm } from './emberStorm.ts';
import { embers } from './embers.ts';
import { feedbackSwell } from './feedbackSwell.ts';
import { flexStrobe } from './flexStrobe.ts';
import { glitchScan } from './glitchScan.ts';
import { gradientSpin } from './gradientSpin.ts';
import { hatTicker } from './hatTicker.ts';
import { headbang } from './headbang.ts';
import { heartbeat } from './heartbeat.ts';
import { hueCarousel } from './hueCarousel.ts';
import { iridescence } from './iridescence.ts';
import { kickTunnel } from './kickTunnel.ts';
import { laidbackWave } from './laidbackWave.ts';
import { lavaBlobs } from './lavaBlobs.ts';
import { lightning } from './lightning.ts';
import { meterBuild } from './meterBuild.ts';
import { moshSlam } from './moshSlam.ts';
import { nebula } from './nebula.ts';
import { pixelRain } from './pixelRain.ts';
import { pump } from './pump.ts';
import { pyroBursts } from './pyroBursts.ts';
import { rainbowRain } from './rainbowRain.ts';
import { riser } from './riser.ts';
import { shockwave } from './shockwave.ts';
import { sineRoll } from './sineRoll.ts';
import { slam } from './slam.ts';
import { snareWhip } from './snareWhip.ts';
import { sparkle } from './sparkle.ts';
import { splash } from './splash.ts';
import { stageBlinders } from './stageBlinders.ts';
import { strobe } from './strobe.ts';
import { subSwell } from './subSwell.ts';
import { subThrob } from './subThrob.ts';
import { sweep } from './sweep.ts';
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
	bassRing,
	lavaBlobs,
	iridescence,
	auroraBorealis,
	chorusBloom,
	subThrob,
	// rhythm
	sweep,
	chase,
	comet,
	pump,
	riser,
	gradientSpin,
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
	// master
	slam,
	strobe,
	chromaBurst,
	colorBump
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

export {
	ambientDrift,
	aurora,
	auroraBorealis,
	bassRing,
	beamFlick,
	blackout,
	buildStrobe,
	cascade,
	chase,
	chorusBloom,
	chromaBurst,
	clapAlong,
	colorBump,
	comet,
	confetti,
	discoBall,
	doubleKickGatling,
	emberStorm,
	embers,
	feedbackSwell,
	flexStrobe,
	glitchScan,
	gradientSpin,
	hatTicker,
	headbang,
	heartbeat,
	hueCarousel,
	iridescence,
	kickTunnel,
	laidbackWave,
	lavaBlobs,
	lightning,
	meterBuild,
	moshSlam,
	nebula,
	pixelRain,
	pump,
	pyroBursts,
	rainbowRain,
	riser,
	shockwave,
	sineRoll,
	slam,
	snareWhip,
	sparkle,
	splash,
	stageBlinders,
	strobe,
	subSwell,
	subThrob,
	sweep,
	vocalGlow,
	vortex,
	vuTowers,
	wash
};
