import { describe, expect, it } from "vitest";
import type { DevBuildResult, DevStatus, DevTestResult } from "../../extensions/bloom-dev/types.js";

// ---------------------------------------------------------------------------
// Task 1: Type validation
// ---------------------------------------------------------------------------
describe("bloom-dev types", () => {
	it("DevStatus has required and optional fields", () => {
		const status: DevStatus = {
			enabled: false,
			repoConfigured: true,
			codeServerRunning: false,
			localBuildAvailable: false,
		};
		expect(status.enabled).toBe(false);
		expect(status.repoConfigured).toBe(true);
		expect(status.repoPath).toBeUndefined();
		expect(status.localImageTag).toBeUndefined();

		const full: DevStatus = {
			enabled: true,
			repoConfigured: true,
			codeServerRunning: true,
			localBuildAvailable: true,
			repoPath: "/home/pi/.bloom/pi-bloom",
			localImageTag: "localhost/bloom:dev",
		};
		expect(full.repoPath).toBe("/home/pi/.bloom/pi-bloom");
		expect(full.localImageTag).toBe("localhost/bloom:dev");
	});

	it("DevBuildResult has required and optional fields", () => {
		const result: DevBuildResult = {
			success: true,
			imageTag: "localhost/bloom:dev",
			duration: 120,
		};
		expect(result.success).toBe(true);
		expect(result.size).toBeUndefined();
		expect(result.error).toBeUndefined();

		const failed: DevBuildResult = {
			success: false,
			imageTag: "localhost/bloom:dev",
			duration: 5,
			error: "build failed",
		};
		expect(failed.error).toBe("build failed");
	});

	it("DevTestResult has all required fields", () => {
		const result: DevTestResult = {
			success: true,
			testsPassed: true,
			lintPassed: true,
			testOutput: "all tests passed",
			lintOutput: "no lint errors",
		};
		expect(result.success).toBe(true);
		expect(result.testOutput).toBe("all tests passed");
	});
});
