export interface MenuItem {
	id: string;
	label: string;
	/** Trailing text: what the option costs, what it is, why it is unavailable. */
	note?: string;
	disabled?: boolean;
	title?: string;
}

export interface MenuGroup {
	/** Absent for a group that needs no heading, which is most of them. */
	label?: string;
	/** The item currently chosen in this group, which is drawn with a tick. */
	value?: string;
	items: MenuItem[];
}

/**
 * The one anchored menu on the page, opened from wherever asked for it.
 *
 * It cannot be a child of the control that opens it. Every panel in this app carries a
 * `backdrop-filter`, which makes it a containing block for `position: fixed`, so a menu written
 * inside the inspector would anchor to the rail and be clipped by its scroll. This is the same
 * split, and for the same reason, as [[room]]: a small shared store, one component at the page
 * root, and a rect handed across.
 */
class MenuClient {
	/**
	 * How to build the list, not the list itself.
	 *
	 * Picking leaves the menu open - model and effort are two choices in one - so the ticks have
	 * to follow the choice being made. A snapshot taken when it opened cannot: it would still be
	 * showing whatever was chosen last time until the menu was closed and opened again.
	 */
	build = $state<(() => MenuGroup[]) | null>(null);
	/** Viewport coordinates of the control that opened it. Null when closed. */
	anchor = $state<DOMRect | null>(null);

	private handler: ((group: number, id: string) => void) | null = null;

	get open(): boolean {
		return this.anchor !== null;
	}

	show(
		trigger: HTMLElement,
		build: () => MenuGroup[],
		onpick: (group: number, id: string) => void
	): void {
		this.build = build;
		this.handler = onpick;
		this.anchor = trigger.getBoundingClientRect();
	}

	close(): void {
		this.anchor = null;
		this.build = null;
		this.handler = null;
	}

	pick(group: number, id: string): void {
		this.handler?.(group, id);
	}
}

export const menu = new MenuClient();
