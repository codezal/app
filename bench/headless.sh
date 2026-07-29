#!/usr/bin/env bash
# OpenBench ADAPTER_SPEC entrypoint: <adapter-dir>/headless.sh
# Thin shim around the real headless CLI; works from any cwd.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
exec npx tsx bench/headless.ts "$@"
