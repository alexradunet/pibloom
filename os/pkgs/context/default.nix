{
  lib,
  writeShellApplication,
  symlinkJoin,
  coreutils,
  findutils,
  gnugrep,
  jq,
  nixos-rebuild,
  ownloom-planner,
  ownloom-wiki,
  podman,
  procps,
}: let
  app = writeShellApplication {
    name = "ownloom-context";

    runtimeInputs = [
      coreutils
      findutils
      gnugrep
      jq
      nixos-rebuild
      ownloom-planner
      ownloom-wiki
      podman
      procps
    ];

    text = builtins.readFile ./ownloom-context.sh;

    meta = {
      description = "Print the current ownloom agent context for prompt injection";
      license = lib.licenses.mit;
      mainProgram = "ownloom-context";
    };
  };
in
  symlinkJoin {
    name = "ownloom-context";
    paths = [app];
    postBuild = ''
      ln -s ownloom-context $out/bin/nixpi-context
    '';
    inherit (app) meta;
  }
