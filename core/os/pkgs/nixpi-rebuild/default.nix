{ stdenvNoCC }:

stdenvNoCC.mkDerivation {
  pname = "nixpi-rebuild";
  version = "0.1.0";

  dontUnpack = true;

  installPhase = ''
    runHook preInstall
    mkdir -p "$out/bin"
    install -m 0755 ${../../../scripts/nixpi-rebuild.sh} "$out/bin/nixpi-rebuild"
    runHook postInstall
  '';
}
