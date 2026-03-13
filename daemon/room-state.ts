export interface RoomStateOptions {
	processedEventTtlMs?: number;
}

interface RootReplyState {
	totalReplies: number;
	perAgentReplies: Map<string, number>;
}

export interface RoomState {
	processedEventTtlMs: number;
	processedEvents: Map<string, number>;
	lastReplyAtByRoomAgent: Map<string, number>;
	rootReplies: Map<string, RootReplyState>;
}

const DEFAULT_PROCESSED_EVENT_TTL_MS = 5 * 60 * 1000;

export function createRoomState(options: RoomStateOptions = {}): RoomState {
	return {
		processedEventTtlMs: options.processedEventTtlMs ?? DEFAULT_PROCESSED_EVENT_TTL_MS,
		processedEvents: new Map(),
		lastReplyAtByRoomAgent: new Map(),
		rootReplies: new Map(),
	};
}

export function hasProcessedEvent(state: RoomState, eventId: string, now: number): boolean {
	pruneProcessedEvents(state, now);
	return state.processedEvents.has(eventId);
}

export function markEventProcessed(state: RoomState, eventId: string, now: number): void {
	pruneProcessedEvents(state, now);
	state.processedEvents.set(eventId, now);
}

export function isAgentCoolingDown(
	state: RoomState,
	roomId: string,
	agentId: string,
	now: number,
	cooldownMs: number,
): boolean {
	const lastReplyAt = state.lastReplyAtByRoomAgent.get(roomAgentKey(roomId, agentId));
	if (lastReplyAt === undefined) return false;
	return now - lastReplyAt < cooldownMs;
}

export function canReplyForRoot(
	state: RoomState,
	roomId: string,
	rootEventId: string,
	agentId: string,
	maxPublicTurnsPerRoot: number,
	totalReplyBudget: number,
): boolean {
	const rootState = state.rootReplies.get(rootKey(roomId, rootEventId));
	if (!rootState) return true;
	if (rootState.totalReplies >= totalReplyBudget) return false;
	return (rootState.perAgentReplies.get(agentId) ?? 0) < maxPublicTurnsPerRoot;
}

export function markReplySent(
	state: RoomState,
	roomId: string,
	rootEventId: string,
	agentId: string,
	now: number,
): void {
	state.lastReplyAtByRoomAgent.set(roomAgentKey(roomId, agentId), now);

	const key = rootKey(roomId, rootEventId);
	let rootState = state.rootReplies.get(key);
	if (!rootState) {
		rootState = { totalReplies: 0, perAgentReplies: new Map() };
		state.rootReplies.set(key, rootState);
	}

	rootState.totalReplies++;
	rootState.perAgentReplies.set(agentId, (rootState.perAgentReplies.get(agentId) ?? 0) + 1);
}

function pruneProcessedEvents(state: RoomState, now: number): void {
	for (const [eventId, timestamp] of state.processedEvents) {
		if (now - timestamp > state.processedEventTtlMs) {
			state.processedEvents.delete(eventId);
		}
	}
}

function roomAgentKey(roomId: string, agentId: string): string {
	return `${roomId}::${agentId}`;
}

function rootKey(roomId: string, rootEventId: string): string {
	return `${roomId}::${rootEventId}`;
}
