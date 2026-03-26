# core/os/modules/app.nix
{ pkgs, lib, config, appPackage, piAgent, ... }:

let
  primaryUser = config.nixpi.primaryUser;
  primaryHome = "/home/${primaryUser}";
  stateDir = config.nixpi.stateDir;
  agentStateDir = "${primaryHome}/.pi";
in

{
  imports = [ ./options.nix ];

  environment.systemPackages = [ appPackage piAgent ];

  systemd.tmpfiles.rules = [
    "L+ /usr/local/share/nixpi - - - - ${appPackage}/share/nixpi"
    "d /etc/nixpi/appservices 0755 root root -"
    "d ${stateDir} 0770 ${primaryUser} ${primaryUser} -"
    "d ${stateDir}/services 0770 ${primaryUser} ${primaryUser} -"
  ];

  system.services.nixpi-chat = {
    imports = [ (lib.modules.importApply ../services/nixpi-chat.nix { inherit pkgs; }) ];
    nixpi-chat = {
      package = appPackage;
      inherit primaryUser agentStateDir;
    };
  };

  systemd.services.nixpi-app-setup = {
    description = "NixPI app setup: create agent state dir and seed default settings";
    wantedBy = [ "multi-user.target" ];
    after = [ "systemd-tmpfiles-setup.service" ];
    serviceConfig = {
      Type = "oneshot";
      RemainAfterExit = true;
      User = "root";
      ExecStart = "${pkgs.writeShellScript "nixpi-app-setup" ''
        primary_group="$(id -gn ${primaryUser})"
        default_pi_settings="${appPackage}/share/nixpi/.pi/settings.json"

        install -d -m 0700 -o ${primaryUser} -g "$primary_group" ${agentStateDir}

        if [ ! -e ${agentStateDir}/settings.json ] && [ -f "$default_pi_settings" ]; then
          install -m 0600 -o ${primaryUser} -g "$primary_group" "$default_pi_settings" ${agentStateDir}/settings.json
        fi

        chown -R ${primaryUser}:"$primary_group" ${agentStateDir}
        chmod 0700 ${agentStateDir}
      ''}";
    };
  };

}
