import { radioFor, readLibrary, searchSongs, watchUrl, type Song } from '@mv/analysis';
import {
	signatureOf,
	titleKeyOf,
	videoIdOf,
	type NewItem,
	type QueueState
} from '$lib/queueModel.ts';
import { queue } from './queueStore.ts';
import { enrichFromLibrary } from './queueAdd.ts';
import { settings } from './settings.ts';

/**
 * The radio: what YouTube Music would play next, and the policy for letting it.
 *
 * Kept apart from the ingest runner so the runner stays a thing that prepares tracks and knows
 * nothing about where they came from.
 */

/** How many unplayed rows autopilot keeps ahead of the current one. */
const LOOKAHEAD = 2;

/** Seeds blended, newest first. One seed orbits a single artist for the rest of the night. */
const SEEDS = 3;

/**
 * Ceilings, none of which is the interesting number - they exist so that a flag left on, or a
 * network that has quietly gone away, cannot run until the disk is full.
 */
const MAX_CONSECUTIVE = 50;
const MAX_FAILURES = 3;
const COOLDOWN_MS = 60_000;
const MIN_INTERVAL_MS = 10_000;

/** Roughly a long evening of signatures, so a set does not come back around. */
const HISTORY = 200;

/** Local files are in the library too, and they have no radio. */
const WATCH_ID = /^[A-Za-z0-9_-]{11}$/;

/** A track to ask for neighbours of, and enough of its name to find it again if it is not one. */
interface Seed {
	id: string;
	label: string;
}

class Autopilot {
	private consecutive = 0;
	private failures = 0;
	private lastAttempt = 0;
	private coolUntil = 0;
	/** Signatures of everything the room has already been offered, newest last. */
	private heard: string[] = [];

	/** A human adding anything is the night being steered, which resets every ceiling. */
	handAdded(): void {
		this.consecutive = 0;
		this.failures = 0;
	}

	noteFailure(): void {
		this.failures += 1;
	}

	noteSuccess(): void {
		this.failures = 0;
	}

	private remember(song: Song): void {
		this.heard.push(signatureOf(song.artist, song.title), titleKeyOf(song.title));
		if (this.heard.length > HISTORY) this.heard = this.heard.slice(-HISTORY);
	}

	/**
	 * Everything the queue has held this session, so a restart does not offer the set again.
	 * Rebuilt from the queue rather than persisted: the queue is the only record there is.
	 */
	private seen(state: QueueState): Set<string> {
		const out = new Set(this.heard);
		for (const item of state.items) {
			const id = item.trackId ?? videoIdOf(item.source);
			if (id) out.add(id);
			if (item.title) {
				out.add(titleKeyOf(item.title));
				if (item.uploader) out.add(signatureOf(item.uploader, item.title));
			}
		}
		return out;
	}

	/** The last few distinct tracks, newest first, as radio seeds. */
	private seedsFrom(state: QueueState): Seed[] {
		const seeds: Seed[] = [];
		for (let i = state.items.length - 1; i >= 0 && seeds.length < SEEDS; i--) {
			const item = state.items[i];
			const id = item.trackId ?? videoIdOf(item.source);
			if (id && !seeds.some((s) => s.id === id)) {
				seeds.push({ id, label: `${item.uploader} ${item.title}`.trim() });
			}
		}
		return seeds;
	}

	/**
	 * One radio, as art tracks.
	 *
	 * A radio takes after the track that seeded it: seeded from an art track it comes back all
	 * art tracks, seeded from a music video it comes back all music videos, and those are the
	 * noisy recordings this whole path exists to avoid. So when the filter empties a list, look
	 * the seed up by name and ask again from the catalogue's copy of it - which is also how a
	 * track ripped before any of this existed gets a clean radio.
	 */
	private async oneRadio(seed: Seed): Promise<Song[]> {
		const direct = await radioFor(seed.id, 25).catch((): Song[] => []);
		if (direct.length > 0 || !seed.label) return direct;

		const [match] = await searchSongs(seed.label, 1).catch((): Song[] => []);
		if (!match || match.id === seed.id) return [];
		return radioFor(match.id, 25).catch((): Song[] => []);
	}

	/**
	 * Blend several radios into one running order.
	 *
	 * Round robin rather than concatenated, so the newest seed leads but the ones before it
	 * still get a say - which is what stops a night drifting into whatever one track suggests.
	 */
	async suggest(seeds: Seed[], want: number, exclude: Set<string>): Promise<Song[]> {
		const lists = await Promise.all(seeds.map((seed) => this.oneRadio(seed)));

		const out: Song[] = [];
		const taken = new Set(exclude);
		for (let round = 0; out.length < want && round < 25; round++) {
			let anyLeft = false;
			for (const list of lists) {
				const song = list[round];
				if (!song) continue;
				anyLeft = true;
				const sig = signatureOf(song.artist, song.title);
				const key = titleKeyOf(song.title);
				if (taken.has(song.id) || taken.has(sig) || taken.has(key)) continue;
				taken.add(song.id);
				taken.add(sig);
				taken.add(key);
				out.push(song);
				if (out.length >= want) break;
			}
			if (!anyLeft) break;
		}
		return out;
	}

	/** What a manual "start radio" asks for: no policy, no marking, just neighbours. */
	async around(seedId: string, want: number): Promise<Song[]> {
		const state = await queue.ready();
		const queued = new Set<string>();
		let label = '';
		for (const item of state.items) {
			const id = item.trackId ?? videoIdOf(item.source);
			if (id) queued.add(id);
			// The row this was asked from names the track, which is what rescues a seed whose
			// own radio is all music videos.
			if (id === seedId && !label) label = `${item.uploader} ${item.title}`.trim();
		}
		queued.add(seedId);
		return this.suggest([{ id: seedId, label }], want, queued);
	}

	/** Seeded from the queue rather than one track, for the panel and the empty palette. */
	async ahead(want: number): Promise<Song[]> {
		const state = await queue.ready();
		let seeds = this.seedsFrom(state);
		if (seeds.length === 0) {
			// Nothing queued yet, so the night has to start from what the last one played.
			const library = await readLibrary();
			seeds = library
				.filter((e) => WATCH_ID.test(e.id))
				.slice(0, SEEDS)
				.map((e) => ({ id: e.id, label: `${e.uploader} ${e.title}`.trim() }));
		}
		if (seeds.length === 0) return [];
		return this.suggest(seeds, want, this.seen(state));
	}

	/**
	 * Keep the queue from running out, one track at a time.
	 *
	 * Appending one per call rather than a batch is what paces the machine: preparing a track
	 * is a download and an analysis, so the queue grows at the rate it is consumed instead of
	 * committing the next hour before the current song is over.
	 */
	async topUp(now: number): Promise<boolean> {
		if (!(await settings.autopilotOn())) return false;
		if (this.consecutive >= MAX_CONSECUTIVE || this.failures >= MAX_FAILURES) return false;
		if (now < this.coolUntil || now - this.lastAttempt < MIN_INTERVAL_MS) return false;

		const before = await queue.ready();
		// Autopilot keeps a night going; it does not start one, because with nothing queued
		// there is nothing to be a neighbour of.
		if (before.items.length === 0) return false;
		if (unplayedAhead(before) >= LOOKAHEAD) return false;

		this.lastAttempt = now;
		let picks: Song[];
		try {
			picks = await this.suggest(this.seedsFrom(before), 1, this.seen(before));
		} catch {
			this.coolUntil = now + COOLDOWN_MS;
			return false;
		}
		if (picks.length === 0) {
			this.coolUntil = now + COOLDOWN_MS;
			return false;
		}

		// The fetch took a moment, and anyone may have queued something in it. Deciding against
		// the state we started from would queue a stranger behind a guest's pick.
		const after = await queue.ready();
		if (after.items.length === 0 || unplayedAhead(after) >= LOOKAHEAD) return false;
		const seen = this.seen(after);
		const song = picks.find((s) => !seen.has(s.id));
		if (!song) return false;

		const item: NewItem = {
			source: watchUrl(song.id),
			trackId: song.id,
			title: song.title,
			uploader: song.artist,
			thumbnail: song.thumbnail,
			duration: song.duration,
			auto: true
		};
		await queue.add(await enrichFromLibrary([item]));
		this.consecutive += 1;
		this.remember(song);
		return true;
	}
}

/** Rows after the current one that have not failed, which is what "the queue is running out" means. */
function unplayedAhead(state: QueueState): number {
	const at = state.items.findIndex((i) => i.key === state.currentKey);
	if (at === -1) return state.items.length;
	return state.items.slice(at + 1).filter((i) => i.status !== 'error').length;
}

export const autopilot = new Autopilot();
