---
layout: home

hero:
  name: NixPI
  text: Headless AI companion OS on NixOS
  tagline: A simple, self-hosted system for running Pi on a VPS you control.
  image:
    src: /nixpi-mark.svg
    alt: NixPI
  actions:
    - theme: brand
      text: Install
      link: /install
    - theme: alt
      text: Getting Started
      link: /getting-started/
    - theme: alt
      text: Architecture
      link: /architecture/

features:
  - title: VPS-first and headless
    details: Deploy to a remote NixOS-capable VPS and operate through one web app.
  - title: Canonical checkout
    details: Use `/srv/nixpi` as the source of truth for updates and rebuilds.
  - title: Minimal by default
    details: Keep the base system small and evolve it with Pi runtime extensions.
  - title: Operable
    details: Built around NixOS, systemd, and file-native state for inspection and recovery.
---

## Start here

- [Install](./install)
- [Getting Started](./getting-started/)
- [Operations](./operations/)
- [Reference](./reference/)
