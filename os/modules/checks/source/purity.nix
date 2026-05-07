{
  runCommand,
  ripgrep,
}:
runCommand "ownloom-purity-check" {
  nativeBuildInputs = [ripgrep];
} ''
  set -euo pipefail
  cd ${../../../..}

  # Ban --impure in all source files (not .example docs, not tests, not markdown)
  ! rg -l \
      --glob '!**/*.example' \
      --glob '!**/tests/**' \
      --glob '!**/*.test.ts' \
      --glob '!**/*.md' \
      -e '--impure' \
      os/ hosts/ 2>/dev/null

  # Ban impure builtins in Nix source
  ! rg -l --glob '*.nix' \
      -e 'builtins\.(currentSystem|currentTime|getEnv)' \
      os/ hosts/ 2>/dev/null

  # Ban channel-style imports in Nix source
  ! rg -l --glob '*.nix' \
      -e 'import <' \
      os/ hosts/ 2>/dev/null

  touch $out
''
