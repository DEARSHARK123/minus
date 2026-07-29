#Requires -Version 5.1
<#
.SYNOPSIS
  Build a double-clickable portable Minus package (blank userdata, no npm run dev).

.DESCRIPTION
  - next build (standalone)
  - Assemble dist/Minus-Portable with launcher scripts
  - Fresh empty userdata/ (MINUS_DATA_DIR) — no chat/learning history shipped
  - Does NOT copy .env.local secrets by default
  - Optional -BundleNode downloads official Node.js Windows x64 into runtime/

.PARAMETER OutDir
  Output folder. Default: <repo>/dist/Minus-Portable

.PARAMETER BundleNode
  Download and embed portable Node.js so recipients need not install Node.

.PARAMETER IncludeEnvLocal
  Copy .env.local into the package (contains secrets — only for private handoff).

.PARAMETER SkipBuild
  Reuse existing .next/standalone (faster iteration).

.PARAMETER Port
  Default listen port written into launchers (default 3000).
#>
[CmdletBinding()]
param(
  [string]$OutDir = "",
  [switch]$BundleNode,
  [switch]$IncludeEnvLocal,
  [switch]$SkipBuild,
  [int]$Port = 3000
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
if (-not $OutDir) {
  $OutDir = Join-Path $ProjectRoot "dist\Minus-Portable"
}

$NodeVersion = "v22.14.0"
$NodeZipName = "node-$NodeVersion-win-x64.zip"
$NodeUrl = "https://nodejs.org/dist/$NodeVersion/$NodeZipName"

function Write-Step([string]$msg) {
  Write-Host ""
  Write-Host "==> $msg" -ForegroundColor Cyan
}

function Ensure-Dir([string]$path) {
  New-Item -ItemType Directory -Force -Path $path | Out-Null
}

function Copy-Tree([string]$src, [string]$dst) {
  if (-not (Test-Path $src)) {
    throw "Missing source: $src"
  }
  Ensure-Dir (Split-Path -Parent $dst)
  if (Test-Path $dst) {
    Remove-Item -Recurse -Force $dst
  }
  Copy-Item -Recurse -Force $src $dst
}

Set-Location $ProjectRoot
Write-Host "Project: $ProjectRoot"
Write-Host "Output:  $OutDir"

# --- Build ---
if (-not $SkipBuild) {
  Write-Step "npm run build (standalone)"
  npm.cmd run build
  if ($LASTEXITCODE -ne 0) { throw "next build failed (exit $LASTEXITCODE)" }
} else {
  Write-Step "SkipBuild: reuse existing .next/standalone"
}

$standalone = Join-Path $ProjectRoot ".next\standalone"
if (-not (Test-Path (Join-Path $standalone "server.js"))) {
  throw "standalone server.js not found. Run a full build first."
}

# --- Clean output ---
Write-Step "Assemble package at $OutDir"
if (Test-Path $OutDir) {
  Remove-Item -Recurse -Force $OutDir
}
Ensure-Dir $OutDir
$appDir = Join-Path $OutDir "app"
Ensure-Dir $appDir

# Standalone server tree
Write-Step "Copy standalone server"
Get-ChildItem $standalone -Force | ForEach-Object {
  Copy-Item -Recurse -Force $_.FullName (Join-Path $appDir $_.Name)
}

# Static assets (required by Next standalone)
$staticSrc = Join-Path $ProjectRoot ".next\static"
$staticDst = Join-Path $appDir ".next\static"
Write-Step "Copy .next/static"
Ensure-Dir (Join-Path $appDir ".next")
Copy-Tree $staticSrc $staticDst

# Public assets (brand logos, pixel icons, …)
$publicSrc = Join-Path $ProjectRoot "public"
if (Test-Path $publicSrc) {
  Write-Step "Copy public/"
  Copy-Tree $publicSrc (Join-Path $appDir "public")
}

# Skills (also traced into standalone; re-copy for safety)
$skillsSrc = Join-Path $ProjectRoot "skills"
if (Test-Path $skillsSrc) {
  Write-Step "Copy skills/"
  Copy-Tree $skillsSrc (Join-Path $appDir "skills")
}

# --- Blank userdata (no history) ---
Write-Step "Create blank userdata (no history)"
$userData = Join-Path $OutDir "userdata"
$dataDir = Join-Path $userData "data"
$workspaceDir = Join-Path $userData "workspace"
Ensure-Dir $dataDir
Ensure-Dir $workspaceDir
Ensure-Dir (Join-Path $userData "logs")
# Placeholder so empty folders survive zip tools
@(
  (Join-Path $dataDir ".gitkeep"),
  (Join-Path $workspaceDir ".gitkeep"),
  (Join-Path $userData "logs\.gitkeep")
) | ForEach-Object {
  if (-not (Test-Path $_)) { New-Item -ItemType File -Path $_ -Force | Out-Null }
}
# Explicitly do NOT copy developer ~/.minus or any chat/learning dumps.

# --- Env (no secrets by default) ---
$envExample = Join-Path $ProjectRoot ".env.example"
$envDst = Join-Path $appDir ".env"
if ($IncludeEnvLocal) {
  $envLocal = Join-Path $ProjectRoot ".env.local"
  if (Test-Path $envLocal) {
    Write-Step "Copy .env.local (WARNING: includes secrets)"
    Copy-Item -Force $envLocal $envDst
  } else {
    Write-Warning ".env.local not found; falling back to .env.example"
    if (Test-Path $envExample) { Copy-Item -Force $envExample $envDst }
  }
} else {
  Write-Step "Ship .env.example as .env (no API keys)"
  if (Test-Path $envExample) {
    Copy-Item -Force $envExample $envDst
  }
  @"

# Portable package defaults (written by package-portable.ps1)
# Data stays inside this folder — blank on first run.
# MINUS_DATA_DIR and MINUS_WORKSPACE are set by the launcher.
"@ | Add-Content -Path $envDst -Encoding UTF8
}

# --- Optional portable Node ---
$runtimeNode = Join-Path $OutDir "runtime\node"
if ($BundleNode) {
  Write-Step "Bundle portable Node.js $NodeVersion"
  $cacheDir = Join-Path $ProjectRoot "dist\.cache"
  Ensure-Dir $cacheDir
  $zipPath = Join-Path $cacheDir $NodeZipName
  if (-not (Test-Path $zipPath)) {
    Write-Host "Downloading $NodeUrl ..."
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $NodeUrl -OutFile $zipPath -UseBasicParsing
  } else {
    Write-Host "Using cached $zipPath"
  }
  $extractTmp = Join-Path $cacheDir "node-extract"
  if (Test-Path $extractTmp) { Remove-Item -Recurse -Force $extractTmp }
  Ensure-Dir $extractTmp
  Expand-Archive -Path $zipPath -DestinationPath $extractTmp -Force
  $extracted = Get-ChildItem $extractTmp -Directory | Select-Object -First 1
  if (-not $extracted) { throw "Node zip extract failed" }
  Ensure-Dir (Split-Path -Parent $runtimeNode)
  if (Test-Path $runtimeNode) { Remove-Item -Recurse -Force $runtimeNode }
  Move-Item $extracted.FullName $runtimeNode
  if (-not (Test-Path (Join-Path $runtimeNode "node.exe"))) {
    throw "node.exe missing after extract"
  }
  Write-Host "Embedded: $runtimeNode\node.exe"
}

# --- Launchers ---
Write-Step "Write launchers (ASCII filenames only — zip-safe on all Windows locales)"
$launcherBat = Join-Path $OutDir "Start-Minus.bat"
$stopBat = Join-Path $OutDir "Stop-Minus.bat"
$launcherVbs = Join-Path $OutDir "Start-Minus.vbs"
# English name avoids mojibake when Compress-Archive / Explorer mishandle UTF-8 zip names
$readme = Join-Path $OutDir "README.txt"

# UTF-8 with BOM helps Chinese filenames on older Windows cmd when saved carefully;
# content itself is mostly ASCII-safe with Chinese comments.
# Keep .bat messages ASCII-only so cmd.exe never mangles encoding.
# Chinese docs live in 使用说明.txt only.
$startBatContent = @"
@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "PORT=$Port"
set "ROOT=%~dp0"
set "APP=%ROOT%app"
set "MINUS_DATA_DIR=%ROOT%userdata\data"
set "MINUS_WORKSPACE=%ROOT%userdata\workspace"
set "HOSTNAME=127.0.0.1"

if not exist "%MINUS_DATA_DIR%" mkdir "%MINUS_DATA_DIR%"
if not exist "%MINUS_WORKSPACE%" mkdir "%MINUS_WORKSPACE%"
if not exist "%ROOT%userdata\logs" mkdir "%ROOT%userdata\logs"

REM Prefer bundled Node (put first on PATH to avoid spaces in start command)
if exist "%ROOT%runtime\node\node.exe" (
  set "PATH=%ROOT%runtime\node;%PATH%"
) else (
  where node >nul 2>&1
  if errorlevel 1 (
    echo [Minus] Node.js not found.
    echo Install Node.js LTS from https://nodejs.org/
    echo Or rebuild package with: npm run package:portable:node
    pause
    exit /b 1
  )
)

REM Already running?
powershell -NoProfile -Command "try { `$r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 http://127.0.0.1:%PORT%/chat; if (`$r.StatusCode -ge 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
if not errorlevel 1 (
  echo [Minus] Already running. Opening browser...
  start "" "http://127.0.0.1:%PORT%/chat"
  exit /b 0
)

echo [Minus] Starting local server on port %PORT% ...
cd /d "%APP%"
start "Minus-Server" /min node server.js

REM Wait until HTTP responds (max ~45s)
set /a _tries=0
:waitloop
set /a _tries+=1
powershell -NoProfile -Command "try { `$r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 http://127.0.0.1:%PORT%/chat; if (`$r.StatusCode -ge 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
if not errorlevel 1 goto ready
if %_tries% GEQ 45 (
  echo [Minus] Start timeout. Run Stop-Minus.bat and retry.
  pause
  exit /b 1
)
timeout /t 1 /nobreak >nul
goto waitloop

:ready
echo [Minus] Ready. Opening browser...
start "" "http://127.0.0.1:%PORT%/chat"
exit /b 0
"@

$stopBatContent = @"
@echo off
setlocal
set "PORT=$Port"
echo [Minus] Stopping process on port %PORT% ...
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { try { Stop-Process -Id `$_ -Force -ErrorAction Stop; Write-Host ('Stopped PID ' + `$_) } catch { Write-Host ('Failed PID ' + `$_) } }; if (-not (Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue)) { Write-Host 'Nothing listening (or already stopped).' }"
echo Done.
timeout /t 2 >nul
"@

$vbsContent = @"
' Double-click entry: run launcher without a console window.
Option Explicit
Dim sh, fso, root, bat
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
' Prefer English filename for reliability across code pages
bat = root & "\Start-Minus.bat"
If Not fso.FileExists(bat) Then
  MsgBox "Start-Minus.bat not found next to this script.", 16, "Minus"
  WScript.Quit 1
End If
sh.Run """" & bat & """", 0, False
"@

$packStamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
$readmeTemplate = Join-Path $ProjectRoot 'packaging\README.txt'
if (-not (Test-Path $readmeTemplate)) {
  throw "Missing packaging\README.txt template"
}
$readmeContent = [System.IO.File]::ReadAllText($readmeTemplate).Replace('__PORT__', "$Port").Replace('__STAMP__', $packStamp)

# .bat must be UTF-8 WITHOUT BOM — BOM makes cmd treat the first line as invalid.
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
$utf8Bom = New-Object System.Text.UTF8Encoding $true
[System.IO.File]::WriteAllText($launcherBat, $startBatContent, $utf8NoBom)
[System.IO.File]::WriteAllText($stopBat, $stopBatContent, $utf8NoBom)
[System.IO.File]::WriteAllText($launcherVbs, $vbsContent, $utf8NoBom)
# README: UTF-8 with BOM for Notepad
[System.IO.File]::WriteAllText($readme, $readmeContent, $utf8Bom)

# No Chinese-named launcher copies: zip tools often corrupt non-ASCII entry names.

# --- Summary ---
Write-Step "Done"
$files = Get-ChildItem $OutDir -Recurse -File
$sizeMb = [math]::Round(($files | Measure-Object Length -Sum).Sum / 1MB, 1)
Write-Host ""
Write-Host "Package ready: $OutDir" -ForegroundColor Green
Write-Host "Files: $($files.Count)  Size: ~${sizeMb} MB"
Write-Host "Entry:  Start-Minus.vbs  /  Start-Minus.bat"
Write-Host "Data:   userdata\  (blank)"
Write-Host "Node:   $(if (Test-Path (Join-Path $runtimeNode 'node.exe')) { 'bundled' } else { 'system PATH required' })"
Write-Host "Secrets:$(if ($IncludeEnvLocal) { ' INCLUDED (.env.local) — private only' } else { ' not included' })"
Write-Host ""
Write-Host "Zip tip: Compress-Archive -Path '$OutDir\*' -DestinationPath 'dist\Minus-Portable.zip'"
