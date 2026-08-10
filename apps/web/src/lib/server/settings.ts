import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { CACHE_DIR } from '@mv/analysis';
import { CLAUDE, deepseek, type AuthorProvider, type BackendId } from '@mv/author-ai';

const SETTINGS_FILE = join(CACHE_DIR, 'settings.json');

interface SettingsFile {
	/**
	 * A DeepSeek platform key, kept here rather than in the environment because the desktop
	 * build launches without a shell to inherit one from. `cache/` is gitignored and the
	 * settings API is loopback-only, which is the same boundary the hardware and the queue sit
	 * behind: anyone who can reach loopback on this machine is already sitting at it.
	 */
	deepseekApiKey?: string;
	/** Which backend the authoring button spends by default. */
	authorBackend?: BackendId;
	/**
	 * How far ahead of the audio the strips are driven, milliseconds.
	 *
	 * DDP and WLED add transport delay the compiler cannot know, and it varies with the board,
	 * the network and the controller. So it belongs to the installation rather than to a track,
	 * and it is dialled by eye against the real room. Positive runs the room early.
	 */
	outputOffsetMs?: number;
}

export interface PublicSettings {
	/** Never the key itself. Whether one is stored is all the interface needs to know. */
	hasDeepseekKey: boolean;
	authorBackend: BackendId;
	outputOffsetMs: number;
}

class Settings {
	private cached: SettingsFile | null = null;

	private async load(): Promise<SettingsFile> {
		if (this.cached) return this.cached;
		try {
			this.cached = JSON.parse(await readFile(SETTINGS_FILE, 'utf8')) as SettingsFile;
		} catch {
			this.cached = {};
		}
		return this.cached;
	}

	async read(): Promise<PublicSettings> {
		const file = await this.load();
		return {
			hasDeepseekKey: typeof file.deepseekApiKey === 'string' && file.deepseekApiKey.length > 0,
			authorBackend: file.authorBackend ?? 'claude',
			outputOffsetMs: file.outputOffsetMs ?? 0
		};
	}

	async update(patch: Partial<SettingsFile>): Promise<PublicSettings> {
		const next = { ...(await this.load()), ...patch };
		// An empty string is how the interface says "forget it", which is not the same as the
		// key being absent from a partial update.
		if (patch.deepseekApiKey === '') delete next.deepseekApiKey;
		this.cached = next;

		await mkdir(CACHE_DIR, { recursive: true });
		const tmp = `${SETTINGS_FILE}.${process.pid}.tmp`;
		await writeFile(tmp, JSON.stringify(next, null, '\t'), { mode: 0o600 });
		await rename(tmp, SETTINGS_FILE);
		return this.read();
	}

	/**
	 * The backend to author with, or why it cannot be.
	 *
	 * An environment variable wins over the stored key, so a dev machine can point at a
	 * different account without editing anything the app also writes to.
	 */
	async provider(id: BackendId): Promise<{ provider: AuthorProvider } | { error: string }> {
		if (id === 'claude') return { provider: CLAUDE };
		const key = process.env.DEEPSEEK_API_KEY || (await this.load()).deepseekApiKey;
		if (!key) return { error: 'no DeepSeek API key is stored; add one in the show panel' };
		return { provider: deepseek(key) };
	}
}

export const settings = new Settings();
