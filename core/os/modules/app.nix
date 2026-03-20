# core/os/modules/app.nix
{ pkgs, lib, config, appPackage, piAgent, ... }:

let
  resolved = import ../lib/resolve-primary-user.nix { inherit lib config; };
  primaryUser = resolved.resolvedPrimaryUser;
  primaryHome = resolved.resolvedPrimaryHome;
  serviceUser = config.nixpi.serviceUser;
  stateDir = config.nixpi.stateDir;
  serviceHome = "${stateDir}/home";
  agentStateDir = "${stateDir}/agent";
in

{
  imports = [ ./options.nix ];

  environment.systemPackages = [ appPackage piAgent ];

  users.groups.${serviceUser} = {};
  users.users.${serviceUser} = {
    isSystemUser = true;
    group = serviceUser;
    home = serviceHome;
    createHome = true;
    shell = "${pkgs.shadow}/bin/nologin";
  };

  systemd.tmpfiles.rules = [
    "L+ /usr/local/share/nixpi - - - - ${appPackage}/share/nixpi"
    "d /etc/nixpi/appservices 0755 root root -"
    "d ${stateDir} 0770 ${serviceUser} ${serviceUser} -"
    "d ${serviceHome} 0770 ${serviceUser} ${serviceUser} -"
    "d ${agentStateDir} 0770 ${serviceUser} ${serviceUser} -"
    "d ${stateDir}/pi-daemon 0770 ${serviceUser} ${serviceUser} -"
    "d ${stateDir}/services 0770 ${serviceUser} ${serviceUser} -"
    "d ${stateDir}/services/home 0770 ${serviceUser} ${serviceUser} -"
    "d ${stateDir}/services/chat 0770 ${serviceUser} ${serviceUser} -"
    "d ${stateDir}/services/code 0770 ${serviceUser} ${serviceUser} -"
    "d ${stateDir}/services/files 0770 ${serviceUser} ${serviceUser} -"
  ];

  system.activationScripts.nixpi-app = lib.stringAfter [ "users" ] ''
    primary_group="$(id -gn ${primaryUser})"

    install -d -m 0755 -o ${primaryUser} -g "$primary_group" ${primaryHome}
    install -d -m 2775 -o ${primaryUser} -g ${serviceUser} ${primaryHome}/nixPI
    install -d -m 2775 -o ${primaryUser} -g ${serviceUser} ${primaryHome}/Public
    install -d -m 2775 -o ${primaryUser} -g ${serviceUser} ${primaryHome}/Public/nixPI
    install -d -m 0755 -o ${serviceUser} -g ${serviceUser} ${serviceHome}
    install -d -m 0770 -o ${serviceUser} -g ${serviceUser} ${agentStateDir}
    install -d -m 0770 -o ${serviceUser} -g ${serviceUser} ${stateDir}/pi-daemon
    install -d -m 0770 -o ${serviceUser} -g ${serviceUser} ${stateDir}/services/home
    install -d -m 0770 -o ${serviceUser} -g ${serviceUser} ${stateDir}/services/chat
    install -d -m 0770 -o ${serviceUser} -g ${serviceUser} ${stateDir}/services/code
    install -d -m 0770 -o ${serviceUser} -g ${serviceUser} ${stateDir}/services/files

    if [ -d ${primaryHome}/.pi ] && [ ! -L ${primaryHome}/.pi ] && [ ! -e ${agentStateDir}/.migration-complete ]; then
      cp -a ${primaryHome}/.pi/. ${agentStateDir}/
      touch ${agentStateDir}/.migration-complete
    fi

    ln -sfn ${agentStateDir} ${primaryHome}/.pi
    chown -h ${primaryUser}:"$primary_group" ${primaryHome}/.pi

    ln -sfn ${agentStateDir} ${serviceHome}/.pi
    chown -h ${serviceUser}:${serviceUser} ${serviceHome}/.pi
  '';

  system.services.pi-daemon = {
    imports = [ (lib.modules.importApply ../services/pi-daemon.nix { inherit pkgs; }) ];
    nixpi-pi-daemon = {
      package = appPackage;
      inherit primaryHome primaryUser serviceHome stateDir agentStateDir serviceUser;
      path = [ piAgent pkgs.nodejs ];
    };
  };
}
