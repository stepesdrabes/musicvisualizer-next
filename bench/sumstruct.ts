import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Print the summary block for one or more bench/reports/<label>.json structure runs. */
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

interface Row {
	key: string;
	dataset: string;
	f05: number;
	f3: number;
	pairwiseF: number;
	nceOver: number;
	nceUnder: number;
	refSegments: number;
	estSegments: number;
	longestEstShare: number;
}

const load = (label: string): Row[] =>
	JSON.parse(readFileSync(join(import.meta.dirname, 'reports', `${label}.json`), 'utf8')).results;

const labels = process.argv.slice(2);
const tables = labels.map((l) => ({ label: l, rows: load(l) }));

for (const ds of ['harmonix', 'salami']) {
	const sets = tables.map((t) => ({ ...t, rows: t.rows.filter((r) => r.dataset === ds) }));
	if (sets.every((s) => s.rows.length === 0)) continue;
	console.log(`\n${ds}`);
	console.log(`  ${'metric'.padEnd(20)}${sets.map((s) => s.label.padStart(12)).join('')}`);
	const line = (name: string, pick: (r: Row) => number, scale = 100) => {
		console.log(
			`  ${name.padEnd(20)}${sets.map((s) => (scale * mean(s.rows.map(pick))).toFixed(scale === 100 ? 1 : 2).padStart(12)).join('')}`
		);
	};
	console.log(`  ${'tracks'.padEnd(20)}${sets.map((s) => String(s.rows.length).padStart(12)).join('')}`);
	line('boundary F0.5', (r) => r.f05);
	line('boundary F3', (r) => r.f3);
	line('pairwise F', (r) => r.pairwiseF);
	line('over-segmentation', (r) => r.nceOver);
	line('under-segmentation', (r) => r.nceUnder);
	line('ref sections', (r) => r.refSegments, 1);
	line('est sections', (r) => r.estSegments, 1);
	line('longest section', (r) => r.longestEstShare);
}
