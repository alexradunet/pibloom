{ pkgs, lib, makeWrapper, nixosAnywherePackage }:

pkgs.stdenvNoCC.mkDerivation {
  pname = "nixpi-deploy-ovh";
  version = "0.1.0";

  dontUnpack = true;
  nativeBuildInputs = [ makeWrapper ];

  installPhase = ''
    runHook preInstall

    mkdir -p "$out/bin" "$out/share/nixpi-deploy-ovh"
    install -m 0755 ${../../../scripts/nixpi-deploy-ovh.sh} "$out/share/nixpi-deploy-ovh/nixpi-deploy-ovh.sh"

    makeWrapper ${pkgs.bash}/bin/bash "$out/bin/nixpi-deploy-ovh" \
      --set NIXPI_REPO_ROOT ${../../../..} \
      --set NIXPI_NIXOS_ANYWHERE ${nixosAnywherePackage}/bin/nixos-anywhere \
      --prefix PATH : "${lib.makeBinPath [ pkgs.coreutils pkgs.nix ]}" \
      --add-flags "$out/share/nixpi-deploy-ovh/nixpi-deploy-ovh.sh"

    runHook postInstall
  '';

  meta.mainProgram = "nixpi-deploy-ovh";
}
