{
  lib,
  stdenvNoCC,
}:
stdenvNoCC.mkDerivation {
  pname = "ownloom-gateway-web";
  version = "0.1.0";

  src = lib.cleanSource ./.;

  installPhase = ''
    runHook preInstall
    mkdir -p $out/share/ownloom-gateway-web
    cp -r public README.md $out/share/ownloom-gateway-web/
    runHook postInstall
  '';

  meta = {
    description = "Static protocol/v1 web client skeleton for Ownloom Gateway";
    license = lib.licenses.mit;
  };
}
