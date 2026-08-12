/**
 * Which desk is authoring the show.
 *
 * The agent runs through the Claude Agent SDK, which spawns the `claude` CLI, and the CLI takes
 * its endpoint from the environment. DeepSeek publishes an Anthropic-compatible endpoint, so a
 * second backend is an environment for the subprocess rather than a second agent loop: the
 * tools, the event stream, web search and the shell all keep working exactly as they do against
 * Anthropic. `query()` takes that environment per call, so both backends coexist in one process
 * and nothing global is mutated.
 *
 * What DeepSeek's endpoint does NOT support is worth knowing before reaching for anything:
 * image input, `cache_control` (its own caching is automatic instead), `top_k`, and Anthropic
 * beta headers. Effort is `low` / `high` / `max` only.
 */
export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export type BackendId = 'claude' | 'deepseek';

export interface AuthorProvider {
	id: BackendId;
	/** Shown in the app, beside the button that spends it. */
	label: string;
	model: string;
	/** The effort levels this backend implements, which are not the same set. */
	effort(level: EffortLevel): EffortLevel;
	/** Extra environment for the spawned CLI. Absent for Anthropic's own endpoint. */
	env?: Record<string, string | undefined>;
}

export const CLAUDE: AuthorProvider = {
	id: 'claude',
	label: 'Claude',
	model: 'claude-opus-5',
	effort: (level) => level
};

export interface AuthorModel {
	id: string;
	label: string;
	/** One phrase on what picking it changes, shown beside the name. */
	note: string;
	backend: BackendId;
}

/**
 * The models the app offers, in the order it offers them.
 *
 * Every one of them has a million-token context, which is the entry requirement rather than a
 * preference: the bar table for a four-minute track plus the DSL reference is most of a
 * 200k window before the agent has read anything, and a model that compacts halfway through
 * loses the grid its cues are addressed against. That is what rules out Haiku here, and it is
 * the same constraint `deepseek`'s `CLAUDE_CODE_AUTO_COMPACT_WINDOW` below is answering.
 */
export const AUTHOR_MODELS: readonly AuthorModel[] = [
	{ id: 'claude-opus-5', label: 'Claude Opus 5', note: 'Default', backend: 'claude' },
	{ id: 'claude-sonnet-5', label: 'Claude Sonnet 5', note: 'Cheaper', backend: 'claude' },
	{ id: 'claude-opus-4-8', label: 'Claude Opus 4.8', note: 'Previous', backend: 'claude' },
	{ id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash', note: 'Cheapest', backend: 'deepseek' }
];

export const DEFAULT_MODEL = AUTHOR_MODELS[0].id;

/** Anthropic's five. DeepSeek folds them into its three through `deepseekEffort`. */
export const EFFORTS: readonly EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max'];
export const DEFAULT_EFFORT: EffortLevel = 'high';

/** Undefined for anything not on the list, which is how an unknown id fails to be honoured. */
export function authorModel(id: string | undefined): AuthorModel | undefined {
	return AUTHOR_MODELS.find((m) => m.id === id);
}

export function isEffort(v: unknown): v is EffortLevel {
	return EFFORTS.includes(v as EffortLevel);
}

/**
 * V4 offers three levels where Anthropic offers five.
 *
 * Mapped rather than passed through: an unrecognised value is not an error the endpoint reports,
 * so a silent downgrade to the default is what a caller asking for `xhigh` would actually get.
 */
function deepseekEffort(level: EffortLevel): EffortLevel {
	if (level === 'low' || level === 'medium') return 'low';
	if (level === 'max') return 'max';
	return 'high';
}

export function deepseek(apiKey: string): AuthorProvider {
	return {
		id: 'deepseek',
		label: 'DeepSeek V4 Flash',
		model: 'deepseek-v4-flash',
		effort: deepseekEffort,
		env: {
			ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
			ANTHROPIC_AUTH_TOKEN: apiKey,
			ANTHROPIC_MODEL: 'deepseek-v4-flash',
			ANTHROPIC_DEFAULT_OPUS_MODEL: 'deepseek-v4-flash',
			ANTHROPIC_DEFAULT_SONNET_MODEL: 'deepseek-v4-flash',
			ANTHROPIC_DEFAULT_HAIKU_MODEL: 'deepseek-v4-flash',
			// A key left over from an Anthropic login takes precedence over the token above, and
			// the failure is a 401 from a host that was never asked for.
			ANTHROPIC_API_KEY: undefined,
			// The subprocess has to identify as what it is - a CLI spawned by this SDK - and not
			// as whatever launched the server. The SDK sets this itself only when it is unset, so
			// a dev server started from inside a Claude Code session hands the child
			// `claude-desktop`, the child then authenticates the way the desktop app does, and
			// DeepSeek answers 401 for a credential nobody meant to send it. Harmless against
			// Anthropic, which accepts that credential; wrong for every other endpoint.
			CLAUDE_CODE_ENTRYPOINT: 'sdk-ts',
			// The context is a million tokens; compacting at the Anthropic default would throw
			// away the bar table halfway through a build pass.
			CLAUDE_CODE_AUTO_COMPACT_WINDOW: '786432'
		}
	};
}

/** The environment the subprocess actually gets: this process's, plus the backend's overrides. */
export function environmentFor(provider: AuthorProvider): Record<string, string | undefined> {
	if (!provider.env) return process.env;
	return { ...process.env, ...provider.env };
}
