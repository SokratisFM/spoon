# Installs (or reinstalls) Spoon on Windows, from PowerShell:
#   irm https://github.com/__REPO__/releases/latest/download/install.ps1 | iex
# Installs per-user (no admin rights); downloading here avoids the SmartScreen prompt a browser
# download of an unsigned installer gets.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$base = if ($env:SPOON_DOWNLOAD_BASE) { $env:SPOON_DOWNLOAD_BASE } else { 'https://github.com/__REPO__/releases/latest/download' }
$setup = Join-Path $env:TEMP 'Spoon-Setup.exe'

# INSTALLERS lists "<sha256>  <link>": the full installer (in the release that last changed
# Electron) and, when this release only changed Spoon's code, that code, which goes over it.
$list = (Invoke-WebRequest "$base/INSTALLERS" -UseBasicParsing).Content
if ($list -is [byte[]]) { $list = [Text.Encoding]::UTF8.GetString($list) }
function Get-Checked($pattern, $dest) {
  $line = ($list -split "`n") | Where-Object { $_ -match $pattern } | Select-Object -First 1
  if (-not $line) { return $false }
  $parts = $line.Trim() -split '\s+'
  Write-Host "Downloading $($parts[-1].Split('/')[-1])..."
  Invoke-WebRequest $parts[-1] -OutFile $dest -UseBasicParsing
  if ((Get-FileHash $dest -Algorithm SHA256).Hash.ToLower() -ne $parts[0].ToLower()) {
    Remove-Item $dest -Force
    throw "The download doesn't match its checksum. Nothing was installed."
  }
  return $true
}
if (-not (Get-Checked '/Spoon-[0-9][^ /]*-win-x64-setup\.exe\s*$' $setup)) { throw 'This release has no Windows installer.' }

Unblock-File $setup
Start-Process $setup -ArgumentList '/S' -Wait
Remove-Item $setup -Force

# Where the installer put Spoon (per user, no admin rights).
$exe = Get-ChildItem "$env:LOCALAPPDATA\Programs" -Filter 'Spoon.exe' -Recurse -Depth 1 -ErrorAction SilentlyContinue | Select-Object -First 1
$code = Join-Path $env:TEMP 'Spoon-code.zip'
if ($exe -and (Get-Checked '/Spoon-[0-9][^ /]*-win-x64-code\.zip\s*$' $code)) {
  $unpacked = Join-Path $env:TEMP 'Spoon-code'
  if (Test-Path $unpacked) { Remove-Item $unpacked -Recurse -Force }
  Expand-Archive $code $unpacked
  robocopy (Join-Path $unpacked 'resources') (Join-Path $exe.DirectoryName 'resources') /MIR /R:3 /W:1 /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { Write-Host 'Couldn''t lay the latest code over the install; Spoon will update itself.' }
  Remove-Item $code, $unpacked -Recurse -Force
}
if ($exe) { Start-Process $exe.FullName }
Write-Host 'Spoon is installed. It will update itself from now on.'
