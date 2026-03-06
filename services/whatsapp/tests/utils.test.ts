import { describe, expect, it, vi } from "vitest";
import { isChannelMessage, makeLogger, MEDIA_TYPES, mimeToExt } from "../src/utils.js";

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
// makeLogger
// ---------------------------------------------------------------------------
describe("makeLogger", () => {
	it("returns object with expected methods", () => {
		const logger = makeLogger();
		expect(typeof logger.trace).toBe("function");
		expect(typeof logger.debug).toBe("function");
		expect(typeof logger.info).toBe("function");
		expect(typeof logger.warn).toBe("function");
		expect(typeof logger.error).toBe("function");
		expect(typeof logger.fatal).toBe("function");
		expect(typeof logger.child).toBe("function");
	});

	it("has silent level", () => {
		expect(makeLogger().level).toBe("silent");
	});

	it("child returns another logger with same shape", () => {
		const child = makeLogger().child();
		expect(typeof child.trace).toBe("function");
		expect(typeof child.warn).toBe("function");
		expect(typeof child.child).toBe("function");
	});

	it("warn logs to console.warn with message", () => {
		const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const logger = makeLogger();
		logger.warn({}, "test warning");
		expect(spy).toHaveBeenCalledWith("[wa:warn]", "test warning");
		spy.mockRestore();
	});

	it("warn uses obj when message is omitted", () => {
		const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const logger = makeLogger();
		logger.warn("fallback warning");
		expect(spy).toHaveBeenCalledWith("[wa:warn]", "fallback warning");
		spy.mockRestore();
	});

	it("error logs to console.error with message", () => {
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		const logger = makeLogger();
		logger.error({}, "test error");
		expect(spy).toHaveBeenCalledWith("[wa:error]", "test error");
		spy.mockRestore();
	});

	it("error uses obj when message is omitted", () => {
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		const logger = makeLogger();
		logger.error("fallback error");
		expect(spy).toHaveBeenCalledWith("[wa:error]", "fallback error");
		spy.mockRestore();
	});

	it("fatal logs to console.error with message", () => {
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		const logger = makeLogger();
		logger.fatal({}, "test fatal");
		expect(spy).toHaveBeenCalledWith("[wa:fatal]", "test fatal");
		spy.mockRestore();
	});

	it("fatal uses obj when message is omitted", () => {
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		const logger = makeLogger();
		logger.fatal("fallback fatal");
		expect(spy).toHaveBeenCalledWith("[wa:fatal]", "fallback fatal");
		spy.mockRestore();
	});

	it("noop methods do not throw", () => {
		const logger = makeLogger();
		expect(() => logger.trace("test")).not.toThrow();
		expect(() => logger.debug("test")).not.toThrow();
		expect(() => logger.info("test")).not.toThrow();
	});
});
