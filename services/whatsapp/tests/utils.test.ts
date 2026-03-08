import { describe, expect, it } from "vitest";
import {
	isChannelMessage,
	isWhatsAppSenderAllowed,
	MEDIA_TYPES,
	mimeToExt,
	parseAllowedSenders,
} from "../src/utils.js";

// ---------------------------------------------------------------------------
// mimeToExt
// ---------------------------------------------------------------------------
describe("mimeToExt", () => {
	it.each([
		["audio/ogg", "ogg"],
		["audio/ogg; codecs=opus", "ogg"],
		["audio/mpeg", "mp3"],
		["audio/mp4", "m4a"],
		["audio/wav", "wav"],
		["image/jpeg", "jpg"],
		["image/png", "png"],
		["image/webp", "webp"],
		["image/gif", "gif"],
		["video/mp4", "mp4"],
		["video/3gpp", "3gp"],
		["application/pdf", "pdf"],
		["application/octet-stream", "bin"],
	])("maps %s → %s", (mime, ext) => {
		expect(mimeToExt(mime)).toBe(ext);
	});

	it("falls back to subtype for unknown mime", () => {
		expect(mimeToExt("text/plain")).toBe("plain");
	});

	it("returns empty string for empty mime (split yields empty)", () => {
		// "".split("/").pop() returns "" which is not null/undefined, so ?? doesn't trigger
		expect(mimeToExt("")).toBe("");
	});
});

// ---------------------------------------------------------------------------
// MEDIA_TYPES
// ---------------------------------------------------------------------------
describe("MEDIA_TYPES", () => {
	it("maps all expected message types", () => {
		expect(MEDIA_TYPES).toEqual({
			audioMessage: "audio",
			imageMessage: "image",
			videoMessage: "video",
			documentMessage: "document",
			stickerMessage: "sticker",
		});
	});
});

// ---------------------------------------------------------------------------
// isChannelMessage
// ---------------------------------------------------------------------------
describe("isChannelMessage", () => {
	it("returns true for valid object with type string", () => {
		expect(isChannelMessage({ type: "response", to: "jid", text: "hi" })).toBe(true);
	});

	it("returns true for minimal valid object", () => {
		expect(isChannelMessage({ type: "ping" })).toBe(true);
	});

	it("returns false for null", () => {
		expect(isChannelMessage(null)).toBe(false);
	});

	it("returns false for non-object", () => {
		expect(isChannelMessage("string")).toBe(false);
		expect(isChannelMessage(42)).toBe(false);
	});

	it("returns false for missing type", () => {
		expect(isChannelMessage({ to: "jid" })).toBe(false);
	});

	it("returns false for non-string type", () => {
		expect(isChannelMessage({ type: 123 })).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// parseAllowedSenders
// ---------------------------------------------------------------------------
describe("parseAllowedSenders", () => {
	it("returns empty set for empty string", () => {
		expect(parseAllowedSenders("").size).toBe(0);
	});

	it("parses comma-separated entries", () => {
		const set = parseAllowedSenders("+1234567890,+0987654321");
		expect(set.size).toBe(2);
		expect(set.has("+1234567890")).toBe(true);
		expect(set.has("+0987654321")).toBe(true);
	});

	it("trims whitespace", () => {
		const set = parseAllowedSenders(" +123 , +456 ");
		expect(set.has("+123")).toBe(true);
		expect(set.has("+456")).toBe(true);
	});

	it("ignores empty entries from trailing commas", () => {
		const set = parseAllowedSenders("+123,,+456,");
		expect(set.size).toBe(2);
	});
});

// ---------------------------------------------------------------------------
// isWhatsAppSenderAllowed
// ---------------------------------------------------------------------------
describe("isWhatsAppSenderAllowed", () => {
	it("allows all when allowlist is empty", () => {
		expect(isWhatsAppSenderAllowed("1234567890@s.whatsapp.net", new Set())).toBe(true);
	});

	it("allows by full JID", () => {
		const allowed = new Set(["1234567890@s.whatsapp.net"]);
		expect(isWhatsAppSenderAllowed("1234567890@s.whatsapp.net", allowed)).toBe(true);
	});

	it("allows by number without @domain", () => {
		const allowed = new Set(["1234567890"]);
		expect(isWhatsAppSenderAllowed("1234567890@s.whatsapp.net", allowed)).toBe(true);
	});

	it("allows by +number format", () => {
		const allowed = new Set(["+1234567890"]);
		expect(isWhatsAppSenderAllowed("1234567890@s.whatsapp.net", allowed)).toBe(true);
	});

	it("rejects when not in allowlist", () => {
		const allowed = new Set(["+9999999999"]);
		expect(isWhatsAppSenderAllowed("1234567890@s.whatsapp.net", allowed)).toBe(false);
	});
});
