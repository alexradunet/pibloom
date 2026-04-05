# Root Files

> Root-level build and repository control surfaces

## Active files

Keep the root concise:

- `flake.nix` is the Nix entrypoint and should stay the single source of truth for packages, hosts, and checks.
- `justfile` is the human-friendly task surface for local development.
- `package.json`, `tsconfig.json`, `vitest.config.ts`, and `biome.json` own the TypeScript toolchain.
- `README.md` should stay focused on install, operating model, and documentation entrypoints.

## Cleanup rule

Do not let root files become secondary architecture documents. If a detail is only relevant to one subsystem, document it next to that subsystem instead of expanding root-level summaries.

### `package.json`

**Responsibility**: Node.js/TypeScript ecosystem entry. Defines dependencies, scripts, and critically, the Pi extension manifest.

**Key Sections**:

```json
{
  "pi": {
    "extensions": [
      "./core/pi/extensions/persona",
      "./core/pi/extensions/os",
      "./core/pi/extensions/episodes",
      "./core/pi/extensions/objects",
      "./core/pi/extensions/nixpi"
    ],
    "skills": ["./core/pi/skills"]
  }
}
```

**Key Scripts**:
- `test` - Run all tests
- `test:unit` - Unit tests only
- `test:integration` - Integration tests
- `test:e2e` - End-to-end tests
- `build` - TypeScript compilation
- `check` / `check:fix` - Biome linting

**Inbound Dependencies**:
- `npm install` - Package installation
- `nix build .#app` - Nix build reads this

**Outbound Dependencies**:
- Peer dependencies: `@mariozechner/pi-ai`, `@mariozechner/pi-coding-agent`
- Runtime: `@mariozechner/pi-web-ui`, `@sinclair/typebox`, `js-yaml`

---

### `justfile`

**Responsibility**: Development task runner. All common development operations defined as recipes.

**Key Recipes**:

| Recipe | Purpose |
|--------|---------|
| `build` | Build the TypeScript app derivation |
| `switch` | Apply local flake to running system |
| `update` | Apply remote GitHub flake to system |
| `iso` | Build the installer ISO |
| `vm-install-iso` | Boot the installer ISO in QEMU |
| `vm-ssh` | SSH into the running installer VM |
| `check-config` | Fast NixOS config validation |
| `check-boot` | Full VM boot test |

**Environment Variables**:
- `NIXPI_INSTALL_VM_DISK_PATH` - VM disk path override
- `NIXPI_INSTALL_VM_MEMORY_MB` - VM RAM override
- `NIXPI_INSTALL_VM_CPUS` - VM CPU override

**Inbound Dependencies**:
- Called by developers for all common tasks

**Outbound Dependencies**:
- `nix build`, `nixos-rebuild` commands
- `tools/run-installer-iso.sh` for VM-based install testing

---

### `tsconfig.json`

**Responsibility**: TypeScript compiler configuration.

**Key Settings**:
- `target`: ES2022
- `module`: NodeNext (ES modules)
- `strict`: true
- `outDir`: `dist/`
- `rootDir`: `.`
- `declaration`: true (generates .d.ts)
- `composite`: true (project references)

**Includes**: `core/**/*.ts`, `tests/**/*.ts`

---

### `vitest.config.ts`

**Responsibility**: Test runner configuration with coverage thresholds.

**Coverage Thresholds**:

| Area | Lines | Functions | Branches | Statements |
|------|-------|-----------|----------|------------|
| `core/lib/` | 72% | 77% | 57% | 69% |
| `core/pi/extensions/` | 60% | 60% | 50% | 60% |

**Key Settings**:
- `environment`: `node`
- `clearMocks`: true
- `restoreMocks`: true

---

### `biome.json`

**Responsibility**: Unified linting and formatting configuration.

**Key Rules**:
- `noUnusedVariables`: error
- `noUnusedImports`: error
- `noFloatingPromises`: error
- `noExcessiveCognitiveComplexity`: warn (max 15)
- `noExplicitAny`: warn

**Formatter Settings**:
- `indentStyle`: tab
- `lineWidth`: 120
- `quoteStyle`: double
- `semicolons`: always

---

### `guardrails.yaml`

**Responsibility**: Default safety rules for Pi tool execution. Blocks dangerous bash patterns.

**Blocked Patterns** (sample):
- `rm -rf /` - Root deletion
- `mkfs` - Filesystem formatting
- `dd to device` - Block device writes
- `eval` - Code injection
- `curl | bash` - Pipe to shell
- `git push --force` - Force push
- `chmod 777` - Overly permissive

**Override Path**: `~/nixpi/guardrails.yaml`

---

### `README.md`

**Responsibility**: Project landing page for GitHub visitors. Provides quick start and capability summary.

**Key Sections**:
- Why NixPI Exists
- What Ships Today
- Quick Start
- Repository Layout
- Capability Model
- Documentation Map

**Note**: Points to this documentation site for detailed information.

---

## Related

- [OS Modules](./os) - NixOS module documentation
- [Codebase Overview](./) - Return to codebase guide
