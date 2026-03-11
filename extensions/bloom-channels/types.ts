/**
 * Types for the Matrix-based channel bridge.
 */

/** Stored connection state for the Matrix client. */
export interface MatrixConnectionState {
	connected: boolean;
	userId: string | null;
	homeserver: string;
	roomId: string | null;
}

/** Inbound message from a Matrix room. */
export interface MatrixInboundMessage {
	roomId: string;
	senderId: string;
	body: string;
	eventId: string;
	timestamp: number;
	media?: MatrixMediaInfo;
}

/** Media attachment from Matrix. */
export interface MatrixMediaInfo {
	kind: "image" | "audio" | "video" | "document";
	mimetype: string;
	url: string;
	filename: string;
	size: number;
}
