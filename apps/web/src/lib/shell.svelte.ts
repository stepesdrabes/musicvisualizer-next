/**
 * What the desktop shell tells the page about itself.
 *
 * Injected as a global before any of the page's own script runs, rather than fetched, because
 * the top bar has to reserve space for the traffic lights on the very first frame and a round
 * trip would show the layout moving. Absent in a browser, which is the whole point: the same
 * build serves both and the web version reserves nothing.
 */
export interface ShellHints {
	desktop: boolean;
	platform: string;
	/** Pixels of leading space the window's own controls need. Zero off macOS. */
	trafficLightInset: number;
	/** Command-line tools the analysis pipeline needs that are not on PATH. */
	missingTools: string[];
}

const NONE: ShellHints = {
	desktop: false,
	platform: 'web',
	trafficLightInset: 0,
	missingTools: []
};

declare global {
	interface Window {
		__LIGHTNINGSTRIKE__?: Partial<ShellHints>;
	}
}

export function readShell(): ShellHints {
	if (typeof window === 'undefined') return NONE;
	const given = window.__LIGHTNINGSTRIKE__;
	if (!given?.desktop) return NONE;
	return {
		desktop: true,
		platform: given.platform ?? 'unknown',
		trafficLightInset: given.trafficLightInset ?? 0,
		missingTools: given.missingTools ?? []
	};
}

/** How to install what is missing, on the platform it is missing from. */
export function installHint(platform: string, tools: string[]): string {
	const list = tools.join(' ');
	if (platform === 'macos') return `brew install ${list}`;
	if (platform === 'windows') return `winget install ${list}`;
	return `Install ${list} with your package manager.`;
}
