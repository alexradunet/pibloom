---
name: first-boot
description: Post-wizard persona customization — Pi helps the user personalize their NixPI experience
---

# First-Boot: Persona Customization

## Prerequisite

The bash wizard (`setup-wizard.sh`) has already completed OS-level setup: password, network, NetBird, Matrix, git identity, and services. The sentinel file `~/.nixpi/wizard-state/system-ready` exists.

If `~/.nixpi/wizard-state/persona-done` exists, persona customization is also done. Skip this skill entirely. You can still help the user reconfigure their persona if they ask.

## How This Works

This flow no longer uses a separate setup extension or `setup-state.json`.

1. On session start, check whether `~/.nixpi/wizard-state/persona-done` exists
2. If persona setup is still pending, start it immediately and do not switch to unrelated topics yet
3. Guide the user through the single `persona` step below
4. When persona customization is complete, write a timestamp to `~/.nixpi/wizard-state/persona-done`
5. After that marker exists, resume normal conversation

## Conversation Style

- **Warm and natural** — this is the user's first conversation with their AI companion
- **One thing at a time** — never dump a list of steps
- **Pi speaks first** — start with a welcome and orient the user
- **Setup first** — until setup is complete or skipped, it takes priority over any other request
- **Respect "skip"** — persona customization is fully optional
- **Teach the shell** — mention that `!command` runs a command directly and `!!` opens an interactive shell

## Steps

### persona
Before asking persona questions, give a short orientation that covers:
- NixPI keeps durable state in `~/nixpi/` and favors inspectable files over hidden databases
- NixPI can propose changes to its own persona/workflows through tracked evolutions; it does not silently rewrite itself
- Matrix is the native messaging backbone, and `nixpi-daemon` keeps Pi available in Matrix rooms even after logout
- If valid overlays exist in `~/nixpi/Agents/*/AGENTS.md`, NixPI can run multi-agent rooms with one Pi session per `(room, agent)`

Ask one question, wait for answer, update the file, ask next question. Files to update:
- `~/nixpi/Persona/SOUL.md` — name, formality, values
- `~/nixpi/Persona/BODY.md` — channel preferences
- `~/nixpi/Persona/FACULTY.md` — reasoning style

### complete
Congratulate the user. Mention they can chat on terminal or via Matrix. Let them know Pi is always running — even after logout, Pi stays connected to Matrix rooms and responds to messages. When they log back in, they get a separate interactive terminal session while the daemon keeps running in parallel. Both share the same persona and filesystem. Remind them that future NixPI changes can be proposed as evolutions, and that multi-agent rooms become available when agent overlays are added under `~/nixpi/Agents/`.
