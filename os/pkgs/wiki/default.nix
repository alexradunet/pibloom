{
  lib,
  buildNpmPackage,
  nodejs,
  makeWrapper,
}:
buildNpmPackage {
  pname = "nixpi-wiki";
  version = "0.3.0";

  src = lib.cleanSourceWith {
    src = ./.;
    filter = path: _type: let
      base = baseNameOf path;
      parent = baseNameOf (dirOf path);
      forbidden = [
        "node_modules"
        "dist"
        ".vite"
      ];
    in
      !(lib.elem base forbidden || lib.elem parent forbidden || lib.hasSuffix ".sqlite" base);
  };

  npmDepsHash = "sha256-LZo38OVcez1PHVYBSyhXcUHEsyx3Valzbax5d52Hv4k=";

  nativeBuildInputs = [makeWrapper];
  makeCacheWritable = true;

  buildPhase = ''
    runHook preBuild
    npm run build
    runHook postBuild
  '';

  doCheck = true;
  checkPhase = ''
    runHook preCheck
    npm test -- --run \
      tests/actions-meta.test.ts \
      tests/actions-meta-digest.test.ts \
      tests/actions-pages-v2.test.ts \
      tests/actions-lint-frontmatter-v2.test.ts
    runHook postCheck
  '';

  installPhase = ''
    runHook preInstall

    mkdir -p $out/share/nixpi-wiki $out/bin
    cp -r dist package.json README.md seed $out/share/nixpi-wiki/

    makeWrapper ${nodejs}/bin/node $out/bin/nixpi-wiki \
      --add-flags "$out/share/nixpi-wiki/dist/cli.cjs"

    runHook postInstall
  '';

  meta = {
    description = "Portable plain-Markdown LLM wiki CLI and core tools";
    license = lib.licenses.mit;
    mainProgram = "nixpi-wiki";
  };
}
