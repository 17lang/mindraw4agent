#!/usr/bin/env bash
set -euo pipefail

if ! command -v codex >/dev/null 2>&1; then
  echo "codex CLI is required to uninstall mindraw4agent." >&2
  exit 1
fi

codex plugin remove mindraw@mindraw4agent || true
codex plugin marketplace remove mindraw4agent || true
codex plugin list
