<#
.SYNOPSIS
  Installs the `cloud` CLI on Windows.
.EXAMPLE
  irm https://github.com/muckmuckhub/cloud/releases/latest/download/install.ps1 | iex
.NOTES
  Published as a release asset by .github/workflows/ci.yml, which stamps the
  release tag in as the default Version. A pinned installer therefore installs
  the release it shipped with, rather than whatever is newest.
#>
[CmdletBinding()]
param(
  [string]$Repo    = $(if ($env:CLOUD_REPO)    { $env:CLOUD_REPO }    else { "muckmuckhub/cloud" }),
  [string]$Version = $(if ($env:CLOUD_VERSION) { $env:CLOUD_VERSION } else { "latest" }),
  [string]$BinDir  = $(if ($env:CLOUD_BIN_DIR) { $env:CLOUD_BIN_DIR } else { "$env:LOCALAPPDATA\Programs\cloud" })
)

$ErrorActionPreference = "Stop"

if ([Environment]::Is64BitOperatingSystem -eq $false) {
  throw "cloud requires 64-bit Windows."
}
if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") {
  Write-Warning "No native ARM64 build yet; installing the x64 binary to run under emulation."
}

$asset = "cloud-windows-x64.exe"
$base  = if ($Version -eq "latest") {
  "https://github.com/$Repo/releases/latest/download"
} else {
  "https://github.com/$Repo/releases/download/$Version"
}

$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ([System.Guid]::NewGuid())
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
  Write-Host "Downloading $asset..."
  Invoke-WebRequest -Uri "$base/$asset"        -OutFile "$tmp\cloud.exe" -UseBasicParsing
  Invoke-WebRequest -Uri "$base/$asset.sha256" -OutFile "$tmp\cloud.sha256" -UseBasicParsing

  Write-Host "Verifying checksum..."
  $expected = ((Get-Content "$tmp\cloud.sha256" -Raw).Trim() -split '\s+')[0]
  $actual   = (Get-FileHash "$tmp\cloud.exe" -Algorithm SHA256).Hash.ToLower()
  if ($expected.ToLower() -ne $actual) {
    throw "Checksum mismatch. Expected $expected, got $actual. Not installing."
  }

  New-Item -ItemType Directory -Path $BinDir -Force | Out-Null
  Move-Item "$tmp\cloud.exe" (Join-Path $BinDir "cloud.exe") -Force

  # Persist to the user PATH if it isn't already there.
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  if ($userPath -notlike "*$BinDir*") {
    [Environment]::SetEnvironmentVariable("Path", "$userPath;$BinDir", "User")
    Write-Host "Added $BinDir to your PATH. Open a new terminal to pick it up."
  }
  $env:Path = "$env:Path;$BinDir"

  Write-Host ""
  Write-Host "Installed to $BinDir\cloud.exe" -ForegroundColor Green

  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Warning "Docker was not found. Install Docker Desktop and enable the WSL 2 backend:"
    Write-Warning "  https://docs.docker.com/desktop/install/windows-install/"
  }

  Write-Host ""
  Write-Host "Next:  mkdir mynetwork; cd mynetwork; cloud init"
}
finally {
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
