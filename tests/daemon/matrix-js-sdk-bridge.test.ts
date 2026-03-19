import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockClients, mockCreateClient } = vi.hoisted(() => ({
	mockClients: [] as MockClient[],
	mockCreateClient: vi.fn(),
}));

type Handler = (...args: unknown[]) => void;

class MockRoom {
	constructor(
		private readonly canonicalAlias: string | null = null,
		private readonly altAliases: string[] = [],
	) {}

	getCanonicalAlias(): string | null {
		return this.canonicalAlias;
	}

	getAltAliases(): string[] {
		return this.altAliases;
	}
}

class MockMatrixEvent {
	public readonly event: Record<string, unknown>;

	constructor(
		private readonly data: {
			type: string;
			roomId?: string;
			sender?: string;
			eventId?: string;
			timestamp?: number;
			content?: Record<string, unknown>;
			stateKey?: string;
		},
	) {
		this.event = {
			room_id: data.roomId,
			content: data.content,
			state_key: data.stateKey,
		};
	}

	getType(): string {
		return this.data.type;
	}

	getRoomId(): string | undefined {
		return this.data.roomId;
	}

	getSender(): string | undefined {
		return this.data.sender;
	}

	getId(): string | undefined {
		return this.data.eventId;
	}

	getTs(): number {
		return this.data.timestamp ?? 0;
	}

	getContent(): Record<string, unknown> {
		return this.data.content ?? {};
	}
}

class MockClient {
	public readonly handlers = new Map<string, Handler[]>();
	public readonly startClient = vi.fn(async () => {
		this.emit("sync", "PREPARED", null, undefined);
	});
	public readonly stopClient = vi.fn();
	public readonly sendTextMessage = vi.fn().mockResolvedValue({ event_id: "$sent" });
	public readonly sendHtmlMessage = vi.fn().mockResolvedValue({ event_id: "$sent" });
	public readonly sendTyping = vi.fn().mockResolvedValue({});
	public readonly joinRoom = vi.fn().mockResolvedValue({});
	public readonly getLocalAliases = vi.fn().mockResolvedValue({ aliases: [] as string[] });
	public readonly getRoom = vi.fn().mockReturnValue(null);

	on(event: string, handler: Handler): void {
		this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
	}

	off(event: string, handler: Handler): void {
		this.handlers.set(
			event,
			(this.handlers.get(event) ?? []).filter((candidate) => candidate !== handler),
		);
	}

	emit(event: string, ...args: unknown[]): void {
		for (const handler of this.handlers.get(event) ?? []) {
			handler(...args);
		}
	}
}

vi.mock("matrix-js-sdk", () => ({
	ClientEvent: {
		Event: "event",
		Sync: "sync",
		SyncUnexpectedError: "sync.unexpectedError",
	},
	SyncState: {
		Prepared: "PREPARED",
		Syncing: "SYNCING",
		Error: "ERROR",
	},
	MemoryStore: class {},
	createClient: mockCreateClient.mockImplementation(() => {
		const client = new MockClient();
		mockClients.push(client);
		return client;
	}),
}));

import { MatrixJsSdkBridge } from "../../core/daemon/runtime/matrix-js-sdk-bridge.js";

async function flushAsyncWork(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("MatrixJsSdkBridge", () => {
	beforeEach(() => {
		mockClients.length = 0;
		vi.clearAllMocks();
	});

	it("starts one official Matrix client per identity and emits normalized text events", async () => {
		const bridge = new MatrixJsSdkBridge({
			identities: [
				{
					id: "host",
					userId: "@pi:garden",
					homeserver: "http://localhost:6167",
					accessToken: "host-token",
					autojoin: true,
				},
				{
					id: "planner",
					userId: "@planner:garden",
					homeserver: "http://localhost:6167",
					accessToken: "planner-token",
					autojoin: true,
				},
			],
		});
		const onTextEvent = vi.fn();
		bridge.onTextEvent(onTextEvent);

		await bridge.start();

		expect(mockClients).toHaveLength(2);
		mockClients[0]?.emit(
			"event",
			new MockMatrixEvent({
				type: "m.room.message",
				roomId: "!room:garden",
				sender: "@alex:garden",
				eventId: "$evt1",
				timestamp: 1_000,
				content: { msgtype: "m.text", body: "hello" },
			}),
		);
		await flushAsyncWork();
		expect(onTextEvent).toHaveBeenCalledWith("host", {
			roomId: "!room:garden",
			eventId: "$evt1",
			senderUserId: "@alex:garden",
			body: "hello",
			timestamp: 1_000,
		});
	});

	it("can use a client during startup if an event arrives as initial sync completes", async () => {
		mockCreateClient.mockImplementationOnce(() => {
			const client = new MockClient();
			Object.defineProperty(client, "startClient", {
				value: vi.fn(async () => {
					client.emit("sync", "PREPARED", null, undefined);
					client.emit(
						"event",
						new MockMatrixEvent({
							type: "m.room.message",
							roomId: "!room:garden",
							sender: "@alex:garden",
							eventId: "$evt-race",
							timestamp: 1_000,
							content: { msgtype: "m.text", body: "hello during startup" },
						}),
					);
				}),
			});
			mockClients.push(client);
			return client;
		});

		const bridge = new MatrixJsSdkBridge({
			identities: [
				{
					id: "host",
					userId: "@pi:garden",
					homeserver: "http://localhost:6167",
					accessToken: "host-token",
				},
			],
		});
		bridge.onTextEvent((identityId, event) => {
			void bridge.setTyping(identityId, event.roomId, true);
		});

		await expect(bridge.start()).resolves.toBeUndefined();
		expect(mockClients[0]?.sendTyping).toHaveBeenCalledWith("!room:garden", true, 30_000);
	});

	it("dedupes the same event seen by multiple identity clients", async () => {
		const bridge = new MatrixJsSdkBridge({
			identities: [
				{
					id: "host",
					userId: "@pi:garden",
					homeserver: "http://localhost:6167",
					accessToken: "host-token",
				},
				{
					id: "planner",
					userId: "@planner:garden",
					homeserver: "http://localhost:6167",
					accessToken: "planner-token",
				},
			],
		});
		const onTextEvent = vi.fn();
		bridge.onTextEvent(onTextEvent);

		await bridge.start();

		const event = new MockMatrixEvent({
			type: "m.room.message",
			roomId: "!room:garden",
			sender: "@alex:garden",
			eventId: "$evt1",
			timestamp: 1_000,
			content: { msgtype: "m.text", body: "hello" },
		});

		mockClients[0]?.emit("event", event);
		mockClients[1]?.emit("event", event);
		await flushAsyncWork();

		expect(onTextEvent).toHaveBeenCalledTimes(1);
	});

	it("autojoins invites for identities configured with autojoin", async () => {
		const bridge = new MatrixJsSdkBridge({
			identities: [
				{
					id: "host",
					userId: "@pi:garden",
					homeserver: "http://localhost:6167",
					accessToken: "host-token",
					autojoin: true,
				},
			],
		});

		await bridge.start();

		mockClients[0]?.emit(
			"event",
			new MockMatrixEvent({
				type: "m.room.member",
				roomId: "!invite:garden",
				sender: "@admin:garden",
				eventId: "$evt2",
				timestamp: 1_000,
				content: { membership: "invite" },
				stateKey: "@pi:garden",
			}),
		);
		await flushAsyncWork();

		expect(mockClients[0]?.joinRoom).toHaveBeenCalledWith("!invite:garden");
	});

	it("routes sendText, typing, and alias lookup through the correct identity client", async () => {
		const bridge = new MatrixJsSdkBridge({
			identities: [
				{
					id: "host",
					userId: "@pi:garden",
					homeserver: "http://localhost:6167",
					accessToken: "host-token",
				},
				{
					id: "planner",
					userId: "@planner:garden",
					homeserver: "http://localhost:6167",
					accessToken: "planner-token",
				},
			],
		});

		await bridge.start();
		mockClients[1]?.getRoom.mockReturnValue(new MockRoom("#general:garden"));

		await bridge.sendText("planner", "!room:garden", "# Hello\n\nThis is **bold** and `code`.");
		await bridge.setTyping("host", "!room:garden", true, 15_000);
		const alias = await bridge.getRoomAlias("planner", "!room:garden");

		expect(mockClients[1]?.sendHtmlMessage).toHaveBeenCalledWith(
			"!room:garden",
			"# Hello\n\nThis is **bold** and `code`.",
			"<h1>Hello</h1><p>This is <strong>bold</strong> and <code>code</code>.</p>",
		);
		expect(mockClients[0]?.sendTyping).toHaveBeenCalledWith("!room:garden", true, 15_000);
		expect(alias).toBe("#general:garden");
	});

	it("falls back from canonical alias to alt alias to room id", async () => {
		const bridge = new MatrixJsSdkBridge({
			identities: [
				{
					id: "host",
					userId: "@pi:garden",
					homeserver: "http://localhost:6167",
					accessToken: "host-token",
				},
			],
		});

		await bridge.start();

		mockClients[0]?.getRoom.mockReturnValueOnce(new MockRoom("#canonical:garden"));
		await expect(bridge.getRoomAlias("host", "!room:garden")).resolves.toBe("#canonical:garden");

		mockClients[0]?.getRoom.mockReturnValueOnce(new MockRoom(null, ["#alt:garden"]));
		await expect(bridge.getRoomAlias("host", "!room:garden")).resolves.toBe("#alt:garden");

		mockClients[0]?.getRoom.mockReturnValueOnce(null);
		mockClients[0]?.getLocalAliases.mockRejectedValueOnce(new Error("no aliases"));
		await expect(bridge.getRoomAlias("host", "!room:garden")).resolves.toBe("!room:garden");
	});

	it("ignores events from self", async () => {
		const bridge = new MatrixJsSdkBridge({
			identities: [
				{
					id: "host",
					userId: "@pi:garden",
					homeserver: "http://localhost:6167",
					accessToken: "host-token",
				},
			],
		});
		const onTextEvent = vi.fn();
		bridge.onTextEvent(onTextEvent);

		await bridge.start();

		mockClients[0]?.emit(
			"event",
			new MockMatrixEvent({
				type: "m.room.message",
				roomId: "!room:garden",
				sender: "@pi:garden", // Self
				eventId: "$evt-self",
				timestamp: 1_000,
				content: { msgtype: "m.text", body: "hello" },
			}),
		);
		await flushAsyncWork();

		expect(onTextEvent).not.toHaveBeenCalled();
	});

	it("ignores events without room id or sender", async () => {
		const bridge = new MatrixJsSdkBridge({
			identities: [
				{
					id: "host",
					userId: "@pi:garden",
					homeserver: "http://localhost:6167",
					accessToken: "host-token",
				},
			],
		});
		const onTextEvent = vi.fn();
		bridge.onTextEvent(onTextEvent);

		await bridge.start();

		// No roomId
		mockClients[0]?.emit(
			"event",
			new MockMatrixEvent({
				type: "m.room.message",
				sender: "@alex:garden",
				eventId: "$evt1",
				timestamp: 1_000,
				content: { msgtype: "m.text", body: "hello" },
			}),
		);
		await flushAsyncWork();

		// No sender
		mockClients[0]?.emit(
			"event",
			new MockMatrixEvent({
				type: "m.room.message",
				roomId: "!room:garden",
				eventId: "$evt2",
				timestamp: 1_000,
				content: { msgtype: "m.text", body: "hello" },
			}),
		);
		await flushAsyncWork();

		expect(onTextEvent).not.toHaveBeenCalled();
	});

	it("ignores non-text message types", async () => {
		const bridge = new MatrixJsSdkBridge({
			identities: [
				{
					id: "host",
					userId: "@pi:garden",
					homeserver: "http://localhost:6167",
					accessToken: "host-token",
				},
			],
		});
		const onTextEvent = vi.fn();
		bridge.onTextEvent(onTextEvent);

		await bridge.start();

		// Image message
		mockClients[0]?.emit(
			"event",
			new MockMatrixEvent({
				type: "m.room.message",
				roomId: "!room:garden",
				sender: "@alex:garden",
				eventId: "$evt-image",
				timestamp: 1_000,
				content: { msgtype: "m.image", url: "mxc://..." },
			}),
		);
		await flushAsyncWork();

		// Non-message event type
		mockClients[0]?.emit(
			"event",
			new MockMatrixEvent({
				type: "m.room.topic",
				roomId: "!room:garden",
				sender: "@alex:garden",
				eventId: "$evt-topic",
				timestamp: 1_000,
				content: { topic: "New topic" },
			}),
		);
		await flushAsyncWork();

		expect(onTextEvent).not.toHaveBeenCalled();
	});

	it("ignores messages with invalid sender format", async () => {
		const bridge = new MatrixJsSdkBridge({
			identities: [
				{
					id: "host",
					userId: "@pi:garden",
					homeserver: "http://localhost:6167",
					accessToken: "host-token",
				},
			],
		});
		const onTextEvent = vi.fn();
		bridge.onTextEvent(onTextEvent);

		await bridge.start();

		// Invalid sender format
		mockClients[0]?.emit(
			"event",
			new MockMatrixEvent({
				type: "m.room.message",
				roomId: "!room:garden",
				sender: "invalid-sender",
				eventId: "$evt1",
				timestamp: 1_000,
				content: { msgtype: "m.text", body: "hello" },
			}),
		);
		await flushAsyncWork();

		expect(onTextEvent).not.toHaveBeenCalled();
	});

	it("does not autojoin when autojoin is disabled", async () => {
		const bridge = new MatrixJsSdkBridge({
			identities: [
				{
					id: "host",
					userId: "@pi:garden",
					homeserver: "http://localhost:6167",
					accessToken: "host-token",
					autojoin: false,
				},
			],
		});

		await bridge.start();

		mockClients[0]?.emit(
			"event",
			new MockMatrixEvent({
				type: "m.room.member",
				roomId: "!invite:garden",
				sender: "@admin:garden",
				eventId: "$evt2",
				timestamp: 1_000,
				content: { membership: "invite" },
				stateKey: "@pi:garden",
			}),
		);
		await flushAsyncWork();

		expect(mockClients[0]?.joinRoom).not.toHaveBeenCalled();
	});

	it("does not autojoin for invites not targeting the identity", async () => {
		const bridge = new MatrixJsSdkBridge({
			identities: [
				{
					id: "host",
					userId: "@pi:garden",
					homeserver: "http://localhost:6167",
					accessToken: "host-token",
					autojoin: true,
				},
			],
		});

		await bridge.start();

		// Invite for someone else
		mockClients[0]?.emit(
			"event",
			new MockMatrixEvent({
				type: "m.room.member",
				roomId: "!invite:garden",
				sender: "@admin:garden",
				eventId: "$evt2",
				timestamp: 1_000,
				content: { membership: "invite" },
				stateKey: "@other:garden",
			}),
		);
		await flushAsyncWork();

		expect(mockClients[0]?.joinRoom).not.toHaveBeenCalled();
	});

	it("does not autojoin for non-invite membership events", async () => {
		const bridge = new MatrixJsSdkBridge({
			identities: [
				{
					id: "host",
					userId: "@pi:garden",
					homeserver: "http://localhost:6167",
					accessToken: "host-token",
					autojoin: true,
				},
			],
		});

		await bridge.start();

		// Join event (not invite)
		mockClients[0]?.emit(
			"event",
			new MockMatrixEvent({
				type: "m.room.member",
				roomId: "!room:garden",
				sender: "@admin:garden",
				eventId: "$evt2",
				timestamp: 1_000,
				content: { membership: "join" },
				stateKey: "@pi:garden",
			}),
		);
		await flushAsyncWork();

		expect(mockClients[0]?.joinRoom).not.toHaveBeenCalled();
	});

	it("throws when using unknown identity", async () => {
		const bridge = new MatrixJsSdkBridge({
			identities: [
				{
					id: "host",
					userId: "@pi:garden",
					homeserver: "http://localhost:6167",
					accessToken: "host-token",
				},
			],
		});

		await bridge.start();

		await expect(bridge.sendText("unknown", "!room:garden", "hello")).rejects.toThrow(
			"Unknown Matrix identity: unknown",
		);
		await expect(bridge.setTyping("unknown", "!room:garden", true)).rejects.toThrow("Unknown Matrix identity: unknown");
		await expect(bridge.getRoomAlias("unknown", "!room:garden")).rejects.toThrow("Unknown Matrix identity: unknown");
	});

	it("stops all clients on stop", async () => {
		const bridge = new MatrixJsSdkBridge({
			identities: [
				{
					id: "host",
					userId: "@pi:garden",
					homeserver: "http://localhost:6167",
					accessToken: "host-token",
				},
				{
					id: "planner",
					userId: "@planner:garden",
					homeserver: "http://localhost:6167",
					accessToken: "planner-token",
				},
			],
		});

		await bridge.start();
		bridge.stop();

		expect(mockClients[0]?.stopClient).toHaveBeenCalled();
		expect(mockClients[1]?.stopClient).toHaveBeenCalled();
	});

	it("uses fallback when event id is missing", async () => {
		const bridge = new MatrixJsSdkBridge({
			identities: [
				{
					id: "host",
					userId: "@pi:garden",
					homeserver: "http://localhost:6167",
					accessToken: "host-token",
				},
			],
		});
		const onTextEvent = vi.fn();
		bridge.onTextEvent(onTextEvent);

		await bridge.start();

		mockClients[0]?.emit(
			"event",
			new MockMatrixEvent({
				type: "m.room.message",
				roomId: "!room:garden",
				sender: "@alex:garden",
				// eventId is undefined
				timestamp: 1_000,
				content: { msgtype: "m.text", body: "hello" },
			}),
		);
		await flushAsyncWork();

		expect(onTextEvent).toHaveBeenCalledWith(
			"host",
			expect.objectContaining({
				eventId: "unknown",
			}),
		);
	});

	it("falls back to local aliases when room has no canonical or alt aliases", async () => {
		const bridge = new MatrixJsSdkBridge({
			identities: [
				{
					id: "host",
					userId: "@pi:garden",
					homeserver: "http://localhost:6167",
					accessToken: "host-token",
				},
			],
		});

		await bridge.start();

		mockClients[0]?.getRoom.mockReturnValue(new MockRoom(null, []));
		mockClients[0]?.getLocalAliases.mockResolvedValue({ aliases: ["#local:garden"] });

		const alias = await bridge.getRoomAlias("host", "!room:garden");
		expect(alias).toBe("#local:garden");
	});
});
