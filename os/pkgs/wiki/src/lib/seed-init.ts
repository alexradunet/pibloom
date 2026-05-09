import { copyFileSync, existsSync, mkdirSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { rebuildAllMeta } from "../wiki/actions-meta.ts";

export interface InitWikiOptions {
  root: string;
  workspace: string;
  domain: string;
}

export interface InitWikiStats {
  root: string;
  workspace: string;
  domain: string;
  seedDir: string;
  copiedFiles: number;
  skippedFiles: number;
  createdDirs: number;
  pages: number;
}

export function expandHome(value: string): string {
  if (value === "~") return os.homedir();
  if (value.startsWith(`~${path.sep}`) || value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

export function absolutePath(value: string): string {
  return path.resolve(expandHome(value));
}

function packageRootCandidate(): string | undefined {
  const scriptPath = process.argv[1];
  if (!scriptPath) return undefined;
  try {
    const realScriptPath = realpathSync(scriptPath);
    const scriptDir = path.dirname(realScriptPath);
    const basename = path.basename(scriptDir);
    if (basename === "dist" || basename === "src") return path.dirname(scriptDir);
    return scriptDir;
  } catch {
    return undefined;
  }
}

export function findSeedDir(): string {
  const packageRoot = packageRootCandidate();
  const candidates = [
    packageRoot ? path.join(packageRoot, "seed") : undefined,
    path.resolve(process.cwd(), "seed"),
  ].filter((entry): entry is string => Boolean(entry));

  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, "WIKI_SCHEMA.md")) && existsSync(path.join(candidate, "templates", "markdown"))) {
      return candidate;
    }
  }

  throw new Error(`Could not locate bundled ownloom wiki seed. Checked: ${candidates.join(", ")}`);
}

function ensureDirectory(dir: string): boolean {
  if (existsSync(dir)) {
    if (!statSync(dir).isDirectory()) throw new Error(`Path exists but is not a directory: ${dir}`);
    return false;
  }
  mkdirSync(dir, { recursive: true });
  return true;
}

function copySeedMissing(srcDir: string, destDir: string, stats: InitWikiStats): void {
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    const src = path.join(srcDir, entry.name);
    const dest = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      if (ensureDirectory(dest)) stats.createdDirs += 1;
      copySeedMissing(src, dest, stats);
      continue;
    }
    if (!entry.isFile()) continue;
    if (existsSync(dest)) {
      stats.skippedFiles += 1;
      continue;
    }
    ensureDirectory(path.dirname(dest));
    copyFileSync(src, dest);
    stats.copiedFiles += 1;
  }
}

function writeFileIfMissing(filePath: string, content: string, stats: InitWikiStats): void {
  if (existsSync(filePath)) {
    stats.skippedFiles += 1;
    return;
  }
  ensureDirectory(path.dirname(filePath));
  writeFileSync(filePath, content, "utf8");
  stats.copiedFiles += 1;
}

function canonicalWikiDirs(root: string): string[] {
  return [
    "daily",
    "objects",
    "sources",
    "types",
    "meta/about-alex",
    "meta/audit",
    "meta/events",
    "raw",
  ].map((relativePath) => path.join(root, relativePath));
}

export function initWikiRoot(options: InitWikiOptions): InitWikiStats {
  const root = absolutePath(options.root);
  const seedDir = findSeedDir();
  const stats: InitWikiStats = {
    root,
    workspace: options.workspace,
    domain: options.domain,
    seedDir,
    copiedFiles: 0,
    skippedFiles: 0,
    createdDirs: 0,
    pages: 0,
  };

  if (ensureDirectory(root)) stats.createdDirs += 1;
  copySeedMissing(seedDir, root, stats);
  for (const dir of canonicalWikiDirs(root)) {
    if (ensureDirectory(dir)) stats.createdDirs += 1;
  }
  writeFileIfMissing(path.join(root, ".gitignore"), [
    "# ownloom Wiki generated metadata",
    "meta/registry.json",
    "meta/backlinks.json",
    "meta/index.md",
    "meta/log.md",
    "meta/fts.db",
    "",
  ].join("\n"), stats);

  const artifacts = rebuildAllMeta(root);
  stats.pages = artifacts.registry.pages.length;
  return stats;
}

export function renderInitText(stats: InitWikiStats): string {
  return [
    `Initialized ownloom wiki root: ${stats.root}`,
    `Seed: ${stats.seedDir}`,
    `Workspace hint: ${stats.workspace}`,
    `Default domain hint: ${stats.domain}`,
    `Files copied: ${stats.copiedFiles}; existing files kept: ${stats.skippedFiles}; directories created: ${stats.createdDirs}`,
    `Pages indexed: ${stats.pages}`,
    "",
    "Next shell setup:",
    `  export OWNLOOM_WIKI_ROOT=${JSON.stringify(stats.root)}`,
    `  export OWNLOOM_WIKI_WORKSPACE=${JSON.stringify(stats.workspace)}`,
    `  export OWNLOOM_WIKI_DEFAULT_DOMAIN=${JSON.stringify(stats.domain)}`,
    "",
    "Next checks:",
    "  ownloom-wiki context --format markdown",
    "  ownloom-wiki doctor --json",
  ].join("\n");
}
