#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v codex >/dev/null 2>&1; then
  echo "codex CLI is required to install mindraw4agent." >&2
  exit 1
fi

codex plugin marketplace add "$ROOT_DIR"
codex plugin add mindraw@mindraw4agent
codex plugin list
