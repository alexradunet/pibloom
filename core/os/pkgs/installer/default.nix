{ pkgs, makeWrapper, nixpiSource, piAgent, appPackage, setupApplyPackage, self }:

let
  layoutsDir = ../../installer/layouts;
  desktopSystem = self.nixosConfigurations.desktop.config.system.build.toplevel;
in

pkgs.stdenvNoCC.mkDerivation {
  pname = "nixpi-installer";
  version = "0.3.0";

  dontUnpack = true;
  nativeBuildInputs = [ makeWrapper ];

  installPhase = ''
    runHook preInstall

    mkdir -p "$out/bin" "$out/share/nixpi-installer/layouts" "$out/share/nixpi-installer/nixpi-config/core"

    install -m 0755 ${./nixpi-installer.sh} "$out/share/nixpi-installer/nixpi-installer.sh"
    install -m 0644 ${layoutsDir}/default.nix "$out/share/nixpi-installer/layouts/default.nix"
    cp -R ${nixpiSource}/core/os "$out/share/nixpi-installer/nixpi-config/core/"
    cp -R ${nixpiSource}/core/scripts "$out/share/nixpi-installer/nixpi-config/core/"

    substituteInPlace "$out/share/nixpi-installer/nixpi-installer.sh" \
      --replace-fail "@desktopSystem@" "${desktopSystem}" \
      --replace-fail "@configSourceDir@" "$out/share/nixpi-installer/nixpi-config" \
      --replace-fail "@piAgentPath@" "${piAgent}" \
      --replace-fail "@appPackagePath@" "${appPackage}" \
      --replace-fail "@setupApplyPackagePath@" "${setupApplyPackage}" \
      --replace-fail "@layoutTemplate@" "$out/share/nixpi-installer/layouts/default.nix"

    makeWrapper ${pkgs.bash}/bin/bash "$out/bin/nixpi-installer" \
      --prefix PATH : "${pkgs.lib.makeBinPath [ pkgs.openssl ]}" \
      --add-flags "$out/share/nixpi-installer/nixpi-installer.sh"

    runHook postInstall
  '';
}
