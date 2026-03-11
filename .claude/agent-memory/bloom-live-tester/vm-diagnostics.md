# VM Diagnostic Findings — 2026-03-10

## Summary
All Bloom containerized services (lemonade, matrix, element, dufs) are non-functional because Quadlet files were never deployed to the user's `~/.config/containers/systemd/` directory. The first-boot wizard (which is supposed to install services) cannot run because it depends on the LLM service that was never installed.

## Critical Findings

### 1. No Quadlet files deployed
- `~/.config/containers/systemd/` does not exist
- Zero containers running (`podman ps -a` empty)
- Zero images pulled (`podman images` empty)
- Zero volumes created

### 2. Port mismatch in first-boot script
- `os/sysconfig/bloom-bash_profile` polls `http://127.0.0.1:8080/health`
- `services/lemonade/quadlet/bloom-lemonade.container` publishes on port 8000
- This would fail even if service were installed

### 3. Service name confusion
- `.bash_profile` error message says: "Run: sudo systemctl status bloom-llm-local"
- No such unit exists. Actual unit would be `bloom-lemonade.service` (user-level, not system-level)

### 4. Chicken-and-egg dependency
- `.bash_profile` flow: greeting -> wait for LLM -> exec pi -> pi runs first-boot wizard -> wizard installs services
- But LLM IS one of the services that needs installing first
- Need pre-deployment of at least lemonade before first interactive login

### 5. Bloom directory partially seeded
- `~/Bloom/` structure exists: Evolutions, Persona, Skills, audit, blueprint-versions.json
- But `Persona/` and `Skills/` are both empty
- `~/.bloom/setup-state.json` does not exist
- `~/.bloom/.setup-complete` does not exist

### 6. Sway crash-looping (expected in QEMU)
- `bloom-sway.service` fails: "No backend was able to open a seat" (no DRM in headless QEMU)
- Restart counter was at 93+ within ~10 minutes of boot
- Consider: detect headless and skip display stack, or set StartLimitBurst

## System services that ARE working
- sshd: running, accessible on port 22 (forwarded to host:2222)
- nginx: running on port 80
- netbird: enabled (status not checked)
- bloom-update-check.timer: active/waiting
- bloom-display.target: active (but child services failing)
