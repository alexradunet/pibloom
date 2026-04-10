import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { stringifyFrontmatter } from "../../../lib/frontmatter.js";
import { atomicWriteFile } from "../../../lib/filesystem.js";
import { err, nowIso, ok } from "../../../lib/utils.js";
import { appendEvent } from "./actions-meta.js";
import { makeSourceId, todayStamp } from "./paths.js";
import type { ActionResult, SourceManifest } from "./types.js";

function sha256(value: string | Buffer): string {
	return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function listExistingSourceIds(wikiRoot: string): string[] {
	const dir = path.join(wikiRoot, "raw");
	try {
		return readdirSync(dir, { withFileTypes: true })
			.filter((e) => e.isDirectory() && e.name.startsWith("SRC-"))
			.map((e) => e.name);
	} catch {
		return [];
	}
}

function scaffoldSourcePage(
	wikiRoot: string,
	sourceId: string,
	title: string,
	kind: string,
	capturedAt: string,
	originType: string,
	originValue: string,
	tags: string[],
): string {
	const fm: Record<string, unknown> = {
		type: "source",
		source_id: sourceId,
		title,
		kind,
		status: "captured",
		captured_at: capturedAt,
		origin_type: originType,
		origin_value: originValue,
		aliases: [],
		tags,
		source_ids: [sourceId],
		summary: "",
	};
	const body = [
		`# ${title}`,
		"",
		"## Source at a glance",
		`- Source ID: ${sourceId}`,
		`- Kind: ${kind}`,
		`- Captured: ${capturedAt}`,
		"",
		"## Summary",
		"",
		"## Key claims",
		"",
		"## Entities and concepts mentioned",
		"",
		"## Reliability / caveats",
		"",
		"## Integration targets",
		"",
		"## Open questions",
		"",
	].join("\n");
	const relPath = path.join("pages", "sources", `${sourceId}.md`);
	const absPath = path.join(wikiRoot, relPath);
	mkdirSync(path.dirname(absPath), { recursive: true });
	atomicWriteFile(absPath, stringifyFrontmatter(fm, body));
	return relPath.split("\\").join("/");
}

export function captureText(
	wikiRoot: string,
	text: string,
	options?: { title?: string; kind?: string; tags?: string[] },
	now = new Date(),
): ActionResult {
	const existingIds = listExistingSourceIds(wikiRoot);
	const sourceId = makeSourceId(existingIds, now);
	const absPacket = path.join(wikiRoot, "raw", sourceId);
	mkdirSync(path.join(absPacket, "original"), { recursive: true });

	const capturedAt = now.toISOString();
	const title = options?.title ?? text.split("\n").find((l) => l.trim())?.slice(0, 80) ?? sourceId;
	const kind = options?.kind ?? "note";
	const hash = sha256(text);

	writeFileSync(path.join(absPacket, "original", "source.txt"), text, "utf-8");
	atomicWriteFile(path.join(absPacket, "extracted.md"), text);

	const manifest: SourceManifest = {
		version: 1,
		sourceId,
		title,
		kind,
		origin: { type: "text", value: "(inline)" },
		capturedAt,
		hash,
		status: "captured",
	};
	atomicWriteFile(path.join(absPacket, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

	const relPacketDir = path.join("raw", sourceId).split("\\").join("/");
	const sourcePagePath = scaffoldSourcePage(wikiRoot, sourceId, title, kind, capturedAt, "text", "(inline)", options?.tags ?? []);

	void appendEvent(wikiRoot, {
		ts: capturedAt,
		kind: "capture",
		title: `Captured ${title}`,
		sourceIds: [sourceId],
		pagePaths: [sourcePagePath],
	});

	return ok({
		text: `Captured ${sourceId}: ${title}`,
		details: { sourceId, packetDir: relPacketDir, sourcePagePath, title, status: "captured" },
	});
}

export function captureFile(
	wikiRoot: string,
	absoluteFilePath: string,
	options?: { title?: string; kind?: string; tags?: string[] },
	now = new Date(),
): ActionResult {
	if (!existsSync(absoluteFilePath)) return err(`File not found: ${absoluteFilePath}`);

	const existingIds = listExistingSourceIds(wikiRoot);
	const sourceId = makeSourceId(existingIds, now);
	const absPacket = path.join(wikiRoot, "raw", sourceId);
	mkdirSync(path.join(absPacket, "original"), { recursive: true });

	const capturedAt = now.toISOString();
	const ext = path.extname(absoluteFilePath) || ".bin";
	const destOriginal = path.join(absPacket, "original", `source${ext}`);
	copyFileSync(absoluteFilePath, destOriginal);

	const content = readFileSync(absoluteFilePath, "utf-8");
	const hash = sha256(content);
	atomicWriteFile(path.join(absPacket, "extracted.md"), content);

	const title = options?.title ?? path.basename(absoluteFilePath, ext);
	const kind = options?.kind ?? (ext === ".pdf" ? "pdf" : "note");

	const manifest: SourceManifest = {
		version: 1,
		sourceId,
		title,
		kind,
		origin: { type: "file", value: absoluteFilePath },
		capturedAt,
		hash,
		status: "captured",
	};
	atomicWriteFile(path.join(absPacket, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

	const relPacketDir = path.join("raw", sourceId).split("\\").join("/");
	const sourcePagePath = scaffoldSourcePage(wikiRoot, sourceId, title, kind, capturedAt, "file", absoluteFilePath, options?.tags ?? []);

	void appendEvent(wikiRoot, {
		ts: capturedAt,
		kind: "capture",
		title: `Captured ${title}`,
		sourceIds: [sourceId],
		pagePaths: [sourcePagePath],
	});

	return ok({
		text: `Captured ${sourceId}: ${title}`,
		details: { sourceId, packetDir: relPacketDir, sourcePagePath, title, status: "captured" },
	});
}
