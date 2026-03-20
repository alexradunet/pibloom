# Tests

> Test suites and validation coverage

## 🌱 Why Tests Exist

Tests ensure nixPI works correctly across:

- **Unit tests**: Individual function behavior
- **Integration tests**: Component interactions
- **E2E tests**: Full system scenarios
- **NixOS tests**: VM-based system validation

## 🚀 What They Own

| Test Suite | Purpose | Location |
|------------|---------|----------|
| Lib tests | Core library validation | `tests/lib/` |
| Extension tests | Pi extension validation | `tests/extensions/` |
| Daemon tests | Daemon component validation | `tests/daemon/` |
| Integration tests | Cross-component validation | `tests/integration/` |
| E2E tests | Full system scenarios | `tests/e2e/` |
| NixOS tests | VM-based system tests | `tests/nixos/` |
| Test helpers | Shared test utilities | `tests/helpers/` |

## 📋 Test Inventory

### Lib Tests (`tests/lib/`)

| File | Coverage Area | Production Code |
|------|---------------|-----------------|
| `filesystem.test.ts` | File operations | `core/lib/filesystem.ts` |
| `exec.test.ts` | Command execution | `core/lib/exec.ts` |
| `matrix.test.ts` | Matrix utilities | `core/lib/matrix.ts` |
| `matrix-format.test.ts` | Message formatting | `core/lib/matrix-format.ts` |
| `matrix-agents.test.ts` | Agent overlay parsing | `core/lib/frontmatter.ts` |
| `matrix-registration.test.ts` | User registration | `core/lib/matrix.ts` |
| `room-alias.test.ts` | Room resolution | `core/lib/matrix.ts` |
| `setup.test.ts` | Setup state | `core/lib/setup.ts` |
| `shared.test.ts` | Shared utilities | `core/lib/shared.ts` |

### Extension Tests (`tests/extensions/`)

| File | Coverage Area | Production Code |
|------|---------------|-----------------|
| `nixpi.test.ts` | NixPI extension | `core/pi/extensions/nixpi/` |
| `os.test.ts` | OS extension core | `core/pi/extensions/os/` |
| `os-update.test.ts` | OS update operations | `core/pi/extensions/os/` |
| `os-proposal.test.ts` | OS proposal flow | `core/pi/extensions/os/` |
| `objects.test.ts` | Objects extension | `core/pi/extensions/objects/` |
| `episodes.test.ts` | Episodes extension | `core/pi/extensions/episodes/` |
| `setup.test.ts` | Setup extension | `core/pi/extensions/setup/` |
| `persona.test.ts` | Persona extension | `core/pi/extensions/persona/` |
| `localai.test.ts` | LocalAI extension | `core/pi/extensions/localai/` |

### Daemon Tests (`tests/daemon/`)

| File | Coverage Area | Production Code |
|------|---------------|-----------------|
| `index.test.ts` | Bootstrap | `core/daemon/index.ts` |
| `multi-agent-runtime.test.ts` | Runtime orchestration | `core/daemon/multi-agent-runtime.ts` |
| `agent-supervisor.test.ts` | Agent supervision | `core/daemon/agent-supervisor.ts` |
| `agent-registry.test.ts` | Agent loading | `core/daemon/agent-registry.ts` |
| `router.test.ts` | Message routing | `core/daemon/router.ts` |
| `room-state.test.ts` | Room state | `core/daemon/room-state.ts` |
| `scheduler.test.ts` | Job scheduling | `core/daemon/scheduler.ts` |
| `proactive.test.ts` | Proactive dispatch | `core/daemon/proactive.ts` |
| `rate-limiter.test.ts` | Rate limiting | `core/daemon/rate-limiter.ts` |
| `lifecycle.test.ts` | Startup retry | `core/daemon/lifecycle.ts` |
| `matrix-js-sdk-bridge.test.ts` | Matrix transport | `core/daemon/runtime/matrix-js-sdk-bridge.ts` |
| `pi-room-session.test.ts` | Session lifecycle | `core/daemon/runtime/pi-room-session.ts` |
| `ordered-cache.test.ts` | Caching | `core/daemon/ordered-cache.ts` |
| `session-events.test.ts` | Session events | `core/daemon/runtime/pi-room-session.ts` |

### Integration Tests (`tests/integration/`)

| File | Coverage Area |
|------|---------------|
| `frontmatter-roundtrip.test.ts` | Frontmatter parse/stringify |
| `guardrails.test.ts` | Guardrails validation |
| `matrix-bridge-resilience.test.ts` | Bridge error handling |
| `nixpi-seeding.test.ts` | Directory seeding |
| `object-lifecycle.test.ts` | Object create/update/read |
| `persona-guardrails.test.ts` | Persona integration |
| `pi-ui-parity-guard.test.ts` | UI consistency |

### E2E Tests (`tests/e2e/`)

| File | Coverage Area |
|------|---------------|
| `extension-registration.test.ts` | Full extension loading |

### NixOS Tests (`tests/nixos/`)

| Test | Purpose | Check Name |
|------|---------|------------|
| `smoke-matrix` | Matrix starts | `checks.x86_64-linux.nixos-smoke` |
| `smoke-firstboot` | Firstboot service | `checks.x86_64-linux.nixos-smoke` |
| `smoke-security` | Basic security | `checks.x86_64-linux.nixos-smoke` |
| `smoke-broker` | Broker service | `checks.x86_64-linux.nixos-smoke` |
| `nixpi-matrix` | Matrix integration | `checks.x86_64-linux.nixos-full` |
| `nixpi-firstboot` | Full firstboot | `checks.x86_64-linux.nixos-full` |
| `localai` | Local AI | `checks.x86_64-linux.nixos-full` |
| `nixpi-network` | Network config | `checks.x86_64-linux.nixos-full` |
| `nixpi-daemon` | Daemon service | `checks.x86_64-linux.nixos-full` |
| `nixpi-e2e` | End-to-end | `checks.x86_64-linux.nixos-full` |
| `nixpi-home` | Home service | `checks.x86_64-linux.nixos-full` |
| `nixpi-security` | Security model | `checks.x86_64-linux.nixos-full` |
| `nixpi-install-flow` | Install process | `checks.x86_64-linux.nixos-full` |
| `nixpi-modular-services` | Services | `checks.x86_64-linux.nixos-full` |
| `nixpi-matrix-bridge` | Matrix bridge | `checks.x86_64-linux.nixos-full` |
| `nixpi-bootstrap-mode` | Bootstrap | `checks.x86_64-linux.nixos-full` |
| `nixpi-post-setup-lockdown` | Post-setup | `checks.x86_64-linux.nixos-full` |
| `nixpi-broker` | Broker | `checks.x86_64-linux.nixos-full` |

### Test Helpers (`tests/helpers/`)

| File | Purpose |
|------|---------|
| `mock-extension-api.ts` | Mock Pi extension API |
| `mock-extension-context.ts` | Mock extension context |
| `temp-nixpi.ts` | Temporary nixPI directory |

---

## 🔍 Coverage Thresholds

From `vitest.config.ts`:

| Area | Lines | Functions | Branches | Statements |
|------|-------|-----------|----------|------------|
| `core/daemon/` | 85% | 80% | 75% | 85% |
| `core/lib/` | 72% | 77% | 57% | 69% |
| `core/pi/extensions/` | 60% | 60% | 50% | 60% |

---

## 🚀 Running Tests

### All Tests
```bash
npm run test
```

### By Suite
```bash
npm run test:unit          # lib, extensions, daemon
npm run test:integration   # integration/
npm run test:e2e          # e2e/
```

### With Coverage
```bash
npm run test:coverage
```

### Watch Mode
```bash
npm run test:watch
```

### NixOS Tests
```bash
just check-nixos-smoke       # Smoke tests
just check-nixos-full        # Full suite
just check-nixos-destructive # Long-running tests
```

---

## 📝 Adding Tests

### Unit Test Pattern

```typescript
import { describe, it, expect } from "vitest";
import { myFunction } from "../../core/lib/my-module";

describe("myModule", () => {
  it("should do something", () => {
    const result = myFunction("input");
    expect(result).toBe("expected");
  });
});
```

### Integration Test Pattern

```typescript
import { describe, it, expect } from "vitest";
import { setupTestEnv } from "../helpers/temp-nixpi";

describe("feature integration", () => {
  it("should work end to end", async () => {
    const env = await setupTestEnv();
    // Test with real components
    await env.cleanup();
  });
});
```

### Test Naming Conventions

- Descriptive: `describe("component")` + `it("should behavior when condition")`
- Group related tests in describe blocks
- Use `beforeEach`/`afterEach` for setup/teardown

---

## 🔗 Related

- [Core Library](./core-lib) - Tested library code
- [Pi Extensions](./pi-extensions) - Tested extensions
- [Daemon](./daemon) - Tested daemon code
