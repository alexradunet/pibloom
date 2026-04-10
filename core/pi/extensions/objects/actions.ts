/**
 * Handler / business logic for objects.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getNixPiDir, safePathWithin } from "../../../lib/filesystem.js";
import { parseFrontmatter, stringifyFrontmatter } from "../../../lib/frontmatter.js";
import { errorResult, textToolResult, truncate } from "../../../lib/utils.js";
import { defaultObjectBody, mergeObjectState, readMemoryRecord, writeMemoryRecord } from "./memory.js";

type ObjectWriteParams = {
	type: string;
	slug: string;
	fields?: Record<string, unknown>;
	path?: string;
	body?: string;
};

/** Parse a `type/slug` reference string into its components. Throws if format is invalid. */
export function parseRef(ref: string): { type: string; slug: string } {
	const slash = ref.indexOf("/");
	if (slash === -1) throw new Error(`invalid reference format: '${ref}' (expected type/slug)`);
	return { type: ref.slice(0, slash), slug: ref.slice(slash + 1) };
}

/** Walk a directory recursively for .md files. */
export function walkMdFiles(dir: string): string[] {
	if (!fs.existsSync(dir)) return [];
	return fs.globSync("**/*.md", { cwd: dir }).map((f) => path.join(dir, f));
}

function objectsDir(): string {
	return path.join(getNixPiDir(), "Objects");
}

function resolveObjectPath(slug: string, filePath?: string): string {
	return filePath ? safePathWithin(os.homedir(), filePath) : safePathWithin(objectsDir(), `${slug}.md`);
}

function tryResolveObjectPath(slug: string, filePath: string | undefined, invalidMessage: string) {
	try {
		return { filepath: resolveObjectPath(slug, filePath) };
	} catch {
		return { error: errorResult(invalidMessage) };
	}
}

function mergedAttributes(params: ObjectWriteParams, existing?: Record<string, unknown>) {
	return mergeObjectState({
		type: params.type,
		slug: params.slug,
		fields: params.fields,
		existing,
	});
}

function writeObjectRecord(filepath: string, attributes: Record<string, unknown>, body: string): void {
	writeMemoryRecord({
		filepath,
		attributes,
		body,
	});
}

function readObjectRaw(filepath: string) {
	const raw = fs.readFileSync(filepath, "utf-8");
	const { attributes, body } = parseFrontmatter<Record<string, unknown>>(raw);
	return { raw, attributes, body };
}

function appendObjectLink(filepath: string, linkRef: string): void {
	const { attributes, body } = readObjectRaw(filepath);
	const links: string[] = Array.isArray(attributes.links) ? [...(attributes.links as string[])] : [];
	if (!links.includes(linkRef)) {
		links.push(linkRef);
		attributes.links = links;
		fs.writeFileSync(filepath, stringifyFrontmatter(attributes, body));
	}
}

/** Create a new markdown object. */
export function createObject(params: ObjectWriteParams) {
	const resolved = tryResolveObjectPath(params.slug, params.path, "Path traversal blocked: invalid path");
	if (resolved.error) return resolved.error;
	const { filepath } = resolved;
	fs.mkdirSync(path.dirname(filepath), { recursive: true });

	const data = mergedAttributes(params);
	const body = params.body ?? defaultObjectBody(data);

	try {
		fs.writeFileSync(filepath, stringifyFrontmatter(data, body), {
			flag: "wx",
		});
	} catch (err: unknown) {
		if ((err as NodeJS.ErrnoException).code === "EEXIST") {
			return errorResult(`object already exists: ${params.type}/${params.slug}`);
		}
		return errorResult(`failed to create object: ${(err as Error).message}`);
	}

	return textToolResult(`created ${params.type}/${params.slug}`);
}

export function updateObject(params: ObjectWriteParams) {
	const invalidMessage = params.path ? "Path traversal blocked: invalid path" : "Path traversal blocked: invalid slug";
	const resolved = tryResolveObjectPath(params.slug, params.path, invalidMessage);
	if (resolved.error) return resolved.error;
	const { filepath } = resolved;
	const record = readMemoryRecord(filepath);
	if (!record) return errorResult(`object not found: ${params.type}/${params.slug}`);
	const attributes = mergedAttributes(params, record.attributes);
	writeObjectRecord(filepath, attributes, params.body ?? record.body);
	return textToolResult(`updated ${params.type}/${params.slug}`);
}

export function upsertObject(params: ObjectWriteParams) {
	const resolved = tryResolveObjectPath(params.slug, params.path, "Path traversal blocked: invalid path");
	if (resolved.error) return resolved.error;
	const { filepath } = resolved;
	const existing = readMemoryRecord(filepath);
	if (!existing) {
		return createObject(params);
	}
	const attributes = mergedAttributes(params, existing.attributes);
	writeObjectRecord(filepath, attributes, params.body ?? existing.body);
	return textToolResult(`upserted ${params.type}/${params.slug}`, { existed: true });
}

/** Read a markdown object. */
export function readObject(params: { type: string; slug: string; path?: string }) {
	const invalidMessage = params.path ? "Path traversal blocked: invalid path" : "Path traversal blocked: invalid slug";
	const resolved = tryResolveObjectPath(params.slug, params.path, invalidMessage);
	if (resolved.error) return resolved.error;
	const { filepath } = resolved;

	if (!fs.existsSync(filepath)) {
		return errorResult(`object not found: ${params.type}/${params.slug}`);
	}
	const raw = fs.readFileSync(filepath, "utf-8");
	return textToolResult(truncate(raw));
}

/** Add bidirectional links between two objects. */
export function linkObjects(params: { ref_a: string; ref_b: string }) {
	const a = parseRef(params.ref_a);
	const b = parseRef(params.ref_b);
	const resolvedA = tryResolveObjectPath(a.slug, undefined, "Path traversal blocked: invalid slug");
	const resolvedB = tryResolveObjectPath(b.slug, undefined, "Path traversal blocked: invalid slug");
	if (resolvedA.error || resolvedB.error) {
		return errorResult("Path traversal blocked: invalid slug");
	}
	const pathA = resolvedA.filepath;
	const pathB = resolvedB.filepath;

	if (!fs.existsSync(pathA)) return errorResult(`object not found: ${params.ref_a}`);
	if (!fs.existsSync(pathB)) return errorResult(`object not found: ${params.ref_b}`);

	appendObjectLink(pathA, params.ref_b);
	appendObjectLink(pathB, params.ref_a);

	return textToolResult(`linked ${params.ref_a} <-> ${params.ref_b}`);
}
