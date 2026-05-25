# Hermes v0.13.0 sync — May 2026 (Ronbot)
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Write-Host "[ronbot-bootstrap] Verifying Windows prerequisites for Hermes (WSL path)..."

if (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) {
  Write-Host "[ronbot-bootstrap] WSL missing. Installing WSL + Ubuntu (requires admin, reboot may be required)..."
  wsl --install -d Ubuntu
  Write-Host "[ronbot-bootstrap] Reboot if prompted, then re-run this bootstrap."
  exit 0
}

$wslStatus = wsl --status 2>$null
if ($LASTEXITCODE -ne 0) {
  Write-Host "[ronbot-bootstrap] Unable to query WSL status. Run in elevated PowerShell."
  exit 1
}

if ($wslStatus -notmatch "Default Version:\s*2") {
  Write-Host "[ronbot-bootstrap] Configuring WSL default version to 2..."
  wsl --set-default-version 2
}

$distros = wsl -l -q
if (-not ($distros -match "Ubuntu")) {
  Write-Host "[ronbot-bootstrap] Ubuntu distro not found. Installing..."
  wsl --install -d Ubuntu
  Write-Host "[ronbot-bootstrap] Launch Ubuntu once, create user, then re-run."
  exit 0
}

Write-Host "[ronbot-bootstrap] Installing baseline packages inside Ubuntu..."
$inner = @'
set -e
sudo apt-get update
sudo apt-get install -y git curl wget
echo "[ronbot-bootstrap] baseline packages ready"
'@
wsl bash -lc $inner

Write-Host "[ronbot-bootstrap] Done. You can now run Ronbot install flow."
