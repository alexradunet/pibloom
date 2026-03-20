# Scripts & Tools

> Setup orchestration and VM/testing helpers

## 🌱 Why Scripts & Tools Exist

Scripts and tools bridge the gap between the repository and runtime operations:

- **Setup scripts**: First-boot wizard and configuration
- **VM tools**: Development and testing in virtual machines
- **Test helpers**: E2E and integration test support

## 🚀 What They Own

| Component | Purpose | Location |
|-----------|---------|----------|
| Setup scripts | First-boot wizard | `core/scripts/` |
| VM runner | QEMU VM execution | `tools/run-qemu.sh` |
| E2E installer | Live install testing | `tools/run-install-vm-e2e.sh` |

## 📋 Script Inventory

### Setup Scripts (`core/scripts/`)

> Note: If `core/scripts/` doesn't exist or is empty, setup may be handled inline in NixOS modules or the first-boot service.

Setup orchestration is primarily handled by:
- `nixpi-firstboot.service` (defined in `core/os/modules/firstboot.nix`)
- `setup-wizard.sh` (installed as a system command)

### VM Tools (`tools/`)

| File | Why | What | How / Notes |
|------|-----|------|-------------|
| `run-qemu.sh` | VM execution | Run QEMU VMs for testing | Used by `just vm*` commands |
| `run-install-vm-e2e.sh` | E2E testing | Live install with NetBird | Full E2E validation |

---

## 🔍 Important File Details

### `tools/run-qemu.sh`

**Responsibility**: Execute QEMU VMs for development and testing.

**Modes**:
| Mode | Purpose |
|------|---------|
| `headless` | Serial console only |
| `gui` | Full graphical display |
| `daemon` | Background, detached |

**Environment Variables**:
| Variable | Purpose | Default |
|----------|---------|---------|
| `NIXPI_VM_OUTPUT` | Nix build output path | `result` |
| `NIXPI_VM_DISK_PATH` | VM disk location | `/tmp/nixpi-vm-disk.qcow2` |
| `NIXPI_VM_LOG_PATH` | Log file | `/tmp/nixpi-vm.log` |
| `NIXPI_VM_MEMORY_MB` | RAM in MB | `16384` |
| `NIXPI_VM_CPUS` | CPU count | `4` |

**Forwarded Ports**:
- `2222` → Guest SSH (port 22)

**Usage**:
```bash
# Run VM (called by justfile)
./tools/run-qemu.sh --mode headless

# Skip rebuild, use existing qcow2
./tools/run-qemu.sh --mode headless --skip-setup
```

**Inbound Dependencies**:
- `just vm`, `just vm-gui`, `just vm-daemon`
- `just vm-install*`

**Outbound Dependencies**:
- QEMU system
- `ovmf` (UEFI firmware)

---

### `tools/run-install-vm-e2e.sh`

**Responsibility**: End-to-end live installation testing with NetBird.

**Flow**:
1. Boots plain NixOS installer VM
2. Installs nixPI onto existing user
3. Injects prefill configuration
4. Waits for firstboot completion
5. Verifies all services active

**Requirements**:
- `NIXPI_TEST_NETBIRD_SETUP_KEY` environment variable
- KVM support for reasonable performance

**Verification Steps**:
- `agent` user exists
- `nixpi-broker` service active
- `nixpi-daemon` service active
- `matrix-synapse` service active
- NetBird connected

**Usage**:
```bash
export NIXPI_TEST_NETBIRD_SETUP_KEY='...'
just live-install-e2e
```

**Security Note**: Setup key is consumed at runtime only, never committed.

---

## 🔄 First-Boot Service

While not a standalone script file, the first-boot logic is important:

### `nixpi-firstboot.service`

**Definition**: `core/os/modules/firstboot.nix`

**Purpose**: Trigger setup wizard on first interactive login.

**Behavior**:
1. Runs before TTY login
2. If `~/.nixpi/.setup-complete` missing → Start wizard
3. Wizard handles: password, NetBird, Matrix, AI setup
4. Marks completion with sentinel file

**Recovery**:
- Corrupt state → Auto-backup and reset
- Interrupt → Resumable on next login

---

## 📋 When to Run Scripts

| Script | Safe to Run | When |
|--------|-------------|------|
| `setup-wizard.sh` | Production | First boot only |
| `run-qemu.sh` | Development | Anytime for testing |
| `run-install-vm-e2e.sh` | Development | CI/CD validation |

---

## 🔗 Related

- [Operations: Quick Deploy](../operations/quick-deploy) - Deployment procedures
- [Operations: First Boot](../operations/first-boot-setup) - Setup procedures
- [Tests](./tests) - Testing documentation
