import { join } from "node:path";
import type { MatrixAgentCredentials } from "../lib/matrix.js";
import type { AgentDefinition } from "./agent-registry.js";
import { AgentSupervisor, type AgentSupervisorOptions } from "./agent-supervisor.js";
import type { MatrixBridge, MatrixIdentity } from "./contracts/matrix.js";
import { collectScheduledJobs } from "./proactive.js";
import { classifySender, extractMentions } from "./router.js";
import { Scheduler, type SchedulerJobState } from "./scheduler.js";
import { MatrixJsSdkBridge } from "./runtime/matrix-js-sdk-bridge.js";

type SchedulerLike = Pick<Scheduler, "start" | "stop">;

export interface MultiAgentRuntime {
	proactiveJobs: number;
	start(): Promise<void>;
	stop(): Promise<void>;
}

export interface MultiAgentRuntimeOptions {
	agents: readonly AgentDefinition[];
	sessionBaseDir: string;
	idleTimeoutMs: number;
	matrixAgentStorageDir: string;
	loadAgentCredentials: (agentId: string) => MatrixAgentCredentials;
	loadSchedulerState: () => Record<string, SchedulerJobState>;
	saveSchedulerState: (state: Record<string, SchedulerJobState>) => void;
	onSchedulerError: (job: { jobId: string; agentId: string; roomId: string; kind: string }, error: unknown) => void;
	createBridge?: (identities: MatrixIdentity[]) => MatrixBridge;
	createSupervisor?: (options: AgentSupervisorOptions) => Pick<AgentSupervisor, "handleEnvelope" | "dispatchProactiveJob" | "shutdown">;
	createScheduler?: (options: ConstructorParameters<typeof Scheduler>[0]) => SchedulerLike;
}

export function createMultiAgentRuntime(options: MultiAgentRuntimeOptions): MultiAgentRuntime {
	const identities = options.agents.map((agent) => {
		const credentials = options.loadAgentCredentials(agent.id);
		return {
			id: agent.id,
			userId: agent.matrix.userId,
			homeserver: credentials.homeserver,
			accessToken: credentials.accessToken,
			storagePath: join(options.matrixAgentStorageDir, `${agent.id}.json`),
			autojoin: agent.matrix.autojoin,
		};
	});
	const bridge =
		options.createBridge?.(identities) ??
		new MatrixJsSdkBridge({
			identities,
		});
	const supervisor =
		options.createSupervisor?.({
			agents: options.agents,
			matrixBridge: bridge,
			sessionBaseDir: options.sessionBaseDir,
			idleTimeoutMs: options.idleTimeoutMs,
		}) ??
		new AgentSupervisor({
			agents: options.agents,
			matrixBridge: bridge,
			sessionBaseDir: options.sessionBaseDir,
			idleTimeoutMs: options.idleTimeoutMs,
		});

	bridge.onTextEvent((_identityId, event) => {
		const senderInfo = classifySender(event.senderUserId, "", options.agents);
		if (senderInfo.senderKind === "self") return;
		void supervisor.handleEnvelope({
			roomId: event.roomId,
			eventId: event.eventId,
			senderUserId: event.senderUserId,
			body: event.body,
			senderKind: senderInfo.senderKind,
			...(senderInfo.senderAgentId ? { senderAgentId: senderInfo.senderAgentId } : {}),
			mentions: extractMentions(event.body, options.agents),
			timestamp: event.timestamp,
		});
	});

	const jobs = collectScheduledJobs(options.agents);
	const scheduler =
		jobs.length > 0
			? (options.createScheduler?.({
					jobs,
					onTrigger: (job) => supervisor.dispatchProactiveJob(job),
					loadState: options.loadSchedulerState,
					saveState: options.saveSchedulerState,
					onError: options.onSchedulerError,
				}) ??
				new Scheduler({
					jobs,
					onTrigger: (job) => supervisor.dispatchProactiveJob(job),
					loadState: options.loadSchedulerState,
					saveState: options.saveSchedulerState,
					onError: options.onSchedulerError,
				}))
			: null;

	return {
		proactiveJobs: jobs.length,
		async start() {
			try {
				await bridge.start();
				scheduler?.start();
			} catch (error) {
				scheduler?.stop();
				await supervisor.shutdown();
				bridge.stop();
				throw error;
			}
		},
		async stop() {
			scheduler?.stop();
			await supervisor.shutdown();
			bridge.stop();
		},
	};
}
