# NixPI

> VPS-first, headless AI companion OS on NixOS

NixPI packages Pi, host integration, durable files, and a remote operator surface into one self-hosted NixOS system.

The primary product story is now:

- deploy to a NixOS-capable VPS
- operate it headlessly
- use one remote web app for chat plus a browser terminal
- keep `/srv/nixpi` as the canonical installed checkout
- run Pi in SDK mode inside the app runtime

## 🌱 Why NixPI Exists

NixPI exists to give Pi a durable, inspectable home on a machine you control:

- a canonical system repo at `/srv/nixpi`
- a remote web control plane for chat and terminal access
- first-class host tools for NixOS workflows
- a minimal operating model based on files, NixOS, and systemd
- a small default runtime surface that can evolve through Pi

## 🚀 What Ships Today

Current platform capabilities:

- canonical headless `nixpi` NixOS host profile for installed systems
- one-command VPS bootstrap via `nixpi-bootstrap-vps`
- a remote web app with chat plus a browser terminal
- Pi SDK mode inside the application process
- host OS management through NixOS rebuild, rollback, systemd, and health tooling
- NetBird-based remote access and security perimeter
- headless NixOS VM coverage for bootstrap and service readiness

## 🚀 Quick Start

Deploy NixPI to a fresh NixOS VPS:

```bash
nix --extra-experimental-features 'nix-command flakes' run github:alexradunet/nixpi#nixpi-bootstrap-vps
```

The `--extra-experimental-features` flag is required on a stock NixOS host where flakes are not yet enabled. The bootstrap script enables them permanently in `/etc/nix/nix.conf` before switching the system configuration.

That bootstrap command prepares the canonical checkout at `/srv/nixpi` and switches the system to the NixPI host profile.

After bootstrap, open the remote web app and use the built-in chat plus browser terminal. For later changes, work from `/srv/nixpi` and rebuild with:

```bash
cd /srv/nixpi
git fetch origin
git rebase origin/main
sudo nixos-rebuild switch --flake /srv/nixpi#nixpi
```

To roll back:

```bash
sudo nixos-rebuild switch --rollback
```

See the [documentation site](https://alexradunet.github.io/NixPI) for detailed instructions.

## 🧭 Documentation

Full documentation is available at **[alexradunet.github.io/NixPI](https://alexradunet.github.io/NixPI)**

Or browse by topic:

| Your Goal | Start Here |
|-----------|------------|
| Deploy NixPI to a VPS | [Quick Deploy](https://alexradunet.github.io/NixPI/operations/quick-deploy) |
| Validate first boot | [First Boot Setup](https://alexradunet.github.io/NixPI/operations/first-boot-setup) |
| Install from the public path | [Install NixPI](https://alexradunet.github.io/NixPI/install) |
| Understanding the system | [Architecture Overview](https://alexradunet.github.io/NixPI/architecture/) |
| Reading the code | [Codebase Guide](https://alexradunet.github.io/NixPI/codebase/) |
| Operating a running system | [Operations](https://alexradunet.github.io/NixPI/operations/) |
| Deep technical reference | [Reference](https://alexradunet.github.io/NixPI/reference/) |

To run the docs locally:

```bash
npm run docs:dev
```

## 💻 Default Service Surface

Installed by default:

- `nixpi-chat.service`
- `nixpi-ttyd.service`
- `nginx.service`
- `netbird.service`

## 🌿 Repository Layout

| Path | Purpose |
|------|---------|
| `core/` | NixPI core: NixOS modules, app runtime, persona, skills, built-in extensions, and shared code |
| `core/os/` | NixOS modules, host configurations, and bootstrap packages |
| `core/chat-server/` | Remote app runtime and frontend shell |
| `core/pi/extensions/` | Pi-facing NixPI extensions shipped in the default runtime |
| `tests/` | unit, integration, chat-server, and NixOS VM tests |
| `docs/` | live project documentation (VitePress site) |

## 🧩 Capability Model

NixPI extends Pi through two active runtime layers:

| Layer | What it is | Typical use |
|------|-------------|-------------|
| 📜 Skill | markdown instructions in `SKILL.md` | procedures, guidance, checklists |
| 🧩 Extension | in-process TypeScript | Pi-facing tools, hooks, commands |

Built-in service surface is part of the base NixOS system:

- main remote app on `/`
- browser terminal on `/terminal/`

## 📚 Documentation Structure

| Section | Contains |
|---------|----------|
| [Overview](https://alexradunet.github.io/NixPI/) | Project summary and entry points |
| [Getting Started](https://alexradunet.github.io/NixPI/getting-started/) | New maintainer orientation |
| [Architecture](https://alexradunet.github.io/NixPI/architecture/) | Subsystem boundaries and runtime flows |
| [Codebase](https://alexradunet.github.io/NixPI/codebase/) | File-by-file responsibility guide |
| [Operations](https://alexradunet.github.io/NixPI/operations/) | Deploy, validate, and run procedures |
| [Reference](https://alexradunet.github.io/NixPI/reference/) | Deep technical documentation |
| [Contributing](https://alexradunet.github.io/NixPI/contributing/) | Maintainer guidelines |

## 🔗 Related

- [Documentation Site](https://alexradunet.github.io/NixPI)
- [GitHub Repository](https://github.com/alexradunet/NixPI)
