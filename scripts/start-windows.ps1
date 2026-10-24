param(
  [int]$ClientPort = 5173,
  [int]$ServerPort = 5172
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

foreach ($dependencyPath in @(
  (Join-Path $root 'node_modules'),
  (Join-Path $root 'client/node_modules'),
  (Join-Path $root 'server/node_modules')
)) {
  if (-not (Test-Path -LiteralPath $dependencyPath)) {
    throw "Dependencies are missing. Run 'npm run install:all' first. Missing: $dependencyPath"
  }
}

$env:PORT = "$ServerPort"
$env:VITE_PORT = "$ClientPort"
$env:VITE_API_PROXY_TARGET = "http://localhost:$ServerPort"
$env:DATA_DIR = Join-Path $root 'data'
$env:CLIENT_DIST_DIR = Join-Path $root 'client/dist'
$env:CORS_ORIGIN = "http://localhost:$ClientPort"

$processFile = Join-Path $root '.listingview-process.json'
if (Test-Path -LiteralPath $processFile) {
  $existing = Get-Content -LiteralPath $processFile -Raw | ConvertFrom-Json
  $existingProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($existing.ProcessId)" -ErrorAction SilentlyContinue
  if ($existingProcess -and $existingProcess.CommandLine -match 'npm(\.cmd)?["'']?\s+run\s+dev') {
    throw "ListingView is already running (PID $($existing.ProcessId)). Use the stop shortcut first."
  }
  Remove-Item -LiteralPath $processFile -Force
}

$npmCommand = (Get-Command npm.cmd -ErrorAction Stop).Source
$process = Start-Process -FilePath $npmCommand -ArgumentList 'run', 'dev' -WorkingDirectory $root -WindowStyle Hidden -PassThru
@{ ProcessId = $process.Id; Root = $root } | ConvertTo-Json | Set-Content -LiteralPath $processFile -Encoding utf8
Write-Host "ListingView is starting. Frontend: http://localhost:$ClientPort"
Write-Host "Use the ListingView Stop shortcut to close it."
