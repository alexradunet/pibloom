import { describe, expect, it, vi } from "vitest";
import { withRetry } from "../../core/lib/retry.js";

describe("withRetry", () => {
	it("returns immediately on success", async () => {
		const fn = vi.fn().mockResolvedValue("ok");
		const result = await withRetry(fn);
		expect(result).toBe("ok");
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it("retries on transient failure then succeeds", async () => {
		const fn = vi
			.fn()
			.mockRejectedValueOnce(new Error("fail"))
			.mockResolvedValue("ok");
		const result = await withRetry(fn, {
			baseDelayMs: 0,
			jitter: false,
			shouldRetry: () => true,
		});
		expect(result).toBe("ok");
		expect(fn).toHaveBeenCalledTimes(2);
	});

	it("throws after maxRetries exhausted", async () => {
		const fn = vi.fn().mockRejectedValue(new Error("always fails"));
		await expect(
			withRetry(fn, {
				maxRetries: 2,
				baseDelayMs: 0,
				jitter: false,
				shouldRetry: () => true,
			}),
		).rejects.toThrow("always fails");
		expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
	});

	it("does not retry when shouldRetry returns false", async () => {
		const fn = vi.fn().mockRejectedValue(new Error("auth failure"));
		await expect(
			withRetry(fn, {
				shouldRetry: () => false,
				baseDelayMs: 0,
			}),
		).rejects.toThrow("auth failure");
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it("calls onError teardown before each retry", async () => {
		const teardown = vi.fn().mockResolvedValue(undefined);
		const fn = vi
			.fn()
			.mockRejectedValueOnce(new Error("fail"))
			.mockResolvedValue("ok");
		await withRetry(fn, {
			baseDelayMs: 0,
			jitter: false,
			onError: teardown,
			shouldRetry: () => true,
		});
		expect(teardown).toHaveBeenCalledTimes(1);
	});
});
