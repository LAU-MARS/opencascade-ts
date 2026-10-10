#!/usr/bin/env bash
# Regenerate the raw OCCT binding layer (src/cpp/generated/raw_bindings.cpp,
# src/ts/raw.generated.ts, tools/codegen/SKIPPED.md) from the whitelist.
#
# Runs the generator inside the docker image — it carries both libclang and
# the OCCT headers of the pinned version. The host needs only Docker.
#
# Usage: npm run codegen   (or: bash etc/codegen.sh)

set -euo pipefail

OCCT_VERSION="${OCCT_VERSION:-7.9.3}"
IMAGE="opencascade-ts/occt-wasm:${OCCT_VERSION}"

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
repo_path=$(cd "${root}" && (pwd -W 2>/dev/null || pwd))

out="${root}/.codegen-tmp"
rm -rf "${out}"
mkdir -p "${out}"
trap 'rm -rf "${out}"' EXIT

# emsdk ships its own libclang with matching builtin headers (stddef.h …);
# the pip wheel has neither, so point cindex at the toolchain copy — generate.py
# locates the matching builtin headers inside the image itself.
MSYS_NO_PATHCONV=1 docker run --rm \
  -e "LIBCLANG_SO=/emsdk/upstream/bin/libclang.so" \
  -v "${repo_path}/tools/codegen:/codegen:ro" \
  -v "${repo_path}/.codegen-tmp:/out" \
  "${IMAGE}" \
  python3 /codegen/generate.py \
    --classes /codegen/classes.json \
    --occt-include /opt/occt/include/opencascade \
    --out-dir /out

mkdir -p "${root}/src/cpp/generated"
cp "${out}/raw_bindings.cpp" "${root}/src/cpp/generated/raw_bindings.cpp"
cp "${out}/raw.generated.ts" "${root}/src/ts/raw.generated.ts"
cp "${out}/SKIPPED.md" "${root}/tools/codegen/SKIPPED.md"

echo "[codegen] wrote src/cpp/generated/raw_bindings.cpp, src/ts/raw.generated.ts, tools/codegen/SKIPPED.md"
