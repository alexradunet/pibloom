import { describe, expect, it } from "vitest";
import {
	advanceStep,
	createInitialState,
	getNextStep,
	getStepsSummary,
	isSetupComplete,
	STEP_ORDER,
} from "../../lib/setup.js";

describe("createInitialState", () => {
	it("creates state with all steps pending", () => {
		const state = createInitialState();
		expect(state.version).toBe(1);
		expect(state.startedAt).toBeTruthy();
		expect(state.completedAt).toBeNull();
		for (const step of STEP_ORDER) {
			expect(state.steps[step].status).toBe("pending");
		}
	});

	it("has exactly 13 steps", () => {
		const state = createInitialState();
		expect(Object.keys(state.steps)).toHaveLength(13);
	});
});

describe("getNextStep", () => {
	it("returns 'welcome' for fresh state", () => {
		const state = createInitialState();
		expect(getNextStep(state)).toBe("welcome");
	});

	it("returns second step when first is completed", () => {
		const state = createInitialState();
		state.steps.welcome = { status: "completed", at: new Date().toISOString() };
		expect(getNextStep(state)).toBe("network");
	});

	it("skips completed and skipped steps", () => {
		const state = createInitialState();
		state.steps.welcome = { status: "completed", at: new Date().toISOString() };
		state.steps.network = { status: "skipped", at: new Date().toISOString(), reason: "has ethernet" };
		expect(getNextStep(state)).toBe("netbird");
	});

	it("returns null when all steps are done", () => {
		const state = createInitialState();
		for (const step of STEP_ORDER) {
			state.steps[step] = { status: "completed", at: new Date().toISOString() };
		}
		expect(getNextStep(state)).toBeNull();
	});
});

describe("advanceStep", () => {
	it("marks step as completed", () => {
		const state = createInitialState();
		const next = advanceStep(state, "welcome", "completed");
		expect(next.steps.welcome.status).toBe("completed");
		expect(next.steps.welcome.at).toBeTruthy();
	});

	it("marks step as skipped with reason", () => {
		const state = createInitialState();
		const next = advanceStep(state, "netbird", "skipped", "user declined");
		expect(next.steps.netbird.status).toBe("skipped");
		expect(next.steps.netbird.reason).toBe("user declined");
	});

	it("sets completedAt when last step is completed", () => {
		const state = createInitialState();
		for (const step of STEP_ORDER.slice(0, -1)) {
			state.steps[step] = { status: "completed", at: new Date().toISOString() };
		}
		const lastStep = STEP_ORDER[STEP_ORDER.length - 1];
		const next = advanceStep(state, lastStep, "completed");
		expect(next.completedAt).toBeTruthy();
	});

	it("does not mutate original state", () => {
		const state = createInitialState();
		const next = advanceStep(state, "welcome", "completed");
		expect(state.steps.welcome.status).toBe("pending");
		expect(next.steps.welcome.status).toBe("completed");
	});
});

describe("isSetupComplete", () => {
	it("returns false for fresh state", () => {
		expect(isSetupComplete(createInitialState())).toBe(false);
	});

	it("returns true when completedAt is set", () => {
		const state = createInitialState();
		state.completedAt = new Date().toISOString();
		expect(isSetupComplete(state)).toBe(true);
	});
});

describe("getStepsSummary", () => {
	it("returns summary of all steps", () => {
		const state = createInitialState();
		state.steps.welcome = { status: "completed", at: new Date().toISOString() };
		const summary = getStepsSummary(state);
		expect(summary).toHaveLength(13);
		expect(summary[0]).toEqual({ name: "welcome", status: "completed" });
		expect(summary[1]).toEqual({ name: "network", status: "pending" });
	});
});
