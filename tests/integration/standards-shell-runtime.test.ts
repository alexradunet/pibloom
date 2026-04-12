import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	daemonArchitecturePath,
	readmePath,
	readUtf8,
	runtimeFlowsPath,
	serviceArchitecturePath,
	shellModulePath,
	vpsHostPath,
} from "./standards-guard.shared.js";

describe("repo standards shell runtime guards", () => {
	it("documents and wires a shell-first operator runtime", () => {
		const shellModule = readUtf8(shellModulePath);
		const vpsHost = readUtf8(vpsHostPath);
		const readme = readUtf8(readmePath);
		const runtimeFlows = readUtf8(runtimeFlowsPath);
		const daemonArchitecture = readUtf8(daemonArchitecturePath);
		const serviceArchitecture = readUtf8(serviceArchitecturePath);

		expect(existsSync(shellModulePath)).toBe(true);
		expect(vpsHost).toContain("../modules/shell.nix");
		expect(vpsHost).toContain("bootstrap.enable = lib.mkDefault true;");
		expect(readme).toContain("plain shell runtime");
		expect(shellModule).toContain(`export PATH="\${wrapperBinDir}:\${nodeBinDir}:$PATH"`);
		expect(runtimeFlows).toContain("Interactive operator sessions stay in a plain shell.");
		expect(daemonArchitecture).toContain("interactive login shells stay in a plain shell");
		expect(serviceArchitecture).toContain("plain shell runtime");
	});
});
