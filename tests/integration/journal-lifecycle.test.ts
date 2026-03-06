import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseFrontmatter } from "../../lib/shared.js";
import { createMockExtensionAPI } from "../helpers/mock-extension-api.js";
import { createTempGarden, type TempGarden } from "../helpers/temp-garden.js";

let temp: TempGarden;

beforeEach(() => {
	temp = createTempGarden();
});

afterEach(() => {
	temp.cleanup();
});

async function setupJournalExtension() {
	const mod = await import("../../extensions/bloom-journal.js");
	const api = createMockExtensionAPI();
	mod.default(api as never);
	return api;
}

function findTool(api: ReturnType<typeof createMockExtensionAPI>, name: string) {
	const tool = api._registeredTools.find((t) => t.name === name);
	if (!tool) throw new Error(`Tool ${name} not found`);
	return tool;
}

async function executeTool(
	api: ReturnType<typeof createMockExtensionAPI>,
	name: string,
	params: Record<string, unknown>,
) {
	const tool = findTool(api, name);
	const execute = tool.execute as (
		id: string,
		params: Record<string, unknown>,
		signal: AbortSignal,
		onUpdate: () => void,
		ctx: unknown,
	) => Promise<{ content: Array<{ type: string; text: string }>; details: Record<string, unknown> }>;
	return execute("test-call", params, AbortSignal.timeout(5000), () => {}, {});
}

describe("journal lifecycle", () => {
	it("journal_write creates file with frontmatter at correct path", async () => {
		const api = await setupJournalExtension();
		const result = await executeTool(api, "journal_write", {
			content: "Test entry",
			date: "2025-06-15",
		});

		expect(result.content[0].text).toContain("2025-06-15");
		const filepath = join(temp.gardenDir, "Journal", "2025", "06", "2025-06-15.md");
		expect(existsSync(filepath)).toBe(true);

		const raw = readFileSync(filepath, "utf-8");
		const parsed = parseFrontmatter(raw);
		expect(parsed.attributes).toHaveProperty("date", "2025-06-15");
		expect(parsed.attributes).toHaveProperty("created");
	});

	it("journal_read returns written content", async () => {
		const api = await setupJournalExtension();
		await executeTool(api, "journal_write", {
			content: "Hello journal",
			date: "2025-06-15",
		});

		const result = await executeTool(api, "journal_read", { date: "2025-06-15" });
		expect(result.content[0].text).toContain("Hello journal");
	});

	it("journal_write appends to existing Pi section without duplication", async () => {
		const api = await setupJournalExtension();
		await executeTool(api, "journal_write", {
			content: "First entry",
			date: "2025-06-15",
		});
		await executeTool(api, "journal_write", {
			content: "Second entry",
			date: "2025-06-15",
		});

		const filepath = join(temp.gardenDir, "Journal", "2025", "06", "2025-06-15.md");
		const raw = readFileSync(filepath, "utf-8");

		// Should contain both entries
		expect(raw).toContain("First entry");
		expect(raw).toContain("Second entry");

		// Should have only one ## Pi section header
		const piHeaders = raw.match(/## Pi/g);
		expect(piHeaders).toHaveLength(1);
	});

	it("journal_read for missing date returns informative message", async () => {
		const api = await setupJournalExtension();
		const result = await executeTool(api, "journal_read", { date: "2099-01-01" });
		expect(result.content[0].text).toBe("No journal entry for 2099-01-01");
	});

	it("frontmatter has date and created fields", async () => {
		const api = await setupJournalExtension();
		await executeTool(api, "journal_write", {
			content: "Check frontmatter",
			date: "2025-03-01",
		});

		const filepath = join(temp.gardenDir, "Journal", "2025", "03", "2025-03-01.md");
		const raw = readFileSync(filepath, "utf-8");
		const parsed = parseFrontmatter(raw);
		expect(parsed.attributes).toHaveProperty("date", "2025-03-01");
		expect(parsed.attributes).toHaveProperty("created");
		expect(typeof parsed.attributes.created).toBe("string");
	});

	it("creates nested year/month directory structure", async () => {
		const api = await setupJournalExtension();
		await executeTool(api, "journal_write", {
			content: "Deep path test",
			date: "2025-12-25",
		});

		const dirPath = join(temp.gardenDir, "Journal", "2025", "12");
		expect(existsSync(dirPath)).toBe(true);
	});
});
