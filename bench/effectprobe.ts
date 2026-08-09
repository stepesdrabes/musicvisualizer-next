import {
	BUILT_IN_EFFECTS,
	DEFAULT_ROOM,
	buildGeometry,
	measureEffect,
	type EffectCharacter
} from '@mv/core';

/**
 * Every built-in, one row each, against the four questions a catalog can fail on.
 *
 *   fill    share of the room above byte 24, which is where a pixel starts reading as lit in a
 *           dark room rather than merely as not-off. `levelprobe`'s byte 8 answers a different
 *           question and calls a spotlight in a black room fully covered.
 *   top10   share of all delivered light sitting in the brightest tenth of the pixels. A wash
 *           scores near 0.1; a spotlight scores near 1. This is the number behind "only a T
 *           section lights up", and no mean brightness can see it.
 *   hue     share of lit bytes on a hue the palette could produce. An effect reaching past
 *           `SLOT` for a colour of its own, or wrapping a slot past 1.0 into the near-black
 *           end of the ring, shows up here.
 *   react   how far the output moves when the spectrum and bands are driven rather than held
 *           flat, as a share of its own mean level. An effect that ignores the music scores 0,
 *           which is exactly the complaint about a quiet passage.
 *   quiet   the same question asked over an intro and an outro instead: quiet, no kit at all,
 *           but a real spectrum with a wandering peak. `react` can be carried entirely by an
 *           effect's response to drums, and the room is reported dead precisely where there are
 *           none, so this is the column that answers the complaint.
 *
 * The measurement itself lives in `core` as `measureEffect`, because the authoring agent is
 * shown the same five numbers for the effects it writes: a catalog judged one way and generated
 * code judged another would be two standards wearing one set of column headings.
 *
 *   node bench/effectprobe.ts [--role bed] [--sort fill]
 */
const argv = process.argv.slice(2);
const flag = (n: string) => {
	const i = argv.indexOf(`--${n}`);
	return i >= 0 ? argv[i + 1] : undefined;
};
const onlyRole = flag('role');
const sortBy = flag('sort') ?? 'role';

const g = buildGeometry(DEFAULT_ROOM);

interface Row extends EffectCharacter {
	id: string;
	role: string;
}

/** Roles that have to hold a quiet passage on their own. A transient is allowed to be still. */
const QUIET_ROLES = new Set(['bed', 'accent', 'rhythm']);

const rows: Row[] = [];
for (const def of BUILT_IN_EFFECTS) {
	if (onlyRole && def.role !== onlyRole) continue;
	rows.push({ id: def.id, role: def.role, ...measureEffect(def, g) });
}

const order = ['bed', 'rhythm', 'transient', 'accent', 'master'];
rows.sort((a, b) =>
	sortBy === 'role'
		? order.indexOf(a.role) - order.indexOf(b.role) || a.id.localeCompare(b.id)
		: sortBy === 'top10'
			? b.top10 - a.top10
			: sortBy === 'hue'
				? a.hue - b.hue
				: sortBy === 'react'
					? a.react - b.react
					: a.fill - b.fill
);

console.error(
	`${'effect'.padEnd(20)}${'role'.padEnd(11)}${'fill'.padStart(7)}${'top10'.padStart(8)}${'hue'.padStart(7)}${'react'.padStart(8)}${'quiet'.padStart(8)}`
);
for (const r of rows) {
	console.error(
		r.id.padEnd(20) +
			r.role.padEnd(11) +
			`${(100 * r.fill).toFixed(0)}%`.padStart(7) +
			`${(100 * r.top10).toFixed(0)}%`.padStart(8) +
			`${(100 * r.hue).toFixed(0)}%`.padStart(7) +
			r.react.toFixed(2).padStart(8) +
			r.quiet.toFixed(2).padStart(8)
	);
}

const mean = (pick: (r: Row) => number) => rows.reduce((a, r) => a + pick(r), 0) / Math.max(1, rows.length);
const emit = (name: string, v: number, digits = 1) => console.log(`${name}\t${v.toFixed(digits)}`);

emit('effects', rows.length, 0);
emit('mean fill %', 100 * mean((r) => r.fill));
emit('mean top10 %', 100 * mean((r) => r.top10));
emit('off-palette', rows.filter((r) => r.hue < 0.9).length, 0);
emit('deaf effects', rows.filter((r) => r.react < 0.02).length, 0);
// Only the ones that can legally appear in a quiet section: a transient with no drums SHOULD be
// still, and counting it here would bury the beds and accents that are the actual complaint.
emit(
	'deaf in quiet',
	rows.filter((r) => r.quiet < 0.02 && QUIET_ROLES.has(r.role)).length,
	0
);
emit('spotlights', rows.filter((r) => r.top10 > 0.45).length, 0);
