# Container & systemd Conventions

Rules for Containerfiles, Quadlet units (.container, .volume, .network), systemd units (.service, .timer, .socket), and podman usage.

## Rules

### Containerfile
1. **Always `Containerfile`**, never `Dockerfile`. Always `podman`, never `docker`.
2. **Pin base images** with digest when stability matters: `FROM image@sha256:...`
3. **Group related RUN commands** to minimize layers. Separate groups with blank lines and a comment explaining the group's purpose.
4. **Clean package caches** in the same RUN that installs them: `&& dnf clean all && rm -rf /var/cache/...`
5. **Cache-friendly ordering**: dependencies (package.json, lock files) before source code. Source changes shouldn't invalidate dependency layers.
6. **ARG for versions**: Pin tool versions with ARG at the top of the relevant section. Makes updates visible and grep-able.
7. **LABEL at the end** (after all build steps, before final validation).
8. **Comments on non-obvious steps.** Each major section gets a one-line comment.

### Quadlet (.container, .volume, .network)
9. **Naming**: `bloom-{name}` for ContainerName, unit file, and volume.
10. **Host networking**: Use `Network=host` for all services.
11. **Health checks required** on every container: `HealthCmd`, `HealthInterval`, `HealthRetries`, `HealthTimeout`, `HealthStartPeriod`.
12. **Resource limits**: Set `PodmanArgs=--memory=` appropriate to the service.
13. **Security**: `NoNewPrivileges=true`, `PodmanArgs=--security-opt label=disable` only when volume mounts require it.
14. **Restart policy**: `Restart=on-failure`, `RestartSec=10` minimum.
15. **Volumes for state**: Service data persists in named volumes, not bind mounts (unless sharing with host is required).

### systemd (.service, .timer, .socket)
16. **Unit naming**: `bloom-{name}.service`, consistent with Quadlet naming.
17. **Dependencies**: Use `After=` and `Wants=` to declare ordering. `network-online.target` for anything needing network.
18. **Restart policy**: `Restart=on-failure` with `RestartSec=` for services.
19. **User field**: Run as `pi` user, not root, unless elevated privileges are required (document why).

## Patterns

```ini
# Good: Quadlet container with all required fields
[Unit]
Description=Bloom dufs — WebDAV file server for home directory
After=network-online.target
Wants=network-online.target

[Container]
Image=docker.io/sigoden/dufs:latest
ContainerName=bloom-dufs
Network=host
Volume=%h:/data
PodmanArgs=--memory=128m
PodmanArgs=--security-opt label=disable
NoNewPrivileges=true
LogDriver=journald

[Service]
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target
```

```dockerfile
# Good: Containerfile layer ordering
# Install deps first (cached unless package.json changes)
COPY package.json package-lock.json /app/
RUN cd /app && npm install

# Copy source (re-runs on changes, but deps are cached)
COPY . /app/
RUN cd /app && npm run build
```

## Anti-patterns

```dockerfile
# Bad: Dockerfile naming
# Bad: docker CLI usage
docker build -f Dockerfile ...

# Bad: no cache cleanup
RUN dnf install -y git curl wget

# Bad: source before deps (cache-busting)
COPY . /app/
RUN npm install && npm run build
```

```ini
# Bad: no health check
[Container]
Image=localhost/bloom-foo:latest
ContainerName=bloom-foo

# Bad: no restart policy
[Service]
ExecStart=/usr/bin/foo

# Bad: no memory limit
[Container]
PodmanArgs=--security-opt label=disable
```
