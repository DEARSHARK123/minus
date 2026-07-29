# Timed freeze-safe verification for minus Next.js app.
# Hard timeouts + auto-kill if node process count spikes.
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location -LiteralPath $root

function Get-NodeCount {
  @(Get-Process node -ErrorAction SilentlyContinue).Count
}

function Stop-NextLike {
  Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue |
    ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
  Get-CimInstance Win32_Process -Filter "name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match 'next|turbopack|minus' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

function Fail($msg) {
  Write-Output "FAIL: $msg"
  Stop-NextLike
  exit 1
}

Write-Output "=== timed verify start ==="
Write-Output ("projectRoot={0}" -f $root)
Write-Output ("nodeBefore={0}" -f (Get-NodeCount))
Stop-NextLike
Start-Sleep -Seconds 1

$logOut = Join-Path $root '.tmp-verify-dev.out.log'
$logErr = Join-Path $root '.tmp-verify-dev.err.log'
foreach ($f in @($logOut, $logErr)) {
  if (Test-Path $f) { Remove-Item -Force $f }
}

$proc = Start-Process -FilePath 'npm.cmd' -ArgumentList 'run','dev' `
  -WorkingDirectory $root -PassThru -NoNewWindow `
  -RedirectStandardOutput $logOut -RedirectStandardError $logErr

$ready = $false
$deadline = (Get-Date).AddSeconds(45)
while ((Get-Date) -lt $deadline) {
  if ((Get-NodeCount) -gt 80) {
    Fail ("node spike during boot: {0}" -f (Get-NodeCount))
  }
  $text = ''
  if (Test-Path $logOut) { $text += (Get-Content -LiteralPath $logOut -Raw -ErrorAction SilentlyContinue) }
  if (Test-Path $logErr) { $text += (Get-Content -LiteralPath $logErr -Raw -ErrorAction SilentlyContinue) }
  if ($text -match 'Ready') { $ready = $true; break }
  if ($text -match "Can't resolve 'tailwindcss'") {
    Fail 'tailwindcss resolve error during boot'
  }
  if ($text -match 'Out of memory|Fatal process out of memory') {
    Fail 'OOM during boot'
  }
  Start-Sleep -Milliseconds 400
}

if (-not $ready) {
  Fail 'dev server not Ready within 45s'
}

Write-Output ("Ready ok; nodeAfterBoot={0}" -f (Get-NodeCount))

# Homepage compile probe — hard 20s timeout
$nodesBeforeHome = Get-NodeCount
try {
  $homeProbe = curl.exe --max-time 20 -sS -o NUL -w "HTTP:%{http_code} TIME:%{time_total}" http://127.0.0.1:3000/
  Write-Output ("HOME {0}" -f $homeProbe)
} catch {
  Fail ("homepage probe exception: {0}" -f $_.Exception.Message)
}
$nodesAfterHome = Get-NodeCount
Write-Output ("nodeAfterHome={0} (delta={1})" -f $nodesAfterHome, ($nodesAfterHome - $nodesBeforeHome))

$devLog = ''
if (Test-Path $logOut) { $devLog += (Get-Content -LiteralPath $logOut -Raw -ErrorAction SilentlyContinue) }
if (Test-Path $logErr) { $devLog += (Get-Content -LiteralPath $logErr -Raw -ErrorAction SilentlyContinue) }
if ($devLog -match "Can't resolve 'tailwindcss'") {
  Fail 'tailwindcss resolve error after homepage'
}
if ($devLog -match 'Out of memory|Fatal process out of memory') {
  Fail 'OOM after homepage'
}
if ($nodesAfterHome -gt 80) {
  Fail ("node spike after homepage: {0}" -f $nodesAfterHome)
}
if ($homeProbe -notmatch 'HTTP:200') {
  Fail ("homepage not 200: {0}" -f $homeProbe)
}

# Learning API probe — hard 10s timeout
$bodyFile = Join-Path $root '.tmp-verify-api-body.json'
Set-Content -LiteralPath $bodyFile -Value '{"action":"getAll"}' -Encoding ascii
try {
  $apiProbe = curl.exe --max-time 10 -sS -H "Content-Type: application/json" `
    --data-binary "@$bodyFile" `
    -w "`nHTTP:%{http_code} TIME:%{time_total}" `
    http://127.0.0.1:3000/api/learning
  Write-Output ("API {0}" -f $apiProbe)
} catch {
  Fail ("api probe exception: {0}" -f $_.Exception.Message)
}

if ($apiProbe -notmatch '"success"\s*:\s*true') {
  try {
    $body = @{ action = 'getAll' } | ConvertTo-Json -Compress
    $json = Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/learning' -Method Post `
      -ContentType 'application/json' -Body $body -TimeoutSec 10
    Write-Output ("API_JSON success={0}" -f $json.success)
    if (-not $json.success) { Fail 'learning API success=false' }
  } catch {
    Fail ("learning API failed: {0}" -f $_.Exception.Message)
  }
}

Write-Output ("nodeFinal={0}" -f (Get-NodeCount))
Stop-NextLike
Start-Sleep -Seconds 1
Write-Output ("nodeAfterCleanup={0}" -f (Get-NodeCount))
Write-Output 'PASS: timed verify ok'
exit 0
