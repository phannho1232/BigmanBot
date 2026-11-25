// agent-browser runs AGENT_BROWSER_EXECUTABLE_PATH with its own arguments. It splits AGENT_BROWSER_ARGS at commas (0.37),
// which cut the user agent at "(KHTML,", so the identity flags ride a generated launcher instead: a shell script that execs
// Chrome (same process, same pid), or on Windows a batch file, which Rust's Command runs through cmd.exe.
import { execFile, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";

import { writeFileAtomic } from "../../atomic.ts";
import { credentialStoreFlags } from "../egress/gate.ts";

export interface Screen { width: number; height: number }

export interface LauncherSettings {
  chrome: string;
  userAgent: string;
  screen: Screen;
  /** Absent: Chrome takes the language from the system, as it does headed. */
  language?: string;
  timeZone?: string;
  /** macOS: Chrome with any HOME but the person's own asks, in a dialog on their screen, for a keychain it cannot find. */
  home?: string;
  /** Every Chrome this launcher starts runs in this box (a Team Cloud's), with only the profile it was started on. */
  box?: LauncherBox;
  /** A Cloud home's browsers' cgroup (browser/memory-cgroup.ts): Chrome joins it before it starts, so all of its processes
   * are born under the kernel's memory limit. A failed join leaves Chrome where it was. */
  memoryGroup?: string;
}

/** bubblewrap's options for a browser's box, before `--` and without the profile, which the launcher binds per start. */
export interface LauncherBox {
  bwrap: string;
  options: string[];
  /** The seccomp filter, read on LAUNCHER_SECCOMP_FD; bubblewrap closes that descriptor before Chrome runs. */
  seccomp: string | null;
}

/** agent-browser hands Chrome only stdio (it speaks to it over a port), so 9 is free for the filter. */
export const LAUNCHER_SECCOMP_FD = 9;

/** Headless Chrome 152–156 still keeps a renderer for its WebUI omnibox popups and reload button, which it never shows.
 * agent-browser 0.37 passes --disable-features=Translate and Chrome keeps only the last value of a switch, so Translate
 * stays in the list; agent-browser splits AGENT_BROWSER_ARGS at commas, so only the launcher can pass a list. */
export const HEADLESS_DISABLED_FEATURES = "--disable-features=Translate,WebUIOmniboxPopup,WebUIOmniboxAimPopup,WebUIReloadButton";

/** Last on the command line, so they win over any switch of the same name: Chrome keeps the last value of a switch. A bot's
 * Chrome never touches the person's keychain or keyring (agent-browser 0.37 passes these too). */
export function launcherFlags(settings: LauncherSettings, platform: NodeJS.Platform = process.platform): string[] {
  return [
    "--disable-blink-features=AutomationControlled",
    `--user-agent=${settings.userAgent}`,
    `--screen-info={${settings.screen.width}x${settings.screen.height}}`,
    ...(settings.language ? [`--lang=${settings.language}`] : []),
    ...credentialStoreFlags(platform),
  ];
}

export function launcherPath(dataDir: string, platform: NodeJS.Platform = process.platform): string {
  return join(dataDir, "browser", platform === "win32" ? "chrome-launcher.cmd" : "chrome-launcher.sh");
}

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/** Within double quotes cmd.exe still expands %…% (a batch file writes a literal % as %%); with delayed expansion off, which
 * Rust's Command sets, nothing else there is special. A quote or a line break cannot be passed at all. */
export function batchQuote(value: string): string {
  if (/["\r\n\0]/u.test(value)) throw new Error("A browser launcher argument cannot hold a quote or a line break.");
  return `"${value.replaceAll("%", "%%")}"`;
}

export function launcherScript(settings: LauncherSettings, platform: NodeJS.Platform = process.platform): string {
  const flags = launcherFlags(settings, platform);
  if (platform === "win32") {
    return ["@echo off", `${batchQuote(settings.chrome)} %* ${flags.map(batchQuote).join(" ")}`, ""].join("\r\n");
  }
  // $headless holds one word without spaces or patterns, so it is expanded unquoted: nothing at all when Chrome has a window.
  const chrome = `${shellQuote(settings.chrome)} "$@" ${flags.map(shellQuote).join(" ")} $headless`;
  return [
    "#!/bin/sh",
    ...(settings.memoryGroup ? [`{ echo $$ > ${shellQuote(`${settings.memoryGroup}/cgroup.procs`)}; } 2>/dev/null`] : []),
    ...(settings.home ? [`HOME=${shellQuote(settings.home)}`, "export HOME"] : []),
    ...(settings.timeZone ? [`TZ=${shellQuote(settings.timeZone)}`, "export TZ"] : []),
    "headless=",
    `for arg in "$@"; do case "$arg" in --headless|--headless=*) headless=${shellQuote(HEADLESS_DISABLED_FEATURES)} ;; esac; done`,
    ...(settings.box ? boxedLaunch(settings.box, chrome) : [`exec ${chrome}`]),
    "",
  ].join("\n");
}

/** Chrome in its box: its profile (agent-browser's --user-data-dir=) bound back read-write, and nothing else of the home
 * or the data folder; HOME is the box's private /tmp. Without a profile it still runs boxed, on a throwaway one. The shell
 * stays bubblewrap's parent rather than exec'ing it: --die-with-parent ends the box with the thread that started it, and
 * agent-browser 0.37 starts Chrome from a worker thread that ends right after. */
function boxedLaunch(box: LauncherBox, chrome: string): string[] {
  return [
    "profile=",
    'for arg in "$@"; do case "$arg" in --user-data-dir=*) profile=${arg#--user-data-dir=} ;; esac; done',
    ...(box.seccomp ? [`exec ${LAUNCHER_SECCOMP_FD}<${shellQuote(box.seccomp)} || exit 70`] : []),
    'if [ -n "$profile" ]; then',
    '  mkdir -p "$profile" || exit 70',
    `  set -- --bind "$profile" "$profile" --setenv HOME /tmp -- ${chrome}`,
    "else",
    `  set -- --setenv HOME /tmp -- ${chrome}`,
    "fi",
    `${shellQuote(box.bwrap)} ${box.options.map(shellQuote).join(" ")} "$@"`,
    "exit $?",
  ];
}

export function writeLauncher(path: string, settings: LauncherSettings, platform: NodeJS.Platform = process.platform): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileAtomic(path, launcherScript(settings, platform), { mode: 0o700 });
  if (platform !== "win32") chmodSync(path, 0o700);
  else if (process.platform === "win32") writeWindowsGuiConfig(path, settings);
}

const WINDOWS_CSC = "C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe";

const WINDOWS_GUI_SHIM_CS = `using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Text;
using System.Threading.Tasks;

static class ChromeGuiShim {
  static string QuoteArg(string arg) {
    if (arg.Length > 0 && arg.IndexOfAny(new char[] { ' ', '\\t', '\\n', '\\v', '\\"' }) < 0) return arg;
    var sb = new StringBuilder();
    sb.Append('\\"');
    for (int i = 0; ; ++i) {
      int bs = 0;
      while (i < arg.Length && arg[i] == '\\\\') { ++i; ++bs; }
      if (i == arg.Length) { sb.Append('\\\\', bs * 2); break; }
      if (arg[i] == '\\"') { sb.Append('\\\\', bs * 2 + 1); sb.Append('\\"'); }
      else { sb.Append('\\\\', bs); sb.Append(arg[i]); }
    }
    sb.Append('\\"');
    return sb.ToString();
  }

  static int Main(string[] args) {
    string exe = Assembly.GetExecutingAssembly().Location;
    string cfg = Path.ChangeExtension(exe, ".cfg");
    string[] lines = File.ReadAllLines(cfg, Encoding.UTF8);
    if (lines.Length == 0 || string.IsNullOrWhiteSpace(lines[0])) return 70;
    var all = new List<string>(args.Length + lines.Length);
    foreach (string a in args) all.Add(QuoteArg(a));
    for (int i = 1; i < lines.Length; ++i) {
      if (lines[i].Length > 0) all.Add(QuoteArg(lines[i]));
    }
    var psi = new ProcessStartInfo(lines[0], string.Join(" ", all));
    psi.UseShellExecute = false;
    psi.CreateNoWindow = true;
    psi.RedirectStandardOutput = true;
    psi.RedirectStandardError = true;
    using (var p = Process.Start(psi)) {
      if (p == null) return 71;
      var tOut = p.StandardOutput.BaseStream.CopyToAsync(Console.OpenStandardOutput());
      var tErr = p.StandardError.BaseStream.CopyToAsync(Console.OpenStandardError());
      p.WaitForExit();
      Task.WaitAll(tOut, tErr);
      return p.ExitCode;
    }
  }
}
`;

function writeWindowsGuiConfig(cmdPath: string, settings: LauncherSettings): void {
  const dir = dirname(cmdPath);
  const cfgPath = join(dir, "chrome-launcher.cfg");
  writeFileAtomic(cfgPath, [settings.chrome, ...launcherFlags(settings, "win32")].join("\n"), { mode: 0o600 });
}

/** Detached agent-browser 0.36/0.37 on Windows opens a visible cmd.exe console when AGENT_BROWSER_EXECUTABLE_PATH is a .cmd
 * batch file; a `/target:winexe` GUI-subsystem shim spawns Chrome with CreateNoWindow so no console window ever opens. */
export function ensureWindowsGuiLauncher(dataDir: string): string | null {
  if (process.platform !== "win32" || !existsSync(WINDOWS_CSC)) return null;
  const dir = join(dataDir, "browser");
  const exePath = join(dir, "chrome-launcher.exe");
  if (existsSync(exePath)) return exePath;
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const csPath = join(dir, `chrome-launcher-${process.pid}.cs`);
    writeFileAtomic(csPath, WINDOWS_GUI_SHIM_CS, { mode: 0o600 });
    try {
      const res = spawnSync(WINDOWS_CSC, ["/nologo", "/target:winexe", `/out:${exePath}`, csPath], { windowsHide: true, timeout: 15_000 });
      return res.status === 0 && existsSync(exePath) ? exePath : null;
    } finally {
      try { unlinkSync(csPath); } catch {}
    }
  } catch {
    return null;
  }
}

type Run = (file: string, args: string[], timeoutMs: number) => Promise<string>;

const run: Run = (file, args, timeoutMs) => new Promise((resolve, reject) => {
  execFile(file, args, { encoding: "utf8", timeout: timeoutMs, windowsHide: true }, (error, stdout) => error ? reject(error) : resolve(String(stdout)));
});

const SIZE = /(\d{3,5}(?:\.\d+)?)x(\d{3,5}(?:\.\d+)?)/u;
const SERVER_SCREEN: Screen = { width: 1920, height: 1080 };
const MAC_SCREEN = `ObjC.import("AppKit"); const size = $.NSScreen.screens.objectAtIndex(0).frame.size; Math.round(size.width) + "x" + Math.round(size.height)`;
/** WPF reports the primary screen in device-independent pixels, the unit of a page's `screen.width`. F0 rounds away the
 * fractional DIPs of a scaled display (150% gives 1706.666…), which a coarse scan would otherwise read as 66667. */
const WINDOWS_SCREEN = "Add-Type -AssemblyName PresentationFramework; '{0:F0}x{1:F0}' -f [System.Windows.SystemParameters]::PrimaryScreenWidth, [System.Windows.SystemParameters]::PrimaryScreenHeight";

/** The primary display, as headed Chrome reports `screen` on it; a server has none and declares 1920×1080. */
export async function primaryScreen(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, runCommand: Run = run): Promise<Screen> {
  const parse = (output: string): Screen | null => {
    const match = SIZE.exec(output);
    return match ? { width: Math.round(Number(match[1])), height: Math.round(Number(match[2])) } : null;
  };
  const named = parse(env.OMB_BROWSER_SCREEN?.trim() ?? "");
  if (named) return named;
  try {
    if (platform === "darwin") return parse(await runCommand("osascript", ["-l", "JavaScript", "-e", MAC_SCREEN], 5_000)) ?? SERVER_SCREEN;
    if (platform === "win32") return parse(await runCommand("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", WINDOWS_SCREEN], 15_000)) ?? SERVER_SCREEN;
    if (platform === "linux" && env.DISPLAY) {
      const lines = (await runCommand("xrandr", ["--current"], 5_000)).split("\n").filter((line) => / connected /u.test(line));
      return parse(lines.find((line) => / primary /u.test(line)) ?? lines[0] ?? "") ?? SERVER_SCREEN;
    }
  } catch {}
  return SERVER_SCREEN;
}

/** Explicit OMB_BROWSER_LANG, app language, then the POSIX locale; "C" and "POSIX" name no language. */
export function browserLanguage(env: NodeJS.ProcessEnv, configured?: string): string | undefined {
  const named = env.OMB_BROWSER_LANG?.trim();
  if (named && /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u.test(named)) return named;
  const app = configured?.trim();
  if (app && /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u.test(app)) {
    try {
      const canonical = Intl.getCanonicalLocales(app)[0];
      return canonical?.toLowerCase() === "ko" ? "ko-KR" : canonical;
    } catch {}
  }
  const locale = env.LC_ALL?.trim() || env.LC_MESSAGES?.trim() || env.LANG?.trim() || "";
  if (/^(?:C|POSIX)(?:[.@].*)?$/u.test(locale)) return "en-US";
  const match = /^([a-z]{2,3})(?:_([A-Z]{2}))?(?:[.@]|$)/u.exec(locale);
  return match ? (match[2] ? `${match[1]}-${match[2]}` : match[1]) : undefined;
}

/** The languages pages are told, best first, for the person's language: "pt-BR" gives "pt-BR,pt,en-US,en", none "en-US,en".
 * As a list, never with q-values: Chrome adds those to the Accept-Language header itself, and navigator.languages would
 * otherwise list "en;q=0.9" as a language. A headless Chrome on Linux tells pages only its first language (Chrome 155),
 * so the bots' browsers are given the whole list. */
export function languageList(language: string | undefined): string {
  const first = language ?? "en-US";
  const base = first.split("-")[0]!;
  return [first, ...(base !== first ? [base] : []), ...(base === "en" ? [] : ["en-US", "en"])].join(",");
}

/** The zone the server runs in, which is also the one each turn's clock shows; Windows Chrome ignores TZ. */
export function browserTimeZone(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string | undefined {
  const zone = env.OMB_BROWSER_TIMEZONE?.trim() || (platform === "win32" ? "" : env.TZ?.trim() || "");
  return /^:?[A-Za-z0-9_+\-./]{1,64}$/u.test(zone) ? zone : undefined;
}
