#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
command -v node >/dev/null || { echo 'Node.js 20+ is required.' >&2; exit 1; }
node -e 'if(Number(process.versions.node.split(".")[0])<20)process.exit(1)' || { echo 'Node.js 20+ is required.' >&2; exit 1; }
command -v codex >/dev/null || { echo 'Codex CLI is required.' >&2; exit 1; }
codex mcp add mindraw_mcp -- bash "$ROOT_DIR/plugins/mindraw/scripts/start-mcp.sh"
echo 'Configured mindraw_mcp. Open a new Codex chat and verify read_mindraw_frame is available.'
