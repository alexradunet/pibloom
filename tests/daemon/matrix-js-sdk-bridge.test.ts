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
					userId: "@pi:bloom",
					homeserver: "http://localhost:6167",
					accessToken: "host-token",
					storagePath: "/tmp/host.json",
					autojoin: true,
				},
				{
					id: "planner",
					userId: "@planner:bloom",
					homeserver: "http://localhost:6167",
					accessToken: "planner-token",
					storagePath: "/tmp/planner.json",
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
				roomId: "!room:bloom",
				sender: "@alex:bloom",
				eventId: "$evt1",
				timestamp: 1_000,
				content: { msgtype: "m.text", body: "hello" },
			}),
		);
		await flushAsyncWork();
		expect(onTextEvent).toHaveBeenCalledWith("host", {
			roomId: "!room:bloom",
			eventId: "$evt1",
			senderUserId: "@alex:bloom",
			body: "hello",
			timestamp: 1_000,
		});
	});

	it("dedupes the same event seen by multiple identity clients", async () => {
		const bridge = new MatrixJsSdkBridge({
			identities: [
				{
					id: "host",
					userId: "@pi:bloom",
					homeserver: "http://localhost:6167",
					accessToken: "host-token",
					storagePath: "/tmp/host.json",
				},
				{
					id: "planner",
					userId: "@planner:bloom",
					homeserver: "http://localhost:6167",
					accessToken: "planner-token",
					storagePath: "/tmp/planner.json",
				},
			],
		});
		const onTextEvent = vi.fn();
		bridge.onTextEvent(onTextEvent);

		await bridge.start();

		const event = new MockMatrixEvent({
			type: "m.room.message",
			roomId: "!room:bloom",
			sender: "@alex:bloom",
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
					userId: "@pi:bloom",
					homeserver: "http://localhost:6167",
					accessToken: "host-token",
					storagePath: "/tmp/host.json",
					autojoin: true,
				},
			],
		});

		await bridge.start();

		mockClients[0]?.emit(
			"event",
			new MockMatrixEvent({
				type: "m.room.member",
				roomId: "!invite:bloom",
				sender: "@admin:bloom",
				eventId: "$evt2",
				timestamp: 1_000,
				content: { membership: "invite" },
				stateKey: "@pi:bloom",
			}),
		);
		await flushAsyncWork();

		expect(mockClients[0]?.joinRoom).toHaveBeenCalledWith("!invite:bloom");
	});

	it("routes sendText, typing, and alias lookup through the correct identity client", async () => {
		const bridge = new MatrixJsSdkBridge({
			identities: [
				{
					id: "host",
					userId: "@pi:bloom",
					homeserver: "http://localhost:6167",
					accessToken: "host-token",
					storagePath: "/tmp/host.json",
				},
				{
					id: "planner",
					userId: "@planner:bloom",
					homeserver: "http://localhost:6167",
					accessToken: "planner-token",
					storagePath: "/tmp/planner.json",
				},
			],
		});

		await bridge.start();
		mockClients[1]?.getRoom.mockReturnValue(new MockRoom("#general:bloom"));

		await bridge.sendText("planner", "!room:bloom", "hello");
		await bridge.setTyping("host", "!room:bloom", true, 15_000);
		const alias = await bridge.getRoomAlias("planner", "!room:bloom");

		expect(mockClients[1]?.sendTextMessage).toHaveBeenCalledWith("!room:bloom", "hello");
		expect(mockClients[0]?.sendTyping).toHaveBeenCalledWith("!room:bloom", true, 15_000);
		expect(alias).toBe("#general:bloom");
	});

	it("falls back from canonical alias to alt alias to room id", async () => {
		const bridge = new MatrixJsSdkBridge({
			identities: [
				{
					id: "host",
					userId: "@pi:bloom",
					homeserver: "http://localhost:6167",
					accessToken: "host-token",
					storagePath: "/tmp/host.json",
				},
			],
		});

		await bridge.start();

		mockClients[0]?.getRoom.mockReturnValueOnce(new MockRoom("#canonical:bloom"));
		await expect(bridge.getRoomAlias("host", "!room:bloom")).resolves.toBe("#canonical:bloom");

		mockClients[0]?.getRoom.mockReturnValueOnce(new MockRoom(null, ["#alt:bloom"]));
		await expect(bridge.getRoomAlias("host", "!room:bloom")).resolves.toBe("#alt:bloom");

		mockClients[0]?.getRoom.mockReturnValueOnce(null);
		mockClients[0]?.getLocalAliases.mockRejectedValueOnce(new Error("no aliases"));
		await expect(bridge.getRoomAlias("host", "!room:bloom")).resolves.toBe("!room:bloom");
	});
});
