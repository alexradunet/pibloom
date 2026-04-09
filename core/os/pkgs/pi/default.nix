# core/os/pkgs/pi/default.nix
# Direct buildNpmPackage derivation for the Pi coding agent CLI.
# Uses the pre-built npm tarball (which includes compiled dist/) together
# with a vendored package-lock.json (the npm registry tarball omits it).
{ lib
, buildNpmPackage
, fetchurl
, makeWrapper
, runCommand
, bash
, fd
, ripgrep
}:

let
  version = "0.66.1";

  # Fetch the npm tarball and inject the vendored package-lock.json.
  srcWithLock = runCommand "pi-src-with-lock" { } ''
    mkdir -p $out
    tar -xzf ${fetchurl {
      url = "https://registry.npmjs.org/@mariozechner/pi-coding-agent/-/pi-coding-agent-${version}.tgz";
      hash = "sha256-NN26A3EQft5Bhyu53JmNECd1kgkNPPse6BsDnwGbzyE=";
    }} -C $out --strip-components=1
    cp ${./package-lock.json} $out/package-lock.json
  '';
in
buildNpmPackage {
  pname = "pi-coding-agent";
  inherit version;

  src = srcWithLock;

  npmDepsHash = "sha256-ogQ9LGHB3ODlKOmXzggkaN7W+Y3HHNUwYtlSVTq4F/I=";

  # The npm tarball already contains compiled dist/ — no build step needed.
  dontNpmBuild = true;

  nativeBuildInputs = [ makeWrapper ];

  postInstall = ''
    wrapProgram $out/bin/pi \
      --prefix PATH : ${lib.makeBinPath [ bash fd ripgrep ]} \
      --set PI_SKIP_VERSION_CHECK 1
  '';

  meta = {
    description = "Pi AI coding agent CLI";
    homepage = "https://github.com/badlogic/pi-mono";
    license = lib.licenses.mit;
    mainProgram = "pi";
  };
}
