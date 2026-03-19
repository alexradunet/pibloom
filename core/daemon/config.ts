/**
 * Daemon configuration loaded from environment variables.
 * All values have sensible defaults.
 */

function parseIntEnv(value: string | undefined, defaultValue: number): number {
	if (!value) return defaultValue;
	const parsed = Number.parseInt(value, 10);
	return Number.isNaN(parsed) ? defaultValue : parsed;
}

export interface DaemonConfig {
	/** Idle timeout for Pi sessions in milliseconds (default: 15 minutes) */
	idleTimeoutMs: number;
	/** Typing indicator timeout in milliseconds (default: 30 seconds) */
	typingTimeoutMs: number;
	/** Typing indicator refresh interval in milliseconds (default: 20 seconds) */
	typingRefreshMs: number;
	/** Total reply budget per root event (default: 4) */
	totalReplyBudget: number;
	/** TTL for processed event IDs in milliseconds (default: 5 minutes) */
	processedEventTtlMs: number;
	/** TTL for root reply tracking in milliseconds (default: 1 hour) */
	rootReplyTtlMs: number;
	/** TTL for room-agent cooldown tracking in milliseconds (default: 1 hour) */
	roomAgentTtlMs: number;
	/** Maximum number of processed events to track (default: 10,000) */
	maxProcessedEvents: number;
	/** Maximum number of root reply entries to track (default: 2,000) */
	maxRootReplies: number;
	/** Maximum number of room-agent entries to track (default: 2,000) */
	maxRoomAgentEntries: number;
	/** TTL for seen event IDs in the Matrix bridge (default: 10 minutes) */
	seenEventTtlMs: number;
	/** Maximum number of seen event IDs to track (default: 10,000) */
	maxSeenEventIds: number;
	/** Initial retry delay for daemon startup in milliseconds (default: 5 seconds) */
	initialRetryDelayMs: number;
	/** Maximum retry delay for daemon startup in milliseconds (default: 5 minutes) */
	maxRetryDelayMs: number;
}

export function loadDaemonConfig(): DaemonConfig {
	return {
		idleTimeoutMs: parseIntEnv(process.env.NIXPI_DAEMON_IDLE_TIMEOUT_MS, 15 * 60 * 1000),
		typingTimeoutMs: parseIntEnv(process.env.NIXPI_TYPING_TIMEOUT_MS, 30_000),
		typingRefreshMs: parseIntEnv(process.env.NIXPI_TYPING_REFRESH_MS, 20_000),
		totalReplyBudget: parseIntEnv(process.env.NIXPI_REPLY_BUDGET, 4),
		processedEventTtlMs: parseIntEnv(process.env.NIXPI_PROCESSED_EVENT_TTL_MS, 5 * 60 * 1000),
		rootReplyTtlMs: parseIntEnv(process.env.NIXPI_ROOT_REPLY_TTL_MS, 60 * 60 * 1000),
		roomAgentTtlMs: parseIntEnv(process.env.NIXPI_ROOM_AGENT_TTL_MS, 60 * 60 * 1000),
		maxProcessedEvents: parseIntEnv(process.env.NIXPI_MAX_PROCESSED_EVENTS, 10_000),
		maxRootReplies: parseIntEnv(process.env.NIXPI_MAX_ROOT_REPLIES, 2_000),
		maxRoomAgentEntries: parseIntEnv(process.env.NIXPI_MAX_ROOM_AGENT_ENTRIES, 2_000),
		seenEventTtlMs: parseIntEnv(process.env.NIXPI_SEEN_EVENT_TTL_MS, 10 * 60 * 1000),
		maxSeenEventIds: parseIntEnv(process.env.NIXPI_MAX_SEEN_EVENT_IDS, 10_000),
		initialRetryDelayMs: parseIntEnv(process.env.NIXPI_INITIAL_RETRY_DELAY_MS, 5_000),
		maxRetryDelayMs: parseIntEnv(process.env.NIXPI_MAX_RETRY_DELAY_MS, 300_000),
	};
}
