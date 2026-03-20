import os
import shutil

NIXPI_SOURCE = "@nixpiSource@"

NIXPI_INSTALL_MODULE_TEMPLATE = """{ ... }:

{
  imports = [
    ./nixpi/core/os/modules/app.nix
    ./nixpi/core/os/modules/broker.nix
    ./nixpi/core/os/modules/firstboot.nix
    ./nixpi/core/os/modules/llm.nix
    ./nixpi/core/os/modules/matrix.nix
    ./nixpi/core/os/modules/network.nix
    ./nixpi/core/os/modules/shell.nix
    ./nixpi/core/os/modules/update.nix
  ];

  nixpi.primaryUser = "@@username@@";
  nixpi.install.mode = "existing-user";
  nixpi.createPrimaryUser = false;

  nixpkgs.config.allowUnfree = true;
  nix.settings.experimental-features = [ "nix-command" "flakes" ];
}
"""

NIXPI_FLAKE_TEMPLATE = """{
  description = "NixPI installed system";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = { nixpkgs, ... }:
    let
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};
      piAgent = pkgs.callPackage ./nixpi/core/os/pkgs/pi {};
      appPackage = pkgs.callPackage ./nixpi/core/os/pkgs/app { inherit piAgent; };
    in {
      nixosConfigurations."@@hostname@@" = nixpkgs.lib.nixosSystem {
        inherit system;
        specialArgs = { inherit piAgent appPackage; };
        modules = [
          ./nixpi/core/os/modules/options.nix
          ./nixpi/core/os/modules/app.nix
          ./nixpi/core/os/modules/broker.nix
          ./nixpi/core/os/modules/llm.nix
          ./nixpi/core/os/modules/matrix.nix
          ./nixpi/core/os/modules/network.nix
          ./nixpi/core/os/modules/shell.nix
          ./nixpi/core/os/modules/update.nix
          ./nixpi/core/os/modules/firstboot.nix
          ./nixpi-host.nix
        ];
      };
    };
}
"""


def _string_var(variables, key, default):
    return str(variables.get(key, default))


def strip_nixpi_install_import(cfg):
    return cfg.replace("      ./nixpi-install.nix\n", "", 1)


def prepare_nixpi_install_artifacts(root_mount_point, variables, cfg):
    nixpi_etc = os.path.join(root_mount_point, "etc/nixos")
    username = _string_var(variables, "username", "nixpi")
    hostname = _string_var(variables, "hostname", "nixpi")

    return {
        "hostname": hostname,
        "nixpi_source_target": os.path.join(nixpi_etc, "nixpi"),
        "nixpi_install_path": os.path.join(nixpi_etc, "nixpi-install.nix"),
        "nixpi_host_path": os.path.join(nixpi_etc, "nixpi-host.nix"),
        "flake_path": os.path.join(nixpi_etc, "flake.nix"),
        "flake_install_ref": f"{nixpi_etc}#{hostname}",
        "host_cfg": strip_nixpi_install_import(cfg),
        "nixpi_install_module": NIXPI_INSTALL_MODULE_TEMPLATE.replace("@@username@@", username),
        "nixpi_flake": NIXPI_FLAKE_TEMPLATE.replace("@@hostname@@", hostname),
    }


def write_nixpi_install_artifacts(root_mount_point, variables, cfg, host_env_process_output):
    artifacts = prepare_nixpi_install_artifacts(root_mount_point, variables, cfg)
    source_target = artifacts["nixpi_source_target"]

    if os.path.exists(source_target):
        shutil.rmtree(source_target)
    shutil.copytree(NIXPI_SOURCE, source_target, symlinks=True)

    host_env_process_output(
        ["cp", "/dev/stdin", artifacts["nixpi_install_path"]],
        None,
        artifacts["nixpi_install_module"],
    )
    host_env_process_output(
        ["cp", "/dev/stdin", artifacts["nixpi_host_path"]],
        None,
        artifacts["host_cfg"],
    )
    host_env_process_output(
        ["cp", "/dev/stdin", artifacts["flake_path"]],
        None,
        artifacts["nixpi_flake"],
    )

    return artifacts
