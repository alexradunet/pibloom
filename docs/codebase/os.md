# OS Modules

> NixOS integration and system provisioning

## 🌱 Why OS Modules Exist

The OS modules define how nixPI integrates with NixOS. They provide:

- System service definitions
- NixOS option declarations
- Package definitions
- Host configurations

## 🚀 What They Own

| Component | Purpose | Location |
|-----------|---------|----------|
| Modules | NixOS option declarations and implementation | `core/os/modules/` |
| Services | Systemd service definitions | `core/os/services/` |
| Packages | Nix derivations for pi and app | `core/os/pkgs/` |
| Hosts | NixOS host configurations | `core/os/hosts/` |
| Library | Shared Nix helper functions | `core/os/lib/` |

## 📋 Module Inventory

### Core Modules (`core/os/modules/`)

| File | Why | What | How / Notes |
|------|-----|------|-------------|
| `options.nix` | Option surface | Declares all nixPI options | Central option definition |
| `app.nix` | App packaging | nixPI app derivation, service | Main application |
| `broker.nix` | Privilege broker | `nixpi-broker` service | Privilege escalation |
| `llm.nix` | LLM integration | Local AI service integration | Ollama, etc. |
| `matrix.nix` | Matrix server | Synapse configuration | Homeserver setup |
| `network.nix` | Networking | NetBird, firewall, DNS | Network configuration |
| `shell.nix` | Shell environment | Shell configuration, completions | User shell setup |
| `update.nix` | Updates | Update timer and service | Automatic updates |
| `firstboot.nix` | First boot | `nixpi-firstboot` service | Initial setup trigger |

### Key Option Categories (from `options.nix`)

| Category | Options | Purpose |
|----------|---------|---------|
| `nixpi.primaryUser` | Username | Primary operator account |
| `nixpi.install.mode` | `managed-user`, `system-wide` | Installation scope |
| `nixpi.createPrimaryUser` | Boolean | Auto-create user |
| `nixpi.bootstrap.*` | Various | First-boot behavior |
| `nixpi.services.*` | Daemon, home, chat | Service toggles |
| `nixpi.matrix.*` | Homeserver settings | Matrix configuration |
| `nixpi.network.*` | NetBird, firewall | Network settings |

---

## 📋 Service Definitions (`core/os/services/`)

| File | Why | What | How / Notes |
|------|-----|------|-------------|
| `nixpi-daemon.nix` | Daemon service | `nixpi-daemon.service` definition | Main runtime service |
| `nixpi-home.nix` | Home service | Status page on :8080 | Built-in service |
| `nixpi-chat.nix` | Chat service | FluffyChat on :8081 | Web Matrix client |
| `nixpi-broker.nix` | Broker service | Privilege escalation service | Admin operations |
| `nixpi-update.nix` | Update service | Automatic update timer | Maintenance window updates |

### Service User Model

| Service | User | Purpose |
|---------|------|---------|
| `nixpi-daemon.service` | `agent` | Unprivileged runtime |
| `nixpi-broker.service` | `root` | Privileged operations |
| `nixpi-home.service` | `agent` | Web service |
| `nixpi-chat.service` | `agent` | Web service |
| `matrix-synapse.service` | `matrix-synapse` | Homeserver |

---

## 📋 Package Definitions (`core/os/pkgs/`)

| File | Why | What | How / Notes |
|------|-----|------|-------------|
| `pi/default.nix` | Pi agent package | Pi AI agent derivation | Peer dependency |
| `app/default.nix` | App package | nixPI app derivation | Main package |

### Package Flow

```
flake.nix
    ↓
callPackage core/os/pkgs/pi     → piAgent
    ↓
callPackage core/os/pkgs/app    → appPackage (uses piAgent)
    ↓
NixOS modules use appPackage
```

---

## 📋 Host Configurations (`core/os/hosts/`)

| File | Why | What | How / Notes |
|------|-----|------|-------------|
| `x86_64.nix` | Desktop config | Full desktop configuration | Main install target |
| `x86_64-attach.nix` | Attach config | Attach to existing NixOS | Install on existing system |
| `installer-vm.nix` | Installer VM | Plain NixOS for VM install | Testing installer flow |

### Host Configuration Pattern

```nix
{ config, pkgs, lib, ... }:
{
  imports = [
    ./hardware-configuration.nix  # Or generic defaults
    self.nixosModules.nixpi       # nixPI feature modules
    self.nixosModules.firstboot   # First-boot service
  ];

  nixpi.primaryUser = "alex";
  nixpi.install.mode = "managed-user";
  # ...
}
```

---

## 📋 Library (`core/os/lib/`)

| File | Why | What | How / Notes |
|------|-----|------|-------------|
| `resolve-primary-user.nix` | User resolution | Determine primary user from env or config | Handles `NIXPI_PRIMARY_USER` |

---

## 🔍 Important File Details

### `core/os/modules/options.nix`

**Responsibility**: Declares all nixPI NixOS options in one place.

**Option Hierarchy**:
```
nixpi
├── primaryUser
├── createPrimaryUser
├── install.mode
├── bootstrap
│   ├── keepSshAfterSetup
│   └── ...
├── services
│   ├── daemon.enable
│   ├── home.enable
│   └── chat.enable
├── matrix
│   ├── enable
│   ├── port
│   └── ...
└── network
    ├── netbird.enable
    └── ...
```

**Inbound Dependencies**:
- All other modules reference these options
- User configurations set these options

---

### `core/os/modules/app.nix`

**Responsibility**: Defines the nixPI app package and main service.

**Key Definitions**:
- `nixpi-app` package (uses `appPackage` from specialArgs)
- `nixpi-daemon.service` systemd unit
- Runtime directory setup
- Environment configuration

**Service Configuration**:
```nix
systemd.services.nixpi-daemon = {
  description = "nixPI Matrix daemon";
  wantedBy = [ "multi-user.target" ];
  after = [ "network.target" "matrix-synapse.service" ];
  serviceConfig = {
    User = "agent";
    ExecStart = "${appPackage}/bin/nixpi-daemon";
    # ...
  };
};
```

---

### `core/os/modules/broker.nix`

**Responsibility**: Privilege escalation service for elevated operations.

**Why It Exists**: The daemon runs as unprivileged `agent` user. Some operations (like certain NixOS commands) need elevated privileges. The broker acts as a controlled elevation point.

**Tools**:
| Tool | Purpose |
|------|---------|
| `nixpi-brokerctl grant-admin <duration>` | Grant admin privileges |
| `nixpi-brokerctl status` | Check broker status |
| `nixpi-brokerctl revoke-admin` | Revoke admin privileges |

**Autonomy Levels**:
- `observe` - Read state only
- `maintain` - Operate approved systemd units
- `admin` - Full elevation (time-bounded)

---

### `core/os/modules/matrix.nix`

**Responsibility**: Matrix Synapse homeserver configuration.

**Key Features**:
- Non-federating configuration (private server)
- Registration token required
- SQLite database (default)
- Runs on port 6167

**Registration Token**: Stored in `/var/lib/continuwuity/registration_token`

---

### `core/os/modules/network.nix`

**Responsibility**: Network configuration including NetBird and firewall.

**Security Model**:
```nix
networking.firewall = {
  trustedInterfaces = [ "wt0" ];  # NetBird only
  # All services only accessible via wt0
};
```

**Critical**: Without NetBird running, services are exposed to local network.

---

## 🔄 Related Tests

| Test Area | Location | Coverage |
|-----------|----------|----------|
| NixOS smoke | `tests/nixos/` | Basic service startup |
| NixOS full | `tests/nixos/` | Comprehensive VM tests |

See [Tests](./tests) for detailed test documentation.

---

## 🔗 Related

- [Architecture Overview](../architecture/) - High-level design
- [Runtime Flows](../architecture/runtime-flows) - End-to-end flows
- [Tests](./tests) - Test coverage
