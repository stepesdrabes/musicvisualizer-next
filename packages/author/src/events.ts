import type { TrackAnalysis } from '@mv/core';

/** What the author is doing, as it happens. Forwarded verbatim to the browser over SSE. */
export type AuthorEvent =
	| { type: 'phase'; phase: 'research' | 'brief' | 'build'; label: string }
	| { type: 'thinking'; text: string }
	| { type: 'tool'; id: string; name: string; detail: string }
	| { type: 'result'; id: string; name: string; summary: string; ok: boolean }
	| { type: 'brief'; brief: string }
	| { type: 'analysis'; analysis: TrackAnalysis; reason: string }
	| { type: 'note'; text: string };

export type OnAuthorEvent = (event: AuthorEvent) => void;

/** Short, human-readable summary of a tool call's arguments. */
export function describeToolCall(name: string, input: unknown): string {
	const short = name.replace(/^mcp__lightdesk__/, '');
	const a = (input ?? {}) as Record<string, unknown>;

	switch (short) {
		case 'get_bars':
			return `bars ${a.fromBar}-${a.toBar}`;
		case 'get_onsets':
			return `${a.instrument} in bars ${a.fromBar}-${a.toBar}`;
		case 'audio_stats':
			return `bars ${a.fromBar}-${a.toBar}`;
		case 'test_effect':
			return String(a.id ?? '');
		case 'reanalyse':
			return a.bpm ? `at ${a.bpm} bpm` : 'default tempo';
		case 'lint_show':
		case 'submit_show': {
			const show = a.show as { cues?: unknown[]; hits?: unknown[] } | undefined;
			return show?.cues ? `${show.cues.length} cues, ${show.hits?.length ?? 0} hits` : '';
		}
		case 'Bash':
			return String(a.command ?? '').slice(0, 90);
		case 'WebSearch':
			return String(a.query ?? '').slice(0, 90);
		case 'WebFetch':
			return String(a.url ?? '').slice(0, 90);
		case 'Read':
			return String(a.file_path ?? '').split('/').pop() ?? '';
		default:
			return '';
	}
}

/** First meaningful line of a tool result, for the activity feed. */
export function summariseResult(text: string): string {
	const trimmed = text.trim();
	if (!trimmed) return 'done';
	const first = trimmed.split('\n').find((l) => l.trim().length > 0) ?? '';
	return first.length > 140 ? `${first.slice(0, 140)}...` : first;
}

/** A tool can answer successfully and still be reporting a rejection. */
export function looksRejected(text: string): boolean {
	return /^(REJECTED|NOT ACCEPTED|Not read|Not accepted|FAILED)/i.test(text.trim());
}

export function toolLabel(name: string): string {
	return name.replace(/^mcp__lightdesk__/, '');
}
