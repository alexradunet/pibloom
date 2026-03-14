export interface MatrixTextEvent {
	roomId: string;
	eventId: string;
	senderUserId: string;
	body: string;
	timestamp: number;
}

export interface MatrixIdentity {
	id: string;
	userId: string;
	homeserver: string;
	accessToken: string;
	storagePath: string;
	autojoin?: boolean;
}
