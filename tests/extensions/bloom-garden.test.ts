import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	ensureBloom,
	getPackageDir,
	handleGardenStatus,
	handleSkillCreate,
	handleSkillList,
} from "../../extensions/bloom-garden/actions.js";

let bloomDir: string;

beforeEach(() => {
	bloomDir = fs.mkdtempSync(path.join(os.tmpdir(), "bloom-garden-test-"));
});

afterEach(() => {
	fs.rmSync(bloomDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// ensureBloom
// ---------------------------------------------------------------------------
describe("ensureBloom", () => {
	it("creates all required subdirectories", () => {
		ensureBloom(bloomDir);
		for (const dir of ["Persona", "Skills", "Evolutions", "audit"]) {
			expect(fs.existsSync(path.join(bloomDir, dir))).toBe(true);
		}
	});

	it("is idempotent — calling twice does not throw", () => {
		ensureBloom(bloomDir);
		expect(() => ensureBloom(bloomDir)).not.toThrow();
	});
});

// ---------------------------------------------------------------------------
// getPackageDir
// ---------------------------------------------------------------------------
describe("getPackageDir", () => {
	it("returns a non-empty string", () => {
		const dir = getPackageDir();
		expect(typeof dir).toBe("string");
		expect(dir.length).toBeGreaterThan(0);
	});

	it("returns a path that exists", () => {
		const dir = getPackageDir();
		expect(fs.existsSync(dir)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// handleGardenStatus
// ---------------------------------------------------------------------------
describe("handleGardenStatus", () => {
	it("returns content containing the bloom dir path", () => {
		ensureBloom(bloomDir);
		const result = handleGardenStatus(bloomDir);
		expect(result.content).toHaveLength(1);
		expect(result.content[0].type).toBe("text");
		expect(result.content[0].text).toContain(bloomDir);
	});

	it("returns a details object", () => {
		ensureBloom(bloomDir);
		const result = handleGardenStatus(bloomDir);
		expect(result.details).toBeDefined();
	});

	it("shows package version line", () => {
		ensureBloom(bloomDir);
		const result = handleGardenStatus(bloomDir);
		expect(result.content[0].text).toContain("Package version:");
	});
});

// ---------------------------------------------------------------------------
// handleSkillCreate
// ---------------------------------------------------------------------------
describe("handleSkillCreate", () => {
	beforeEach(() => {
		ensureBloom(bloomDir);
	});

	it("creates a SKILL.md file at the expected path", () => {
		const result = handleSkillCreate(bloomDir, {
			name: "my-skill",
			description: "A test skill",
			content: "# My Skill\n\nDo things.",
		});
		expect(result.content[0].text).toContain("created skill: my-skill");
		const skillFile = path.join(bloomDir, "Skills", "my-skill", "SKILL.md");
		expect(fs.existsSync(skillFile)).toBe(true);
	});

	it("writes name and description into the frontmatter", () => {
		handleSkillCreate(bloomDir, {
			name: "scoped-skill",
			description: "Scoped description",
			content: "Body text",
		});
		const raw = fs.readFileSync(path.join(bloomDir, "Skills", "scoped-skill", "SKILL.md"), "utf-8");
		expect(raw).toContain("name: scoped-skill");
		expect(raw).toContain("description: Scoped description");
		expect(raw).toContain("Body text");
	});

	it("returns an error result when the skill already exists", () => {
		handleSkillCreate(bloomDir, { name: "dup-skill", description: "first", content: "" });
		const result = handleSkillCreate(bloomDir, { name: "dup-skill", description: "second", content: "" });
		expect(result.content[0].text).toContain("already exists");
	});

	it("blocks path traversal in skill name that escapes bloom dir", () => {
		const result = handleSkillCreate(bloomDir, { name: "../../escape", description: "bad", content: "" });
		expect(result.content[0].text).toContain("Path traversal blocked");
	});
});

// ---------------------------------------------------------------------------
// handleSkillList
// ---------------------------------------------------------------------------
describe("handleSkillList", () => {
	it("returns message when Skills directory does not exist", () => {
		// bloomDir exists but Skills subdir has not been created
		const result = handleSkillList(bloomDir);
		expect(result.content[0].text).toContain("No skills directory found");
	});

	it("returns message when Skills directory is empty", () => {
		fs.mkdirSync(path.join(bloomDir, "Skills"), { recursive: true });
		const result = handleSkillList(bloomDir);
		expect(result.content[0].text).toContain("No skills found");
	});

	it("lists skills with their descriptions", () => {
		ensureBloom(bloomDir);
		handleSkillCreate(bloomDir, { name: "alpha", description: "Alpha skill", content: "" });
		handleSkillCreate(bloomDir, { name: "beta", description: "Beta skill", content: "" });

		const result = handleSkillList(bloomDir);
		expect(result.content[0].text).toContain("alpha");
		expect(result.content[0].text).toContain("Alpha skill");
		expect(result.content[0].text).toContain("beta");
		expect(result.content[0].text).toContain("Beta skill");
	});

	it("ignores entries without a SKILL.md file", () => {
		ensureBloom(bloomDir);
		// Create a directory without a SKILL.md
		fs.mkdirSync(path.join(bloomDir, "Skills", "orphan"), { recursive: true });
		const result = handleSkillList(bloomDir);
		expect(result.content[0].text).toContain("No skills found");
	});
});
