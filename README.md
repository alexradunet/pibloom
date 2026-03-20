# nixPI

> Pi-native AI companion OS on NixOS

Very opinionated NixOS build personally for me and my workflows and how I imagine a PC will be in the future. My goal is to leverage the current AI Agents Technology to build an AI Firsts OS designed specifically for one end user to act like a personal life assistant and knowledge management system.

It is very experimental and I am still currently developing it based on my needs and my own code engineering preferences.

I plan to keep this project as minimal as possible so the end user can evolve the OS through Pi without carrying a large default runtime surface.

## 🌱 Why nixPI Exists

nixPI packages Pi, host integration, memory, and a small set of built-in user services into one self-hosted system.

nixPI exists to give Pi:

- a durable home directory under `~/nixPI/`
- first-class host tools for NixOS workflows
- a local repo proposal workflow for human-reviewed system changes
- a private Matrix-based messaging surface
- a minimal but inspectable operating model based on files, NixOS, and systemd

## 🚀 What Ships Today

Current platform capabilities:

- nixPI directory management and blueprint seeding for `~/nixPI/`
- persona injection, shell guardrails, durable-memory digest injection, and compaction context persistence
- local-only Nix proposal support for checking the seeded repo clone, refreshing `flake.lock`, and validating config before review
- host OS management tools for NixOS updates, local/remote switch, systemd, health, and reboot scheduling
- built-in user services for Home and Web Chat
- markdown-native durable memory in `~/nixPI/Objects/`
- append-only episodic memory in `~/nixPI/Episodes/`
- a unified Matrix room daemon with synthesized host-agent fallback and optional multi-agent overlays
- proactive daemon jobs for heartbeat and simple cron-style scheduled turns
- a first-boot flow split between a bash wizard and a Pi-guided persona step

## 🚀 Quick Start

Install nixPI on an existing NixOS system:

```bash
# 1. Install NixOS from the official ISO: https://nixos.org/download.html
# 2. Download and extract nixPI:
curl -L https://github.com/alexradunet/nixpi/archive/refs/heads/main.tar.gz | tar xz -C ~
mv ~/nixpi-main ~/nixpi
cd ~/nixpi

# 3. Apply nixPI to your existing user (replace 'alex' with your username)
sudo NIXPI_PRIMARY_USER=alex nixos-rebuild switch --impure --flake .#desktop-attach

# 4. Reboot, then run the setup wizard to complete configuration:
setup-wizard.sh
```

See the [documentation site](https://alexradunet.github.io/nixPI) for detailed instructions.

## 🧭 Documentation

Full documentation is available at **[alexradunet.github.io/nixPI](https://alexradunet.github.io/nixPI)**

Or browse by topic:

| Your Goal | Start Here |
|-----------|------------|
| Installing nixPI | [Quick Deploy](https://alexradunet.github.io/nixPI/operations/quick-deploy) |
| First-time setup | [First Boot Setup](https://alexradunet.github.io/nixPI/operations/first-boot-setup) |
| Understanding the system | [Architecture Overview](https://alexradunet.github.io/nixPI/architecture/) |
| Reading the code | [Codebase Guide](https://alexradunet.github.io/nixPI/codebase/) |
| Operating a running system | [Operations](https://alexradunet.github.io/nixPI/operations/) |
| Deep technical reference | [Reference](https://alexradunet.github.io/nixPI/reference/) |

To run the docs locally:

```bash
npm run docs:dev
```

## 💻 Default Install

Installed by default:

- `sshd.service`
- `netbird.service`
- `matrix-synapse.service`
- `nixpi-daemon.service` after setup once AI auth and defaults are ready
- `nixpi-home.service`
- `nixpi-chat.service`

## 🌿 Repository Layout

| Path | Purpose |
|------|---------|
| `core/` | nixPI core: NixOS modules, daemon, persona, skills, built-in extensions, and shared runtime code |
| `core/os/` | NixOS modules and host configurations |
| `core/daemon/` | Matrix room daemon and multi-agent runtime |
| `core/pi/extensions/` | Pi-facing nixPI extensions shipped in the default runtime |
| `tests/` | unit, integration, daemon, and extension tests |
| `docs/` | live project documentation (VitePress site) |

## 🧩 Capability Model

nixPI extends Pi through two active runtime layers:

| Layer | What it is | Typical use |
|------|-------------|-------------|
| 📜 Skill | markdown instructions in `SKILL.md` | procedures, guidance, checklists |
| 🧩 Extension | in-process TypeScript | Pi-facing tools, hooks, commands |

Built-in service surface is part of the base NixOS system:

- `Home` on `:8080`
- `Web Chat` on `:8081`
- `Matrix` on `:6167`

## 📚 Documentation Structure

| Section | Contains |
|---------|----------|
| [Overview](https://alexradunet.github.io/nixPI/) | Project summary and entry points |
| [Getting Started](https://alexradunet.github.io/nixPI/getting-started/) | New maintainer orientation |
| [Architecture](https://alexradunet.github.io/nixPI/architecture/) | Subsystem boundaries and runtime flows |
| [Codebase](https://alexradunet.github.io/nixPI/codebase/) | File-by-file responsibility guide |
| [Operations](https://alexradunet.github.io/nixPI/operations/) | Deploy, setup, and run procedures |
| [Reference](https://alexradunet.github.io/nixPI/reference/) | Deep technical documentation |
| [Contributing](https://alexradunet.github.io/nixPI/contributing/) | Maintainer guidelines |

## 🔗 Related

- [Documentation Site](https://alexradunet.github.io/nixPI)
- [GitHub Repository](https://github.com/alexradunet/nixPI)
