import { join } from "node:path";
import type { AgentDefinition } from "./agent-registry.js";
import { RoomProcess } from "./room-process.js";
import type { RpcCommand, RpcEvent } from "./rpc-protocol.js";
import { sanitizeRoomAlias } from "../lib/room-alias.js";

export interface AgentSessionOptions {
	roomId: string;
	roomAlias: string;
	agent: AgentDefinition;
	socketDir: string;
	sessionBaseDir: string;
	idleTimeoutMs: number;
	onAgentEnd: (agentId: string, text: string) => void;
	onEvent: (agentId: string, event: RpcEvent) => void;
	onExit: (agentId: string, code: number | null) => void;
}

export class AgentSession {
	private readonly opts: AgentSessionOptions;
	private readonly roomProcess: RoomProcess;
	private readonly sanitizedRoomAlias: string;

	constructor(opts: AgentSessionOptions) {
		this.opts = opts;
		this.sanitizedRoomAlias = sanitizeRoomAlias(opts.roomAlias);
		this.roomProcess = new RoomProcess({
			roomId: opts.roomId,
			roomAlias: opts.roomAlias,
			sanitizedAlias: `${this.sanitizedRoomAlias}-${opts.agent.id}`,
			socketDir: opts.socketDir,
			sessionDir: join(opts.sessionBaseDir, this.sanitizedRoomAlias, opts.agent.id),
			idleTimeoutMs: opts.idleTimeoutMs,
			onAgentEnd: (text) => opts.onAgentEnd(opts.agent.id, text),
			onEvent: (event) => opts.onEvent(opts.agent.id, event),
			onExit: (code) => opts.onExit(opts.agent.id, code),
		});
	}

	get alive(): boolean {
		return this.roomProcess.alive;
	}

	get isStreaming(): boolean {
		return this.roomProcess.isStreaming;
	}

	get agentId(): string {
		return this.opts.agent.id;
	}

	get sessionDir(): string {
		return join(this.opts.sessionBaseDir, this.sanitizedRoomAlias, this.opts.agent.id);
	}

	async spawn(): Promise<void> {
		await this.roomProcess.spawn();
	}

	send(cmd: RpcCommand): void {
		this.roomProcess.send(cmd);
	}

	sendMessage(text: string): void {
		this.roomProcess.sendMessage(text);
	}

	dispose(): void {
		this.roomProcess.dispose();
	}
}
