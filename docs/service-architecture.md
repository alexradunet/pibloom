# Service Architecture

> 📖 [Emoji Legend](LEGEND.md)

Bloom extends Pi's capabilities through three mechanisms, each suited to different needs. When Pi detects a capability gap or the user requests a new feature, choose the lightest mechanism that fits.

## 🌱 Extensibility Hierarchy

```mermaid
graph TD
    gap[Capability Gap Detected] --> q1{Needs code<br/>execution or<br/>long-running process?}
    q1 -->|No| skill[Skill<br/>SKILL.md]
    q1 -->|Yes| q2{Needs direct access<br/>to Pi session?}
    q2 -->|Yes| ext[Extension<br/>TypeScript]
    q2 -->|No| svc[Service<br/>Container]

    skill --> skill_desc["Markdown file with instructions<br/>Cheapest to create<br/>No code, just knowledge"]
    ext --> ext_desc["In-process TypeScript<br/>Full Pi API access<br/>Commands, tools, events"]
    svc --> svc_desc["Containerized workload<br/>Isolated, resource-limited<br/>HTTP/socket interaction"]

    style skill fill:#d5f5d5
    style ext fill:#d5d5f5
    style svc fill:#f5d5d5
```

### 🌱 When to Use What

| Mechanism | Use When | Examples | Cost |
|-----------|----------|----------|------|
| **Skill** | Pi needs knowledge or a procedure to follow | meal-planning, troubleshooting guides, API references | Zero — just a markdown file |
| **Extension** | Pi needs to register commands, tools, or react to session events | bloom-channels (Unix socket server), bloom-objects (object store) | Low — TypeScript, runs in-process |
| **Service** | A standalone process needs to run independently of Pi's session | LLM (llama.cpp), STT (whisper.cpp), WhatsApp bridge (always-on), dufs (WebDAV) | Medium — systemd unit, resource allocation |

**Always prefer the lighter option.** A skill that teaches Pi to call an existing API is better than an extension wrapping that API, which is better than a service re-implementing it.

## 🌱 System Overview

```mermaid
graph TB
    subgraph "Bloom OS (Fedora bootc)"
        subgraph "Pi Agent Process"
            persona[bloom-persona]
            garden[bloom-garden]
            objects[bloom-objects]
            topics[bloom-topics]
            channels[bloom-channels<br/>Unix socket<br/>$XDG_RUNTIME_DIR/bloom/channels.sock]
        end

        subgraph "Service Containers (Podman Quadlet)"
            llm[bloom-llm<br/>llama.cpp :8080]
            stt[bloom-stt<br/>whisper.cpp :8081]
            dufs[bloom-dufs<br/>WebDAV :5000]
            wa[bloom-whatsapp<br/>Baileys Bridge]
            signal[bloom-signal<br/>Signal Bridge]
        end

        subgraph "System Services (RPM)"
            netbird[netbird<br/>NetBird VPN<br/>system RPM service]
        end

        subgraph "System Services"
            systemd[systemd --user]
            systemd_sys[systemd system]
        end
    end

    channels <-->|Unix socket JSON| wa
    channels <-->|Unix socket JSON| signal
    wa <-->|Baileys| whatsapp_cloud[WhatsApp Cloud]
    signal <-->|signal-cli| signal_cloud[Signal Cloud]
    llm -->|HTTP API| channels
    netbird <-->|WireGuard| netbird_cloud[NetBird Cloud]
    dufs -->|WebDAV| devices[Other Devices]
    systemd -->|manages| wa
    systemd -->|manages| signal
    systemd -->|manages| llm
    systemd -->|manages| stt
    systemd -->|manages| dufs
    systemd_sys -->|manages| netbird

    style persona fill:#e8d5f5
    style garden fill:#d5f5e8
    style objects fill:#d5e8f5
    style channels fill:#f5e8d5
```

## 🌱 The Three Layers

| Layer | Mechanism | Lifecycle | Communication | Created By |
|-------|-----------|-----------|---------------|------------|
| **Skills** | Markdown files (SKILL.md) | Discovered at session start | Pi reads and follows instructions | Pi (via `skill_create`) or developer |
| **Extensions** | In-process TypeScript | Loaded with Pi session | Direct API (ExtensionAPI) | Developer (requires code review + PR) |
| **Services** | Containers (Podman Quadlet) | systemd-managed, independent | Unix socket, HTTP, shell | Pi (via self-evolution) or developer |

### 🌱 Why Three Layers?

- **Skills** are pure knowledge — procedures, API references, troubleshooting guides. Pi reads them and acts. No code, no process, no resources. Pi can create these autonomously.
- **Extensions** need direct access to Pi's session (send messages, register commands, access context). They run in-process and require TypeScript. These are core platform code.
- **Services** are standalone workloads (speech-to-text, messaging bridges, mesh VPN, file sync) that run as containers.

### 📦 The `bloom-` Prefix

Bloom-managed services use a `bloom-` prefix on their **unit names** (e.g., `bloom-llm`, `bloom-whatsapp`). This is a management namespace — it does NOT mean the underlying image is Bloom-specific. NetBird runs as a system-level RPM service:

| Unit Name | Type | Image / Runtime | Bloom-specific? |
|-----------|------|-----------------|-----------------|
| `bloom-llm` | Podman Quadlet (user) | `ghcr.io/ggml-org/llama.cpp:server` | No — upstream image |
| `bloom-stt` | Podman Quadlet (user) | `ghcr.io/ggml-org/whisper.cpp:main` | No — upstream image |
| `bloom-dufs` | Podman Quadlet (user) | `docker.io/sigoden/dufs:latest` | No — upstream image |
| `bloom-whatsapp` | Podman Quadlet (user) | localhost/bloom-whatsapp:latest | Yes — custom bridge |
| `bloom-signal` | Podman Quadlet (user) | localhost/bloom-signal:latest | Yes — custom bridge |
| `netbird` | System RPM service | NetBird package | No — upstream RPM |

The prefix enables:
- `systemctl --user status bloom-*` — list all Bloom-managed user services
- Clear separation from user-installed services

## 📦 Local Package Installation

Services are installed from bundled local packages in `services/{name}/`. Each package contains Quadlet container units and a SKILL.md file.

### 📦 Package Format

```
services/{name}/
├── quadlet/
│   ├── bloom-{name}.container    # Podman Quadlet unit
│   └── bloom-{name}-*.volume     # Volume definitions
└── SKILL.md                      # Skill file (frontmatter + API docs)
```

### 📦 Service Catalog

`services/catalog.yaml` is the declarative metadata index for install automation:

- default service versions
- runtime image references
- preflight requirements (for example `podman` for container services)

The `manifest_apply` tool uses this catalog to auto-install missing services and enforce preflight checks.

## 📦 Service Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Installed: service_install (local package)
    Installed --> Running: systemctl --user start
    Running --> Stopped: systemctl --user stop
    Stopped --> Running: systemctl --user start
    Stopped --> Removed: Remove quadlet + skill files
    Removed --> [*]
    Running --> Removed: systemctl --user stop + remove files

    note right of Installed
        ~/.config/containers/systemd/bloom-{name}.container
        ~/Bloom/Skills/{name}/SKILL.md
    end note
```

## 📡 Media Pipeline

When WhatsApp receives a voice note or image, the media flows through multiple services:

```mermaid
sequenceDiagram
    participant WA as WhatsApp Cloud
    participant Bridge as bloom-whatsapp
    participant FS as /var/lib/bloom/media/
    participant Channels as bloom-channels
    participant Pi as Pi Agent
    participant STT as bloom-stt

    WA->>Bridge: Incoming voice note
    Bridge->>Bridge: downloadMediaMessage()
    Bridge->>FS: Save as {timestamp}-{id}.ogg
    Bridge->>Channels: Unix socket JSON with media metadata
    Channels->>Pi: "[whatsapp: John] sent audio (15s, 24KB, audio/ogg). File: /var/lib/bloom/media/..."

    Note over Pi: Pi decides to transcribe
    Pi->>STT: POST http://localhost:8081/inference<br/>file=@/var/lib/bloom/media/...ogg
    STT->>Pi: {"text": "transcribed content"}
    Pi->>Channels: Response text
    Channels->>Bridge: Unix socket JSON response
    Bridge->>WA: Send reply
```

### 📡 Media Message Format (Channel Protocol)

```json
{
  "type": "message",
  "channel": "whatsapp",
  "from": "John",
  "timestamp": 1709568000,
  "media": {
    "kind": "audio",
    "mimetype": "audio/ogg",
    "filepath": "/var/lib/bloom/media/1709568000-abc123.ogg",
    "duration": 15,
    "size": 24576,
    "caption": null
  }
}
```

## 🗂️ File System Layout

```mermaid
graph LR
    subgraph "Immutable OS Layer (/usr)"
        bloom_pkg["/usr/local/share/bloom/<br/>Extensions + Skills + Persona"]
    end

    subgraph "User State (~)"
        config["~/.config/containers/systemd/<br/>Installed Quadlet units"]
        bloom_dir["~/Bloom/<br/>Persona, skills, objects"]
        skills["~/Bloom/Skills/<br/>Installed service skills"]
        media["/var/lib/bloom/media/<br/>Downloaded media files"]
        pi_state["~/.pi/<br/>Pi agent state"]
    end

    subgraph "Container Volumes"
        llm_models["bloom-llm-models<br/>LLM model cache"]
        stt_models["bloom-stt-models<br/>STT model cache"]
        wa_auth["bloom-whatsapp-auth<br/>WhatsApp credentials"]
        signal_data["bloom-signal-data<br/>Signal credentials"]
    end

    subgraph "System State"
        nb_state["/var/lib/netbird/<br/>NetBird identity"]
    end

    bloom_pkg --> config
    config --> llm_models
```

## 📦 Available Services

| Service | Category | Port | Type | Image / Runtime | Resources |
|---------|----------|------|------|-----------------|-----------|
| bloom-llm | ai | 8080 | Podman Quadlet | ghcr.io/ggml-org/llama.cpp:server | 2GB RAM |
| bloom-stt | ai | 8081 | Podman Quadlet | ghcr.io/ggml-org/whisper.cpp:main | 512MB RAM |
| bloom-dufs | sync | 5000 | Podman Quadlet | docker.io/sigoden/dufs:latest | 64MB RAM |
| bloom-whatsapp | communication | — | Podman Quadlet | localhost/bloom-whatsapp:latest | 128MB RAM |
| bloom-signal | communication | 18802 | Podman Quadlet | localhost/bloom-signal:latest | 128MB RAM |
| netbird | networking | — | System RPM service | NetBird package | 256MB RAM |

## 📦 Adding a New Service

1. Create `services/{name}/quadlet/bloom-{name}.container` with Quadlet conventions
2. Create `services/{name}/SKILL.md` documenting the API and usage
3. Test locally: copy to `~/.config/containers/systemd/`, reload, start
4. Update the services table in `services/README.md` and `AGENTS.md`

### 📦 Quadlet Conventions Checklist

- [ ] Container name: `bloom-{name}`
- [ ] Network: prefer `bloom.network` isolation (`host` only when required, e.g. VPN)
- [ ] Health check defined (`HealthCmd`, `HealthInterval`, `HealthRetries`)
- [ ] Logging: `LogDriver=journald`
- [ ] Security: `NoNewPrivileges=true`
- [ ] Restart policy: `on-failure` with `RestartSec=10`
- [ ] Resource limits set (`--memory`)
- [ ] `WantedBy=default.target` in `[Install]`

## 🔗 Related

- [Emoji Legend](LEGEND.md) — Notation reference
- [Channel Protocol](channel-protocol.md) — Unix socket IPC spec
- [Supply Chain](supply-chain.md) — Artifact trust and releases
- [Quick Deploy](quick_deploy.md) — OS build and deployment
