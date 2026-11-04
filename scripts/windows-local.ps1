param(
  [ValidateSet("start", "stop", "restart", "pair", "status", "autostart-on", "autostart-off", "desktop-shortcut")]
  [string]$Action = "start",
  [int]$Port = 8799,
  [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$DataDir = if ($env:OMB_DATA_DIR) { $env:OMB_DATA_DIR } else { Join-Path $HOME ".openmausbot" }
$LogsDir = Join-Path $DataDir "logs"
$OutLog = Join-Path $LogsDir "bigman-web.out.log"
$ErrLog = Join-Path $LogsDir "bigman-web.err.log"
$StartupVbs = Join-Path ([Environment]::GetFolderPath("Startup")) "BigmanBot.vbs"
$DesktopLnk = Join-Path ([Environment]::GetFolderPath("Desktop")) "Bigman Bot.lnk"
$LauncherVbs = Join-Path $RepoRoot "scripts\launch-bigman.vbs"

function Resolve-Node24 {
  $fnmRoot = Join-Path $env:APPDATA "fnm\node-versions"
  if (Test-Path $fnmRoot) {
    $candidates = Get-ChildItem -Path $fnmRoot -Directory -Filter "v24.*" -ErrorAction SilentlyContinue |
      Sort-Object Name -Descending
    foreach ($dir in $candidates) {
      $exe = Join-Path $dir.FullName "installation\node.exe"
      if (Test-Path $exe) { return $exe }
    }
  }
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  throw "Node.js 24+ not found."
}

function Get-ServerHealth {
  try {
    return Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 2
  } catch {
    return $null
  }
}

function Stop-BigmanServer {
  $conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  foreach ($conn in $conns) {
    if ($conn.OwningProcess -gt 4) {
      $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $($conn.OwningProcess)" -ErrorAction SilentlyContinue
      if ($proc -and $proc.ParentProcessId -gt 4) {
        $parent = Get-CimInstance Win32_Process -Filter "ProcessId = $($proc.ParentProcessId)" -ErrorAction SilentlyContinue
        if ($parent -and $parent.Name -eq "node.exe" -and $parent.CommandLine -like "*openmausbot*") {
          & taskkill /PID $parent.ProcessId /T /F | Out-Null
          continue
        }
      }
      & taskkill /PID $conn.OwningProcess /T /F | Out-Null
    }
  }
  $deadline = (Get-Date).AddSeconds(8)
  while ((Get-Date) -lt $deadline) {
    if (-not (Get-ServerHealth)) { return }
    Start-Sleep -Milliseconds 200
  }
}

function Open-BigmanBrowser([string]$NodeExe, [string]$CliJs) {
  $url = "http://127.0.0.1:$Port/"
  try {
    $pairOut = (& $NodeExe $CliJs pair --port $Port --label "Windows PC" 2>$null) -join "`n"
    if ($pairOut -match "code=([A-Za-z0-9_-]+)") {
      $code = $Matches[1]
      $url = "http://127.0.0.1:$Port/#code=$code"
      Write-Output "Pairing code: $code"
      Write-Output "Open link:    $url"
    }
  } catch {}
  Start-Process "explorer.exe" -ArgumentList $url | Out-Null
}

function Start-BigmanServer {
  $nodeExe = Resolve-Node24
  $nodeDir = Split-Path -Parent $nodeExe
  $env:PATH = "$nodeDir;$env:PATH"

  $cliJs = Join-Path $RepoRoot "dist-server\openmausbot.js"
  $uiHtml = Join-Path $RepoRoot "dist\index.html"
  if (-not ((Test-Path $cliJs) -and (Test-Path $uiHtml))) {
    throw "Production build missing ($cliJs or $uiHtml). Run 'pnpm build && pnpm build:server' first."
  }

  $health = Get-ServerHealth
  if ($health -and $health.static -eq $true) {
    if (-not $NoBrowser) { Open-BigmanBrowser -NodeExe $nodeExe -CliJs $cliJs }
    Write-Output "Bigman Bot is running at http://127.0.0.1:$Port/"
    return
  }
  if ($health) {
    Stop-BigmanServer
  }

  New-Item -ItemType Directory -Force -Path $LogsDir | Out-Null
  $cmdLine = "cmd.exe /d /s /c ""set PATH=$nodeDir;%PATH% && ""$nodeExe"" ""$cliJs"" serve --port $Port --no-pair --local >> ""$OutLog"" 2>> ""$ErrLog"""""
  $startup = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = [uint16]0 }
  $created = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
    CommandLine = $cmdLine
    CurrentDirectory = $RepoRoot
    ProcessStartupInformation = $startup
  } -ErrorAction SilentlyContinue
  if (-not $created -or $created.ReturnValue -ne 0) {
    Start-Process -FilePath $nodeExe `
      -ArgumentList @($cliJs, "serve", "--port", "$Port", "--no-pair", "--local") `
      -WorkingDirectory $RepoRoot `
      -WindowStyle Hidden `
      -RedirectStandardOutput $OutLog `
      -RedirectStandardError $ErrLog | Out-Null
  }

  $deadline = (Get-Date).AddSeconds(20)
  $ready = $false
  while ((Get-Date) -lt $deadline) {
    $check = Get-ServerHealth
    if ($check -and $check.static -eq $true) {
      $ready = $true
      break
    }
    Start-Sleep -Milliseconds 250
  }
  if (-not $ready) {
    throw "Bigman Bot did not become ready on port $Port. Check logs at $ErrLog"
  }

  if (-not $NoBrowser) {
    Open-BigmanBrowser -NodeExe $nodeExe -CliJs $cliJs
  }
  Write-Output "Bigman Bot started in background at http://127.0.0.1:$Port/"
}

switch ($Action) {
  "start" {
    Start-BigmanServer
  }
  "stop" {
    Stop-BigmanServer
    Write-Output "Bigman Bot stopped."
  }
  "restart" {
    Stop-BigmanServer
    Start-BigmanServer
  }
  "pair" {
    $nodeExe = Resolve-Node24
    $cliJs = Join-Path $RepoRoot "dist-server\openmausbot.js"
    Open-BigmanBrowser -NodeExe $nodeExe -CliJs $cliJs
  }
  "status" {
    $h = Get-ServerHealth
    $auto = Test-Path $StartupVbs
    if ($h) {
      Write-Output "Status: RUNNING (PID $($h.pid), static=$($h.static)) at http://127.0.0.1:$Port/ | AutoStart=$auto"
    } else {
      Write-Output "Status: STOPPED | AutoStart=$auto"
    }
  }
  "autostart-on" {
    $scriptPath = Join-Path $RepoRoot "scripts\windows-local.ps1"
    $vbs = "CreateObject(""WScript.Shell"").Run ""powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """"$scriptPath"""" start -NoBrowser"", 0, False"
    Set-Content -Path $StartupVbs -Value $vbs -Encoding ASCII
    Write-Output "Enabled Windows login auto-start: $StartupVbs"
  }
  "autostart-off" {
    if (Test-Path $StartupVbs) { Remove-Item -Force $StartupVbs }
    Write-Output "Disabled Windows login auto-start."
  }
  "desktop-shortcut" {
    $wsh = New-Object -ComObject WScript.Shell
    $sc = $wsh.CreateShortcut($DesktopLnk)
    $sc.TargetPath = "wscript.exe"
    $sc.Arguments = """$LauncherVbs"""
    $sc.WorkingDirectory = $RepoRoot
    $sc.Description = "Mo Bigman Bot (Chay ngam Web UI)"
    $ico = Join-Path $RepoRoot "build\icon.ico"
    if (Test-Path $ico) { $sc.IconLocation = $ico }
    $sc.Save()
    Write-Output "Created Desktop shortcut: $DesktopLnk"
  }
}
