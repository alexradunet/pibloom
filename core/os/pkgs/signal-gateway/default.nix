{ lib, buildNpmPackage, nodejs, makeWrapper }:

buildNpmPackage {
  pname = "nixpi-signal-gateway";
  version = "0.1.0";

  src = ../../../../Agents/signal-gateway;

  npmDepsHash = "sha256-zJJ8TM9yLQjVSNLrLxC4XPpUFzEnqOnv+XFsrNwwwM8=";

  nativeBuildInputs = [ makeWrapper ];

  buildPhase = ''
    runHook preBuild
    npm run build
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    mkdir -p $out/share/nixpi-signal-gateway $out/bin
    cp -r dist node_modules package.json $out/share/nixpi-signal-gateway/

    makeWrapper ${nodejs}/bin/node $out/bin/nixpi-signal-gateway \
      --add-flags "$out/share/nixpi-signal-gateway/dist/main.js"

    runHook postInstall
  '';

  meta = {
    description = "NixPI Signal gateway";
    license = lib.licenses.mit;
    mainProgram = "nixpi-signal-gateway";
  };
}
