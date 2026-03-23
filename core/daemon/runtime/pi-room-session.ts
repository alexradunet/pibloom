import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	type AgentSessionEvent,
	createAgentSession,
	createCodingTools,
	DefaultResourceLoader,
	type AgentSession as PiAgentSession,
	SessionManager,
	SettingsManager,
} from "@mariozechner/pi-coding-agent";
import { createLogger } from "../../lib/shared.js";
import type { AgentSessionLike } from "../contracts/session.js";
import { extractResponseText, type SessionEvent } from "../contracts/session.js";

const log = createLogger("pi-room-session");
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

async function getSharedResources(): Promise<{
	resourceLoader: DefaultResourceLoader;
}> {
	const settingsManager = SettingsManager.create(REPO_ROOT);
	const resourceLoader = new DefaultResourceLoader({
		cwd: REPO_ROOT,
		settingsManager,
	});
	await resourceLoader.reload();
	return { resourceLoader };
}

type SessionInternals = {
	_modelRegistry?: {
		find: (provider: string, modelId: string) => unknown;
	};
};

export interface PiRoomSessionOptions {
	roomId: string;
	roomAlias: string;
	sanitizedAlias: string;
	sessionDir: string;
	idleTimeoutMs: number;
	onAgentEnd: (text: string) => void;
	onEvent: (event: SessionEvent) => void;
	onExit: (code: number | null) => void;
}

export class PiRoomSession implements AgentSessionLike {
	private readonly opts: PiRoomSessionOptions;
	private session: PiAgentSession | null = null;
	private unsubscribe: (() => void) | null = null;
	private idleTimer: ReturnType<typeof setTimeout> | null = null;
	private aliveState = false;
	private pendingMessage = false;
	private disposing = false;

	constructor(opts: PiRoomSessionOptions) {
		this.opts = opts;
	}

	get alive(): boolean {
		return this.aliveState;
	}

	async spawn(): Promise<void> {
		const { resourceLoader } = await getSharedResources();
		// Create a fresh SettingsManager per spawn so model/provider changes
		// made in the TUI (written to the Pi runtime settings file) are always
		// picked up when a new room session starts.
		const settingsManager = SettingsManager.create(REPO_ROOT);
		const { session } = await createAgentSession({
			cwd: this.opts.sessionDir,
			resourceLoader,
			settingsManager,
			sessionManager: SessionManager.create(this.opts.sessionDir),
			tools: createCodingTools(this.opts.sessionDir),
		});

		if (!session.model) {
			const defaultProvider = settingsManager.getDefaultProvider();
			const defaultModelId = settingsManager.getDefaultModel();
			const modelRegistry = (session as unknown as SessionInternals)._modelRegistry;
			if (defaultProvider && defaultModelId && modelRegistry) {
				const configuredModel = modelRegistry.find(defaultProvider, defaultModelId);
				if (configuredModel) {
					await session.setModel(configuredModel as Parameters<typeof session.setModel>[0]);
				}
			}
		}

		this.session = session;
		this.aliveState = true;
		this.unsubscribe = session.subscribe((event) => this.handleEvent(event));
		this.resetIdleTimer();
		log.info("spawned pi agent session", { room: this.opts.sanitizedAlias });
	}

	async sendMessage(text: string): Promise<void> {
		if (!this.session || this.disposing) return;

		this.resetIdleTimer();
		const shouldQueueFollowUp = this.pendingMessage || this.session.isStreaming;
		if (!shouldQueueFollowUp) {
			this.pendingMessage = true;
		}

		try {
			if (shouldQueueFollowUp) {
				await this.session.prompt(text, { streamingBehavior: "followUp" });
			} else {
				await this.session.prompt(text);
			}
		} catch (error) {
			this.pendingMessage = false;
			log.error("failed to send message to pi agent session", {
				room: this.opts.sanitizedAlias,
				error: String(error),
			});
			throw error;
		}
	}

	dispose(): void {
		this.disposing = true;
		this.aliveState = false;
		this.pendingMessage = false;

		if (this.idleTimer) {
			clearTimeout(this.idleTimer);
			this.idleTimer = null;
		}

		this.unsubscribe?.();
		this.unsubscribe = null;
		this.session?.dispose();
		this.session = null;
	}

	private handleEvent(event: AgentSessionEvent): void {
		if (event.type === "agent_start") {
			this.pendingMessage = true;
			this.opts.onEvent(event as SessionEvent);
			return;
		}

		if (event.type === "agent_end") {
			this.pendingMessage = false;
			const text = extractResponseText(event.messages as unknown as readonly Record<string, unknown>[]);
			if (text) {
				this.opts.onAgentEnd(text);
			}
			this.opts.onEvent(event as SessionEvent);
			return;
		}

		if (event.type === "message_update") {
			this.opts.onEvent(event as SessionEvent);
		}
	}

	private resetIdleTimer(): void {
		if (this.idleTimer) clearTimeout(this.idleTimer);
		this.idleTimer = setTimeout(() => {
			log.info("idle timeout, disposing", { room: this.opts.sanitizedAlias });
			this.dispose();
		}, this.opts.idleTimeoutMs);
		this.idleTimer.unref();
	}
}
