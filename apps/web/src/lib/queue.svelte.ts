import { EMPTY_QUEUE, currentItem, type NewItem, type QueueState } from './queueModel.ts';

/**
 * A view onto the server's queue.
 *
 * Deliberately holds no authority: every mutation is a POST and the new state arrives back
 * over the stream like anybody else's would. That is what lets a phone in the room change
 * the queue without this tab having a stale copy of it, and it is why there is no optimistic
 * update here - a queue two people are editing is one where guessing is worse than waiting.
 */
export class QueueClient {
	state = $state<QueueState>(EMPTY_QUEUE);
	connected = $state(false);

	private source: EventSource | null = null;

	get current() {
		return currentItem(this.state);
	}

	get items() {
		return this.state.items;
	}

	connect(): void {
		if (this.source) return;
		const es = new EventSource('/api/queue/stream');
		es.addEventListener('queue', (ev) => {
			this.state = JSON.parse((ev as MessageEvent).data) as QueueState;
			this.connected = true;
		});
		// EventSource reconnects on its own; this only reports that it is trying.
		es.addEventListener('error', () => (this.connected = false));
		this.source = es;
	}

	dispose(): void {
		this.source?.close();
		this.source = null;
	}

	private post(body: Record<string, unknown>): Promise<Response> {
		return fetch('/api/queue', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		});
	}

	/**
	 * Returns the state the server built for this call, whose last rows are the ones just
	 * added. Reading them off the live queue instead would be a guess: it is fed by the stream,
	 * and anyone else - a phone in the room, the radio topping the queue up - may have appended
	 * between the POST and its reply.
	 */
	async add(items: NewItem[]): Promise<QueueState | null> {
		const res = await this.post({ action: 'add', items });
		if (!res.ok) return null;
		return (await res.json()) as QueueState;
	}

	remove(key: string): Promise<Response> {
		return this.post({ action: 'remove', key });
	}

	move(key: string, to: number): Promise<Response> {
		return this.post({ action: 'move', key, to });
	}

	playNext(key: string): Promise<Response> {
		return this.post({ action: 'playNext', key });
	}

	jump(key: string): Promise<Response> {
		return this.post({ action: 'jump', key });
	}

	next(): Promise<Response> {
		return this.post({ action: 'next' });
	}

	prev(): Promise<Response> {
		return this.post({ action: 'prev' });
	}

	clear(keepCurrent = true): Promise<Response> {
		return this.post({ action: 'clear', keepCurrent });
	}

	retry(key: string): Promise<Response> {
		return this.post({ action: 'retry', key });
	}
}
