# Security Model

> Security perimeter and threat model

## Core Security Model

NixPI no longer ships an HTTP terminal surface. The supported operator paths are:

- SSH for remote administration
- local terminal login on monitor-attached hardware
- optional Headscale-managed admin tailnet for a private management overlay

## Network Exposure

By default, the host keeps:

- SSH reachable for the primary operator
- the Headscale HTTPS and STUN ports reachable on the dedicated control-plane host when the admin tailnet is self-hosted
- no built-in HTTP/HTTPS Pi surface

## What The Admin Tailnet Protects

The admin tailnet remains the preferred private management network for operator devices and future trusted-service traffic. It is not required for the local shell runtime to function.

## Threat Actors Within Scope

1. **Compromised SSH client or admin device**
2. **Compromised device on the admin tailnet**
3. **Template forker who deploys without verifying shell-access hardening**

## Agent Privilege Boundary

- The primary operator account is the normal human and Pi runtime identity
- Interactive Pi state lives in `~/.pi`, while service and secret state lives under `/var/lib/nixpi`
- Privileged actions are routed through the root-owned `nixpi-broker` service
