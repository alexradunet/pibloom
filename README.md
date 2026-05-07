# NixPI

NixPI is a personal NixOS monorepo for one VPS-centered host. It bundles the host configuration, reusable OS modules, local agent runtime packages (`pi`, `nixpi-planner`, `nixpi-gateway`, `nixpi-wiki`, …), and agent skills into a single flake.

The wiki/notes content is intentionally **not** part of this repository — it lives at `~/wiki` on the host and is never published.

## Layout

```text
.
├── flake.nix              # root flake: host, modules, packages, checks
├── os/                    # reusable NixOS modules and local packages
└── hosts/                 # host-specific NixOS configuration
    └── nixpi-vps/         # the single VPS host
```

## Build and apply

```sh
nix flake show
nix build .#nixosConfigurations.nixpi-vps.config.system.build.toplevel
```

On the host, validate then apply with standard Nix tooling:

```sh
nix flake check --accept-flake-config
sudo nixos-rebuild switch --flake .#nixpi-vps --accept-flake-config
```

Agents should follow `os/skills/nixpi-config/SKILL.md` for the full status → diff → validate → confirm → apply workflow.

For a manual remote deploy from a workstation, set the target host explicitly:

```sh
nixos-rebuild switch \
  --flake .#nixpi-vps \
  --target-host alex@<your-vps-ip> \
  --use-remote-sudo
```

## Publishing

The canonical remote is GitHub. Standard `git commit` / `git push` is the only publication path — there is no auto-sync daemon. Confirm changes locally, run `nix flake check --accept-flake-config`, then push.

## Secrets and host-local config

Stable host secrets live in encrypted `sops-nix` files under `hosts/nixpi-vps/secrets.yaml`. Host-local overlays live in `*.private.nix` files alongside the host config and are tracked in git **with placeholder values**:

- `hosts/nixpi-vps/networking.private.nix` — VPS WAN address + gateway (TEST-NET-3 placeholder)
- `hosts/nixpi-vps/secrets.private.nix` — code-server argon2 hash (placeholder)
- `hosts/nixpi-vps/nixpi-gateway.private.nix` — WhatsApp transport owner numbers (disabled by default)

After cloning, edit each file with real values, then mark them as locally-modified-only so git won't include the changes in commits or pulls:

```sh
git update-index --skip-worktree \
  hosts/nixpi-vps/networking.private.nix \
  hosts/nixpi-vps/secrets.private.nix \
  hosts/nixpi-vps/nixpi-gateway.private.nix
```

A first install can boot without `hosts/nixpi-vps/secrets.yaml`; SSH keys are enough. After first boot, copy `.sops.example.yaml` to `.sops.yaml`, create a real encrypted `secrets.yaml`, force-add it past the ignore rule, and rebuild.

## License

MIT — see [LICENSE](./LICENSE).
