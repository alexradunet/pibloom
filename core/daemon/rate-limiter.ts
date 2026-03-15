/**
 * Rate limiting and circuit breaker for proactive jobs.
 */

export interface RateLimiterConfig {
	/** Maximum number of jobs per hour per agent (default: 60) */
	maxJobsPerHour?: number;
	/** Number of consecutive failures before circuit opens (default: 5) */
	circuitBreakerThreshold?: number;
	/** Time in ms before circuit moves from open to half-open (default: 60 seconds) */
	circuitBreakerResetMs?: number;
}

interface AgentRateState {
	jobTimestamps: number[];
	consecutiveFailures: number;
	circuitState: "closed" | "open" | "half-open";
	circuitOpenedAt?: number;
}

export class ProactiveJobRateLimiter {
	private readonly maxJobsPerHour: number;
	private readonly circuitBreakerThreshold: number;
	private readonly circuitBreakerResetMs: number;
	private readonly agentStates = new Map<string, AgentRateState>();

	constructor(config: RateLimiterConfig = {}) {
		this.maxJobsPerHour = config.maxJobsPerHour ?? 60;
		this.circuitBreakerThreshold = config.circuitBreakerThreshold ?? 5;
		this.circuitBreakerResetMs = config.circuitBreakerResetMs ?? 60_000;
	}

	/**
	 * Check if a job is allowed to run for the given agent.
	 * Returns { allowed: true } if the job can proceed,
	 * or { allowed: false, reason: string } if it should be rejected.
	 */
	canExecute(agentId: string, now = Date.now()): { allowed: true } | { allowed: false; reason: string } {
		const state = this.getOrCreateState(agentId);

		// Check circuit breaker
		if (state.circuitState === "open") {
			// Check if it's time to move to half-open
			if (state.circuitOpenedAt && now - state.circuitOpenedAt >= this.circuitBreakerResetMs) {
				state.circuitState = "half-open";
				state.consecutiveFailures = 0;
			} else {
				return {
					allowed: false,
					reason: `Circuit breaker is open for agent ${agentId}`,
				};
			}
		}

		// Clean old timestamps (older than 1 hour)
		const oneHourAgo = now - 60 * 60 * 1000;
		state.jobTimestamps = state.jobTimestamps.filter((ts) => ts > oneHourAgo);

		// Check rate limit
		if (state.jobTimestamps.length >= this.maxJobsPerHour) {
			return {
				allowed: false,
				reason: `Rate limit exceeded for agent ${agentId}: ${this.maxJobsPerHour} jobs per hour`,
			};
		}

		return { allowed: true };
	}

	/**
	 * Record that a job has been executed.
	 */
	recordExecution(agentId: string, now = Date.now()): void {
		const state = this.getOrCreateState(agentId);
		state.jobTimestamps.push(now);
	}

	/**
	 * Record a job failure for circuit breaker tracking.
	 */
	recordFailure(agentId: string, now = Date.now()): void {
		const state = this.getOrCreateState(agentId);
		state.consecutiveFailures++;

		if (state.consecutiveFailures >= this.circuitBreakerThreshold) {
			state.circuitState = "open";
			state.circuitOpenedAt = now;
		}
	}

	/**
	 * Record a job success (resets consecutive failures in half-open state).
	 */
	recordSuccess(agentId: string): void {
		const state = this.getOrCreateState(agentId);
		if (state.circuitState === "half-open") {
			state.circuitState = "closed";
		}
		state.consecutiveFailures = 0;
	}

	/**
	 * Get current state for an agent (for debugging/monitoring).
	 */
	getState(agentId: string): Readonly<AgentRateState> | undefined {
		return this.agentStates.get(agentId);
	}

	/**
	 * Reset all state (useful for testing).
	 */
	reset(): void {
		this.agentStates.clear();
	}

	private getOrCreateState(agentId: string): AgentRateState {
		let state = this.agentStates.get(agentId);
		if (!state) {
			state = {
				jobTimestamps: [],
				consecutiveFailures: 0,
				circuitState: "closed",
			};
			this.agentStates.set(agentId, state);
		}
		return state;
	}
}

// Singleton instance for daemon-wide rate limiting
const defaultLimiter = new ProactiveJobRateLimiter({
	maxJobsPerHour: Number.parseInt(process.env.BLOOM_PROACTIVE_MAX_JOBS_PER_HOUR ?? "60", 10),
	circuitBreakerThreshold: Number.parseInt(process.env.BLOOM_CIRCUIT_BREAKER_THRESHOLD ?? "5", 10),
	circuitBreakerResetMs: Number.parseInt(process.env.BLOOM_CIRCUIT_BREAKER_RESET_MS ?? "60000", 10),
});

export function getDefaultRateLimiter(): ProactiveJobRateLimiter {
	return defaultLimiter;
}
