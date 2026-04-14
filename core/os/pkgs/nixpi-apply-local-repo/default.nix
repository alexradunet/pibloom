{ stdenvNoCC }:

stdenvNoCC.mkDerivation {
  pname = "nixpi-apply-local-repo";
  version = "0.1.0";

  dontUnpack = true;

  installPhase = ''
    runHook preInstall
    mkdir -p "$out/bin"
    install -m 0755 ${../../../scripts/nixpi-apply-local-repo.sh} "$out/bin/nixpi-apply-local-repo"
    runHook postInstall
  '';
}
