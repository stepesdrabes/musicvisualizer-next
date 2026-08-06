import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * Where the workspace lives, found by walking up to the package.json that declares workspaces.
 *
 * Anchored here rather than to cwd because the dev server runs from `apps/web`, so anything
 * cwd-relative lands somewhere else and re-fetches everything it was supposed to have cached.
 */
export function workspaceRoot(): string {
	let dir = import.meta.dirname;
	for (let i = 0; i < 8; i++) {
		try {
			const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
				workspaces?: unknown;
			};
			if (pkg.workspaces) return dir;
		} catch {
			// Keep walking.
		}
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return process.cwd();
}

/** Decoded audio and analysis blobs. */
export const CACHE_DIR = process.env.MV_CACHE_DIR
	? resolve(process.env.MV_CACHE_DIR)
	: join(workspaceRoot(), 'cache');

/** Model weights. Big, fetched once, and no more part of the repo than the audio is. */
export const MODEL_DIR = process.env.MV_MODEL_DIR
	? resolve(process.env.MV_MODEL_DIR)
	: join(workspaceRoot(), 'models');
