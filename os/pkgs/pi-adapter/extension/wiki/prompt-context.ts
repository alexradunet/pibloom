import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { getWikiRootForDomain } from "../../../wiki/src/api.ts";

const MEMORY_FILE = "memory/MEMORY.md";
const USER_FILE = "memory/USER.md";

function getTechnicalWikiRoot(): string {
	return getWikiRootForDomain("technical");
}

function readPlainFile(filePath: string): string {
	return existsSync(filePath) ? readFileSync(filePath, "utf-8").trim() : "";
}

export function readMemoryPaths(domain?: string): { memoryPath: string; userPath: string } {
	const wikiRoot = domain === "personal" ? getWikiRootForDomain("personal") : getTechnicalWikiRoot();
	return {
		memoryPath: path.join(wikiRoot, MEMORY_FILE),
		userPath: path.join(wikiRoot, USER_FILE),
	};
}

export function readMemoryStats(domain?: string): { memoryChars: number; userChars: number; memoryPath: string; userPath: string } {
	const { memoryPath, userPath } = readMemoryPaths(domain);
	return {
		memoryPath,
		userPath,
		memoryChars: readPlainFile(memoryPath).length,
		userChars: readPlainFile(userPath).length,
	};
}
