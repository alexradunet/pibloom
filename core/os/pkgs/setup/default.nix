{ stdenvNoCC }:

stdenvNoCC.mkDerivation {
  pname = "nixpi-setup";
  version = "0.1.0";

  dontUnpack = true;

  installPhase = ''
    runHook preInstall

    mkdir -p "$out/bin"
    install -m 0755 ${../../../scripts/setup-lib.sh} "$out/bin/setup-lib.sh"
    install -m 0755 ${../../../scripts/setup-wizard.sh} "$out/bin/setup-wizard.sh"

    runHook postInstall
  '';
}
