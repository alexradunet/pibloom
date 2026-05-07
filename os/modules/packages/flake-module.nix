{inputs, ...}: let
  nixpiOverlay = final: _prev: {
    pi = final.callPackage ../../pkgs/pi {};
    nixpi-wiki = final.callPackage ../../pkgs/nixpi-wiki {};
    nixpi-audit = final.callPackage ../../pkgs/nixpi-audit {};
    nixpi-context = final.callPackage ../../pkgs/nixpi-context {};
    nixpi-status = final.callPackage ../../pkgs/nixpi-status {};
    nixpi-health = final.callPackage ../../pkgs/nixpi-health {};

    nixpi-gateway = final.callPackage ../../pkgs/nixpi-gateway {};
    nixpi-planner = final.callPackage ../../pkgs/nixpi-planner {};
  };
in {
  perSystem = {
    pkgs,
    system,
    ...
  }: {
    _module.args.pkgs = import inputs.nixpkgs {
      inherit system;
      overlays = [nixpiOverlay];
    };

    formatter = pkgs.writeShellApplication {
      name = "nixfmt";
      runtimeInputs = [pkgs.alejandra];
      text = ''
        if [ "$#" -eq 0 ]; then
          find . -type f -name '*.nix' -writable -print0 | xargs -0 alejandra
          exit 0
        fi

        exec alejandra "$@"
      '';
    };

    devShells.default = pkgs.mkShellNoCC {
      packages = with pkgs; [
        alejandra
        deadnix
        nodejs
        statix
      ];

      shellHook = ''
        # Auto-install node_modules for any TS package that hasn't been set up yet.
        for pkg in os/pkgs/nixpi-gateway os/pkgs/nixpi-wiki os/pkgs/nixpi-planner; do
          if [ -f "$pkg/package.json" ] && [ ! -d "$pkg/node_modules" ]; then
            echo "nixpi: running npm install in $pkg..."
            (cd "$pkg" && npm install --silent)
          fi
        done
      '';
    };

    packages = {
      inherit (pkgs) pi;
      inherit (pkgs) nixpi-wiki nixpi-context nixpi-status nixpi-health nixpi-gateway nixpi-planner;
      default = pkgs.pi;
    };

    apps = let
      mkApp = package: {
        type = "app";
        program = "${package}/bin/${package.meta.mainProgram or package.name}";
        meta.description = package.meta.description or package.name;
      };

      piApp = mkApp pkgs.pi;
      nixpiWikiApp = mkApp pkgs.nixpi-wiki;
      nixpiContextApp = mkApp pkgs.nixpi-context;
      nixpiStatusApp = mkApp pkgs.nixpi-status;
      nixpiHealthApp = mkApp pkgs.nixpi-health;

      nixpiPlannerApp = mkApp pkgs.nixpi-planner;
    in {
      pi = piApp;
      nixpi-wiki = nixpiWikiApp;
      nixpi-context = nixpiContextApp;
      nixpi-status = nixpiStatusApp;
      nixpi-health = nixpiHealthApp;

      nixpi-planner = nixpiPlannerApp;
      default = piApp;
    };
  };

  flake.overlays.default = nixpiOverlay;
}
