# Getting Started with nixPI

> Orienting new maintainers to the nixPI codebase

## 🌱 How to Read This Repository

nixPI is organized as a multi-layer system. Understanding these layers will help you navigate the codebase effectively.

### Runtime Layers

| Layer | Technology | Purpose |
|-------|------------|---------|
| **OS Layer** | NixOS/Nix | System provisioning, services, packaging |
| **Daemon Layer** | TypeScript/Node.js | Always-on Matrix room runtime |
| **Extension Layer** | TypeScript | Pi-facing tools, commands, hooks |
| **Memory Layer** | Markdown | Durable and episodic storage |
| **Documentation** | VitePress | This documentation site |

### Key Directory Map

```
nixPI/
├── core/
│   ├── os/          # NixOS modules, services, packages
│   ├── daemon/      # Matrix daemon and multi-agent runtime
│   ├── lib/         # Shared runtime helpers
│   └── pi/          # Pi-facing extensions and persona
│       ├── extensions/  # Built-in Pi extensions
│       ├── persona/     # Persona configuration
│       └── skills/      # Built-in skill definitions
├── tests/           # Unit, integration, and E2E tests
├── docs/            # This documentation
├── tools/           # VM and testing helpers
└── flake.nix        # Nix entry point
```

## 🚀 Common Commands

### Development Workflow

```bash
# Run all tests
npm run test

# Run specific test suites
npm run test:unit
npm run test:integration
npm run test:e2e

# Build TypeScript
npm run build

# Lint and format
npm run check
npm run check:fix
```

### Nix/NixOS Workflow

```bash
# Apply local config to running system
just switch

# Apply remote config
just update

# Build and run test VM
just vm

# SSH into running VM
just vm-ssh

# Validate NixOS config
just check-config

# Full VM boot test
just check-boot
```

### Documentation Workflow

```bash
# Start development server
npm run docs:dev

# Build documentation
npm run docs:build

# Preview built documentation
npm run docs:preview
```

## 📚 Reading Order for New Maintainers

If you're diving into the codebase, this order will help you build mental models:

1. **Start with the big picture**
   - Read [Architecture Overview](../architecture/)
   - Understand [Runtime Flows](../architecture/runtime-flows)

2. **Understand the control surfaces**
   - Read [Root Files](../codebase/root-files)
   - Understand `flake.nix` and `package.json`

3. **Dive into subsystems**
   - [Core Library](../codebase/core-lib) - shared primitives
   - [Daemon](../codebase/daemon) - room runtime
   - [Pi Extensions](../codebase/pi-extensions) - tool surface
   - [OS Modules](../codebase/os) - NixOS integration

4. **Reference as needed**
   - [Operations](../operations/) for deployment
   - [Reference](../reference/) for deep details

## 🔗 Related

- [Architecture Overview](../architecture/)
- [Codebase Guide](../codebase/)
- [Operations: Quick Deploy](../operations/quick-deploy)
