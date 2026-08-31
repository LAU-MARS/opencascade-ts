#!/usr/bin/env bash
# Build the WASM artifact (dist/wasm/occtjs.js + occtjs.wasm).
#
# Usage:
#   bash etc/build-wasm.sh                 # OCCT_VERSION defaults to 7.9.3
#   OCCT_VERSION=8.0.0 bash etc/build-wasm.sh
#
# Requirements: Docker. First run compiles OCCT (~1-2 h); later runs reuse the
# cached image and only relink the glue layer (~1 min).

set -euo pipefail

OCCT_VERSION="${OCCT_VERSION:-7.9.3}"
IMAGE="opencascade-ts/occt-wasm:${OCCT_VERSION}"

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

echo "[build-wasm] base image ${IMAGE} (this is slow the first time)..."
docker build -f "${root}/etc/docker/Dockerfile" \
  --build-arg OCCT_VERSION="${OCCT_VERSION}" \
  -t "${IMAGE}" \
  "${root}"

mkdir -p "${root}/dist/wasm"

echo "[build-wasm] linking glue layer..."
# Git Bash (MSYS) rewrites leading-slash arguments of native executables
# (bash /src/… → C:/Program Files/Git/src/…). Disable conversion and pass
# Windows-style mounts (docker accepts forward slashes; pwd -W is Git Bash
# specific and falls back to plain pwd on Linux/macOS).
repo_path=$(cd "${root}" && (pwd -W 2>/dev/null || pwd))
MSYS_NO_PATHCONV=1 docker run --rm \
  -v "${repo_path}/src/cpp:/src:ro" \
  -v "${repo_path}/dist/wasm:/out" \
  "${IMAGE}" \
  bash /src/build-glue.sh

echo "[build-wasm] artifact in ${root}/dist/wasm"
