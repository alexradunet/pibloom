/** Safe filesystem operations: path traversal protection, temp dirs, and home resolution. */
import { existsSync, mkdirSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/** Ensure a directory exists. */
export function ensureDir(dir: string, mode?: number): void {
	if (existsSync(dir)) return;
	mkdirSync(dir, { recursive: true, ...(mode ? { mode } : {}) });
}

/** Write a file atomically via temporary sibling + rename. */
export function atomicWriteFile(filePath: string, content: string, mode?: number): void {
	ensureDir(path.dirname(filePath), mode);
	const tmpPath = `${filePath}.tmp`;
	writeFileSync(tmpPath, content, "utf-8");
	renameSync(tmpPath, filePath);
}

/**
 * Resolve a path under a root directory and reject traversal, including
 * escaping through existing symlinks.
 */
export function safePathWithin(root: string, ...segments: string[]): string {
	const resolvedRoot = path.resolve(root);
	const resolvedPath = path.resolve(resolvedRoot, ...segments);
	if (segments.length === 0) return resolvedRoot;

	if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(`${resolvedRoot}${path.sep}`)) {
		throw new Error(`Path traversal blocked: ${segments.join("/")} escapes ${root}`);
	}

	const existingRoot = existsSync(resolvedRoot) ? realpathSync(resolvedRoot) : resolvedRoot;
	const existingParent = existsSync(path.dirname(resolvedPath))
		? realpathSync(path.dirname(resolvedPath))
		: path.dirname(resolvedPath);
	const existingTarget = existsSync(resolvedPath) ? realpathSync(resolvedPath) : resolvedPath;

	for (const candidate of [existingParent, existingTarget]) {
		if (candidate !== existingRoot && !candidate.startsWith(`${existingRoot}${path.sep}`)) {
			throw new Error(`Path traversal blocked: ${segments.join("/")} escapes ${root}`);
		}
	}

	return resolvedPath;
}

/**
 * Resolve path segments under a root directory, blocking path traversal.
 * Throws if the resolved path escapes the root.
 */
export function safePath(root: string, ...segments: string[]): string {
	return safePathWithin(root, ...segments);
}

/** Resolve the configured app data directory. Checks `NIXPI_DIR`, then falls back to `~/nixPI`. */
export function getNixpiDir(): string {
	return process.env.NIXPI_DIR ?? path.join(os.homedir(), "nixPI");
}

/** Resolve the configured Pi runtime directory. */
export function getPiDir(): string {
	return process.env.NIXPI_PI_DIR ?? path.join(os.homedir(), ".pi");
}

/** Path to the user's Quadlet unit directory for rootless containers. */
export function getQuadletDir(): string {
	return path.join(os.homedir(), ".config", "containers", "systemd");
}

/** Path to the OS update status file written by the update-check timer. */
export function getUpdateStatusPath(): string {
	return path.join(os.homedir(), ".nixpi", "update-status.json");
}

/** Resolve the dedicated daemon state directory. */
export function getDaemonStateDir(): string {
	return process.env.NIXPI_DAEMON_STATE_DIR ?? path.join(getPiDir(), "nixpi-daemon");
}

/** Path to the local repo clone used for local-only proposal workflows. */
export function getNixpiRepoDir(): string {
	return process.env.NIXPI_REPO_DIR ?? path.join(os.homedir(), ".nixpi", "pi-nixpi");
}
