/** Safe filesystem operations: path traversal protection, temp dirs, and home resolution. */
import os from "node:os";
import path from "node:path";
import { safePathWithin } from "./fs-utils.js";

/**
 * Resolve path segments under a root directory, blocking path traversal.
 * Throws if the resolved path escapes the root.
 */
export function safePath(root: string, ...segments: string[]): string {
	return safePathWithin(root, ...segments);
}

/** Resolve the configured app data directory. Checks `GARDEN_DIR`, then falls back to `~/Garden`. */
export function getGardenDir(): string {
	return process.env.GARDEN_DIR ?? path.join(os.homedir(), "Garden");
}

/** Path to the user's Quadlet unit directory for rootless containers. */
export function getQuadletDir(): string {
	return path.join(os.homedir(), ".config", "containers", "systemd");
}

/** Path to the OS update status file written by the update-check timer. */
export function getUpdateStatusPath(): string {
	return path.join(os.homedir(), ".garden", "update-status.json");
}

/** Path to the local repo clone used for local-only proposal workflows. */
export function getGardenRepoDir(): string {
	return process.env.GARDEN_REPO_DIR ?? path.join(os.homedir(), ".garden", "pi-garden");
}
