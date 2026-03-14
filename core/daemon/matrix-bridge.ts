import type { MatrixTextEvent } from "./matrix-types.js";

export interface MatrixBridge {
	start(): Promise<void>;
	stop(): void;
	sendText(identityId: string, roomId: string, text: string): Promise<void>;
	setTyping(identityId: string, roomId: string, typing: boolean, timeoutMs?: number): Promise<void>;
	getRoomAlias(identityId: string, roomId: string): Promise<string>;
	onTextEvent(handler: (identityId: string, event: MatrixTextEvent) => void): void;
}
