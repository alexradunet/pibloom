import os from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createMultiAgentRuntimeMock = vi.fn();
const withRetryMock = vi.fn();
const loadRuntimeAgentsMock = vi.fn();
const loadSchedulerStateMock = vi.fn();
const saveSchedulerStateMock = vi.fn();
const readFileSyncMock = vi.fn();
const matrixCredentialsPathMock = vi.fn();
const matrixAgentCredentialsPathMock = vi.fn();
const logInfoMock = vi.fn();
const logWarnMock = vi.fn();
const logErrorMock = vi.fn();

vi.mock("node:fs", () => ({
	readFileSync: readFileSyncMock,
}));

vi.mock("../../core/lib/matrix.js", () => ({
	matrixCredentialsPath: matrixCredentialsPathMock,
	matrixAgentCredentialsPath: matrixAgentCredentialsPathMock,
}));

vi.mock("../../core/lib/shared.js", async () => {
	const actual = await vi.importActual<typeof import("../../core/lib/shared.js")>("../../core/lib/shared.js");
	return {
		...actual,
		createLogger: () => ({
			info: logInfoMock,
			warn: logWarnMock,
			error: logErrorMock,
			debug: vi.fn(),
		}),
	};
});

vi.mock("../../core/daemon/agent-registry.js", () => ({
	loadRuntimeAgents: loadRuntimeAgentsMock,
}));

vi.mock("../../core/lib/retry.js", () => ({
	withRetry: withRetryMock,
}));

vi.mock("../../core/daemon/multi-agent-runtime.js", () => ({
	createMultiAgentRuntime: createMultiAgentRuntimeMock,
}));

vi.mock("../../core/daemon/proactive.js", () => ({
	loadSchedulerState: loadSchedulerStateMock,
	saveSchedulerState: saveSchedulerStateMock,
}));

describe("daemon bootstrap", () => {
	const processOnSpy = vi.spyOn(process, "on").mockImplementation(() => process);
	const homeDir = os.homedir();

	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
		loadSchedulerStateMock.mockReturnValue({});
		saveSchedulerStateMock.mockImplementation(() => undefined);
		matrixCredentialsPathMock.mockReturnValue("/tmp/matrix.json");
		matrixAgentCredentialsPathMock.mockImplementation((agentId: string) => `/tmp/${agentId}.json`);
		readFileSyncMock.mockReturnValue(
			JSON.stringify({
				homeserver: "http://matrix",
				botAccessToken: "token",
				botPassword: "secret",
				botUserId: "@pi:nixpi",
				registrationToken: "reg-token",
			}),
		);
		withRetryMock.mockImplementation(async (fn: () => Promise<void>) => {
			await fn();
		});
	});

	afterEach(() => {
		processOnSpy.mockClear();
	});

	it("starts the unified runtime with a default host agent when no valid agent definitions exist", async () => {
		const runtime = {
			start: vi.fn().mockResolvedValue(undefined),
			stop: vi.fn().mockResolvedValue(undefined),
			proactiveJobs: 0,
		};
		createMultiAgentRuntimeMock.mockReturnValue(runtime);
		loadRuntimeAgentsMock.mockReturnValue({
			agents: [
				{
					id: "host",
					name: "Pi",
					instructionsPath: "<builtin>",
					matrix: { userId: "@pi:nixpi" },
					respond: { mode: "host" },
				},
			],
			errors: ["bad overlay"],
		});

		await import("../../core/daemon/index.js");

		expect(logWarnMock).toHaveBeenCalledWith("skipping invalid agent definition", { error: "bad overlay" });
		expect(createMultiAgentRuntimeMock).toHaveBeenCalledWith(
			expect.objectContaining({
				agents: [
					expect.objectContaining({
						id: "host",
						name: "Pi",
						instructionsPath: "<builtin>",
						matrix: expect.objectContaining({ userId: "@pi:nixpi" }),
						respond: expect.objectContaining({ mode: "host" }),
					}),
				],
				sessionBaseDir: `${homeDir}/.pi/sessions/nixpi-rooms`,
			}),
		);
		expect(withRetryMock).toHaveBeenCalledTimes(1);
		expect(runtime.start).toHaveBeenCalledTimes(1);
	});

	it("starts the multi-agent runtime when valid agent definitions exist", async () => {
		const runtime = {
			start: vi.fn().mockResolvedValue(undefined),
			stop: vi.fn().mockResolvedValue(undefined),
			proactiveJobs: 2,
		};
		createMultiAgentRuntimeMock.mockReturnValue(runtime);
		loadRuntimeAgentsMock.mockReturnValue({
			agents: [{ id: "ops" }, { id: "support" }],
			errors: [],
		});

		const bootstrapModule = "../../core/daemon/index.js?multi";
		await import(bootstrapModule);

		expect(createMultiAgentRuntimeMock).toHaveBeenCalledWith(
			expect.objectContaining({
				agents: [{ id: "ops" }, { id: "support" }],
				sessionBaseDir: `${homeDir}/.pi/sessions/nixpi-rooms`,
			}),
		);
		expect(withRetryMock).toHaveBeenCalledTimes(1);
		expect(runtime.start).toHaveBeenCalledTimes(1);
	});
});
