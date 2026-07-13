#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CALLER_DIR="$PWD"
PORT="${MINDRAW_CANVAS_PORT:-43227}"
PROJECT_ROOT="${MINDRAW_PROJECT_ROOT:-${1:-$CALLER_DIR}}"

export MINDRAW_PROJECT_ROOT="$PROJECT_ROOT"
export MINDRAW_CANVAS_PORT="$PORT"

cd "$ROOT_DIR"

exec node ./scripts/mindraw-canvas-service.mjs serve --project-root "$PROJECT_ROOT" --port "$PORT"
