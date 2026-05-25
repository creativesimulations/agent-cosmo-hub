#!/usr/bin/env bash
# Hermes v0.13.0 sync — May 2026 (Ronbot)
set -euo pipefail

echo "[ronbot-bootstrap] Verifying Ubuntu prerequisites for Hermes..."

if ! command -v sudo >/dev/null 2>&1; then
  echo "[ronbot-bootstrap] sudo missing. Run as root or install sudo first."
  exit 1
fi

echo "[ronbot-bootstrap] Installing baseline packages..."
sudo apt-get update
sudo apt-get install -y git curl wget

echo "[ronbot-bootstrap] Installing optional packages for richer Hermes features..."
sudo apt-get install -y ripgrep ffmpeg || true

echo "[ronbot-bootstrap] Done. You can now run Ronbot install flow."
