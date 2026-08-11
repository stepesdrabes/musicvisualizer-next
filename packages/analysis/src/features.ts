import { chromagram, type Chromagram } from './chroma.ts';
import { computeSpectrogram, logFilterBank, type Spectrogram } from './dsp/spectrogram.ts';
import { conditionCurve, onsetStrength, type OnsetCurves } from './onsets.ts';

/**
 * 100 frames a second. A 10 ms grid is finer than any onset the ear resolves as separate,
 * and it is what the published onset and beat detectors are tuned at, so their parameters
 * transfer without rescaling.
 */
export const FEATURE_FPS = 100;
const FFT_SIZE = 2048;
const BANDS_PER_OCTAVE = 24;

export interface AnalysisFeatures {
	sampleRate: number;
	duration: number;
	spec: Spectrogram;
	curves: OnsetCurves;
	/** Conditioned broadband onset strength: the curve tempo and beats are derived from. */
	odf: Float32Array;
	chroma: Chromagram;
}

export function extractFeatures(mono: Float32Array, sampleRate: number): AnalysisFeatures {
	const hop = Math.max(1, Math.round(sampleRate / FEATURE_FPS));
	const bank = logFilterBank(FFT_SIZE, sampleRate, BANDS_PER_OCTAVE, 30, 17000);
	const spec = computeSpectrogram(mono, sampleRate, { fftSize: FFT_SIZE, hop, bank });
	const curves = onsetStrength(spec);
	const odf = conditionCurve(curves.flux, curves.fps);
	return {
		sampleRate,
		duration: mono.length / sampleRate,
		spec,
		curves,
		odf,
		chroma: chromagram(mono, sampleRate)
	};
}

