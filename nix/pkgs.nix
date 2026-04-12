# nix/pkgs.nix — mkPackages: system → NixPI package attrset
{ self, nixpkgs, nixos-anywhere }:
system:
let
  pkgs = import nixpkgs { inherit system; };
  piAgent = pkgs.callPackage ../core/os/pkgs/pi { };
  appPackage = pkgs.callPackage ../core/os/pkgs/app { inherit piAgent; };
  nixpiBootstrapDefaultInput =
    if self ? rev then
      "github:alexradunet/nixpi/${self.rev}"
    else
      "github:alexradunet/nixpi";
  plainHostDeployPath = ../nixos_vps_provisioner/pkgs/plain-host-deploy;
  plainHostDeploy =
    if builtins.pathExists plainHostDeployPath then
      pkgs.callPackage plainHostDeployPath {
        nixosAnywherePackage = nixos-anywhere.packages.${system}.nixos-anywhere;
      }
    else
      pkgs.writeShellScriptBin "plain-host-deploy" ''
        cat >&2 <<'EOF'
plain-host-deploy is not available in this checkout.

This repository expects an adjacent nixos_vps_provisioner tree at:
  ../nixos_vps_provisioner

Without that source, the flake cannot perform the rescue-mode base install.
Add the provisioner tree beside this repo, then rerun:
  nix run .#plain-host-deploy -- --target-host root@SERVER_IP --disk /dev/disk/by-id/PERSISTENT_TARGET_DISK_ID
EOF
        exit 1
      '';
in
{
  pi = piAgent;
  app = appPackage;
  signal-gateway = pkgs.callPackage ../core/os/pkgs/signal-gateway { };
  # Guardrail contract reference: nixpi-bootstrap-host = pkgs.callPackage ../core/os/pkgs/nixpi-bootstrap-host { };
  nixpi-bootstrap-host = pkgs.callPackage ../core/os/pkgs/nixpi-bootstrap-host {
    nixpiDefaultInput = nixpiBootstrapDefaultInput;
  };
  nixpi-rebuild = pkgs.callPackage ../core/os/pkgs/nixpi-rebuild { };
  plain-host-deploy = plainHostDeploy;
}
