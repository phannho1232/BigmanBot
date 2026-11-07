// Official Node.js LTS archive installed on demand into tools/standalone/node/<version>/ when the host has no npm on
// PATH. Its bin folder is registered as a fallback PATH entry so a user-installed Node.js always takes precedence.
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync, createReadStream, existsSync, lstatSync, openSync, readdirSync, readFileSync, readSync, renameSync, rmSync, unlinkSync,
} from "node:fs";
import { chmod, lstat, mkdir, open, readdir, rename, rm, stat, symlink, unlink, writeFile, type FileHandle } from "node:fs/promises";
import { dirname, join } from "node:path";
import { stripVTControlCharacters } from "node:util";

import { cliProbeEnvironment } from "./cli-probe.ts";
import { DATA_DIR, stripControlPlaneEnv } from "./config.ts";
import type { StandaloneAsset, StandaloneRelease } from "./contracts.ts";
import {
  plainInstallError, STANDALONE_DOWNLOAD_TIMEOUT_MS, standaloneEngineDir, standalonePlatformKey, standaloneRoot,
} from "./engine-standalone.ts";
import { registerFallbackPathDir, resetPathCache } from "./env-path.ts";
import { userError, userErrorFields } from "./user-errors.ts";
import { extractZip, safeArchivePath } from "./zip-archive.ts";

export const NODE_VERSION = "24.22.2";
const NODE_NAME = "Node.js";
const NODE_ENGINE = "node";
const NODE_HOSTS = ["nodejs.org"] as const;

const STALL_TIMEOUT_MS = 60_000;
const PROBE_TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 5;
const MAX_ZIP_MEMBERS = 10_000;
const RECORD = ".node-install.json";
const DOWNLOAD_PREFIX = ".download-";
const STAGING_PREFIX = ".staging-";
const OLD_PREFIX = ".old-";
const SHA256 = /^[0-9a-f]{64}$/u;

export interface PortableNodeAsset {
  url: string;
  sha256: string;
  executableSha256: string;
  archive: "tar.gz" | "zip";
  rootDir: string;
  approxBytes: number;
  hosts?: readonly string[];
}

export interface PortableNodeInstalled {
  version: string;
  binDir: string;
  executablePath: string;
}

export interface PortableNodeInstallOptions {
  baseDir?: string;
  platformKey?: string;
  asset?: PortableNodeAsset;
  fetchImpl?: typeof fetch;
  probe?: (executable: string) => Promise<string | null>;
  timeoutMs?: number;
  stallMs?: number;
}

interface NodeInstallRecord {
  version: string;
  sha256: string;
  rootDir: string;
  executableSha256: string;
  installedAt: number;
}

class PortableNodeInstallError extends Error {}

export const NODE_ASSETS: Readonly<Record<string, PortableNodeAsset>> = {
  "darwin-arm64": {
    url: `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-darwin-arm64.tar.gz`,
    sha256: "aa9549349e47dffaa42dcf95d6e06ade8c4bdafc980979883b88767670df385a",
    executableSha256: "b6fb419f0f43bb2fbca273700294dd2f3b685a64b60e8417c295f47646a70e4a",
    archive: "tar.gz",
    rootDir: `node-v${NODE_VERSION}-darwin-arm64`,
    approxBytes: 53_068_959,
  },
  "darwin-x64": {
    url: `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-darwin-x64.tar.gz`,
    sha256: "d5e336d588c45be0c37dbd52cc29895593009ca4997a77a1fd02815131ed0e52",
    executableSha256: "bdcd4500054d48c9ec6058706795d91cac83e3e3eaced218434294d8f2fbf7fa",
    archive: "tar.gz",
    rootDir: `node-v${NODE_VERSION}-darwin-x64`,
    approxBytes: 54_383_415,
  },
  "linux-x64": {
    url: `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.gz`,
    sha256: "361718c444e49af2ca5a110c83ba6a8901143f23ab285ebbef0341f391f482a9",
    executableSha256: "904a6d3484241d466989f9df9ba3aab822b1496191bdb28230eb491a55c32a52",
    archive: "tar.gz",
    rootDir: `node-v${NODE_VERSION}-linux-x64`,
    approxBytes: 58_299_872,
  },
  "linux-arm64": {
    url: `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-arm64.tar.gz`,
    sha256: "95c264150aceb7f3437a29fd6984924f5f8d1511ea3cbd6c508b83f6c555dae2",
    executableSha256: "b4855de8c4781130b722ceaec9718fed77cca3eed2e5cfc5455e267c0b9ee3b0",
    archive: "tar.gz",
    rootDir: `node-v${NODE_VERSION}-linux-arm64`,
    approxBytes: 58_030_966,
  },
  "linux-x64-musl": {
    url: `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64-musl.tar.gz`,
    sha256: "11ebd16c8d7819c0675211225505273d7aea305a8dd85a9c0aeb1fbec2343320",
    executableSha256: "9b75d31f8196298cc32d3c75eb27f2834737da5fde0794b9639354f4e02b1909",
    archive: "tar.gz",
    rootDir: `node-v${NODE_VERSION}-linux-x64-musl`,
    approxBytes: 60_886_654,
  },
  "win32-x64": {
    url: `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-win-x64.zip`,
    sha256: "ca1bff5d8ead13c9f2ea404a176db46bd430704d5b5113734049fa365e7799e2",
    executableSha256: "1c331340fa6cac5e4294725959070a143fa0507195a78ad77eed7943f719aac9",
    archive: "zip",
    rootDir: `node-v${NODE_VERSION}-win-x64`,
    approxBytes: 37_754_834,
  },
  "win32-arm64": {
    url: `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-win-arm64.zip`,
    sha256: "f47968c213105077f64c6510f007632c0ca2574802a0b5067c327c49abe1c468",
    executableSha256: "e2d6e75a0bfe4c176316d7c732eb8def9d94570c759eaeab335473a015abb7ea",
    archive: "zip",
    rootDir: `node-v${NODE_VERSION}-win-arm64`,
    approxBytes: 33_789_289,
  },
};

const running = new Map<string, Promise<PortableNodeInstalled>>();

export function portableNodeAssetFor(key: string = standalonePlatformKey()): PortableNodeAsset | null {
  return Object.hasOwn(NODE_ASSETS, key) ? NODE_ASSETS[key] ?? null : null;
}

export function portableNodeAvailable(key: string = standalonePlatformKey()): boolean {
  return portableNodeAssetFor(key) !== null;
}

export function portableNodeEngineDir(baseDir = DATA_DIR): string {
  return standaloneEngineDir(NODE_ENGINE, baseDir);
}

function binDirIn(versionDir: string, asset: PortableNodeAsset): string {
  return asset.archive === "zip" ? join(versionDir, asset.rootDir) : join(versionDir, asset.rootDir, "bin");
}

function nodeExecutableIn(versionDir: string, asset: PortableNodeAsset): string {
  return join(binDirIn(versionDir, asset), asset.archive === "zip" ? "node.exe" : "node");
}

function npmCliScriptIn(versionDir: string, asset: PortableNodeAsset): string {
  return asset.archive === "zip"
    ? join(versionDir, asset.rootDir, "node_modules", "npm", "bin", "npm-cli.js")
    : join(versionDir, asset.rootDir, "lib", "node_modules", "npm", "bin", "npm-cli.js");
}

function npxCliScriptIn(versionDir: string, asset: PortableNodeAsset): string {
  return asset.archive === "zip"
    ? join(versionDir, asset.rootDir, "node_modules", "npm", "bin", "npx-cli.js")
    : join(versionDir, asset.rootDir, "lib", "node_modules", "npm", "bin", "npx-cli.js");
}

function realFile(path: string): boolean {
  try {
    return lstatSync(path).isFile();
  } catch {
    return false;
  }
}

function realDirectory(path: string): boolean {
  try {
    return lstatSync(path).isDirectory();
  } catch {
    return false;
  }
}

function readRecord(versionDir: string): NodeInstallRecord | null {
  const path = join(versionDir, RECORD);
  if (!realFile(path)) return null;
  try {
    const record = JSON.parse(readFileSync(path, "utf8")) as Partial<NodeInstallRecord> | null;
    if (
      !record || typeof record.version !== "string" || typeof record.sha256 !== "string"
      || typeof record.rootDir !== "string" || !safeArchivePath(record.rootDir)
      || typeof record.executableSha256 !== "string" || !SHA256.test(record.executableSha256)
    ) return null;
    return record as NodeInstallRecord;
  } catch {
    return null;
  }
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

function hashFileSync(path: string): string {
  const hash = createHash("sha256");
  const fd = openSync(path, "r");
  try {
    const buffer = Buffer.allocUnsafe(1 << 20);
    for (let read = readSync(fd, buffer, 0, buffer.length, null); read > 0; read = readSync(fd, buffer, 0, buffer.length, null)) {
      hash.update(buffer.subarray(0, read));
    }
  } finally {
    closeSync(fd);
  }
  return hash.digest("hex");
}

function sweepLeftovers(engineDir: string): void {
  let names: string[];
  try {
    names = readdirSync(engineDir);
  } catch {
    return;
  }
  for (const name of names) {
    const path = join(engineDir, name);
    try {
      if (name.startsWith(OLD_PREFIX)) {
        const version = realDirectory(path) ? readRecord(path)?.version : undefined;
        if (version && !existsSync(join(engineDir, version))) {
          renameSync(path, join(engineDir, version));
          continue;
        }
      } else if (!name.startsWith(DOWNLOAD_PREFIX) && !name.startsWith(STAGING_PREFIX)) {
        continue;
      }
      if (lstatSync(path).isDirectory()) rmSync(path, { recursive: true, force: true });
      else unlinkSync(path);
    } catch {}
  }
}

function verifiedBootInstall(engineDir: string, asset: PortableNodeAsset): PortableNodeInstalled | null {
  const versionDir = join(engineDir, NODE_VERSION);
  if (!realDirectory(versionDir)) return null;
  const record = readRecord(versionDir);
  if (
    !record || record.version !== NODE_VERSION || record.sha256 !== asset.sha256
    || record.rootDir !== asset.rootDir || record.executableSha256 !== asset.executableSha256
  ) return null;
  const binDir = binDirIn(versionDir, asset);
  const executablePath = nodeExecutableIn(versionDir, asset);
  if (!realDirectory(binDir) || !realFile(executablePath) || !realFile(npmCliScriptIn(versionDir, asset))) return null;
  if (asset.archive === "zip" && !realFile(join(binDir, "npm.cmd"))) return null;
  try {
    if (hashFileSync(executablePath) !== asset.executableSha256) return null;
  } catch {
    return null;
  }
  return { version: NODE_VERSION, binDir, executablePath };
}

/** At boot: puts the verified Portable Node bin folder at the end of PATH so previously installed npm CLIs can run. */
export function registerPortableNodeBinDir(
  baseDir = DATA_DIR,
  key: string = standalonePlatformKey(),
  assetOverride?: PortableNodeAsset,
): void {
  const asset = assetOverride ?? portableNodeAssetFor(key);
  if (!asset || !realDirectory(standaloneRoot(baseDir))) return;
  const engineDir = portableNodeEngineDir(baseDir);
  if (!realDirectory(engineDir)) return;
  try {
    sweepLeftovers(engineDir);
    const installed = verifiedBootInstall(engineDir, asset);
    if (installed) registerFallbackPathDir(installed.binDir);
  } catch (error) {
    console.warn(`portable node: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function trustedUrl(url: URL, hosts: readonly string[]): boolean {
  return url.protocol === "https:" && !url.username && !url.password && (url.port === "" || url.port === "443")
    && hosts.includes(url.hostname);
}

async function writeAll(handle: FileHandle, chunk: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < chunk.length) {
    const { bytesWritten } = await handle.write(chunk, offset, chunk.length - offset, null);
    if (bytesWritten <= 0) throw new Error("The download could not be written to disk.");
    offset += bytesWritten;
  }
}

function httpRefusal(status: number): PortableNodeInstallError {
  if (status === 404 || status === 410) return Object.assign(new PortableNodeInstallError(`This version of ${NODE_NAME} is no longer available to download. Update OpenMausBot, then try again.`), userErrorFields(userError("serverError.install.versionGone", { name: NODE_NAME })));
  if (status === 403 || status === 429) return Object.assign(new PortableNodeInstallError("The download site is limiting downloads right now. Try again in a few minutes."), userErrorFields(userError("serverError.install.downloadLimited")));
  if (status >= 500) return Object.assign(new PortableNodeInstallError(`${NODE_NAME}'s download site isn't answering right now. Try again later.`), userErrorFields(userError("serverError.install.siteNotAnswering", { name: NODE_NAME })));
  return Object.assign(new PortableNodeInstallError(`${NODE_NAME} couldn't be downloaded. Check the internet connection and try again.`), userErrorFields(userError("serverError.install.downloadFailed", { name: NODE_NAME })));
}

async function downloadNodeArchive(asset: PortableNodeAsset, destination: string, options: PortableNodeInstallOptions): Promise<void> {
  const hosts = asset.hosts ?? NODE_HOSTS;
  const cap = asset.approxBytes * 2;
  const tooLarge = () => Object.assign(new PortableNodeInstallError(`The ${NODE_NAME} download was larger than expected, so it was stopped. Nothing was installed.`), userErrorFields(userError("serverError.install.downloadTooLarge", { name: NODE_NAME })));
  const controller = new AbortController();
  let timedOut = false;
  let stalled = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs ?? STANDALONE_DOWNLOAD_TIMEOUT_MS);
  timer.unref?.();
  let stallTimer: NodeJS.Timeout | undefined;
  const progressed = () => {
    clearTimeout(stallTimer);
    stallTimer = setTimeout(() => {
      stalled = true;
      controller.abort();
    }, options.stallMs ?? STALL_TIMEOUT_MS);
    stallTimer.unref?.();
  };
  try {
    let url = new URL(asset.url);
    let response: Response;
    for (let hop = 0; ; hop += 1) {
      if (!trustedUrl(url, hosts)) {
        throw Object.assign(new PortableNodeInstallError(`The ${NODE_NAME} download did not come from its official site, so it was stopped. Nothing was installed.`), userErrorFields(userError("serverError.install.unofficialDownload", { name: NODE_NAME })));
      }
      progressed();
      response = await (options.fetchImpl ?? fetch)(url.href, { redirect: "manual", signal: controller.signal });
      if (response.status < 300 || response.status >= 400) break;
      const location = response.headers.get("location");
      await response.body?.cancel().catch(() => {});
      if (!location || hop >= MAX_REDIRECTS) {
        throw Object.assign(new PortableNodeInstallError(`The ${NODE_NAME} download kept redirecting, so it was stopped. Nothing was installed.`), userErrorFields(userError("serverError.install.redirects", { name: NODE_NAME })));
      }
      url = new URL(location, url);
    }
    if (!response.ok || !response.body) {
      await response.body?.cancel().catch(() => {});
      throw httpRefusal(response.status);
    }
    const declared = Number(response.headers.get("content-length") ?? Number.NaN);
    if (Number.isFinite(declared) && declared > cap) throw tooLarge();
    const hash = createHash("sha256");
    const handle = await open(destination, "wx", 0o600);
    let received = 0;
    try {
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        progressed();
        received += chunk.byteLength;
        if (received > cap) throw tooLarge();
        hash.update(chunk);
        await writeAll(handle, chunk);
      }
    } finally {
      await handle.close();
    }
    if (hash.digest("hex") !== asset.sha256) {
      throw Object.assign(new PortableNodeInstallError(`The ${NODE_NAME} download failed its safety check, so nothing was installed. Try again later.`), userErrorFields(userError("serverError.install.safetyCheck", { name: NODE_NAME })));
    }
  } catch (error) {
    if (error instanceof PortableNodeInstallError) throw error;
    if (timedOut) throw Object.assign(new PortableNodeInstallError(`The ${NODE_NAME} download took too long and was stopped. Check the internet connection and try again.`), userErrorFields(userError("serverError.install.downloadTimeout", { name: NODE_NAME })));
    if (stalled) throw new PortableNodeInstallError(`The ${NODE_NAME} download stopped partway. Check the internet connection and try again.`);
    if (typeof (error as NodeJS.ErrnoException).code === "string") throw error;
    throw Object.assign(new PortableNodeInstallError(`${NODE_NAME} couldn't be downloaded. Check the internet connection and try again.`), userErrorFields(userError("serverError.install.downloadFailed", { name: NODE_NAME })));
  } finally {
    clearTimeout(timer);
    clearTimeout(stallTimer);
    controller.abort();
  }
}

async function normaliseModes(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await chmod(path, 0o755);
      await normaliseModes(path);
    } else if (entry.isFile()) {
      await chmod(path, ((await stat(path)).mode & 0o111) !== 0 ? 0o755 : 0o644);
    } else if (!entry.isSymbolicLink()) {
      throw Object.assign(new PortableNodeInstallError("The archive contains an unexpected or unsafe file. Nothing was installed."), userErrorFields(userError("serverError.install.unsafeArchive")));
    }
  }
}

/** Official POSIX Node.js tarballs ship bin/{npm,npx,corepack} as SymbolicLink entries and C++ headers/manpages under
 * include/ and share/. We skip those entries during extraction and recreate relative bin/{npm,npx} symlinks ourselves. */
async function extractNodeTarGz(archivePath: string, staging: string, rootDir: string): Promise<boolean> {
  let unsafe = false;
  const allowedLinks = new Set([`${rootDir}/bin/npm`, `${rootDir}/bin/npx`, `${rootDir}/bin/corepack`]);
  const skippedPrefixes = [`${rootDir}/include/`, `${rootDir}/share/`];
  const tar = await import("tar");
  await tar.x({
    file: archivePath,
    cwd: staging,
    strict: true,
    preservePaths: false,
    preserveOwner: false,
    umask: 0o022,
    filter: (path, entry) => {
      const type = "type" in entry ? entry.type : undefined;
      const name = path.replace(/^(?:\.\/)+/u, "").replace(/\/$/u, "");
      if (name === "" && type === "Directory") return false;
      if (!safeArchivePath(name) || (name !== rootDir && !name.startsWith(`${rootDir}/`))) {
        unsafe = true;
        return false;
      }
      if (name === `${rootDir}/include` || name === `${rootDir}/share` || skippedPrefixes.some((prefix) => name.startsWith(prefix))) {
        return false;
      }
      if (type === "SymbolicLink" && allowedLinks.has(name)) {
        return false;
      }
      if (type !== "File" && type !== "Directory") {
        unsafe = true;
        return false;
      }
      return true;
    },
  });
  return !unsafe;
}

async function unpackNodeArchive(archivePath: string, staging: string, asset: PortableNodeAsset): Promise<void> {
  const unsafe = Object.assign(new PortableNodeInstallError(`The ${NODE_NAME} download holds an unexpected or unsafe file, so nothing was installed.`), userErrorFields(userError("serverError.install.unsafeFile", { name: NODE_NAME })));
  try {
    if (asset.archive === "zip") {
      await extractZip(archivePath, staging, { maxEntries: MAX_ZIP_MEMBERS });
    } else {
      if (!(await extractNodeTarGz(archivePath, staging, asset.rootDir))) throw unsafe;
      if (process.platform !== "win32") await normaliseModes(staging);
      const binDir = binDirIn(staging, asset);
      const npmCli = npmCliScriptIn(staging, asset);
      const npxCli = npxCliScriptIn(staging, asset);
      if (process.platform !== "win32") {
        if ((await lstat(npmCli).catch(() => null))?.isFile()) await chmod(npmCli, 0o755);
        if ((await lstat(npxCli).catch(() => null))?.isFile()) await chmod(npxCli, 0o755);
      }
      if ((await lstat(binDir).catch(() => null))?.isDirectory()) {
        const npmLink = join(binDir, "npm");
        const npxLink = join(binDir, "npx");
        await unlink(npmLink).catch(() => {});
        await unlink(npxLink).catch(() => {});
        await symlink("../lib/node_modules/npm/bin/npm-cli.js", npmLink);
        await symlink("../lib/node_modules/npm/bin/npx-cli.js", npxLink);
      }
    }
  } catch (error) {
    if (error instanceof PortableNodeInstallError || typeof (error as NodeJS.ErrnoException).code === "string") throw error;
    throw unsafe;
  }
}

function probeNodeVersion(executable: string): Promise<string | null> {
  const env: NodeJS.ProcessEnv = { ...cliProbeEnvironment() };
  stripControlPlaneEnv(env as Record<string, string | undefined>);
  return new Promise((resolveProbe) => {
    execFile(executable, ["--version"], { env, timeout: PROBE_TIMEOUT_MS, killSignal: "SIGKILL", maxBuffer: 64 * 1024, windowsHide: true, encoding: "utf8" }, (error, stdout, stderr) => {
      const lines = (text: string) => stripVTControlCharacters(text).split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
      if (error) {
        const { code, killed } = error as { code?: unknown; killed?: boolean };
        const said = lines(stderr)[0]
          ?? (killed ? "it did not answer in time" : typeof code === "number" ? `it stopped with exit code ${code}` : lines(stdout)[0] ?? "it could not be run");
        return resolveProbe(said.slice(0, 400));
      }
      if (!stdout.includes(NODE_VERSION)) return resolveProbe(`it reported version ${(lines(stdout)[0] ?? "nothing").slice(0, 80)}, not v${NODE_VERSION}`);
      resolveProbe(null);
    });
  });
}

async function verifiedExisting(versionDir: string, asset: PortableNodeAsset): Promise<PortableNodeInstalled | null> {
  const record = readRecord(versionDir);
  if (
    !record || record.version !== NODE_VERSION || record.sha256 !== asset.sha256
    || record.rootDir !== asset.rootDir || record.executableSha256 !== asset.executableSha256
  ) return null;
  const binDir = binDirIn(versionDir, asset);
  const executablePath = nodeExecutableIn(versionDir, asset);
  if (!(await lstat(binDir).catch(() => null))?.isDirectory()) return null;
  if (!(await lstat(executablePath).catch(() => null))?.isFile()) return null;
  if (!(await lstat(npmCliScriptIn(versionDir, asset)).catch(() => null))?.isFile()) return null;
  if (asset.archive === "zip" && !(await lstat(join(binDir, "npm.cmd")).catch(() => null))?.isFile()) return null;
  if ((await hashFile(executablePath)) !== asset.executableSha256) return null;
  return { version: NODE_VERSION, binDir, executablePath };
}

async function realFolder(path: string): Promise<void> {
  const info = await lstat(path).catch(() => null);
  if (!info) {
    await mkdir(path, { mode: 0o700 });
    return;
  }
  if (!info.isDirectory()) {
    throw Object.assign(new PortableNodeInstallError(`OpenMausBot's folder for ${NODE_NAME} is not a plain folder (${path}), so nothing was changed. Move it away, then try again.`), userErrorFields(userError("serverError.install.notPlainFolder", { name: NODE_NAME, path })));
  }
}

async function removeDir(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true, maxRetries: 4, retryDelay: 250 });
}

function wrapError(asset: PortableNodeAsset | null, error: unknown): Error {
  if (error instanceof PortableNodeInstallError) return error;
  const syntheticRelease: StandaloneRelease = {
    name: NODE_NAME,
    engine: NODE_ENGINE,
    version: NODE_VERSION,
    hosts: asset?.hosts ?? NODE_HOSTS,
    assets: {},
  };
  const syntheticAsset: StandaloneAsset = {
    url: asset?.url ?? "https://nodejs.org/",
    sha256: asset?.sha256 ?? "0".repeat(64),
    executableSha256: asset?.executableSha256 ?? "0".repeat(64),
    archive: asset?.archive ?? "tar.gz",
    executable: "node",
    approxBytes: asset?.approxBytes ?? 50_000_000,
  };
  return plainInstallError(syntheticRelease, syntheticAsset, error);
}

async function installPortableNodeOnce(options: PortableNodeInstallOptions): Promise<PortableNodeInstalled> {
  const key = options.platformKey ?? standalonePlatformKey();
  const asset = options.asset ?? portableNodeAssetFor(key);
  if (!asset) {
    throw Object.assign(new PortableNodeInstallError(`${NODE_NAME} has no download for this computer.`), userErrorFields(userError("serverError.install.noDownload", { name: NODE_NAME })));
  }
  const probe = options.probe ?? probeNodeVersion;
  const engineDir = portableNodeEngineDir(options.baseDir);
  const versionDir = join(engineDir, NODE_VERSION);
  const tag = randomUUID();
  const archivePath = join(engineDir, `${DOWNLOAD_PREFIX}${tag}.part`);
  const staging = join(engineDir, `${STAGING_PREFIX}${tag}`);
  try {
    const root = standaloneRoot(options.baseDir);
    await mkdir(dirname(root), { recursive: true, mode: 0o700 });
    await realFolder(root);
    await realFolder(engineDir);
    sweepLeftovers(engineDir);

    const existing = await verifiedExisting(versionDir, asset);
    if (existing) {
      const failure = await probe(existing.executablePath);
      if (failure !== null) {
        throw Object.assign(new PortableNodeInstallError(`${NODE_NAME} is installed, but it doesn't start on this computer (${failure}). Nothing was changed.`), userErrorFields(userError("serverError.install.existingDoesNotStart", { name: NODE_NAME, failure })));
      }
      registerFallbackPathDir(existing.binDir);
      resetPathCache();
      return existing;
    }

    await downloadNodeArchive(asset, archivePath, options);
    await mkdir(staging, { mode: 0o700 });
    await unpackNodeArchive(archivePath, staging, asset);

    const stagedNode = nodeExecutableIn(staging, asset);
    const stagedNpmCli = npmCliScriptIn(staging, asset);
    const stagedBinDir = binDirIn(staging, asset);
    if (
      !(await lstat(stagedNode).catch(() => null))?.isFile()
      || !(await lstat(stagedNpmCli).catch(() => null))?.isFile()
      || (asset.archive === "zip" && !(await lstat(join(stagedBinDir, "npm.cmd")).catch(() => null))?.isFile())
    ) {
      throw Object.assign(new PortableNodeInstallError(`The ${NODE_NAME} download did not contain the program it should, so nothing was installed.`), userErrorFields(userError("serverError.install.programMissing", { name: NODE_NAME })));
    }
    if (process.platform !== "win32") await chmod(stagedNode, 0o755);
    const programSha256 = await hashFile(stagedNode);
    if (programSha256 !== asset.executableSha256) {
      throw Object.assign(new PortableNodeInstallError(`The ${NODE_NAME} download failed its safety check, so nothing was installed. Try again later.`), userErrorFields(userError("serverError.install.safetyCheck", { name: NODE_NAME })));
    }
    const failure = await probe(stagedNode);
    if (failure !== null) {
      throw Object.assign(new PortableNodeInstallError(`${NODE_NAME} was downloaded, but it doesn't start on this computer (${failure}). Nothing was installed.`), userErrorFields(userError("serverError.install.downloadDoesNotStart", { name: NODE_NAME, failure })));
    }

    const record: NodeInstallRecord = {
      version: NODE_VERSION,
      sha256: asset.sha256,
      rootDir: asset.rootDir,
      executableSha256: programSha256,
      installedAt: Date.now(),
    };
    await writeFile(join(staging, RECORD), `${JSON.stringify(record)}\n`, { flag: "wx", mode: 0o600 });

    const aside = existsSync(versionDir) ? join(engineDir, `${OLD_PREFIX}${tag}`) : null;
    if (aside) await rename(versionDir, aside);
    try {
      await rename(staging, versionDir);
    } catch (error) {
      if (aside) await rename(aside, versionDir).catch(() => {});
      throw error;
    }
    if (aside) await removeDir(aside).catch(() => {});

    const binDir = binDirIn(versionDir, asset);
    const executablePath = nodeExecutableIn(versionDir, asset);
    registerFallbackPathDir(binDir);
    resetPathCache();
    return { version: NODE_VERSION, binDir, executablePath };
  } catch (error) {
    throw wrapError(asset, error);
  } finally {
    await rm(archivePath, { force: true }).catch(() => {});
    await removeDir(staging).catch(() => {});
  }
}

/** Downloads and activates the pinned Portable Node.js runtime if not already present in tools/standalone/node. */
export function ensurePortableNode(options: PortableNodeInstallOptions = {}): Promise<PortableNodeInstalled> {
  const key = portableNodeEngineDir(options.baseDir);
  const existing = running.get(key);
  if (existing) return existing;
  const run = installPortableNodeOnce(options).finally(() => running.delete(key));
  running.set(key, run);
  return run;
}
