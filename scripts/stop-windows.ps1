$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$processFile = Join-Path $root '.listingview-process.json'

if (-not (Test-Path -LiteralPath $processFile)) {
  Write-Host 'No ListingView process record found; nothing was stopped.'
  exit 0
}

$record = Get-Content -LiteralPath $processFile -Raw | ConvertFrom-Json
if ([System.IO.Path]::GetFullPath($record.Root) -ne [System.IO.Path]::GetFullPath($root)) {
  throw 'The process record belongs to a different project directory; refusing to stop processes.'
}

$rootProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($record.ProcessId)" -ErrorAction SilentlyContinue
if (-not $rootProcess) {
  Remove-Item -LiteralPath $processFile -Force
  Write-Host 'ListingView was already stopped.'
  exit 0
}
if ($rootProcess.CommandLine -notmatch 'npm(\.cmd)?["'']?\s+run\s+dev') {
  throw "PID $($record.ProcessId) no longer matches the ListingView launcher; refusing to stop it."
}

$allProcesses = @(Get-CimInstance Win32_Process)
$descendants = [System.Collections.Generic.List[uint32]]::new()
function Add-ChildProcesses([uint32]$ParentId) {
  foreach ($child in $allProcesses | Where-Object { $_.ParentProcessId -eq $ParentId }) {
    Add-ChildProcesses -ParentId $child.ProcessId
    $descendants.Add([uint32]$child.ProcessId)
  }
}
Add-ChildProcesses -ParentId ([uint32]$record.ProcessId)
foreach ($processId in $descendants) {
  Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
}
Stop-Process -Id $record.ProcessId -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $processFile -Force
Write-Host 'ListingView has been stopped.'
