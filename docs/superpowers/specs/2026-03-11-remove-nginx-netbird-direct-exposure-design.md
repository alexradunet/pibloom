# Design: Remove Nginx, Direct Service Exposure via NetBird Mesh

**Date:** 2026-03-11
**Status:** Approved

## Problem

Bloom OS uses nginx as a reverse proxy to route subdomain-based HTTP traffic to containerized services on localhost. All clients access services exclusively through the NetBird mesh. Since the mesh already provides encryption (WireGuard), authentication (peer identity), and DNS resolution (`bloom.mesh` zone), nginx is redundant overhead — it adds a process, a config format, vhost generation code, and a failure mode, all to solve a problem (virtual hosting on port 80) that doesn't need solving when every client is mesh-aware.

## Solution

Remove nginx entirely. Services are directly reachable by mesh peers on their native ports. The existing firewall configuration (`wt0` in trusted zone) ensures only mesh traffic reaches service ports. NetBird DNS continues to resolve `{service}.bloom.mesh` to the device's mesh IP.

### Request flow (before)

```
Client → DNS: cinny.bloom.mesh → 100.x.x.x
       → HTTP: 100.x.x.x:80 → nginx vhost match → proxy_pass 127.0.0.1:18810 → container
```

### Request flow (after)

```
Client → DNS: cinny.bloom.mesh → 100.x.x.x
       → HTTP: 100.x.x.x:18810 → container (direct)
```

## Changes

### 1. Container Port Binding

Most services already use host networking and are mesh-reachable. Only cinny needs a port binding change:

| Service | Current State | Change Needed |
|---------|--------------|---------------|
| cinny | `PublishPort=127.0.0.1:18810:80` on `bloom.network` | Change to `Network=host`, remove `PublishPort`, adjust container to serve on port 18810 |
| dufs | `Network=host`, port 5000 | **No change** — already directly exposed |
| code-server | `Network=host`, port 8443 | **No change** — already directly exposed |
| Matrix (continuwuity) | Native service, already binds `0.0.0.0:6167` | **No change** |

**Cinny detail:** Switch cinny from `bloom.network` + `PublishPort` to `Network=host` for consistency with dufs and code-server. The container image (cinny) serves on port 80 internally — configure it or add a port mapping to serve on 18810 on the host. Update the comment from "nginx proxies /cinny to this" to reflect direct mesh access.

**Template update:** Update `services/_template/quadlet/bloom-TEMPLATE.container` to use `Network=host` instead of `bloom.network` + `PublishPort=127.0.0.1:18800:18800`, matching the pattern established by dufs and code-server.

### 2. Nginx Removal

**Delete:**

- `lib/nginx.ts` — vhost generation, config writing, reload functions (~107 lines)
- `tests/lib/nginx.test.ts` — associated tests (~72 lines)
- `os/sysconfig/bloom-nginx.conf` — main nginx config
- `os/sysconfig/bloom-status.html` — nginx default landing page
- From `os/Containerfile`:
  - `dnf install nginx` and `systemctl enable nginx`
  - `COPY os/sysconfig/bloom-nginx.conf /etc/nginx/conf.d/bloom.conf`
  - `COPY os/sysconfig/bloom-status.html /usr/share/nginx/html/index.html`
  - `setsebool -P httpd_can_network_connect 1` (nginx-specific SELinux boolean)

**Modify:**

- `lib/service-routing.ts` — remove nginx integration, becomes DNS-only (~89 → ~40 lines). Remove the `nginx` field from `RoutingResult` type.
- `tests/lib/service-routing.test.ts` — simplify to DNS-only tests
- `extensions/bloom-services/actions-install.ts` — `ensureServiceRouting()` call stays but only does DNS
- `services/catalog.yaml` — remove `websocket` field (was nginx-specific), keep `port`

### 3. Firewall (No Change)

Current configuration is sufficient:

```
firewall-offline-cmd --zone=trusted --add-interface=wt0
```

The trusted zone on `wt0` allows all mesh traffic. Other interfaces remain in the default zone which blocks incoming connections. Services using `Network=host` bind to all interfaces, but the firewall blocks non-mesh access. This is the right trade-off for a single-user mesh. Per-port policies can be added later via NetBird's access control API if multi-user support is needed.

### 4. Service Access URLs

URLs change to include the service port:

| Service | URL |
|---------|-----|
| Cinny | `http://cinny.bloom.mesh:18810` |
| Dufs | `http://dufs.bloom.mesh:5000` |
| Code Server | `http://code-server.bloom.mesh:8443` |
| Matrix API | `http://bloom.mesh:6167/_matrix/` |

Path-based fallback routes (`/cinny/`, `/_matrix/` on port 80) are removed. All access is subdomain+port.

**Update locations:**

- `extensions/bloom-services/actions-install.ts` — install success message should print full URL with port
- `services/cinny/cinny-config.json` — change `"homeserverList": ["/"]` to `"homeserverList": ["http://bloom.mesh:6167"]` (the relative path `/` only worked because nginx served both Cinny and Matrix on port 80)
- `skills/service-management/SKILL.md` — update service URL references
- `skills/first-boot/SKILL.md` — update service URL references

### 5. No Impact Areas

- `lib/netbird.ts` — untouched, DNS zone/record management unchanged
- Internal service communication (bridges → Matrix on localhost) — unchanged
- NetBird mesh setup flow — unchanged

## Security Model

| Layer | What it does |
|-------|-------------|
| WireGuard (NetBird) | Encrypts all mesh traffic, authenticates peers |
| Firewall (firewalld) | Only `wt0` interface in trusted zone; other interfaces blocked by default zone |
| Host networking | Services bind `0.0.0.0` but only reachable via trusted `wt0` interface |

No data traverses the network unencrypted. No service is reachable from outside the mesh. Local access (e.g., via SSH) works via `localhost:{port}`.

## Future Extension

NetBird's management API supports access control policies (per-peer, per-port, per-protocol) and posture checks (geo, network range, process). These can be layered on when multi-user or multi-trust-level access is needed, without architectural changes to this design.

## Net Impact

- **~180 lines deleted** (nginx code, tests, config)
- **~50 lines simplified** (service-routing becomes DNS-only)
- **1 OS dependency removed** (nginx package)
- **1 systemd service removed** (nginx.service)
- **0 new dependencies added**
