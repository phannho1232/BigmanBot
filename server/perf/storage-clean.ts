import { existsSync, lstatSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const CHROME_CACHE_DIRS: ReadonlySet<string> = new Set([
  "Cache", "Code Cache", "GPUCache", "DawnCache", "DawnGraphiteCache", "DawnWebGPUCache", "GraphiteDawnCache", "GrShaderCache", "ShaderCache",
  "component_crx_cache", "extensions_crx_cache", "optimization_guide_model_store", "Crashpad", "BrowserMetrics", "Safe Browsing",
  "OnDeviceHeadSuggestModel", "screen_ai",
]);

const SERVICE_WORKER_CACHE_DIRS: ReadonlySet<string> = new Set(["CacheStorage", "ScriptCache"]);

const HOME_CACHE_NAMES: readonly string[] = ["pip", "uv", "pnpm", "yarn", "node-gyp", "npm", "bun", "pypoetry", "go-build"];

const HOME_PACKAGE_PATHS: ReadonlyArray<readonly string[]> = [
  [".npm", "_cacache"],
  [".pnpm-store"],
  [".local", "share", "pnpm", "store"],
  [".bun", "install", "cache"],
  [".cargo", "registry", "cache"],
  [".cargo", "git", "db"],
  [".yarn", "berry", "cache"],
  [".gradle", "caches"],
];

export interface CleanStorageOptions {
  dataDir: string;
  home: string;
  includeHomeCaches: boolean;
  busy: () => boolean;
  knownBotIds: ReadonlySet<string>;
  knownThreadIds: ReadonlySet<string>;
}

export interface CleanStorageResult {
  ok: boolean;
  busy?: boolean;
  freedBytes: number;
  removedEntries: number;
}

function measurePlainTree(target: string): number {
  let stat;
  try { stat = lstatSync(target); } catch { return 0; }
  if (stat.isSymbolicLink()) return 0;
  if (stat.isFile()) return stat.size;
  if (!stat.isDirectory()) return 0;
  let total = 0;
  let names: string[];
  try { names = readdirSync(target); } catch { return 0; }
  for (const name of names) total += measurePlainTree(join(target, name));
  return total;
}

function removePlainPath(target: string): { bytes: number; removed: number } {
  let stat;
  try { stat = lstatSync(target); } catch { return { bytes: 0, removed: 0 }; }
  if (stat.isSymbolicLink()) return { bytes: 0, removed: 0 };
  const bytes = measurePlainTree(target);
  try {
    rmSync(target, { recursive: true, force: true });
    return { bytes, removed: 1 };
  } catch {
    return { bytes: 0, removed: 0 };
  }
}

function safeReaddir(dir: string): string[] {
  try {
    return existsSync(dir) && lstatSync(dir).isDirectory() && !lstatSync(dir).isSymbolicLink() ? readdirSync(dir) : [];
  } catch {
    return [];
  }
}

function cleanBrowserProfileCaches(profileDir: string, add: (res: { bytes: number; removed: number }) => void): void {
  for (const sub of ["", "Default"]) {
    const base = sub ? join(profileDir, sub) : profileDir;
    for (const name of safeReaddir(base)) {
      if (CHROME_CACHE_DIRS.has(name)) add(removePlainPath(join(base, name)));
    }
    const sw = join(base, "Service Worker");
    for (const name of safeReaddir(sw)) {
      if (SERVICE_WORKER_CACHE_DIRS.has(name)) add(removePlainPath(join(sw, name)));
    }
  }
}

function cleanTaskWorkspaceInstalls(dir: string, depth: number, add: (res: { bytes: number; removed: number }) => void): void {
  if (depth > 3) return;
  for (const name of safeReaddir(dir)) {
    const full = join(dir, name);
    let stat;
    try { stat = lstatSync(full); } catch { continue; }
    if (stat.isSymbolicLink() || !stat.isDirectory()) continue;
    if (name === "node_modules" || name === ".pnpm-store" || name === ".next" || name === ".turbo" || name === "__pycache__" || name === ".pytest_cache") {
      add(removePlainPath(full));
    } else if (!name.startsWith(".")) {
      cleanTaskWorkspaceInstalls(full, depth + 1, add);
    }
  }
}

export function cleanWorkspaceStorage(options: CleanStorageOptions): CleanStorageResult {
  if (options.busy()) return { ok: false, busy: true, freedBytes: 0, removedEntries: 0 };
  const dataDir = resolve(options.dataDir);
  let freedBytes = 0;
  let removedEntries = 0;
  const add = (res: { bytes: number; removed: number }) => {
    freedBytes += res.bytes;
    removedEntries += res.removed;
  };

  for (const rel of [
    ["tmp"], [".tmp"], ["tunnel-runtime"], ["box-uploads"], ["browser-uploads"],
    ["browser", "temp"], ["cache", "trash"], ["sync", "trash"], ["sync", "uploads"],
    ["engine-homes", ".held"], ["doctor-backups"], ["tools", "npm-home", "cache"],
  ]) {
    add(removePlainPath(join(dataDir, ...rel)));
  }

  for (const name of safeReaddir(dataDir)) {
    if (/\.\d+\.[0-9a-f-]{36}\.tmp$/.test(name)) add(removePlainPath(join(dataDir, name)));
  }

  const toolsDir = join(dataDir, "tools");
  for (const name of safeReaddir(toolsDir)) {
    if (name.startsWith(".npm-staging-") || name.startsWith(".npm-aside-") || name.startsWith(".staging-")) {
      add(removePlainPath(join(toolsDir, name)));
    }
  }

  for (const profileRoot of [join(dataDir, "browser", "profiles"), join(dataDir, "agent-browser-profiles")]) {
    for (const profile of safeReaddir(profileRoot)) cleanBrowserProfileCaches(join(profileRoot, profile), add);
  }
  if (existsSync(join(dataDir, "chrome-profile"))) cleanBrowserProfileCaches(join(dataDir, "chrome-profile"), add);

  for (const botFolder of ["workspaces", "bots"] as const) {
    const root = join(dataDir, botFolder);
    for (const botId of safeReaddir(root)) {
      if (!options.knownBotIds.has(botId)) add(removePlainPath(join(root, botId)));
      else if (botFolder === "bots") add(removePlainPath(join(root, botId, "data-tmp")));
    }
  }

  const taskWorkspaces = join(dataDir, "task-workspaces");
  for (const botId of safeReaddir(taskWorkspaces)) {
    const botDir = join(taskWorkspaces, botId);
    if (!options.knownBotIds.has(botId)) {
      add(removePlainPath(botDir));
      continue;
    }
    for (const threadId of safeReaddir(botDir)) {
      const threadDir = join(botDir, threadId);
      if (!options.knownThreadIds.has(threadId)) add(removePlainPath(threadDir));
      else cleanTaskWorkspaceInstalls(threadDir, 0, add);
    }
  }

  const toolResults = join(dataDir, "tool-results");
  for (const threadId of safeReaddir(toolResults)) {
    if (!options.knownThreadIds.has(threadId)) add(removePlainPath(join(toolResults, threadId)));
  }

  for (const logFolder of ["events", "native"] as const) {
    const root = join(dataDir, logFolder);
    for (const file of safeReaddir(root)) {
      if (!file.endsWith(".ndjson")) continue;
      const threadId = file.slice(0, -".ndjson".length);
      if (threadId && !options.knownThreadIds.has(threadId)) add(removePlainPath(join(root, file)));
    }
  }

  const backupsRoot = join(dataDir, ".backups");
  if (existsSync(backupsRoot) && ! existsSync(join(backupsRoot, "pending-restore.json"))) {
    let activeJournalId: string | null = null;
    try {
      const journal = JSON.parse(readFileSync(join(backupsRoot, "restore-journal.json"), "utf8")) as { id?: unknown; phase?: unknown };
      if (journal.phase === "applying" && typeof journal.id === "string") activeJournalId = journal.id;
    } catch {}
    for (const name of safeReaddir(backupsRoot)) {
      if (name.endsWith(".json") || (activeJournalId && (name === activeJournalId || name === `safety-${activeJournalId}`))) continue;
      add(removePlainPath(join(backupsRoot, name)));
    }
  }

  if (options.includeHomeCaches) {
    const home = resolve(options.home);
    for (const parts of HOME_PACKAGE_PATHS) add(removePlainPath(join(home, ...parts)));
    const dotCache = join(home, ".cache");
    for (const name of HOME_CACHE_NAMES) add(removePlainPath(join(dotCache, name)));
  }

  return { ok: true, freedBytes, removedEntries };
}
