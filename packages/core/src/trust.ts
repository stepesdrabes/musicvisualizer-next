import type { TrackAnalysis } from './contracts/analysis.ts';

/**
 * Whether the analysed grid deserves an authored show, and why not when it does not.
 *
 * Some tracks defeat the analyser - a wrong metrical level reads a pop song in 2/4, every
 * downstream judgement inherits the broken grid, and the show comes out as thirty-five cues
 * over twenty-three sections, changing looks every six seconds. That show is worse than no
 * show: the lounge scenes follow the same track through its spectrum and its section
 * boundaries without trusting either very far, so a track the analyser lost runs calm there
 * instead of frantic. This is the verdict that routes it.
 */
export interface GridTrust {
	trusted: boolean;
	/** Human-readable, shown on the queue row and in the inspector. Empty when trusted. */
	reasons: string[];
}

/**
 * Fragmentation is the tell, confidence and meter are the accessories.
 *
 * Calibrated against a 113-track cache: the clean end of the corpus tops out near 4.8
 * sections a minute (busy but honest house), the broken end starts at 5.5 with the one
 * catastrophic grid at 6.3. Confidence alone cannot draw this line - one track at
 * meterConfidence 0.55 has clean structure while another at 0.88 is chopped to bits by a
 * half-time grid - so it only ever tightens the fragmentation test, never trips on its own.
 * A 2/4 verdict is treated the same way: real 2/4 barely exists in this repertoire, so on a
 * fragmented track it is evidence of a meter failure rather than of a polka.
 */
const FRAGMENTED = 5.2;
const SUSPECT = 4.5;
const SHAKY_METER = 0.55;

export function gridTrust(analysis: TrackAnalysis): GridTrust {
	const minutes = analysis.duration / 60;
	// Too short to fragment meaningfully, and too short for lounge to improve on anything.
	if (minutes < 1 || analysis.sections.length === 0) return { trusted: true, reasons: [] };

	const perMinute = analysis.sections.length / minutes;
	const meter = analysis.tempo.meterConfidence;
	const halfBars = analysis.tempo.beatsPerBar === 2;

	const reasons: string[] = [];
	if (perMinute > FRAGMENTED) {
		reasons.push(`${perMinute.toFixed(1)} sections a minute`);
	} else if (perMinute > SUSPECT && (meter <= SHAKY_METER || halfBars)) {
		reasons.push(
			`${perMinute.toFixed(1)} sections a minute on ${
				halfBars ? 'a 2/4 grid' : `meter confidence ${meter.toFixed(2)}`
			}`
		);
	}
	if (reasons.length > 0 && halfBars) reasons.push('read in 2/4, which this repertoire almost never is');

	return { trusted: reasons.length === 0, reasons };
}
