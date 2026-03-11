# Bloom Live Tester Memory

## VM Access
- SSH: `sshpass -p '<see bib-config.toml>' ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -p 2222 pi@localhost`
- Password is in `os/bib-config.toml` (gitignored). Key-based auth not configured by default.
- Must use `sshpass` for non-interactive SSH; `ssh-askpass` is not available in CI/headless.
- Commands that return non-zero (e.g., systemctl status for missing units) will cancel parallel tool calls. Use `|| true` or chain commands in a single SSH session.

## Known Issues (as of 2026-03-10)
- See `vm-diagnostics.md` for detailed findings.
- **Chicken-and-egg**: Lemonade (local LLM) must be running before Pi can start, but Pi is supposed to install it during first-boot wizard.
- **Port mismatch**: `.bash_profile` checks port 8080, lemonade Quadlet publishes port 8000.
- **Service name mismatch**: `.bash_profile` references `bloom-llm-local`, actual unit is `bloom-lemonade`.
- **No Quadlet pre-deployment**: `~/.config/containers/systemd/` is never created; services never start.
- **Sway crash-loops in headless QEMU**: Expected but noisy. Restart counter hits 90+ quickly.

## Boot Timing
- VM boots and SSH available within ~30 seconds.
- Auto-login on tty1/ttyS0 triggers `.bash_profile` which blocks for up to 120s waiting for LLM.

## Service Architecture
- Quadlet files live in `services/*/quadlet/` in the repo.
- Must be copied to `~/.config/containers/systemd/` for podman to generate systemd units.
- `bloom.network` Quadlet is at `/usr/share/containers/systemd/bloom.network` (system-wide in image).
- Service catalog: `services/catalog.yaml`
- Installation procedure documented in `skills/service-management/SKILL.md`

## Ports (from Quadlet definitions)
- Lemonade: 8000
- Element: 8080 (check quadlet)
- Matrix: 8081 (check quadlet)
- Dufs: 5000 (check quadlet)
- nginx reverse proxy: 80
