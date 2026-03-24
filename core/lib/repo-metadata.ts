import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { atomicWriteFile } from "./filesystem.js";
import { assertValidPrimaryUser, getPrimaryUser } from "./filesystem.js";

export interface CanonicalRepoMetadata {
	path: string;
	origin: string;
	branch: string;
}

export function getCanonicalRepoMetadataPath(primaryUser = getPrimaryUser()): string {
	return path.join("/home", assertValidPrimaryUser(primaryUser), ".nixpi", "canonical-repo.json");
}

export function readCanonicalRepoMetadata(
	primaryUser = getPrimaryUser(),
	metadataPath = getCanonicalRepoMetadataPath(primaryUser),
): CanonicalRepoMetadata | undefined {
	if (!existsSync(metadataPath)) return undefined;
	const parsed = JSON.parse(readFileSync(metadataPath, "utf-8")) as Partial<CanonicalRepoMetadata>;
	if (
		typeof parsed.path !== "string" ||
		typeof parsed.origin !== "string" ||
		typeof parsed.branch !== "string"
	) {
		throw new Error(`Invalid canonical repo metadata in ${metadataPath}`);
	}
	return parsed;
}

export function writeCanonicalRepoMetadata(
	metadata: CanonicalRepoMetadata,
	primaryUser = getPrimaryUser(),
	metadataPath = getCanonicalRepoMetadataPath(primaryUser),
): string {
	atomicWriteFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
	return metadataPath;
}
