import type { GenreFamily } from '@mv/core';

/**
 * Fold whatever the metadata sources say into the lighting vocabulary.
 *
 * Keyword votes rather than a taxonomy walk, because the inputs are a mess by construction:
 * iTunes says "Pop" for most of the Czech catalogue, MusicBrainz genres are community votes,
 * and YouTube tags are whatever the uploader typed. A specific style name outvotes a coarse
 * one, so "drum & bass" beats the "Dance" that arrives beside it.
 */

interface Rule {
	family: GenreFamily;
	/** Specific style names count double against coarse store categories. */
	weight: number;
	match: RegExp;
}

/**
 * Order matters only for readability; every rule is tested against every string and the
 * votes are summed, so "melodic techno" scores techno twice rather than first-match-wins.
 */
const RULES: Rule[] = [
	{ family: 'techno', weight: 2, match: /\btechno\b|\bminimal\b|\bschranz\b/ },
	{ family: 'house', weight: 2, match: /\bhouse\b|\bgarage\b|\bukg\b|\b2-?step\b|\bamapiano\b/ },
	{ family: 'trance', weight: 2, match: /\btrance\b|\bpsytrance\b|\bgoa\b/ },
	{
		family: 'bass',
		weight: 2,
		match: /drum\s?(?:and|&|n)\s?bass|\bdnb\b|\bd&b\b|\bjungle\b|\bdubstep\b|\briddim\b|\bbreakbeat\b|\bbassline\b|\bhardstyle\b|\bhappy hardcore\b|\bgabber\b/
	},
	// Festival trap is bass music; hip-hop trap arrives with rap keywords beside it that outvote.
	{ family: 'bass', weight: 1, match: /\btrap\b/ },
	{ family: 'edm', weight: 2, match: /\bedm\b|\bbig ?room\b|\belectro house\b|\bprogressive house\b|\bfuture (?:house|bass)\b|\bslap house\b|\bbrazilian phonk\b|\bphonk\b/ },
	{ family: 'edm', weight: 1, match: /\bdance\b|\belectronic\b|\belectro\b/ },
	{
		family: 'pop',
		weight: 2,
		match: /\bsynth-?pop\b|\bdance-?pop\b|\belectropop\b|\beuropop\b|\bk-?pop\b|\bindie pop\b|\bteen pop\b|\bart pop\b/
	},
	{ family: 'pop', weight: 1, match: /\bpop\b/ },
	{ family: 'rock', weight: 2, match: /\bgrunge\b|\bbritpop\b|\bpost-?punk\b|\bindie rock\b|\bgarage rock\b|\bclassic rock\b|\bhard rock\b/ },
	{ family: 'rock', weight: 1, match: /\brock\b|\balternative\b|\bindie\b/ },
	{
		family: 'metal',
		weight: 2,
		match: /\bmetal\b|\bmetalcore\b|\bdeathcore\b|\bdjent\b|\bthrash\b|\bdoom\b|\bnu-?metal\b/
	},
	{ family: 'punk', weight: 2, match: /\bpunk\b|\bska\b|\bhardcore punk\b/ },
	{
		family: 'hiphop',
		weight: 2,
		match: /hip[\s-]?hop|\brap\b|\bdrill\b|\bgrime\b|\bboom bap\b|\bczech rap\b/
	},
	{ family: 'rnb', weight: 2, match: /\br\s?&\s?b\b|\brnb\b|\bsoul\b|\bneo-?soul\b/ },
	{
		family: 'ballad',
		weight: 2,
		match: /\bsinger[\s/-]?songwriter\b|\bacoustic\b|\bfolk\b|\bballad\b|\bcountry\b|\bamericana\b/
	},
	{
		family: 'ambient',
		weight: 2,
		match: /\bambient\b|\bdowntempo\b|\bchill(?:out|hop)?\b|\blo-?fi\b|\btrip[\s-]?hop\b|\bidm\b|\bclassical\b|\bnew age\b|\bsoundtrack\b|\bscore\b/
	},
	{
		family: 'latin',
		weight: 2,
		match: /\blatin\b|\breggaeton\b|\bafrobeats?\b|\bdembow\b|\bsalsa\b|\bbachata\b|\bcumbia\b|\bdancehall\b|\breggae\b/
	},
	{ family: 'disco', weight: 2, match: /\bdisco\b|\bfunk\b|\bnu-?disco\b|\bboogie\b|\bmotown\b|\bjazz\b|\bswing\b/ }
];

export interface GenreVote {
	family: GenreFamily | null;
	/** Share of the total vote the winner took, 0..1. Zero when nothing matched. */
	confidence: number;
}

/**
 * `strings` is everything gathered: source genres and uploader tags. `weights` scales each
 * string's vote - the audio classifier passes its activation scores, so a 0.74 Techno
 * outvotes three 0.2 relatives instead of being outvoted by the word "electronic"
 * appearing in every one of them.
 */
export function mapGenres(strings: readonly string[], weights?: readonly number[]): GenreVote {
	const votes = new Map<GenreFamily, number>();
	let total = 0;

	for (let i = 0; i < strings.length; i++) {
		// Discogs' "Folk, World, & Country" parent is a catch-all whose children run from
		// Soukous to Celtic, and the parent's own words vote ballad at weight 2 - it filed
		// a 116 bpm funk record as a ballad. The parent is struck and the style keeps its
		// own say; every other parent (Hip Hop, Rock, Reggae...) is informative and stays,
		// because stripping them all turned "Hip Hop Trap" into a bass vote.
		const s = strings[i].toLowerCase().replace(/folk,\s*world,?\s*&\s*country/g, ' ');
		const scale = weights?.[i] ?? 1;
		for (const rule of RULES) {
			if (!rule.match.test(s)) continue;
			votes.set(rule.family, (votes.get(rule.family) ?? 0) + rule.weight * scale);
			total += rule.weight * scale;
		}
	}

	let best: GenreFamily | null = null;
	let bestVotes = 0;
	for (const [family, n] of votes) {
		if (n > bestVotes) {
			bestVotes = n;
			best = family;
		}
	}
	if (!best || total === 0) return { family: null, confidence: 0 };
	return { family: best, confidence: bestVotes / total };
}
