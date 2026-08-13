import { describe, expect, it } from 'vitest';
import { DEFAULT_ROOM, buildGeometry } from './geometry.ts';
import { EffectRegistry } from './effects/index.ts';
import { Mixer } from './mixer.ts';
import { ShowPlayer } from './player.ts';
import { fixtureAnalysis, fixtureShow } from './ambient/fixture.ts';

const g = buildGeometry(DEFAULT_ROOM);

describe('hits across cue boundaries', () => {
	/**
	 * The anticipation lead consumes an onset up to ~30 ms EARLY, so a kick sitting exactly
	 * on a cue boundary fires its one-frame edge a frame or two before the incoming effect
	 * is installed: the outgoing effect got the kick, the incoming one - installed precisely
	 * to answer it - heard silence. Reported from the room as "a kick right on the switch
	 * does not get triggered". The player re-asserts any freshly consumed edge on the
	 * install frame; this holds it to that.
	 */
	it('re-asserts a kick consumed just before the switch to the incoming effect', () => {
		const analysis = fixtureAnalysis(120);
		const show = fixtureShow(analysis);
		expect(show.cues.length).toBeGreaterThan(1);

		// One kick, exactly on the second cue's downbeat.
		const boundaryBar = show.cues[1].bar;
		const boundaryTime = analysis.tempo.barTimes[boundaryBar];
		analysis.onsets.kick = { times: [boundaryTime], levels: [1] };
		analysis.onsets.snare = { times: [], levels: [] };
		analysis.onsets.hat = { times: [], levels: [] };

		const player = new ShowPlayer(new Mixer(g), new EffectRegistry());
		player.load(analysis, show);

		const dt = 1 / 60;
		let kickOnOrAfterBoundary = false;
		// Offset so no frame lands exactly on the boundary: the lead consumes the kick one
		// to two frames early, which is the precise shape of the bug.
		for (let t = boundaryTime - 0.5 + 0.003; t < boundaryTime + 0.1; t += dt) {
			const f = player.update(t, dt);
			if (t >= boundaryTime && f.kick) kickOnOrAfterBoundary = true;
		}
		expect(kickOnOrAfterBoundary).toBe(true);
	});
});
