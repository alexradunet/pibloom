import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type SavedContext = { savedAt: string; host?: string; cwd?: string };

function agentDir(): string {
  return process.env.OWNLOOM_AGENT_DIR
    ?? process.env.PI_CODING_AGENT_DIR
    ?? join(process.env.HOME || "/tmp", ".pi", "agent");
}

export function saveContext(data: SavedContext): void {
  const filePath = join(agentDir(), "context.json");
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
}

export function buildCompactionContext(cwd: string): SavedContext {
  return {
    savedAt: new Date().toISOString(),
    host: process.env.HOSTNAME || undefined,
    cwd,
  };
}
