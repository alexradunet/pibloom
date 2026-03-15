import { describe, expect, it } from "vitest";

import { ProactiveJobRateLimiter } from "../../core/daemon/rate-limiter.js";

describe("ProactiveJobRateLimiter", () => {
	describe("rate limiting", () => {
		it("allows jobs under the rate limit", () => {
			const limiter = new ProactiveJobRateLimiter({ maxJobsPerHour: 3 });
			const now = Date.now();

			expect(limiter.canExecute("agent1", now)).toEqual({ allowed: true });
			limiter.recordExecution("agent1", now);

			expect(limiter.canExecute("agent1", now)).toEqual({ allowed: true });
			limiter.recordExecution("agent1", now);

			expect(limiter.canExecute("agent1", now)).toEqual({ allowed: true });
		});

		it("blocks jobs when rate limit is exceeded", () => {
			const limiter = new ProactiveJobRateLimiter({ maxJobsPerHour: 2 });
			const now = Date.now();

			limiter.recordExecution("agent1", now);
			limiter.recordExecution("agent1", now);

			const result = limiter.canExecute("agent1", now);
			expect(result.allowed).toBe(false);
			if (!result.allowed) {
				expect(result.reason).toContain("Rate limit exceeded");
			}
		});

		it("resets rate limit after one hour", () => {
			const limiter = new ProactiveJobRateLimiter({ maxJobsPerHour: 1 });
			const now = Date.now();

			limiter.recordExecution("agent1", now);
			expect(limiter.canExecute("agent1", now).allowed).toBe(false);

			// After 1 hour + 1ms, should be allowed again
			const later = now + 60 * 60 * 1000 + 1;
			expect(limiter.canExecute("agent1", later)).toEqual({ allowed: true });
		});

		it("tracks agents independently", () => {
			const limiter = new ProactiveJobRateLimiter({ maxJobsPerHour: 1 });
			const now = Date.now();

			limiter.recordExecution("agent1", now);
			expect(limiter.canExecute("agent1", now).allowed).toBe(false);
			expect(limiter.canExecute("agent2", now)).toEqual({ allowed: true });
		});
	});

	describe("circuit breaker", () => {
		it("opens circuit after threshold failures", () => {
			const limiter = new ProactiveJobRateLimiter({
				circuitBreakerThreshold: 3,
				circuitBreakerResetMs: 60_000,
			});
			const now = Date.now();

			limiter.recordFailure("agent1", now);
			limiter.recordFailure("agent1", now);
			limiter.recordFailure("agent1", now);

			const result = limiter.canExecute("agent1", now);
			expect(result.allowed).toBe(false);
			if (!result.allowed) {
				expect(result.reason).toContain("Circuit breaker is open");
			}
		});

		it("moves to half-open after reset timeout", () => {
			const limiter = new ProactiveJobRateLimiter({
				circuitBreakerThreshold: 1,
				circuitBreakerResetMs: 60_000,
			});
			const now = Date.now();

			limiter.recordFailure("agent1", now);
			expect(limiter.canExecute("agent1", now).allowed).toBe(false);

			// After reset timeout, should be half-open
			const later = now + 60_001;
			expect(limiter.canExecute("agent1", later)).toEqual({ allowed: true });
		});

		it("closes circuit on success in half-open state", () => {
			const limiter = new ProactiveJobRateLimiter({
				circuitBreakerThreshold: 1,
				circuitBreakerResetMs: 60_000,
			});
			const now = Date.now();

			limiter.recordFailure("agent1", now);
			const later = now + 60_001;
			limiter.recordSuccess("agent1");

			// Should be able to execute now (circuit closed)
			expect(limiter.canExecute("agent1", later)).toEqual({ allowed: true });
		});

		it("reopens circuit on failure in half-open state", () => {
			const limiter = new ProactiveJobRateLimiter({
				circuitBreakerThreshold: 1,
				circuitBreakerResetMs: 60_000,
			});
			const now = Date.now();

			limiter.recordFailure("agent1", now);
			const later = now + 60_001;

			// In half-open, another failure should open the circuit again
			limiter.recordFailure("agent1", later);
			expect(limiter.canExecute("agent1", later).allowed).toBe(false);
		});
	});

	describe("state inspection", () => {
		it("returns agent state", () => {
			const limiter = new ProactiveJobRateLimiter({ maxJobsPerHour: 10 });
			const now = Date.now();

			limiter.recordExecution("agent1", now);
			limiter.recordExecution("agent1", now + 1000);

			const state = limiter.getState("agent1");
			expect(state).toBeDefined();
			expect(state?.jobTimestamps).toHaveLength(2);
		});

		it("returns undefined for unknown agents", () => {
			const limiter = new ProactiveJobRateLimiter();
			expect(limiter.getState("unknown")).toBeUndefined();
		});
	});

	describe("reset", () => {
		it("clears all state", () => {
			const limiter = new ProactiveJobRateLimiter({ maxJobsPerHour: 1 });
			const now = Date.now();

			limiter.recordExecution("agent1", now);
			expect(limiter.getState("agent1")).toBeDefined();

			limiter.reset();
			expect(limiter.getState("agent1")).toBeUndefined();
		});
	});
});
