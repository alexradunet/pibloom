# Local LLM Integration Design

**Date:** 2026-03-17
**Status:** Revised v4

## Overview

LocalAI with a bundled default model is always installed and always running on Bloom OS. No feature flags, no opt-in. A Pi extension registers LocalAI as a provider; `setup-wizard.sh` sets it as the default provider/model so Pi uses it automatically without login or model selection. Pi agent also receives a bundled skill documenting all four modalities.

## Goals

- LocalAI runs on every Bloom OS instance out of the box
- `omnicoder-9b-q4_k_m.gguf` (5.74GB) bundled into the image at build time via `pkgs.fetchurl`
- Pi uses the local model automatically — no login, no model selection prompt
- All four modalities available: LLM, STT (Whisper), TTS, image generation
- Fully private — no telemetry, no cloud calls, all inference local

## Non-Goals

- Feature flags or opt-out mechanisms
- Model management UI
- Automatic routing between local and cloud
- Container-based deployment

## Hardware Requirements

- Minimum: 8GB RAM
- Recommended: 16GB RAM
- ISO size: ~6-7GB with model bundled

## Architecture

### 1. NixOS Module: `core/os/modules/llm.nix`

LocalAI always enabled. No options.

```nix
{ pkgs, lib, ... }:

let
  modelFileName = "omnicoder-9b-q4_k_m.gguf";
  model = pkgs.fetchurl {
    url    = "https://.../<model>.gguf";   # filled in during implementation
    sha256 = "...";                         # filled in during implementation
    name   = modelFileName;
  };
in
{
  systemd.services.localai = {
    description = "Bloom Local AI Inference (LocalAI)";
    after    = [ "network.target" ];
    wantedBy = [ "multi-user.target" ];

    serviceConfig = {
      Type             = "simple";
      ExecStartPre     = "${pkgs.writeShellScript ''localai-seed-model'' ''
        dest=/var/lib/localai/models/${modelFileName}
        if [ ! -f "$dest" ]; then
          install -m 644 ${model} "$dest"
        fi
      ''}";
      ExecStart        = "${pkgs.local-ai}/bin/local-ai run --address 0.0.0.0:11435 --models-path /var/lib/localai/models";
      Restart          = "on-failure";
      RestartSec       = 5;
      DynamicUser      = true;
      StateDirectory   = "localai localai/models";
      WorkingDirectory = "/var/lib/localai";
    };
  };
}
```

Key decisions:
- **`''..''` Nix string syntax** — both `writeShellScript` arguments use Nix multiline strings to avoid nested double-quote parse errors
- **`ExecStartPre` as interpolated string** — `"${pkgs.writeShellScript ...}"` produces the store path string required by `serviceConfig.ExecStartPre`
- **`StateDirectory = "localai localai/models"`** — systemd creates both dirs and chowns to `DynamicUser` before `ExecStartPre` runs
- **`ExecStartPre` idempotent** — skips copy if model already present, safe on restarts
- **Port `11435`** — no conflict with Bloom Home (`8080`), Matrix (`6167`), or Ollama's `11434`
- **`name = modelFileName` in `pkgs.fetchurl`** — store output path matches the filename used in the seed script

### 2. Host Config Update: `core/os/hosts/x86_64.nix`

Add `../modules/bloom-llm.nix` to imports.

### 3. Pi Extension: `core/pi/extensions/localai/`

Pi auto-loads all subdirectories listed under `"extensions": ["./core/pi/extensions"]` in `package.json`. Adding `localai/` to that directory is sufficient — no registry or loader change needed. The compiled output lands in `dist/core/pi/extensions/localai/` and is included via the `cp -r dist` step in `app/default.nix`.

Extension has two files:

**`index.ts`** — registers the LocalAI provider at extension load time:

```ts
export default function (pi: ExtensionAPI) {
  pi.registerProvider("localai", {
    baseUrl: "http://localhost:11435/v1",
    api: "openai-completions",
    models: [
      {
        id: "omnicoder-9b-q4_k_m",
        name: "OmniCoder 9B",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 8192,
        maxTokens: 4096,
        compat: {
          supportsDeveloperRole: false,
          maxTokensField: "max_tokens",
        },
      },
    ],
  });
}
```

No `actions.ts` needed — the extension only registers the provider. Default model selection is handled by `setup-wizard.sh` (see below).

### 4. Wizard Update: `core/scripts/setup-wizard.sh`

`setup-wizard.sh` already has `write_pi_settings_defaults(provider, model)` which unconditionally writes `defaultProvider` and `defaultModel` to `~/.pi/agent/settings.json`. It always overwrites — there is no per-key guard. The single-run protection is the wizard's own gate (`~/.bloom/.setup-complete`): the wizard runs once on first boot, so `write_pi_settings_defaults` is only called once in practice.

Update the wizard to call:

```bash
write_pi_settings_defaults "localai" "omnicoder-9b-q4_k_m"
```

This replaces any existing cloud provider default call. On a fresh install, Pi will start using the local model immediately after the wizard runs.

### 5. Pi Skill: `core/pi/skills/local-llm/SKILL.md`

Bundled via garden blueprints sync — `app/default.nix` already copies `core/pi/skills/` wholesale, so no derivation change is needed.

Skill content:

**Service:**
- LocalAI always runs at boot: `systemctl status localai`
- API base: `http://localhost:11435/v1`
- List loaded models: `GET /v1/models`

**Endpoints:**

| Modality | Endpoint |
|----------|----------|
| LLM | `POST /v1/chat/completions` |
| STT (Whisper) | `POST /v1/audio/transcriptions` |
| TTS | `POST /v1/audio/speech` |
| Image | `POST /v1/images/generations` |

**Default model:** `omnicoder-9b-q4_k_m` — available immediately at boot, no download needed.

**Additional models:** Drop GGUF files into `/var/lib/localai/models/` and restart `localai.service`.

**When to prefer local:**
- Offline / air-gapped operation
- Privacy-sensitive tasks
- Bulk processing
- Audio (STT/TTS)

### 6. AGENTS.md Update

Add `localai` to the extensions table and `local-llm` to the bundled skills list under `## 📜 Bundled Skills`.

## File Changes

| File | Change |
|------|--------|
| `core/os/modules/llm.nix` | New file — always-on LocalAI systemd service |
| `core/os/hosts/x86_64.nix` | Add `bloom-llm.nix` to imports |
| `core/pi/extensions/localai/index.ts` | New file — provider registration |
| `core/scripts/setup-wizard.sh` | Call `write_pi_settings_defaults "localai" "omnicoder-9b-q4_k_m"` |
| `core/pi/skills/local-llm/SKILL.md` | New file |
| `AGENTS.md` | Add `localai` extension + `local-llm` skill |

## Testing

- `systemctl status localai` — active after boot
- `curl http://localhost:11435/v1/models` — returns `omnicoder-9b-q4_k_m`
- `~/.pi/agent/settings.json` has `defaultProvider: "localai"` and `defaultModel: "omnicoder-9b-q4_k_m"` after wizard
- Pi session starts without login prompt, using local model
- Pi skill appears in `~/Bloom/Skills/local-llm/` after blueprints sync
- Restarting `localai.service` — `ExecStartPre` is idempotent (no duplicate copy)
