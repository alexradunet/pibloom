import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export function agentDir() {
  return join(process.env.HOME || "/tmp", ".pi", "agent");
}

export function atomicWriteText(filePath: string, content: string) {
  mkdirSync(dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  writeFileSync(tmpPath, content, "utf-8");
  renameSync(tmpPath, filePath);
}

// `host: <name> (fleet|external)` — used for the session_start status line.
// Kept inline (no separate fleet helpers) since `nixpi-context` is the canonical
// fleet/host source and gets injected into every system prompt.
export function formatFleetHostStatus() {
  const host = currentHost();
  return `host: ${host} (${isFleetHost(host) ? "fleet" : "external"})`;
}

function currentHost(): string {
  const env = process.env.NIXPI_WIKI_HOST?.trim() || process.env.HOSTNAME?.trim();
  if (env) return env;
  try {
    const h = readFileSync("/etc/hostname", "utf-8").trim();
    if (h) return h;
  } catch { /* fall through */ }
  return "nixos";
}

function isFleetHost(host: string): boolean {
  const root = process.env.NIXPI_ROOT ?? join(process.env.HOME || "/tmp", "NixPI");
  try {
    return readdirSync(join(root, "hosts"), { withFileTypes: true })
      .some((e) => e.isDirectory() && e.name === host && existsSync(join(root, "hosts", host, "default.nix")));
  } catch {
    return false;
  }
}
