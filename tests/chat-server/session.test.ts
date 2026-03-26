import { describe, it, expect, vi, beforeEach } from "vitest";
import { ChatSessionManager } from "../../core/chat-server/session.js";

// We mock pi-coding-agent so tests don't need real LLM calls.
vi.mock("@mariozechner/pi-coding-agent", () => ({
  createAgentSession: vi.fn(),
  createCodingTools: vi.fn(() => []),
  DefaultResourceLoader: vi.fn().mockImplementation(function () {
    return { reload: vi.fn().mockResolvedValue(undefined) };
  }),
  SessionManager: { create: vi.fn(() => ({})) },
  SettingsManager: {
    create: vi.fn(() => ({
      getDefaultProvider: vi.fn(() => null),
      getDefaultModel: vi.fn(() => null),
    })),
  },
}));

import { createAgentSession } from "@mariozechner/pi-coding-agent";

describe("ChatSessionManager", () => {
  let mockSession: {
    prompt: ReturnType<typeof vi.fn>;
    subscribe: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
    isStreaming: boolean;
    model: unknown;
  };

  beforeEach(() => {
    let subscriber: ((e: unknown) => void) | null = null;
    mockSession = {
      prompt: vi.fn().mockResolvedValue(undefined),
      subscribe: vi.fn((cb: (e: unknown) => void) => {
        subscriber = cb;
        return () => { subscriber = null; };
      }),
      dispose: vi.fn(),
      isStreaming: false,
      model: null,
    };
    vi.mocked(createAgentSession).mockResolvedValue({
      session: mockSession as never,
      extensionsResult: {} as never,
    });
    // expose subscriber for tests
    (mockSession as unknown as { _emit: (e: unknown) => void })._emit = (e) => subscriber?.(e);
  });

  it("creates a session on first getOrCreate", async () => {
    const manager = new ChatSessionManager({
      nixpiShareDir: "/mock/share",
      chatSessionsDir: "/tmp/chat-sessions",
      idleTimeoutMs: 5000,
      maxSessions: 4,
    });
    const session = await manager.getOrCreate("test-id-1");
    expect(session).toBeDefined();
    expect(createAgentSession).toHaveBeenCalledOnce();
  });

  it("returns the same session on second getOrCreate with same id", async () => {
    const manager = new ChatSessionManager({
      nixpiShareDir: "/mock/share",
      chatSessionsDir: "/tmp/chat-sessions",
      idleTimeoutMs: 5000,
      maxSessions: 4,
    });
    await manager.getOrCreate("test-id-2");
    await manager.getOrCreate("test-id-2");
    expect(createAgentSession).toHaveBeenCalledOnce();
  });

  it("disposes old sessions when maxSessions is exceeded", async () => {
    const manager = new ChatSessionManager({
      nixpiShareDir: "/mock/share",
      chatSessionsDir: "/tmp/chat-sessions",
      idleTimeoutMs: 5000,
      maxSessions: 2,
    });
    await manager.getOrCreate("s1");
    await manager.getOrCreate("s2");
    await manager.getOrCreate("s3"); // should evict s1
    expect(mockSession.dispose).toHaveBeenCalledOnce();
  });

  it("delete removes and disposes a session", async () => {
    const manager = new ChatSessionManager({
      nixpiShareDir: "/mock/share",
      chatSessionsDir: "/tmp/chat-sessions",
      idleTimeoutMs: 5000,
      maxSessions: 4,
    });
    await manager.getOrCreate("del-test");
    manager.delete("del-test");
    expect(mockSession.dispose).toHaveBeenCalledOnce();
  });
});
