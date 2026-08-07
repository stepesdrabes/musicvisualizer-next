import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

/**
 * Grid-sweep numeric constants in source files against a scoring script.
 *
 *   node bench/tune.ts NAME=0.3,0.5 OTHER=1,2
 *   node bench/tune.ts --run bench/drumlab.ts --in packages/analysis/src/drums.ts GAP=0.4,0.6
 *
 * Constants are found by name across every `--in` file, so a sweep can cross module boundaries.
 * Each point runs in a fresh process, because a module that imports its dependency by the plain
 * specifier keeps the first instance whatever query string the importer adds.
 *
 * The scoring script prints `name<tab>value` lines; every one becomes a column.
 */
const argv = process.argv.slice(2);
const many = (flag: string): string[] => {
	const out: string[] = [];
	for (let i = 0; i < argv.length; i++) if (argv[i] === flag) out.push(argv[i + 1]);
	return out;
};
const one = (flag: string, fallback: string): string => many(flag)[0] ?? fallback;

const run = one('--run', 'bench/struct-sweep.ts');
const files = many('--in');
const specs = argv.filter((a, i) => a.includes('=') && !argv[i - 1]?.startsWith('--'));
if (files.length === 0) files.push('packages/analysis/src/structure.ts');

const originals = new Map(files.map((f) => [f, readFileSync(f, 'utf8')]));

const axes = specs.map((s) => {
	const [name, list] = s.split('=');
	return { name, values: list.split(',') };
});

let combos: Record<string, string>[] = [{}];
for (const axis of axes) {
	combos = combos.flatMap((base) => axis.values.map((v) => ({ ...base, [axis.name]: v })));
}

const score = (): Map<string, string> => {
	const out = execFileSync(process.execPath, [run, '--label', 'tmp-tune'], {
		encoding: 'utf8',
		maxBuffer: 1 << 26
	});
	const rows = new Map<string, string>();
	for (const line of out.split('\n')) {
		const tab = line.indexOf('\t');
		if (tab > 0) rows.set(line.slice(0, tab).trim(), line.slice(tab + 1).trim());
		else {
			// The structure sweep prints aligned columns rather than tabs.
			const m = /^\s{2}([a-z][a-z0-9 .-]+?)\s{2,}([-0-9.]+)\s*$/i.exec(line);
			if (m) rows.set(m[1].trim(), m[2]);
		}
	}
	return rows;
};

try {
	let header = false;
	for (const combo of combos) {
		for (const [file, original] of originals) {
			let src = original;
			for (const [name, value] of Object.entries(combo)) {
				const re = new RegExp(`(const ${name} = )[-0-9.]+(;)`);
				if (re.test(src)) src = src.replace(re, `$1${value}$2`);
			}
			writeFileSync(file, src);
		}
		for (const name of Object.keys(combo)) {
			const found = [...originals.values()].some((s) =>
				new RegExp(`const ${name} = [-0-9.]+;`).test(s)
			);
			if (!found) throw new Error(`no "const ${name} = <number>;" in any --in file`);
		}

		const rows = score();
		if (!header) {
			console.log(
				`${axes.map((a) => a.name.padEnd(14)).join('')}${[...rows.keys()].map((k) => k.padStart(15)).join('')}`
			);
			header = true;
		}
		console.log(
			`${axes.map((a) => String(combo[a.name]).padEnd(14)).join('')}${[...rows.values()].map((v) => v.padStart(15)).join('')}`
		);
	}
} finally {
	for (const [file, original] of originals) writeFileSync(file, original);
}
