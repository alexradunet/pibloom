// tests/chat-server/rpc-client-manager.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

// Must be hoisted above the import that loads RpcClientManager.
vi.mock("@mariozechner/pi-coding-agent", () => ({
	RpcClient: vi.fn(),
}));

import { RpcClient } from "@mariozechner/pi-coding-agent";
import { RpcClientManager } from "../../core/chat-server/rpc-client-manager.js";

type EventListener = (event: Record<string, unknown>) => void;

function makeMockClient() {
	let listener: EventListener | null = null;
	const mock = {
		start: vi.fn().mockResolvedValue(undefined),
		stop: vi.fn().mockResolvedValue(undefined),
		newSession: vi.fn().mockResolvedValue({ cancelled: false }),
		onEvent: vi.fn((cb: EventListener) => {
			listener = cb;
			return () => {
				listener = null;
			};
		}),
		prompt: vi.fn().mockResolvedValue(undefined),
		emit: (event: Record<string, unknown>) => listener?.(event),
	};
	return mock;
}

let mockClientInstance: ReturnType<typeof makeMockClient>;

beforeEach(() => {
	mockClientInstance = makeMockClient();
	vi.mocked(RpcClient).mockImplementation(function () { return mockClientInstance as unknown as RpcClient; });
});

describe("RpcClientManager.start / stop", () => {
	it("starts the RpcClient", async () => {
		const mgr = new RpcClientManager({ nixpiShareDir: "/mock/share", cwd: "/tmp/cwd" });
		await mgr.start();
		expect(mockClientInstance.start).toHaveBeenCalledOnce();
	});

	it("stops the RpcClient", async () => {
		const mgr = new RpcClientManager({ nixpiShareDir: "/mock/share", cwd: "/tmp/cwd" });
		await mgr.stop();
		expect(mockClientInstance.stop).toHaveBeenCalledOnce();
	});
});

describe("RpcClientManager.reset", () => {
	it("calls newSession on the RpcClient", async () => {
		const mgr = new RpcClientManager({ nixpiShareDir: "/mock/share", cwd: "/tmp/cwd" });
		await mgr.reset();
		expect(mockClientInstance.newSession).toHaveBeenCalledOnce();
	});
});

describe("RpcClientManager.sendMessage", () => {
	it("streams text deltas and emits done", async () => {
		const mgr = new RpcClientManager({ nixpiShareDir: "/mock/share", cwd: "/tmp/cwd" });

		mockClientInstance.prompt.mockImplementation(async () => {
			// Simulate Pi emitting accumulated text events followed by agent_end.
			mockClientInstance.emit({
				type: "message_update",
				message: { content: [{ type: "text", text: "Hello" }] },
			});
			mockClientInstance.emit({
				type: "message_update",
				message: { content: [{ type: "text", text: "Hello world" }] },
			});
			mockClientInstance.emit({ type: "agent_end", messages: [] });
		});

		const events = [];
		for await (const event of mgr.sendMessage("hi")) {
			events.push(event);
		}

		expect(events).toEqual([
			{ type: "text", content: "Hello" },
			{ type: "text", content: " world" }, // delta only, not full "Hello world"
			{ type: "done" },
		]);
	});

	it("clears text cursors on agent_start so a new turn starts fresh", async () => {
		const mgr = new RpcClientManager({ nixpiShareDir: "/mock/share", cwd: "/tmp/cwd" });

		// First turn: build up cursor position.
		mockClientInstance.prompt.mockImplementationOnce(async () => {
			mockClientInstance.emit({
				type: "message_update",
				message: { content: [{ type: "text", text: "First" }] },
			});
			mockClientInstance.emit({ type: "agent_end", messages: [] });
		});
		for await (const _ of mgr.sendMessage("first")) { /* drain */ }

		// Second turn: agent_start clears cursors so text starts from 0 again.
		mockClientInstance.prompt.mockImplementationOnce(async () => {
			mockClientInstance.emit({ type: "agent_start" });
			mockClientInstance.emit({
				type: "message_update",
				message: { content: [{ type: "text", text: "Second" }] },
			});
			mockClientInstance.emit({ type: "agent_end", messages: [] });
		});
		const events = [];
		for await (const event of mgr.sendMessage("second")) {
			events.push(event);
		}

		expect(events).toContainEqual({ type: "text", content: "Second" });
		expect(events).not.toContainEqual({ type: "text", content: "d" }); // would happen without cursor reset
	});

	it("emits tool_call and tool_result events", async () => {
		const mgr = new RpcClientManager({ nixpiShareDir: "/mock/share", cwd: "/tmp/cwd" });

		mockClientInstance.prompt.mockImplementation(async () => {
			mockClientInstance.emit({
				type: "tool_execution_start",
				toolCallId: "t1",
				toolName: "bash",
				args: { command: "ls" },
			});
			mockClientInstance.emit({
				type: "tool_execution_end",
				toolCallId: "t1",
				toolName: "bash",
				result: "file.txt",
				isError: false,
			});
			mockClientInstance.emit({ type: "agent_end", messages: [] });
		});

		const events = [];
		for await (const event of mgr.sendMessage("list files")) {
			events.push(event);
		}

		expect(events).toContainEqual({ type: "tool_call", name: "bash", input: '{"command":"ls"}' });
		expect(events).toContainEqual({ type: "tool_result", name: "bash", output: "file.txt" });
	});

	it("emits error event when prompt rejects", async () => {
		const mgr = new RpcClientManager({ nixpiShareDir: "/mock/share", cwd: "/tmp/cwd" });

		mockClientInstance.prompt.mockRejectedValue(new Error("Pi crashed"));

		const events = [];
		for await (const event of mgr.sendMessage("hi")) {
			events.push(event);
		}

		expect(events).toContainEqual({ type: "error", message: "Error: Pi crashed" });
	});

	it("ignores message_update events with no text content", async () => {
		const mgr = new RpcClientManager({ nixpiShareDir: "/mock/share", cwd: "/tmp/cwd" });

		mockClientInstance.prompt.mockImplementation(async () => {
			mockClientInstance.emit({ type: "message_update", message: {} });
			mockClientInstance.emit({ type: "message_update", message: { content: [] } });
			mockClientInstance.emit({ type: "agent_end", messages: [] });
		});

		const events = [];
		for await (const event of mgr.sendMessage("hi")) {
			events.push(event);
		}

		expect(events).toEqual([{ type: "done" }]);
	});
});
