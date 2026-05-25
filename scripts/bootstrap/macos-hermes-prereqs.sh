#!/usr/bin/env bash
# Hermes v0.13.0 sync — May 2026 (Ronbot)
set -euo pipefail

echo "[ronbot-bootstrap] Verifying macOS prerequisites for Hermes..."

if ! command -v git >/dev/null 2>&1; then
  echo "[ronbot-bootstrap] git missing. Triggering Xcode Command Line Tools..."
  xcode-select --install || true
  echo "[ronbot-bootstrap] Complete Xcode CLT install, then rerun."
  exit 0
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "[ronbot-bootstrap] curl missing unexpectedly. Install Command Line Tools and rerun."
  exit 1
fi

if ! command -v brew >/dev/null 2>&1; then
  echo "[ronbot-bootstrap] Homebrew not detected."
  echo "Install Homebrew once: /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
  exit 0
fi

echo "[ronbot-bootstrap] Installing optional Hermes extras (ripgrep, ffmpeg)..."
brew install ripgrep ffmpeg || true

echo "[ronbot-bootstrap] Done. Core Hermes install can now run from Ronbot."
