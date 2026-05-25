# Hermes Managed Bootstrap (Ronbot)

This folder provides optional bootstrap scripts for managed fleets where end-user privilege prompts are restricted.

## Scripts

- `scripts/bootstrap/windows-hermes-prereqs.ps1`
  - Ensures WSL2 + Ubuntu are present.
  - Installs baseline packages (`git`, `curl`, `wget`) inside Ubuntu.
- `scripts/bootstrap/macos-hermes-prereqs.sh`
  - Verifies `git` and `curl`.
  - Uses Homebrew for optional extras (`ripgrep`, `ffmpeg`) when available.
- `scripts/bootstrap/ubuntu-hermes-prereqs.sh`
  - Installs baseline packages (`git`, `curl`, `wget`) and optional extras.

## Scope

- These scripts prepare host prerequisites only.
- Hermes itself is still installed by Ronbot using the official Hermes installer.
- If browser dependencies are blocked by policy, use Ronbot's core install mode and skip browser extras.

## Intended Use

- Intune/Jamf/MDM pre-provisioning
- Golden image preparation
- Locked-down enterprise endpoints
