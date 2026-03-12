/** Safe filesystem operations: path traversal protection, temp dirs, and home resolution. */
import os from "node:os";
import path from "node:path";

/**
 * Resolve path segments under a root directory, blocking path traversal.
 * Throws if the resolved path escapes the root.
 */
export function safePath(root: string, ...segments: string[]): string {
	const resolved = path.resolve(root, ...segments);
	const normalRoot = path.resolve(root);
	if (!resolved.startsWith(normalRoot + path.sep) && resolved !== normalRoot) {
		throw new Error(`Path traversal blocked: ${segments.join("/")} escapes ${root}`);
	}
	return resolved;
}

/** Resolve the Bloom directory. Checks `BLOOM_DIR` env var, then falls back to `~/Bloom`. */
export function getBloomDir(): string {
	return process.env.BLOOM_DIR ?? path.join(os.homedir(), "Bloom");
}

/** Path to the OS update status file written by the update-check timer. */
export function getUpdateStatusPath(): string {
	return path.join(os.homedir(), ".bloom", "update-status.json");
}
