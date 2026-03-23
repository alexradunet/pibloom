{ pkgs, lib, config, ... }:

let
  primaryUser = config.nixpi.primaryUser;
  primaryHome = "/home/${primaryUser}";
  systemReadyFile = "${primaryHome}/.nixpi/wizard-state/system-ready";

  openHome = pkgs.writeShellScriptBin "nixpi-open-home" ''
    set -euo pipefail
    exec ${pkgs.chromium}/bin/chromium --app=http://127.0.0.1
  '';

  openElementWeb = pkgs.writeShellScriptBin "nixpi-open-element-web" ''
    set -euo pipefail
    exec ${pkgs.chromium}/bin/chromium --app=http://127.0.0.1:${toString config.nixpi.services.elementWeb.port}
  '';

  restartDesktop = pkgs.writeShellScriptBin "nixpi-restart-desktop-shell" ''
    set -euo pipefail
    ${pkgs.dunst}/bin/dunst >/tmp/nixpi-dunst.log 2>&1 &
    pkill -u "$USER" -x xfce4-panel || true
    pkill -u "$USER" -x xfdesktop || true
    pkill -u "$USER" -x Thunar || true
    ${pkgs.xfce4-panel}/bin/xfce4-panel >/tmp/nixpi-xfce4-panel.log 2>&1 &
    ${pkgs.xfdesktop}/bin/xfdesktop >/tmp/nixpi-xfdesktop.log 2>&1 &
    ${pkgs.xfwm4}/bin/xfwm4 --replace >/tmp/nixpi-xfwm4.log 2>&1 &
  '';

  homeDesktopItem = pkgs.makeDesktopItem {
    name = "nixpi-home";
    desktopName = "NixPI Home";
    genericName = "NixPI Home";
    exec = "${openHome}/bin/nixpi-open-home";
    terminal = false;
    categories = [ "Network" ];
  };

  elementWebDesktopItem = pkgs.makeDesktopItem {
    name = "nixpi-element-web";
    desktopName = "NixPI Element Web";
    genericName = "Element Web";
    exec = "${openElementWeb}/bin/nixpi-open-element-web";
    terminal = false;
    categories = [ "Network" "Chat" ];
  };

  restartDesktopItem = pkgs.makeDesktopItem {
    name = "nixpi-restart-desktop-shell";
    desktopName = "Restart Desktop Shell";
    exec = "${restartDesktop}/bin/nixpi-restart-desktop-shell";
    terminal = false;
    categories = [ "System" ];
  };

  desktopTerminal = pkgs.writeShellScriptBin "nixpi-open-desktop-terminal" ''
    set -euo pipefail

    if pgrep -u "${primaryUser}" -f "xterm.*NixPI (Terminal|Setup)" >/dev/null 2>&1; then
      exit 0
    fi

    title="NixPI Terminal"
    if [ ! -f "${systemReadyFile}" ]; then
      title="NixPI Setup"
    fi

    exec ${pkgs.xterm}/bin/xterm \
      -title "$title" \
      -fa "Monospace" \
      -fs 12 \
      -fg "#e6edf3" \
      -bg "#10161d" \
      -geometry 132x36 \
      -e ${pkgs.bash}/bin/bash -lc '
        [ -f "${primaryHome}/.bashrc" ] && . "${primaryHome}/.bashrc"

        if [ ! -f "${systemReadyFile}" ]; then
          if ! setup-wizard.sh; then
            echo ""
            echo "Setup paused because the last step failed."
            echo "Review the error above, fix the issue, then rerun: setup-wizard.sh"
            exec ${pkgs.bash}/bin/bash --login
          fi
        fi

        if [ -z "''${PI_SESSION:-}" ] && command -v pi >/dev/null 2>&1 && mkdir /tmp/.nixpi-pi-session 2>/dev/null; then
          trap "rmdir /tmp/.nixpi-pi-session 2>/dev/null" EXIT
          export PI_SESSION=1
          _nixpi_pkg="/usr/local/share/nixpi"
          _pi_settings="${primaryHome}/.pi/settings.json"
          if [ -d "$_nixpi_pkg" ]; then
            mkdir -p "$(dirname "$_pi_settings")"
            if [ -f "$_pi_settings" ] && command -v jq >/dev/null 2>&1; then
              if ! jq -e ".packages // [] | index(\"$_nixpi_pkg\")" "$_pi_settings" >/dev/null 2>&1; then
                jq ".packages = ((.packages // []) + [\"$_nixpi_pkg\"] | unique)" "$_pi_settings" > "''${_pi_settings}.tmp" && \
                  mv "''${_pi_settings}.tmp" "$_pi_settings"
              fi
            elif [ ! -f "$_pi_settings" ]; then
              cp "$_nixpi_pkg/.pi/settings.json" "$_pi_settings"
            fi
          fi
          unset _nixpi_pkg _pi_settings
          if ! pi; then
            echo ""
            echo "Pi exited unexpectedly."
            echo "Run 'pi' again after checking the error above."
          fi
        fi

        exec ${pkgs.bash}/bin/bash --login
      '
  '';

  xfceSessionInit = pkgs.writeShellScript "nixpi-xfce-session-init" ''
    set -eu
    ${pkgs.setxkbmap}/bin/setxkbmap \
      ${lib.escapeShellArg config.services.xserver.xkb.layout} \
      ${lib.optionalString (config.services.xserver.xkb.variant != "") "-variant ${lib.escapeShellArg config.services.xserver.xkb.variant}"}
    ${pkgs.xsetroot}/bin/xsetroot -solid "#10161d"
    if ! pgrep -u "${primaryUser}" -x dunst >/dev/null 2>&1; then
      ${pkgs.dunst}/bin/dunst >/tmp/nixpi-dunst.log 2>&1 &
    fi
  '';

  desktopAutostartEntry = pkgs.writeText "nixpi-terminal-autostart.desktop" ''
    [Desktop Entry]
    Type=Application
    Version=1.0
    Name=NixPI Terminal
    Comment=Launch the NixPI setup and Pi session terminal
    Exec=${desktopTerminal}/bin/nixpi-open-desktop-terminal
    OnlyShowIn=XFCE;
    X-GNOME-Autostart-enabled=true
    StartupNotify=false
  '';

  xprofile = pkgs.writeText "nixpi-xprofile" ''
    if [ -x ${xfceSessionInit} ]; then
      ${xfceSessionInit}
    fi
  '';
in
{
  imports = [ ./options.nix ];

  assertions = [
    {
      assertion = primaryUser != "";
      message = "nixpi.primaryUser must resolve before enabling the XFCE desktop session.";
    }
  ];

  environment.systemPackages = with pkgs; [
    chromium
    dunst
    imagemagick
    tesseract
    wmctrl
    thunar
    xclip
    xdotool
    xprop
    xsetroot
    xterm
    scrot
    openHome
    openElementWeb
    restartDesktop
    desktopTerminal
    homeDesktopItem
    elementWebDesktopItem
    restartDesktopItem
  ];

  services.xserver.enable = true;
  services.xserver.desktopManager.xfce.enable = true;
  services.xserver.displayManager.lightdm.enable = true;
  services.displayManager.defaultSession = lib.mkDefault "xfce";
  services.displayManager.autoLogin.enable = true;
  services.displayManager.autoLogin.user = primaryUser;
  services.xserver.displayManager.lightdm.greeters.gtk.enable = true;
  systemd.defaultUnit = lib.mkDefault "graphical.target";

  environment.etc = {
    "skel/.config/autostart/nixpi-terminal.desktop".source = desktopAutostartEntry;
    "skel/.xprofile".source = xprofile;
  };

  system.activationScripts.nixpi-xfce-desktop = lib.stringAfter [ "users" ] ''
    primary_group="$(id -gn ${primaryUser})"

    install -d -m 0755 -o ${primaryUser} -g "$primary_group" ${primaryHome}/.config
    install -d -m 0755 -o ${primaryUser} -g "$primary_group" ${primaryHome}/.config/autostart

    if [ ! -e ${primaryHome}/.config/autostart/nixpi-terminal.desktop ]; then
      install -m 0644 -o ${primaryUser} -g "$primary_group" /etc/skel/.config/autostart/nixpi-terminal.desktop ${primaryHome}/.config/autostart/nixpi-terminal.desktop
    fi

    if [ ! -e ${primaryHome}/.xprofile ]; then
      install -m 0644 -o ${primaryUser} -g "$primary_group" /etc/skel/.xprofile ${primaryHome}/.xprofile
    fi
  '';
}
