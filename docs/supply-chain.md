# Supply Chain Notes

> 📖 [Emoji Legend](LEGEND.md)

Garden now relies on Nix inputs and Nixpkgs packages for its built-in service surface instead of a separate packaged-service layer.

The important supply-chain boundary is therefore:

- `flake.nix` inputs
- the selected Nixpkgs revision
- Garden's own source tree

Built-in services such as Garden Home, FluffyChat, dufs, and code-server are provisioned from those sources rather than from a mutable runtime package catalog.
