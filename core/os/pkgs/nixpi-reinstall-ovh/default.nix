{ pkgs, lib, makeWrapper, nixosAnywherePackage }:

pkgs.stdenvNoCC.mkDerivation {
  pname = "nixpi-reinstall-ovh";
  version = "0.1.0";

  dontUnpack = true;
  nativeBuildInputs = [ makeWrapper ];

  installPhase = ''
    runHook preInstall

    mkdir -p "$out/bin" "$out/share/nixpi-reinstall-ovh"
    install -m 0755 ${../../../scripts/nixpi-reinstall-ovh.sh} "$out/share/nixpi-reinstall-ovh/nixpi-reinstall-ovh.sh"

    makeWrapper ${pkgs.bash}/bin/bash "$out/bin/nixpi-reinstall-ovh" \
      --set NIXPI_REPO_ROOT ${../../../..} \
      --set NIXPI_NIXOS_ANYWHERE ${nixosAnywherePackage}/bin/nixos-anywhere \
      --prefix PATH : "${lib.makeBinPath [ pkgs.coreutils pkgs.nix pkgs.python3 ]}" \
      --add-flags "$out/share/nixpi-reinstall-ovh/nixpi-reinstall-ovh.sh"

    runHook postInstall
  '';

  meta.mainProgram = "nixpi-reinstall-ovh";
}
