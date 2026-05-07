{inputs, ...}: let
  ownloomOverlay = final: _prev: let
    wiki = final.callPackage ../../pkgs/wiki {};
    context = final.callPackage ../../pkgs/context {};
    gateway = final.callPackage ../../pkgs/gateway {};
    gatewayWeb = final.callPackage ../../pkgs/gateway-web {};
    planner = final.callPackage ../../pkgs/planner {};
  in {
    pi = final.callPackage ../../pkgs/pi {};

    ownloom-wiki = wiki;
    ownloom-context = context;
    ownloom-gateway = gateway;
    ownloom-gateway-web = gatewayWeb;
    ownloom-planner = planner;
  };
in {
  perSystem = {
    pkgs,
    system,
    ...
  }: {
    _module.args.pkgs = import inputs.nixpkgs {
      inherit system;
      overlays = [ownloomOverlay];
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
        for pkg in os/pkgs/gateway os/pkgs/wiki os/pkgs/planner; do
          if [ -f "$pkg/package.json" ] && [ ! -d "$pkg/node_modules" ]; then
            echo "ownloom: running npm install in $pkg..."
            (cd "$pkg" && npm install --silent)
          fi
        done
      '';
    };

    packages = {
      inherit (pkgs) pi;
      inherit (pkgs) ownloom-wiki ownloom-context ownloom-gateway ownloom-gateway-web ownloom-planner;
      default = pkgs.pi;
    };

    apps = let
      mkApp = package: {
        type = "app";
        program = "${package}/bin/${package.meta.mainProgram or package.name}";
        meta.description = package.meta.description or package.name;
      };

      piApp = mkApp pkgs.pi;
      ownloomWikiApp = mkApp pkgs.ownloom-wiki;
      ownloomContextApp = mkApp pkgs.ownloom-context;
      ownloomPlannerApp = mkApp pkgs.ownloom-planner;
    in {
      pi = piApp;
      ownloom-wiki = ownloomWikiApp;
      ownloom-context = ownloomContextApp;
      ownloom-planner = ownloomPlannerApp;
      default = piApp;
    };
  };

  flake.overlays.default = ownloomOverlay;
}
