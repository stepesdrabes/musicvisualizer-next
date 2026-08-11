/**
 * Structure segmentation metrics, faithful to mir_eval 0.8 `segment`.
 *
 * Recovered from the deleted harness (bench/segment-metrics.ts, removed in b94e2fa),
 * unchanged: the numbers must stay comparable with the baselines recorded against it.
 *
 * Two questions, kept apart because a system can be good at one and hopeless at the other:
 * boundary detection asks "does a section change here", and labelling asks "is this the same
 * material as that". Reporting only a combined figure would hide a failure of either half.
 */

export interface Segment {
	start: number;
	end: number;
	label: string;
}

/** Interval starts plus the final end, which is what mir_eval treats as a boundary set. */
export function boundariesOf(segments: readonly Segment[]): number[] {
	if (segments.length === 0) return [];
	return [...segments.map((s) => s.start), segments[segments.length - 1].end];
}

function matchEvents(ref: readonly number[], est: readonly number[], window: number): number {
	const adj: number[][] = ref.map(() => []);
	let j = 0;
	for (let i = 0; i < ref.length; i++) {
		while (j < est.length && est[j] < ref[i] - window) j++;
		for (let k = j; k < est.length && est[k] <= ref[i] + window; k++) adj[i].push(k);
	}
	const matchOfEst = new Int32Array(est.length).fill(-1);
	const seen = new Uint8Array(est.length);
	const augment = (i: number): boolean => {
		for (const k of adj[i]) {
			if (seen[k]) continue;
			seen[k] = 1;
			if (matchOfEst[k] === -1 || augment(matchOfEst[k])) {
				matchOfEst[k] = i;
				return true;
			}
		}
		return false;
	};
	let matched = 0;
	for (let i = 0; i < ref.length; i++) {
		seen.fill(0);
		if (augment(i)) matched++;
	}
	return matched;
}

export interface PRF {
	precision: number;
	recall: number;
	f: number;
}

function prf(hits: number, nEst: number, nRef: number): PRF {
	const precision = nEst > 0 ? hits / nEst : 0;
	const recall = nRef > 0 ? hits / nRef : 0;
	const f = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
	return { precision, recall, f };
}

/**
 * Boundary hit rate at a tolerance. 0.5 s is the strict figure papers lead with; 3 s is the
 * loose one, and the gap between them says whether boundaries are merely near or actually on.
 */
export function boundaryDetection(
	ref: readonly Segment[],
	est: readonly Segment[],
	window = 0.5,
	trim = true
): PRF {
	let refB = boundariesOf(ref);
	let estB = boundariesOf(est);
	// The track's own start and end are free hits, and counting them flatters everyone equally.
	if (trim) {
		refB = refB.slice(1, -1);
		estB = estB.slice(1, -1);
	}
	if (refB.length === 0 || estB.length === 0) return { precision: 0, recall: 0, f: 0 };
	return prf(matchEvents(refB, estB, window), estB.length, refB.length);
}

/** Label at each frame centre, or null past the end of the annotation. */
function sampleLabels(segments: readonly Segment[], frames: number, frameSize: number): (string | null)[] {
	const out = new Array<string | null>(frames).fill(null);
	let i = 0;
	for (let f = 0; f < frames; f++) {
		const t = (f + 0.5) * frameSize;
		while (i < segments.length && segments[i].end <= t) i++;
		out[f] = i < segments.length && segments[i].start <= t ? segments[i].label : null;
	}
	return out;
}

function contingency(
	ref: readonly Segment[],
	est: readonly Segment[],
	frameSize: number
): { table: Map<string, Map<string, number>>; total: number } {
	const end = Math.min(
		ref.length ? ref[ref.length - 1].end : 0,
		est.length ? est[est.length - 1].end : 0
	);
	const frames = Math.max(0, Math.floor(end / frameSize));
	const yRef = sampleLabels(ref, frames, frameSize);
	const yEst = sampleLabels(est, frames, frameSize);

	const table = new Map<string, Map<string, number>>();
	let total = 0;
	for (let f = 0; f < frames; f++) {
		const a = yRef[f];
		const b = yEst[f];
		if (a === null || b === null) continue;
		let row = table.get(a);
		if (!row) {
			row = new Map();
			table.set(a, row);
		}
		row.set(b, (row.get(b) ?? 0) + 1);
		total++;
	}
	return { table, total };
}

/**
 * Pairwise frame clustering, computed from the contingency table rather than by forming the
 * n-by-n agreement matrices: a four-minute track at 100 ms is 2400 frames, and the quadratic
 * form is 5.8 million booleans for a number that a few hundred counts already determine.
 */
export function pairwise(
	ref: readonly Segment[],
	est: readonly Segment[],
	frameSize = 0.1
): PRF {
	const { table } = contingency(ref, est, frameSize);
	const pairs = (n: number) => (n * (n - 1)) / 2;

	let both = 0;
	const rowTotals = new Map<string, number>();
	const colTotals = new Map<string, number>();
	for (const [a, row] of table) {
		let r = 0;
		for (const [b, n] of row) {
			both += pairs(n);
			r += n;
			colTotals.set(b, (colTotals.get(b) ?? 0) + n);
		}
		rowTotals.set(a, r);
	}
	let agreeRef = 0;
	for (const n of rowTotals.values()) agreeRef += pairs(n);
	let agreeEst = 0;
	for (const n of colTotals.values()) agreeEst += pairs(n);

	return prf(both, agreeEst, agreeRef);
}

export interface NCE {
	over: number;
	under: number;
	f: number;
}

/**
 * Normalised conditional entropy: `under` falls when one estimated section swallows several
 * reference ones, `over` when a reference section is split. The pair is what catches the
 * collapse failure, where a single label spans most of the track.
 */
export function nce(ref: readonly Segment[], est: readonly Segment[], frameSize = 0.1): NCE {
	const { table, total } = contingency(ref, est, frameSize);
	if (total === 0) return { over: 0, under: 0, f: 0 };

	const rowTotals = new Map<string, number>();
	const colTotals = new Map<string, number>();
	for (const [a, row] of table) {
		let r = 0;
		for (const [b, n] of row) {
			r += n;
			colTotals.set(b, (colTotals.get(b) ?? 0) + n);
		}
		rowTotals.set(a, r);
	}

	let hEstGivenRef = 0;
	let hRefGivenEst = 0;
	for (const [a, row] of table) {
		for (const [b, n] of row) {
			const p = n / total;
			hEstGivenRef -= p * Math.log2(n / rowTotals.get(a)!);
			hRefGivenEst -= p * Math.log2(n / colTotals.get(b)!);
		}
	}

	const nRef = rowTotals.size;
	const nEst = colTotals.size;
	const over = nEst > 1 ? Math.max(0, 1 - hEstGivenRef / Math.log2(nEst)) : 0;
	const under = nRef > 1 ? Math.max(0, 1 - hRefGivenEst / Math.log2(nRef)) : 0;
	const f = over + under > 0 ? (2 * over * under) / (over + under) : 0;
	return { over, under, f };
}

export interface SegmentScores {
	f05: number;
	f3: number;
	pairwiseF: number;
	nceOver: number;
	nceUnder: number;
	nceF: number;
	refSegments: number;
	estSegments: number;
	/** Longest estimated section as a fraction of the track: the collapse this is looking for. */
	longestEstShare: number;
}

export function scoreSegments(ref: readonly Segment[], est: readonly Segment[]): SegmentScores {
	const p = pairwise(ref, est);
	const n = nce(ref, est);
	const duration = est.length ? est[est.length - 1].end - est[0].start : 0;
	let longest = 0;
	for (const s of est) longest = Math.max(longest, s.end - s.start);
	return {
		f05: boundaryDetection(ref, est, 0.5).f,
		f3: boundaryDetection(ref, est, 3).f,
		pairwiseF: p.f,
		nceOver: n.over,
		nceUnder: n.under,
		nceF: n.f,
		refSegments: ref.length,
		estSegments: est.length,
		longestEstShare: duration > 0 ? longest / duration : 0
	};
}
