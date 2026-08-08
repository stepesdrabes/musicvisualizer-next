/**
 * The queue as data and pure transitions over it.
 *
 * Kept apart from the file it is persisted to and the stream it is published on, because
 * every interesting question about a queue - what "next" means when the current track was
 * removed, what happens when the same track is added twice - is answerable without either.
 * The server module owns persistence; this owns the meaning.
 */

export type ItemStatus =
	| 'pending'
	| 'resolving'
	| 'downloading'
	| 'analysing'
	| 'ready'
	| 'error';

export type Authored = 'none' | 'engine' | 'claude';

export interface QueueItem {
	/**
	 * Identifies the row, not the track. The same song may sit in the queue twice, and after
	 * the first copy plays the second still has to be addressable.
	 */
	key: string;
	/** A YouTube URL or a local path. The only thing known before it is resolved. */
	source: string;
	/** Null until resolving succeeds. */
	trackId: string | null;
	title: string;
	uploader: string;
	thumbnail: string;
	/** Seconds; 0 when not yet known. */
	duration: number;
	status: ItemStatus;
	/** Why it failed, or which stage it is in. Empty when there is nothing to say. */
	message: string;
	authored: Authored;
	/** Reserved for guests adding from their own device. Absent means the host added it. */
	addedBy?: string;
	addedAt: number;
}

export interface QueueState {
	items: QueueItem[];
	/** The row that is playing, by key. Null when the queue is empty or has run out. */
	currentKey: string | null;
	/** Bumped on every mutation, so a client can tell a stale snapshot from a fresh one. */
	revision: number;
}

export const EMPTY_QUEUE: QueueState = { items: [], currentKey: null, revision: 0 };

export interface NewItem {
	source: string;
	trackId?: string | null;
	title?: string;
	uploader?: string;
	thumbnail?: string;
	duration?: number;
	authored?: Authored;
	addedBy?: string;
}

export function indexOfKey(state: QueueState, key: string | null): number {
	return key === null ? -1 : state.items.findIndex((i) => i.key === key);
}

export function currentItem(state: QueueState): QueueItem | null {
	const i = indexOfKey(state, state.currentKey);
	return i === -1 ? null : state.items[i];
}

/** The row after the current one, which is the only one worth preparing ahead. */
export function nextItem(state: QueueState): QueueItem | null {
	const i = indexOfKey(state, state.currentKey);
	if (i === -1) return state.items[0] ?? null;
	return state.items[i + 1] ?? null;
}

function makeItem(input: NewItem, key: string, now: number): QueueItem {
	return {
		key,
		source: input.source,
		trackId: input.trackId ?? null,
		title: input.title ?? input.source,
		uploader: input.uploader ?? '',
		thumbnail: input.thumbnail ?? '',
		duration: input.duration ?? 0,
		// A track already in the cache is ready the moment it is queued; nothing to fetch.
		status: input.trackId && input.authored && input.authored !== 'none' ? 'ready' : 'pending',
		message: '',
		authored: input.authored ?? 'none',
		addedBy: input.addedBy,
		addedAt: now
	};
}

/**
 * Append, and take over as current if nothing was playing.
 *
 * Adding never interrupts. A queue whose point is that several people put songs into it
 * cannot have the newest arrival cut off whatever is running.
 */
export function addItems(
	state: QueueState,
	inputs: NewItem[],
	keyFor: (index: number) => string,
	now: number
): QueueState {
	if (inputs.length === 0) return state;
	const added = inputs.map((input, i) => makeItem(input, keyFor(i), now));
	const items = [...state.items, ...added];
	return {
		items,
		currentKey: state.currentKey ?? added[0].key,
		revision: state.revision + 1
	};
}

/**
 * Remove a row.
 *
 * Removing what is playing hands the room to whatever moved up into its place, so the
 * gesture reads as "skip this" rather than "stop the music".
 */
export function removeItem(state: QueueState, key: string): QueueState {
	const at = indexOfKey(state, key);
	if (at === -1) return state;
	const items = state.items.filter((i) => i.key !== key);
	let currentKey = state.currentKey;
	if (state.currentKey === key) currentKey = items[at]?.key ?? items[at - 1]?.key ?? null;
	return { items, currentKey, revision: state.revision + 1 };
}

export function clearQueue(state: QueueState, keepCurrent: boolean): QueueState {
	const current = keepCurrent ? currentItem(state) : null;
	return {
		items: current ? [current] : [],
		currentKey: current?.key ?? null,
		revision: state.revision + 1
	};
}

/** Move a row to an absolute index, clamped. Reordering never changes what is playing. */
export function moveItem(state: QueueState, key: string, to: number): QueueState {
	const from = indexOfKey(state, key);
	if (from === -1) return state;
	const target = Math.max(0, Math.min(state.items.length - 1, Math.floor(to)));
	if (target === from) return state;
	const items = [...state.items];
	const [row] = items.splice(from, 1);
	items.splice(target, 0, row);
	return { ...state, items, revision: state.revision + 1 };
}

/** Put a row directly after the current one, which is what "play next" means. */
export function playNext(state: QueueState, key: string): QueueState {
	const at = indexOfKey(state, state.currentKey);
	return moveItem(state, key, at === -1 ? 0 : at + 1);
}

export function jumpTo(state: QueueState, key: string): QueueState {
	if (indexOfKey(state, key) === -1) return state;
	return { ...state, currentKey: key, revision: state.revision + 1 };
}

/**
 * Step through the queue. Stops at both ends rather than wrapping: a set that silently
 * restarts is worse than one that ends.
 */
export function step(state: QueueState, dir: -1 | 1): QueueState {
	const at = indexOfKey(state, state.currentKey);
	if (at === -1) {
		const first = dir > 0 ? state.items[0] : state.items[state.items.length - 1];
		return first ? { ...state, currentKey: first.key, revision: state.revision + 1 } : state;
	}
	const target = state.items[at + dir];
	if (!target) return state;
	return { ...state, currentKey: target.key, revision: state.revision + 1 };
}

export function patchItem(
	state: QueueState,
	key: string,
	patch: Partial<Omit<QueueItem, 'key'>>
): QueueState {
	const at = indexOfKey(state, key);
	if (at === -1) return state;
	const items = [...state.items];
	items[at] = { ...items[at], ...patch };
	return { ...state, items, revision: state.revision + 1 };
}

/**
 * Whether a guest may pull a row back out.
 *
 * Their own, and not the one playing. Removing what is playing is a skip however it is
 * spelled, and a room where anyone can skip is a room where nobody finishes a song. An
 * anonymous row belongs to nobody and so cannot be removed by anybody.
 */
export function canGuestRemove(state: QueueState, key: string, guest: string): boolean {
	if (!guest) return false;
	const item = state.items.find((i) => i.key === key);
	return item !== undefined && item.addedBy === guest && state.currentKey !== key;
}

/** Whether two snapshots of an item differ in anything a queue row draws. */
export function sameItem(a: QueueItem, b: QueueItem): boolean {
	return (
		a.key === b.key &&
		a.trackId === b.trackId &&
		a.title === b.title &&
		a.uploader === b.uploader &&
		a.thumbnail === b.thumbnail &&
		a.duration === b.duration &&
		a.status === b.status &&
		a.message === b.message &&
		a.authored === b.authored
	);
}
