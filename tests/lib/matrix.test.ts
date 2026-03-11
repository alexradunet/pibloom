import { describe, expect, it } from "vitest";
import { extractResponseText, generatePassword, matrixCredentialsPath } from "../../lib/matrix.js";

describe("extractResponseText", () => {
	it("extracts string content (post-compaction)", () => {
		const messages = [{ role: "assistant", content: "summarized text" }];
		expect(extractResponseText(messages)).toBe("summarized text");
	});

	it("extracts text blocks from array content", () => {
		const messages = [
			{ role: "assistant", content: [{ type: "text", text: "hello" }] },
		];
		expect(extractResponseText(messages)).toBe("hello");
	});

	it("skips tool_use blocks", () => {
		const messages = [
			{
				role: "assistant",
				content: [
					{ type: "tool_use", id: "1", name: "foo" },
					{ type: "text", text: "actual response" },
				],
			},
		];
		expect(extractResponseText(messages)).toBe("actual response");
	});

	it("concatenates multiple text parts", () => {
		const messages = [
			{
				role: "assistant",
				content: [
					{ type: "text", text: "part1" },
					{ type: "text", text: "part2" },
				],
			},
		];
		expect(extractResponseText(messages)).toBe("part1\n\npart2");
	});

	it("returns empty string for no assistant messages", () => {
		expect(extractResponseText([{ role: "user", content: "hello" }])).toBe("");
	});

	it("returns empty string for tool-only turns", () => {
		const messages = [
			{ role: "assistant", content: [{ type: "tool_use", id: "1", name: "foo" }] },
		];
		expect(extractResponseText(messages)).toBe("");
	});

	it("returns last assistant message text", () => {
		const messages = [
			{ role: "assistant", content: "first" },
			{ role: "user", content: "question" },
			{ role: "assistant", content: "second" },
		];
		expect(extractResponseText(messages)).toBe("second");
	});

	it("returns empty string for empty array", () => {
		expect(extractResponseText([])).toBe("");
	});
});

describe("generatePassword", () => {
	it("returns a base64url string of expected length", () => {
		const pw = generatePassword();
		expect(pw.length).toBeGreaterThan(16);
		expect(pw).toMatch(/^[A-Za-z0-9_-]+$/);
	});

	it("generates unique passwords", () => {
		const a = generatePassword();
		const b = generatePassword();
		expect(a).not.toBe(b);
	});
});

describe("matrixCredentialsPath", () => {
	it("returns path under .pi directory", () => {
		const p = matrixCredentialsPath();
		expect(p).toContain(".pi");
		expect(p).toContain("matrix-credentials.json");
	});
});
