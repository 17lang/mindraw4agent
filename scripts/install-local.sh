#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v codex >/dev/null 2>&1; then
  echo "codex CLI is required to install mindraw4agent." >&2
  exit 1
fi

command -v node >/dev/null || { echo "Node.js 20+ is required." >&2; exit 1; }
node -e 'if(Number(process.versions.node.split(".")[0])<20)process.exit(1)' || { echo "Node.js 20+ is required." >&2; exit 1; }

codex plugin marketplace add "$ROOT_DIR"
codex plugin add mindraw@mindraw4agent
echo "Mindraw plugin installed. Start a new Codex session and verify read_mindraw_frame."
