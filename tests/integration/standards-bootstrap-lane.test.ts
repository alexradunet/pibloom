import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	bootstrapHostPackagePath,
	bootstrapHostScriptPath,
	bootstrapHostTestPath,
	flakePath,
	nixHostsPath,
	nixPkgsPath,
	readUtf8,
} from "./standards-guard.shared.js";

describe("repo standards bootstrap lane guards", () => {
	it("keeps only the host-owned bootstrap lane wired into the repo", () => {
		const flake = readUtf8(flakePath);
		const nixPkgs = readUtf8(nixPkgsPath);
		const nixHosts = readUtf8(nixHostsPath);

		expect(flake).toContain('disko.url = "github:nix-community/disko"');
		expect(flake).toContain('nixos-anywhere.url = "github:nix-community/nixos-anywhere"');
		expect(nixPkgs).toContain("nixpi-bootstrap-host = pkgs.callPackage ../core/os/pkgs/nixpi-bootstrap-host { };");
		expect(nixPkgs).toContain("plainHostDeployPath = ../nixos_vps_provisioner/pkgs/plain-host-deploy;");
		expect(nixPkgs).toContain("plain-host-deploy = plainHostDeploy;");
		expect(nixPkgs).toContain('pkgs.writeShellScriptBin "plain-host-deploy"');
		expect(nixHosts).toContain("ovh-vps-base = mkConfiguredStableSystem");
		expect(nixHosts).toContain("../nixos_vps_provisioner/presets/ovh-single-disk.nix");
		expect(nixHosts).toContain("../nixos_vps_provisioner/presets/ovh-vps-base.nix");
		expect(flake).toContain(`program = "\${self.packages.\${system}.nixpi-bootstrap-host}/bin/nixpi-bootstrap-host"`);
		expect(flake).toContain(`program = "\${self.packages.\${system}.plain-host-deploy}/bin/plain-host-deploy"`);

		expect(existsSync(bootstrapHostScriptPath)).toBe(true);
		expect(existsSync(bootstrapHostPackagePath)).toBe(true);
		expect(existsSync(bootstrapHostTestPath)).toBe(true);

		expect(flake).not.toContain("nixpi-rebuild-pull");
		expect(flake).not.toContain("nixpi-reinstall-ovh");
		expect(flake).not.toContain("nixpi-deploy-ovh = pkgs.callPackage");
		expect(flake).not.toContain(`program = "\${self.packages.\${system}.nixpi-deploy-ovh}/bin/nixpi-deploy-ovh"`);
		expect(flake).not.toContain("ovh-vps = mkConfiguredStableSystem");
		expect(flake).not.toContain("ovh-base = mkConfiguredStableSystem");
		expect(flake).not.toContain("./core/os/pkgs/plain-host-deploy");
		expect(flake).not.toContain("./core/os/disko/ovh-single-disk.nix");
		expect(flake).not.toContain("./core/os/hosts/ovh-base.nix");
	});
});
