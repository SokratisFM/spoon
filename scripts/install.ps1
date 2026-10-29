# Installs (or reinstalls) Spoon on Windows, from PowerShell:
#   irm https://github.com/__REPO__/releases/latest/download/install.ps1 | iex
# Installs per-user (no admin rights); downloading here avoids the SmartScreen prompt a browser
# download of an unsigned installer gets.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$base = if ($env:SPOON_DOWNLOAD_BASE) { $env:SPOON_DOWNLOAD_BASE } else { 'https://github.com/__REPO__/releases/latest/download' }
$setup = Join-Path $env:TEMP 'Spoon-Setup.exe'

# The release's checksum list names its installer (Spoon-<version>-win-x64-setup.exe).
$sums = (Invoke-WebRequest "$base/SHA256SUMS" -UseBasicParsing).Content
if ($sums -is [byte[]]) { $sums = [Text.Encoding]::UTF8.GetString($sums) }
$line = ($sums -split "`n") | Where-Object { $_ -match ' Spoon-[0-9][^ ]*-win-x64-setup\.exe\s*$' } | Select-Object -First 1
if (-not $line) { throw 'This release has no Windows installer.' }
$parts = $line.Trim() -split '\s+'
$expected = $parts[0].ToLower()
$file = $parts[-1]

Write-Host "Downloading $file..."
Invoke-WebRequest "$base/$file" -OutFile $setup -UseBasicParsing
$actual = (Get-FileHash $setup -Algorithm SHA256).Hash.ToLower()
if (-not $expected -or $expected -ne $actual) {
  Remove-Item $setup -Force
  throw "The download doesn't match its checksum. Nothing was installed."
}

Unblock-File $setup
Start-Process $setup -ArgumentList '/S', '--force-run' -Wait
Remove-Item $setup -Force
Write-Host 'Spoon is installed. It will update itself from now on.'
