# Root Files

> Package, build, and configuration files at the repository root

## 🌱 Why These Files Matter

The root files define how the project is built, tested, and deployed. They are the primary control surfaces that orchestrate the entire system.

## 📋 Root File Inventory

### Build and Package Control

| File | Why | What | How / Notes |
|------|-----|------|-------------|
| `package.json` | Node.js ecosystem entry | Dependencies, scripts, extension manifest | Defines Pi extensions in `pi.extensions` array |
| `package-lock.json` | Deterministic installs | Locked dependency versions | Auto-generated, commit to repo |
| `tsconfig.json` | TypeScript compilation | Compiler options, source paths | Outputs to `dist/` |

### Nix Control

| File | Why | What | How / Notes |
|------|-----|------|-------------|
| `flake.nix` | Nix ecosystem entry | Packages, NixOS configs, checks, dev shell | Defines `nixosModules.nixpi` aggregate |
| `flake.lock` | Deterministic Nix | Locked input versions | Auto-generated, commit to repo |

### Task Runner

| File | Why | What | How / Notes |
|------|-----|------|-------------|
| `justfile` | Development tasks | VM, build, test, deploy commands | Uses `just` (modern make alternative) |

### Quality Control

| File | Why | What | How / Notes |
|------|-----|------|-------------|
| `vitest.config.ts` | Test runner | Test discovery, coverage thresholds | Unit: 85% lines, 72% lib, 60% extensions |
| `biome.json` | Lint/format | Code style, import validation, complexity | Warns on complexity > 15 |
| `guardrails.yaml` | Tool safety | Default blocked patterns for bash tool | Overridable in `~/nixPI/guardrails.yaml` |

### Documentation

| File | Why | What | How / Notes |
|------|-----|------|-------------|
| `README.md` | Project landing | Quick start, capability summary | Points to docs site |

---

## 🔍 Important File Details

### `flake.nix`

**Responsibility**: Single entry point for the entire Nix ecosystem. Defines packages, NixOS configurations, checks, and the development shell.

**Key Exports**:
- `packages.${system}.pi` - Pi agent package
- `packages.${system}.app` - Main app package
- `nixosModules.nixpi` - Composable module exporting all nixPI features
- `nixosConfigurations.desktop` - Full desktop configuration
- `nixosConfigurations.desktop-attach` - Attach to existing NixOS
- `checks.${system}.*` - Build and VM tests

**Inbound Dependencies**:
- Referenced by `nixos-rebuild` commands
- Used by `just` commands for VM operations

**Outbound Dependencies**:
- `core/os/modules/options.nix` - Module imports
- `core/os/pkgs/pi/` - Pi agent derivation
- `core/os/pkgs/app/` - App derivation
- `tests/nixos/` - NixOS tests

**Key Implementation Notes**:
- Uses `specialArgs` to pass `piAgent` and `appPackage` to modules
- `pkgsUnfree` used only for test VMs to work around nixosTest limitations
- `allowUnfree` intentionally NOT set in module (must be set by consumer)

---

### `package.json`

**Responsibility**: Node.js/TypeScript ecosystem entry. Defines dependencies, scripts, and critically, the Pi extension manifest.

**Key Sections**:

```json
{
  "pi": {
    "extensions": [
      "./core/pi/extensions/persona",
      "./core/pi/extensions/localai",
      "./core/pi/extensions/os",
      "./core/pi/extensions/episodes",
      "./core/pi/extensions/objects",
      "./core/pi/extensions/nixpi",
      "./core/pi/extensions/setup"
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
- Runtime: `matrix-js-sdk`, `@sinclair/typebox`, `js-yaml`

---

### `justfile`

**Responsibility**: Development task runner. All common development operations defined as recipes.

**Key Recipes**:

| Recipe | Purpose |
|--------|---------|
| `build` | Build the TypeScript app derivation |
| `switch` | Apply local flake to running system |
| `update` | Apply remote GitHub flake to system |
| `vm` / `vm-gui` | Build and run test VM |
| `vm-ssh` | SSH into running VM |
| `check-config` | Fast NixOS config validation |
| `check-boot` | Full VM boot test |

**Environment Variables**:
- `NIXPI_PRIMARY_USER` - Target user for rebuilds
- `NIXPI_VM_MEMORY_MB` - VM RAM override
- `NIXPI_VM_CPUS` - VM CPU override

**Inbound Dependencies**:
- Called by developers for all common tasks

**Outbound Dependencies**:
- `nix build`, `nixos-rebuild` commands
- `tools/run-qemu.sh` for VM execution

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
| `core/daemon/` | 85% | 80% | 75% | 85% |
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

**Override Path**: `~/nixPI/guardrails.yaml`

---

### `README.md`

**Responsibility**: Project landing page for GitHub visitors. Provides quick start and capability summary.

**Key Sections**:
- Why nixPI Exists
- What Ships Today
- Quick Start
- Repository Layout
- Capability Model
- Documentation Map

**Note**: Points to this documentation site for detailed information.

---

## 🔗 Related

- [OS Modules](./os) - NixOS module documentation
- [Codebase Overview](./) - Return to codebase guide
