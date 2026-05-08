{
  lib,
  buildNpmPackage,
  nodejs,
  makeWrapper,
  radicale,
}:
buildNpmPackage {
  pname = "ownloom-planner";
  version = "0.1.0";

  src = ./.;

  npmDepsHash = "sha256-GFBVZApRc6nqbz7+Mqx00Z21pB+0w2lfiyuakPHiQE0=";

  nativeBuildInputs = [makeWrapper radicale];

  buildPhase = ''
    runHook preBuild
    npm run build
    runHook postBuild
  '';

  doCheck = true;
  checkPhase = ''
    runHook preCheck
    npm run test
    runHook postCheck
  '';

  installPhase = ''
    runHook preInstall

    npm prune --omit=dev --ignore-scripts --no-audit --no-fund

    mkdir -p $out/share/ownloom-planner $out/bin
    cp -r dist node_modules package.json $out/share/ownloom-planner/

    makeWrapper ${nodejs}/bin/node $out/bin/ownloom-planner \
      --add-flags "$out/share/ownloom-planner/dist/cli.js"

    makeWrapper ${nodejs}/bin/node $out/bin/ownloom-planner-server \
      --add-flags "$out/share/ownloom-planner/dist/server.js"

    runHook postInstall
  '';

  meta = {
    description = "Tiny ownloom planner adapter for local CalDAV/iCalendar tasks, reminders, and events";
    license = lib.licenses.mit;
    mainProgram = "ownloom-planner";
  };
}
