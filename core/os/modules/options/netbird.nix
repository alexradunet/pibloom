{ lib, ... }:

{
  options.nixpi.netbird = {
    enable = lib.mkEnableOption "managed NetBird client bootstrap";

    setupKeyFile = lib.mkOption {
      type = lib.types.str;
      example = "/run/secrets/netbird-setup-key";
      description = ''
        Runtime path to a NetBird setup key file used for automated enrollment.
      '';
    };

    clientName = lib.mkOption {
      type = with lib.types; nullOr str;
      default = null;
      description = ''
        Optional NetBird client name to advertise during enrollment.
      '';
    };

    managementUrl = lib.mkOption {
      type = with lib.types; nullOr str;
      default = null;
      description = ''
        Optional override for non-default NetBird management URLs.
      '';
    };
  };
}
