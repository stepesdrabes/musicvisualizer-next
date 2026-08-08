export interface RoomInfo {
	token: string;
	address: string | null;
	/** Null when this machine has no network address a phone could reach. */
	url: string | null;
}

/**
 * The room code, shared between the trigger in the queue rail and the dialog at the page root.
 *
 * They are apart because a dialog cannot live inside a panel that blurs its backdrop: that
 * makes the panel a containing block, and `position: fixed` then centres on the rail rather
 * than the window. A small shared store is how the two halves stay one thing without threading
 * state through the panel between them.
 */
class RoomClient {
	info = $state<RoomInfo | null>(null);
	open = $state(false);
	rotating = $state(false);

	async load(): Promise<void> {
		try {
			const res = await fetch('/api/room');
			if (res.ok) this.info = (await res.json()) as RoomInfo;
		} catch {
			// No code to show, which the dialog's empty state already covers.
		}
	}

	async rotate(): Promise<void> {
		this.rotating = true;
		try {
			const res = await fetch('/api/room', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ action: 'rotate' })
			});
			if (res.ok) this.info = (await res.json()) as RoomInfo;
		} finally {
			this.rotating = false;
		}
	}
}

/**
 * One per page rather than one per component: there is a single room, and both halves of its
 * interface have to agree about the code on screen.
 */
export const room = new RoomClient();
