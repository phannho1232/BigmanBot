import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import {
  chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readlinkSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import * as tar from "tar";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { enginesBinDir, ensureNpmRuntime, installNpmEngine, npmAvailable } from "./engine-install.ts";
import { augmentedPath, findCliCandidates, resetPathCacheForTests } from "./env-path.ts";
import {
  ensurePortableNode,
  NODE_ASSETS,
  NODE_VERSION,
  portableNodeAssetFor,
  portableNodeAvailable,
  portableNodeEngineDir,
  registerPortableNodeBinDir,
  type PortableNodeAsset,
} from "./node-runtime.ts";
import { removeTempDir } from "./testing/cleanup.ts";
import { buildZip } from "./testing/zip-fixture.ts";

const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");

function useAssetServer() {
  const routes = new Map<string, { status?: number; headers?: Record<string, string>; body?: Buffer }>();
  const hits = new Map<string, number>();
  let server: Server;
  let port = 0;
  beforeAll(async () => {
    server = createServer((req, res) => {
      const key = req.url!.slice(1);
      hits.set(key, (hits.get(key) ?? 0) + 1);
      const route = routes.get(key);
      if (!route) {
        res.writeHead(404).end();
        return;
      }
      const body = route.body ?? Buffer.alloc(0);
      res.writeHead(route.status ?? 200, { "content-length": String(body.length), ...route.headers });
      res.end(body);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  }));
  beforeEach(() => {
    routes.clear();
    hits.clear();
  });
  const fetchImpl = ((input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    return fetch(`http://127.0.0.1:${port}/${url.host}${url.pathname}`, init);
  }) as typeof fetch;
  return { routes, hits: (key: string) => hits.get(key) ?? 0, fetchImpl };
}

describe("pinned Node.js release table", () => {
  it("pins official HTTPS nodejs.org archives and SHA-256 hashes for all supported platforms", () => {
    const expectedKeys = [
      "darwin-arm64",
      "darwin-x64",
      "linux-x64",
      "linux-arm64",
      "linux-x64-musl",
      "win32-x64",
      "win32-arm64",
    ];
    expect(Object.keys(NODE_ASSETS).sort()).toEqual(expectedKeys.sort());
    for (const key of expectedKeys) {
      const asset = portableNodeAssetFor(key);
      expect(asset).not.toBeNull();
      expect(portableNodeAvailable(key)).toBe(true);
      expect(asset!.url.startsWith(`https://nodejs.org/dist/v${NODE_VERSION}/`)).toBe(true);
      expect(asset!.sha256).toMatch(/^[0-9a-f]{64}$/u);
      expect(asset!.executableSha256).toMatch(/^[0-9a-f]{64}$/u);
      expect(asset!.approxBytes).toBeGreaterThan(30_000_000);
    }
    expect(portableNodeAssetFor("freebsd-x64")).toBeNull();
    expect(portableNodeAvailable("freebsd-x64")).toBe(false);
  });
});

describe("installing and verifying Portable Node.js", () => {
  const server = useAssetServer();
  let scratch = "";
  let base = "";
  let originalPath: string | undefined;
  let originalSealed: string | undefined;
  let originalHome: string | undefined;
  let originalUserProfile: string | undefined;
  let originalAppData: string | undefined;
  let originalLocalAppData: string | undefined;

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), "omb-portable-node-"));
    base = join(scratch, "data");
    const emptyHome = join(scratch, "home");
    const emptyPath = join(scratch, "empty-path");
    mkdirSync(emptyHome, { recursive: true });
    mkdirSync(emptyPath, { recursive: true });
    originalPath = process.env.PATH;
    originalSealed = process.env.OMB_TEST_SEALED_PATH;
    originalHome = process.env.HOME;
    originalUserProfile = process.env.USERPROFILE;
    originalAppData = process.env.APPDATA;
    originalLocalAppData = process.env.LOCALAPPDATA;
    process.env.PATH = emptyPath;
    process.env.OMB_TEST_SEALED_PATH = "1";
    process.env.HOME = emptyHome;
    process.env.USERPROFILE = emptyHome;
    process.env.APPDATA = join(emptyHome, "AppData", "Roaming");
    process.env.LOCALAPPDATA = join(emptyHome, "AppData", "Local");
    resetPathCacheForTests();
  });

  afterEach(async () => {
    process.env.PATH = originalPath;
    if (originalSealed === undefined) delete process.env.OMB_TEST_SEALED_PATH;
    else process.env.OMB_TEST_SEALED_PATH = originalSealed;
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (originalUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = originalUserProfile;
    if (originalAppData === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = originalAppData;
    if (originalLocalAppData === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = originalLocalAppData;
    resetPathCacheForTests();
    await removeTempDir(scratch);
  });

  function buildWindowsZipAsset(program = `node-win-${NODE_VERSION}`, overrides: Partial<PortableNodeAsset> = {}): PortableNodeAsset {
    const rootDir = `node-v${NODE_VERSION}-win-x64`;
    const body = buildZip([
      { name: `${rootDir}/node.exe`, data: program, mode: 0o100755 },
      { name: `${rootDir}/npm.cmd`, data: '@echo off\r\nSET "NPM_CLI_JS=%~dp0\\node_modules\\npm\\bin\\npm-cli.js"\r\n"%~dp0\\node.exe" "%NPM_CLI_JS%" %*\r\n', mode: 0o100644 },
      { name: `${rootDir}/npx.cmd`, data: '@echo off\r\nSET "NPX_CLI_JS=%~dp0\\node_modules\\npm\\bin\\npx-cli.js"\r\n"%~dp0\\node.exe" "%NPX_CLI_JS%" %*\r\n', mode: 0o100644 },
      { name: `${rootDir}/node_modules/npm/bin/npm-cli.js`, data: "#!/usr/bin/env node\nconsole.log('11.6.0');\n", mode: 0o100644 },
      { name: `${rootDir}/node_modules/npm/bin/npx-cli.js`, data: "#!/usr/bin/env node\nconsole.log('11.6.0');\n", mode: 0o100644 },
    ]);
    server.routes.set(`nodejs.org/dist/v${NODE_VERSION}/${rootDir}.zip`, { body });
    return {
      url: `https://nodejs.org/dist/v${NODE_VERSION}/${rootDir}.zip`,
      sha256: sha256(body),
      executableSha256: sha256(program),
      archive: "zip",
      rootDir,
      approxBytes: body.length,
      ...overrides,
    };
  }

  async function buildPosixTarAsset(program = `#!/bin/sh\necho "v${NODE_VERSION}"\n`, overrides: Partial<PortableNodeAsset> = {}): Promise<PortableNodeAsset> {
    const rootDir = `node-v${NODE_VERSION}-linux-x64`;
    const source = mkdtempSync(join(scratch, "node-tar-src-"));
    const files: Record<string, { data: string; mode: number }> = {
      [`${rootDir}/bin/node`]: { data: program, mode: 0o755 },
      [`${rootDir}/lib/node_modules/npm/bin/npm-cli.js`]: { data: "#!/usr/bin/env node\nconsole.log('11.6.0');\n", mode: 0o755 },
      [`${rootDir}/lib/node_modules/npm/bin/npx-cli.js`]: { data: "#!/usr/bin/env node\nconsole.log('11.6.0');\n", mode: 0o755 },
      [`${rootDir}/include/node/node.h`]: { data: "// skipped header\n", mode: 0o644 },
      [`${rootDir}/share/man/man1/node.1`]: { data: "skipped manpage\n", mode: 0o644 },
    };
    for (const [name, { data, mode }] of Object.entries(files)) {
      const target = join(source, ...name.split("/"));
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, data);
      chmodSync(target, mode);
    }
    const tarFile = join(scratch, `${rootDir}.tar.gz`);
    await tar.c({ gzip: true, file: tarFile, cwd: source, portable: true }, [rootDir]);
    const body = Buffer.from(await import("node:fs/promises").then((fs) => fs.readFile(tarFile)));
    server.routes.set(`nodejs.org/dist/v${NODE_VERSION}/${rootDir}.tar.gz`, { body });
    return {
      url: `https://nodejs.org/dist/v${NODE_VERSION}/${rootDir}.tar.gz`,
      sha256: sha256(body),
      executableSha256: sha256(program),
      archive: "tar.gz",
      rootDir,
      approxBytes: body.length,
      ...overrides,
    };
  }

  it("downloads, verifies, and unpacks a Windows .zip archive, registering its bin folder at the end of PATH", async () => {
    const asset = buildWindowsZipAsset();
    const installed = await ensurePortableNode({
      baseDir: base,
      asset,
      fetchImpl: server.fetchImpl,
      probe: async () => null,
    });

    const expectedBinDir = join(portableNodeEngineDir(base), NODE_VERSION, asset.rootDir);
    expect(installed).toEqual({
      version: NODE_VERSION,
      binDir: expectedBinDir,
      executablePath: join(expectedBinDir, "node.exe"),
    });
    expect(augmentedPath().split(delimiter).at(-1)).toBe(expectedBinDir);
    expect(server.hits(`nodejs.org/dist/v${NODE_VERSION}/${asset.rootDir}.zip`)).toBe(1);

    await ensurePortableNode({
      baseDir: base,
      asset,
      fetchImpl: server.fetchImpl,
      probe: async () => null,
    });
    expect(server.hits(`nodejs.org/dist/v${NODE_VERSION}/${asset.rootDir}.zip`)).toBe(1);

    resetPathCacheForTests();
    registerPortableNodeBinDir(base, "win32-x64", asset);
    expect(augmentedPath().split(delimiter).at(-1)).toBe(expectedBinDir);

    writeFileSync(join(expectedBinDir, "node.exe"), "tampered-node");
    resetPathCacheForTests();
    registerPortableNodeBinDir(base, "win32-x64", asset);
    expect(augmentedPath().split(delimiter)).not.toContain(expectedBinDir);
  });

  it.skipIf(process.platform === "win32")("downloads, verifies, and unpacks a POSIX .tar.gz archive, recreating npm and npx symlinks and skipping headers", async () => {
    const asset = await buildPosixTarAsset();
    const installed = await ensurePortableNode({
      baseDir: base,
      asset,
      fetchImpl: server.fetchImpl,
    });

    const versionRoot = join(portableNodeEngineDir(base), NODE_VERSION, asset.rootDir);
    const expectedBinDir = join(versionRoot, "bin");
    expect(installed).toEqual({
      version: NODE_VERSION,
      binDir: expectedBinDir,
      executablePath: join(expectedBinDir, "node"),
    });
    expect(existsSync(join(versionRoot, "include"))).toBe(false);
    expect(existsSync(join(versionRoot, "share"))).toBe(false);
    expect(lstatSync(join(expectedBinDir, "npm")).isSymbolicLink()).toBe(true);
    expect(readlinkSync(join(expectedBinDir, "npm"))).toBe("../lib/node_modules/npm/bin/npm-cli.js");
    expect(lstatSync(join(expectedBinDir, "npx")).isSymbolicLink()).toBe(true);
    expect(readlinkSync(join(expectedBinDir, "npx"))).toBe("../lib/node_modules/npm/bin/npx-cli.js");
    expect(findCliCandidates("npm")).toEqual([join(expectedBinDir, "npm")]);
  });

  it("refuses a download that fails its archive or executable SHA-256 check, or comes from an untrusted host", async () => {
    const badArchive = buildWindowsZipAsset("node", { sha256: "0".repeat(64) });
    await expect(ensurePortableNode({ baseDir: base, asset: badArchive, fetchImpl: server.fetchImpl, probe: async () => null }))
      .rejects.toThrow(/safety check/);

    const badExe = buildWindowsZipAsset("node", { executableSha256: "0".repeat(64) });
    await expect(ensurePortableNode({ baseDir: base, asset: badExe, fetchImpl: server.fetchImpl, probe: async () => null }))
      .rejects.toThrow(/safety check/);

    const untrusted = buildWindowsZipAsset("node", { url: "https://evil.example.test/node.zip" });
    await expect(ensurePortableNode({ baseDir: base, asset: untrusted, fetchImpl: server.fetchImpl, probe: async () => null }))
      .rejects.toThrow(/official site/);
  });

  it.skipIf(process.platform === "win32")("refuses a tar.gz containing an unexpected symbolic link", async () => {
    const rootDir = `node-v${NODE_VERSION}-linux-x64`;
    const source = mkdtempSync(join(scratch, "node-tar-badlink-"));
    mkdirSync(join(source, rootDir, "bin"), { recursive: true });
    writeFileSync(join(source, rootDir, "bin", "node"), `#!/bin/sh\necho "v${NODE_VERSION}"\n`, { mode: 0o755 });
    symlinkSync("/etc/passwd", join(source, rootDir, "bin", "evil"));
    const tarFile = join(scratch, "badlink.tar.gz");
    await tar.c({ gzip: true, file: tarFile, cwd: source, portable: true }, [rootDir]);
    const body = Buffer.from(await import("node:fs/promises").then((fs) => fs.readFile(tarFile)));
    server.routes.set(`nodejs.org/dist/v${NODE_VERSION}/${rootDir}.tar.gz`, { body });
    const asset: PortableNodeAsset = {
      url: `https://nodejs.org/dist/v${NODE_VERSION}/${rootDir}.tar.gz`,
      sha256: sha256(body),
      executableSha256: sha256(`#!/bin/sh\necho "v${NODE_VERSION}"\n`),
      archive: "tar.gz",
      rootDir,
      approxBytes: body.length,
    };
    await expect(ensurePortableNode({ baseDir: base, asset, fetchImpl: server.fetchImpl }))
      .rejects.toThrow(/unsafe/);
  });

  it("automatically bootstraps Portable Node when ensureNpmRuntime sees no npm on PATH", async () => {
    expect(findCliCandidates("npm")).toEqual([]);
    expect(npmAvailable()).toBe(true);
    const asset = buildWindowsZipAsset();
    await ensureNpmRuntime(base, undefined, {
      asset,
      fetchImpl: server.fetchImpl,
      probe: async () => null,
    });
    const expectedBinDir = join(portableNodeEngineDir(base), NODE_VERSION, asset.rootDir);
    expect(augmentedPath().split(delimiter).at(-1)).toBe(expectedBinDir);
    expect(server.hits(`nodejs.org/dist/v${NODE_VERSION}/${asset.rootDir}.zip`)).toBe(1);
  });

  it("bootstraps Portable Node during installNpmEngine and installs the npm package when npm is missing from PATH", async () => {
    expect(findCliCandidates("npm")).toEqual([]);
    const fakeNpmCli = `const { mkdirSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const args = process.argv.slice(2);
const prefix = args[args.indexOf("--prefix") + 1];
if (process.platform === "win32") {
  mkdirSync(prefix, { recursive: true });
  writeFileSync(join(prefix, "fakebin.js"), "console.log('1.0.0');\\n");
  writeFileSync(join(prefix, "fakebin.cmd"), '@echo off\\r\\nnode "%~dp0\\\\fakebin.js" %*\\r\\n');
} else {
  mkdirSync(join(prefix, "bin"), { recursive: true });
  writeFileSync(join(prefix, "bin", "fakebin"), "#!/usr/bin/env node\\nconsole.log('1.0.0');\\n", { mode: 0o755 });
}
`;
    if (process.platform === "win32") {
      const rootDir = `node-v${NODE_VERSION}-win-x64`;
      const placeholder = `node-win-${NODE_VERSION}`;
      const body = buildZip([
        { name: `${rootDir}/node.exe`, data: placeholder, mode: 0o100755 },
        { name: `${rootDir}/npm.cmd`, data: '@echo off\r\nSET "NPM_CLI_JS=%~dp0\\node_modules\\npm\\bin\\npm-cli.js"\r\n"%~dp0\\node.exe" "%NPM_CLI_JS%" %*\r\n', mode: 0o100644 },
        { name: `${rootDir}/node_modules/npm/bin/npm-cli.js`, data: fakeNpmCli, mode: 0o100644 },
        { name: `${rootDir}/node_modules/npm/bin/npx-cli.js`, data: fakeNpmCli, mode: 0o100644 },
      ]);
      server.routes.set(`nodejs.org/dist/v${NODE_VERSION}/${rootDir}.zip`, { body });
      const asset: PortableNodeAsset = {
        url: `https://nodejs.org/dist/v${NODE_VERSION}/${rootDir}.zip`,
        sha256: sha256(body),
        executableSha256: sha256(placeholder),
        archive: "zip",
        rootDir,
        approxBytes: body.length,
      };
      await installNpmEngine("fake-engine", {
        baseDir: base,
        cli: "fakebin",
        nodeOptions: {
          asset,
          fetchImpl: server.fetchImpl,
          probe: async (stagedNode) => {
            rmSync(stagedNode);
            return null;
          },
        },
      });
    } else {
      const rootDir = `node-v${NODE_VERSION}-linux-x64`;
      const nodeWrapper = `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "v${NODE_VERSION}"; exit 0; fi\nexec "${process.execPath}" "$@"\n`;
      const asset = await buildPosixTarAsset(nodeWrapper);
      const source = mkdtempSync(join(scratch, "node-tar-e2e-"));
      mkdirSync(join(source, rootDir, "bin"), { recursive: true });
      mkdirSync(join(source, rootDir, "lib", "node_modules", "npm", "bin"), { recursive: true });
      writeFileSync(join(source, rootDir, "bin", "node"), nodeWrapper, { mode: 0o755 });
      writeFileSync(join(source, rootDir, "lib", "node_modules", "npm", "bin", "npm-cli.js"), `#!/usr/bin/env node\n${fakeNpmCli}`, { mode: 0o755 });
      writeFileSync(join(source, rootDir, "lib", "node_modules", "npm", "bin", "npx-cli.js"), `#!/usr/bin/env node\n${fakeNpmCli}`, { mode: 0o755 });
      const tarFile = join(scratch, "e2e.tar.gz");
      await tar.c({ gzip: true, file: tarFile, cwd: source, portable: true }, [rootDir]);
      const body = Buffer.from(await import("node:fs/promises").then((fs) => fs.readFile(tarFile)));
      server.routes.set(`nodejs.org/dist/v${NODE_VERSION}/${rootDir}.tar.gz`, { body });
      await installNpmEngine("fake-engine", {
        baseDir: base,
        cli: "fakebin",
        nodeOptions: {
          asset: { ...asset, sha256: sha256(body), approxBytes: body.length },
          fetchImpl: server.fetchImpl,
        },
      });
    }
    expect(findCliCandidates("fakebin")[0]?.startsWith(enginesBinDir(base))).toBe(true);
  });
});
