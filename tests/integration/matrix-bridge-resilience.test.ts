import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockClients, mockCreateClient } = vi.hoisted(() => ({
	mockClients: [] as MockClient[],
	mockCreateClient: vi.fn(),
}));

type Handler = (...args: unknown[]) => void;

class MockClient {
	public readonly handlers = new Map<string, Handler[]>();
	public startClient = vi.fn(async () => {
		this.emit("sync", "PREPARED", null, undefined);
	});
	public readonly stopClient = vi.fn();
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

describe("Matrix Bridge Resilience", () => {
	beforeEach(() => {
		mockClients.length = 0;
		vi.clearAllMocks();
	});

	it("handles sync state error during startup", async () => {
		mockCreateClient.mockImplementationOnce(() => {
			const client = new MockClient();
			client.startClient = vi.fn(async () => {
				client.emit("sync", "ERROR", null, { error: new Error("Sync failed") });
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

		await expect(bridge.start()).rejects.toThrow("Sync failed");
	});

	it("handles unexpected sync error during startup", async () => {
		mockCreateClient.mockImplementationOnce(() => {
			const client = new MockClient();
			client.startClient = vi.fn(async () => {
				client.emit("sync.unexpectedError", new Error("Network error"));
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

		await expect(bridge.start()).rejects.toThrow("Network error");
	});
});
