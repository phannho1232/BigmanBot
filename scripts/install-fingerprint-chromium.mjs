// Downloads adryfish/fingerprint-chromium from GitHub Releases into <DATA_DIR>/browser/fingerprint-chromium
// so resolveChromePlan() picks it up automatically and passes a unique --fingerprint=<seed> per profile.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO = "adryfish/fingerprint-chromium";

function resolveDataDir(args) {
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--data-dir" && args[i + 1]) return resolve(args[i + 1]);
  }
  return resolve(process.env.OMB_DATA_DIR?.trim() || join(homedir(), ".openmausbot"));
}

function matchAsset(assets, platform) {
  if (platform === "win32") {
    return assets.find((a) => /windows_x64\.zip$/iu.test(a.name));
  }
  if (platform === "linux") {
    return assets.find((a) => /x86_64_linux\.tar\.xz$/iu.test(a.name));
  }
  return null;
}

function moveContentsUpIfSingleDir(targetDir, expectedBinary) {
  if (existsSync(join(targetDir, expectedBinary))) return;
  const entries = readdirSync(targetDir, { withFileTypes: true }).filter((e) => e.isDirectory());
  if (entries.length !== 1) return;
  const nested = join(targetDir, entries[0].name);
  if (!existsSync(join(nested, expectedBinary))) return;
  for (const item of readdirSync(nested)) {
    renameSync(join(nested, item), join(targetDir, item));
  }
  rmSync(nested, { recursive: true, force: true });
}

async function main() {
  const platform = process.platform;
  if (platform !== "win32" && platform !== "linux") {
    throw new Error(`Automated fingerprint-chromium archive extraction supports win32 and linux (current: ${platform}). Set OMB_CHROME_PATH to your fingerprint-chromium binary instead.`);
  }
  const dataDir = resolveDataDir(process.argv.slice(2));
  const installDir = join(dataDir, "browser", "fingerprint-chromium");
  const binaryName = platform === "win32" ? "chrome.exe" : "chrome";
  const binaryPath = join(installDir, binaryName);

  console.log(`Querying latest release from https://github.com/${REPO} ...`);
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=5`, {
    headers: { "User-Agent": "OpenMausBot-Fingerprint-Installer" },
  });
  if (!res.ok) throw new Error(`GitHub API HTTP ${res.status}`);
  const releases = await res.json();
  let chosen = null;
  let releaseTag = null;
  for (const rel of releases) {
    const asset = matchAsset(rel.assets ?? [], platform);
    if (asset) {
      chosen = asset;
      releaseTag = rel.tag_name;
      break;
    }
  }
  if (!chosen) throw new Error(`No matching ${platform} archive found in recent ${REPO} releases.`);

  console.log(`Downloading ${chosen.name} (${Math.round(chosen.size / 1_048_576)} MB, tag ${releaseTag})...`);
  const staging = mkdtempSync(join(tmpdir(), "omb-fp-chromium-"));
  const archivePath = join(staging, chosen.name);
  try {
    const dl = await fetch(chosen.browser_download_url, { redirect: "follow" });
    if (!dl.ok) throw new Error(`Download failed: HTTP ${dl.status}`);
    const bytes = Buffer.from(await dl.arrayBuffer());
    writeFileSync(archivePath, bytes);

    const extractDir = join(staging, "extracted");
    mkdirSync(extractDir, { recursive: true });
    console.log(`Extracting ${chosen.name}...`);
    const tar = spawnSync("tar", ["-xf", archivePath, "-C", extractDir], { stdio: "inherit", windowsHide: true });
    if (tar.status !== 0) {
      if (platform === "win32") {
        const ps = spawnSync("powershell.exe", [
          "-NoProfile", "-NonInteractive", "-Command",
          `Expand-Archive -LiteralPath '${archivePath.replaceAll("'", "''")}' -DestinationPath '${extractDir.replaceAll("'", "''")}' -Force`,
        ], { stdio: "inherit", windowsHide: true });
        if (ps.status !== 0) throw new Error("Failed to extract archive with both tar and Expand-Archive.");
      } else {
        throw new Error(`tar exited with code ${tar.status}`);
      }
    }

    moveContentsUpIfSingleDir(extractDir, binaryName);
    if (!existsSync(join(extractDir, binaryName))) {
      throw new Error(`Extracted archive did not contain ${binaryName}`);
    }

    mkdirSync(join(dataDir, "browser"), { recursive: true });
    rmSync(installDir, { recursive: true, force: true });
    renameSync(extractDir, installDir);
    console.log(`Installed fingerprint-chromium ${releaseTag} at: ${binaryPath}`);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
