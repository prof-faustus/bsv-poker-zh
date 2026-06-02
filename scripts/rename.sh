#!/usr/bin/env bash
# core §0.4 — rename the project from a single source of truth (build/project.env).
# No source references the literal name outside generated files; this rewrites them.
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck disable=SC1091
source build/project.env
echo "Renaming to: PROJECT_NAME=$PROJECT_NAME NPM_SCOPE=$NPM_SCOPE GO_MODULE=$GO_MODULE IMAGE_TAG=$IMAGE_TAG"
echo "(Implemented in the build: rewrites @scope in package.json files, the Go module path,"
echo " the Tauri productName, and the VM image tag. Phase-0 placeholder — wired with the"
echo " desktop/VM packaging in §16.)"
