{ lib, ... }:

{
  options.nixpi.bootstrap = {
    keepSshAfterSetup = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = ''
        Whether SSH should remain reachable after first-boot setup
        completes. By default SSH is treated as a bootstrap-only path.
      '';
    };
  };
}
