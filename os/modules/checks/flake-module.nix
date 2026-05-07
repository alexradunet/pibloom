{
  inputs,
  lib,
  ...
}: {
  perSystem = {
    pkgs,
    system,
    ...
  }: {
    checks = {
      formatting =
        pkgs.runCommand "formatting-check" {
          nativeBuildInputs = [pkgs.alejandra];
        } ''
          cd ${../../..}

          find . -type f -name '*.nix' -print0 \
            | xargs -0 alejandra --check

          touch $out
        '';

      deadnix =
        pkgs.runCommand "deadnix-check" {
          nativeBuildInputs = [pkgs.deadnix];
        } ''
          cd ${../../..}
          deadnix --fail .
          touch $out
        '';

      statix =
        pkgs.runCommand "statix-check" {
          nativeBuildInputs = [pkgs.statix];
        } ''
          cd ${../../..}
          statix check .
          touch $out
        '';

      ownloom-purity-check = pkgs.callPackage ./source/purity.nix {};
      ownloom-wiki-stale-identities = pkgs.callPackage ./source/wiki-stale-identities.nix {};
      ownloom-wiki-adapter-api-boundary = pkgs.callPackage ./source/wiki-adapter-api-boundary.nix {};

      ownloom-wiki-npm-pack-smoke = pkgs.callPackage ./wiki-npm-pack-smoke.nix {};
      ownloom-pi-extension-startup-smoke = pkgs.callPackage ./smoke/pi-extension-startup.nix {};
      ownloom-wiki-cli-smoke = pkgs.callPackage ./smoke/wiki-cli.nix {};

      # Build package derivations in flake checks so their package-local test suites run.
      ownloom-wiki-package = pkgs.ownloom-wiki;
      ownloom-gateway-package = pkgs.ownloom-gateway;
      ownloom-planner-package = pkgs.ownloom-planner;

      ownloom-gateway-module-eval = import ./eval/gateway-module.nix {inherit inputs lib pkgs system;};
      ownloom-openssh-native-abuse-eval = import ./eval/openssh-native-abuse.nix {inherit inputs lib pkgs system;};
      ownloom-vps-security-eval = import ./eval/vps-security.nix {inherit inputs lib pkgs;};
      ownloom-host-configurations-eval = import ./eval/host-configurations.nix {inherit inputs lib pkgs;};

      # NixOS integration tests (pkgs.testers.runNixOSTest).
      nixos-planner-radicale = import ./nixos-tests/planner-radicale.nix {inherit lib pkgs;};
      nixos-ollama-smoke = import ./nixos-tests/ollama-smoke.nix {inherit lib pkgs;};
      nixos-planner-pi-e2e = import ./nixos-tests/planner-pi-e2e.nix {inherit lib pkgs;};
      nixos-gateway-loopback = import ./nixos-tests/gateway-loopback.nix {inherit lib pkgs;};
      nixos-ownloom-services-boot-smoke = import ./nixos-tests/services-boot-smoke.nix {inherit lib pkgs;};
    };
  };
}
