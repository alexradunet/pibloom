# Supply Chain

> Image trust and dependency policy

## 🌱 Supply Chain Notes

nixPI relies on Nix inputs and Nixpkgs packages for its built-in service surface.

The important supply-chain boundary is:

- `flake.nix` inputs
- The selected Nixpkgs revision
- nixPI's own source tree

Built-in services such as nixPI Home and FluffyChat are provisioned from those sources rather than from a mutable runtime package catalog.

## 📚 Dependency Sources

| Source | Purpose |
|--------|---------|
| `nixpkgs` | System packages, services |
| `nixPI source` | Modules, extensions, daemon |
| `npm registry` | Node.js dependencies (locked) |

## 🔒 Trust Model

1. Nixpkgs revision is pinned in `flake.lock`
2. npm dependencies are pinned in `package-lock.json`
3. Both lockfiles should be committed to version control
4. Review changes to lockfiles as part of normal PR review

## 🔗 Related

- [Security Model](./security-model)
