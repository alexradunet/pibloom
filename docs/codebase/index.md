# nixPI Codebase Guide

> Canonical codebase reading guide for maintainers

## 🌱 Why This Guide Exists

This guide documents every tracked file in the nixPI repository. For each file, you'll find:

- **Why** it exists
- **What** it owns
- **How** it works and interacts with adjacent files

## 🚀 Top-Level Directory Map

```
nixPI/
├── README.md              # Project entry point
├── package.json           # Node.js dependencies and extension manifest
├── flake.nix              # Nix entry point and module aggregator
├── justfile               # Development task runner
├── tsconfig.json          # TypeScript configuration
├── vitest.config.ts       # Test configuration
├── biome.json             # Linting and formatting rules
├── guardrails.yaml        # Default tool guardrails
├── core/                  # All implementation code
├── tests/                 # Test suites
├── docs/                  # This documentation
└── tools/                 # VM and testing helpers
```

## 📚 Subsystem Documentation

Each major subsystem has its own detailed page:

| Subsystem | Page | Description |
|-----------|------|-------------|
| Root Files | [Root Files](./root-files) | Package, build, and config files |
| Core Library | [Core Library](./core-lib) | Shared runtime helpers |
| Daemon | [Daemon](./daemon) | Matrix room runtime |
| Pi Extensions | [Pi Extensions](./pi-extensions) | Pi-facing tools and commands |
| Persona & Skills | [Persona & Skills](./pi-persona-skills) | Behavior configuration |
| OS Modules | [OS Modules](./os) | NixOS integration |
| Scripts & Tools | [Scripts & Tools](./scripts) | Setup and VM helpers |
| Tests | [Tests](./tests) | Test suites and coverage |

## 🧭 Recommended Read Order

### For Understanding the System

1. [Root Files](./root-files) - Understand the control surfaces
2. [OS Modules](./os) - Understand system provisioning
3. [Daemon](./daemon) - Understand the always-on runtime
4. [Pi Extensions](./pi-extensions) - Understand the tool surface

### For Making Changes

1. Identify the subsystem your change affects
2. Read that subsystem's documentation
3. Understand related test files
4. Make changes with tests

## 🔍 File Types in This Repository

| Type | Extension | Examples |
|------|-----------|----------|
| Source | `.ts` | `core/**/*.ts` |
| Nix Module | `.nix` | `core/os/**/*.nix` |
| Config | `.json`, `.yaml` | `package.json`, `guardrails.yaml` |
| Test | `.test.ts` | `tests/**/*.test.ts` |
| Script | `.sh` | `tools/*.sh` |
| Lockfile | `.lock` | `flake.lock`, `package-lock.json` |

## 📋 File Inventory Format

Each subsystem page uses a consistent format:

### File Responsibility Tables

| File | Why | What | How / Notes |
|------|-----|------|-------------|
| `path/to/file.ts` | Solves X problem | Owns Y functionality | Entry point, key exports |

### Important File Subsections

High-value files get expanded subsections with:

- **Responsibility**: What this file is for
- **Key Exports**: Functions, types, classes
- **Inbound Dependencies**: What uses this file
- **Outbound Dependencies**: What this file uses
- **Lifecycle**: When and how it's instantiated

## 🔗 Related

- [Architecture Overview](../architecture/) - High-level subsystem boundaries
- [Runtime Flows](../architecture/runtime-flows) - End-to-end flows
