import { describe, expect, it, vi } from "vitest";

import { startWithRetry } from "../../core/daemon/lifecycle.js";

describe("startWithRetry", () => {
	it("retries with backoff until startup succeeds", async () => {
		const startFn = vi
			.fn<() => Promise<void>>()
			.mockRejectedValueOnce(new Error("first"))
			.mockRejectedValueOnce(new Error("second"))
			.mockResolvedValue(undefined);
		const onError = vi.fn(async () => undefined);
		const sleep = vi.fn(async (_delayMs: number) => undefined);
		const onRetry = vi.fn();

		await startWithRetry(startFn, onError, {
			initialDelayMs: 100,
			maxDelayMs: 1000,
			sleep,
			onRetry,
		});

		expect(startFn).toHaveBeenCalledTimes(3);
		expect(onError).toHaveBeenCalledTimes(2);
		expect(sleep).toHaveBeenNthCalledWith(1, 100);
		expect(sleep).toHaveBeenNthCalledWith(2, 300);
		expect(onRetry).toHaveBeenCalledTimes(2);
	});
});
