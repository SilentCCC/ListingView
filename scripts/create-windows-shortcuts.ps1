$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$shell = New-Object -ComObject WScript.Shell
$desktop = [Environment]::GetFolderPath('Desktop')

foreach ($shortcut in @(
  @{
    Name = 'ListingView 启动'
    Arguments = "-NoProfile -ExecutionPolicy Bypass -Command `"try { `$env:VITE_OPEN_BROWSER='true'; & '$(Join-Path $PSScriptRoot 'start-windows.ps1')' } catch { if (`$_.Exception.Message -notmatch 'already running') { throw }; explorer.exe 'http://localhost:5173' }`""
    Description = '启动 ListingView 前后端服务并打开浏览器'
  },
  @{
    Name = 'ListingView 关闭'
    Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $PSScriptRoot 'stop-windows.ps1')`""
    Description = '关闭本次启动的 ListingView 服务'
  }
)) {
  $linkPath = Join-Path $desktop ($shortcut.Name + '.lnk')
  $link = $shell.CreateShortcut($linkPath)
  $link.TargetPath = Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
  $link.Arguments = $shortcut.Arguments
  $link.WorkingDirectory = $root
  $link.Description = $shortcut.Description
  $link.IconLocation = "$env:SystemRoot\System32\shell32.dll,137"
  $link.Save()
  Write-Host "Created: $linkPath"
}
