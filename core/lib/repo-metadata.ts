import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { atomicWriteFile } from "./filesystem.js";
import { getPrimaryUser } from "./filesystem.js";

export interface CanonicalRepoMetadata {
	path: string;
	origin: string;
	branch: string;
}

export function getCanonicalRepoMetadataPath(primaryUser = getPrimaryUser()): string {
	return path.join("/home", primaryUser, ".nixpi", "canonical-repo.json");
}

export function readCanonicalRepoMetadata(
	primaryUser = getPrimaryUser(),
	metadataPath = getCanonicalRepoMetadataPath(primaryUser),
): CanonicalRepoMetadata | undefined {
	if (!existsSync(metadataPath)) return undefined;
	return JSON.parse(readFileSync(metadataPath, "utf-8")) as CanonicalRepoMetadata;
}

export function writeCanonicalRepoMetadata(
	metadata: CanonicalRepoMetadata,
	primaryUser = getPrimaryUser(),
	metadataPath = getCanonicalRepoMetadataPath(primaryUser),
): string {
	atomicWriteFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
	return metadataPath;
}
