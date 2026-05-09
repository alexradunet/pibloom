# ownloom

ownloom is a personal NixOS monorepo for one VPS-centered host. It bundles the host configuration, reusable OS modules, local agent runtime packages (`pi`, `ownloom-planner`, `ownloom-gateway`, `ownloom-wiki`, …), and agent skills into a single flake.

The wiki/notes content is intentionally **not** part of this repository — it lives at `~/wiki` on the host and is never published.

## Layout

```text
.
├── flake.nix              # root flake: host, modules, packages, checks
├── os/                    # reusable NixOS modules and local packages
└── hosts/                 # host-specific NixOS configuration
    └── ownloom-vps/         # the live VPS host
```

## Build and apply

```sh
nix flake show
nix build .#nixosConfigurations.ownloom-vps.config.system.build.toplevel
```

On the host, validate then apply with standard Nix tooling:

```sh
nix flake check --accept-flake-config
sudo nixos-rebuild switch --flake .#ownloom-vps --accept-flake-config
```

Agents should follow the ownloom config skill workflow for the full status → diff → validate → confirm → apply workflow. 

## Operator surface

Ownloom is the AI/operator cockpit over standards-based local tools, not a custom app suite. See [`docs/operator-surface.md`](./docs/operator-surface.md) for the planner/wiki/config boundary: Radicale remains the CalDAV source of truth, its built-in UI handles collection management, and Ownloom CLIs stay the machine interface.

## Design system

Ownloom UI must follow [`DESIGN.md`](./DESIGN.md): **Digital Scoarță / Pixel Loom Minimalism**. In short: Pico-first static interfaces, self-hosted assets, warm dark Romanian woven-carpet-inspired palette, Newsreader headings, Work Sans interface text, JetBrains Mono metadata/logs, 4px rhythm/radius, flat tonal layers, 1px structural borders, and subtle pixel-stitch motifs. Avoid generic SaaS gloss, cyberpunk neon, busy wallpaper, and remote runtime design assets.

For a manual remote deploy from a workstation, set the target host explicitly:

```sh
nixos-rebuild switch \
  --flake .#ownloom-vps \
  --target-host alex@<your-vps-ip> \
  --use-remote-sudo
```

## Publishing

The canonical remote is GitHub. Standard `git commit` / `git push` is the only publication path — there is no auto-sync daemon. Confirm changes locally, run `nix flake check --accept-flake-config`, then push.

## Secrets and host-local config

Stable host secrets live in encrypted `sops-nix` files under `hosts/ownloom-vps/secrets.yaml`. Host-local overlays live in `*.private.nix` files alongside the host config and are tracked in git **with placeholder values**:

- `hosts/ownloom-vps/networking.private.nix` — VPS WAN address + gateway (TEST-NET-3 placeholder)
- `hosts/ownloom-vps/secrets.private.nix` — code-server argon2 hash (placeholder)
- `hosts/ownloom-vps/ownloom-gateway.private.nix` — WhatsApp transport owner numbers (disabled by default)
- `hosts/ownloom-vps/minecraft.private.nix` — Minecraft whitelist entries (empty placeholder)

After cloning, edit each file with real values, then mark them as locally-modified-only so git won't include the changes in commits or pulls:

```sh
git update-index --skip-worktree \
  hosts/ownloom-vps/networking.private.nix \
  hosts/ownloom-vps/secrets.private.nix \
  hosts/ownloom-vps/ownloom-gateway.private.nix \
  hosts/ownloom-vps/minecraft.private.nix
```

A first install can boot without `hosts/ownloom-vps/secrets.yaml`; SSH keys are enough. After first boot, copy `.sops.example.yaml` to `.sops.yaml`, create a real encrypted `secrets.yaml`, force-add it past the ignore rule, and rebuild.

## License

MIT — see [LICENSE](./LICENSE).
