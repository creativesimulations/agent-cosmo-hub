

# Hermes Agent Control Panel — Electron Desktop App

A modern dark glass-styled desktop application for installing, configuring, and monitoring NousResearch's Hermes Agent.

## Core Screens

### 1. Welcome / Connection Screen
- **Connect to running agent**: Enter the Hermes gateway URL or detect a locally running instance
- **Install & Setup Wizard**: Step-by-step guided installation (Python/pip install, initial config, provider setup, first run) — mirrors `hermes_cli/setup.py` flow with a visual UI

### 2. Dashboard (Main View)
- Agent health status (online/offline, uptime, CPU/memory)
- Active sub-agents list with current task descriptions (from `delegate_tool`)
- Live activity feed / log stream from the agent
- Quick-action buttons (restart, pause, open terminal)

### 3. Sub-Agent Monitor
- Tree/graph view of parent agent → spawned sub-agents
- Per-agent: status, current task, model being used, token usage
- Ability to kill/pause individual sub-agents

### 4. LLM Configuration
- List of configured providers (OpenAI, Anthropic, local models via Ollama/vLLM, etc.)
- Toggle which models are available to the agent
- Set default model, auxiliary model
- Local model setup helper (detect Ollama, configure endpoints)

### 5. API Keys & Credentials
- Secure entry and storage for provider API keys
- Maps to Hermes `auth.py` provider registry
- Show key status (valid/invalid/expired)
- Stored encrypted locally via Electron's safeStorage API

### 6. Skills Manager
- Browse installed, bundled, and optional skills
- Enable/disable skills per platform
- Install optional skills from the official repo
- View skill details and capabilities

### 7. Settings & Terminal
- Embedded terminal for direct Hermes CLI access
- Agent configuration editor (config.yaml)
- Gateway platform management (Telegram, Discord, etc.)
- Cron/scheduler job management

## Technical Approach
- **Electron app** packaged for Windows, macOS, and Linux
- **React + Tailwind** UI with the modern dark glass aesthetic you chose
- **Admin/CLI access** via Node.js `child_process` in Electron main process
- Communication with Hermes via its Gateway API server and direct CLI commands
- All screens built as React routes with smooth transitions

## Design System
- Dark gradient background (slate-950 → indigo-950)
- Glassmorphism cards (backdrop-blur, white/5 backgrounds, white/10 borders)
- Violet/indigo/cyan accent colors for metrics and highlights
- Clean typography, rounded corners, subtle shadows

