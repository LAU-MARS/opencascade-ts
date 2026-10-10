#!/usr/bin/env bash
# Runs INSIDE the opencascade-ts/occt-wasm image (see etc/docker/Dockerfile).
# Compiles the TypeScript-facing C++ glue and links it against the OCCT static
# libraries into dist/wasm/occtjs.js + dist/wasm/occtjs.wasm.
#
# Mounted by etc/build-wasm.sh as: /src  -> repo src/cpp,  /out -> repo dist/wasm

set -euo pipefail

SRC=/src
OUT=/out
OCCT=/opt/occt

CXXFLAGS="-std=c++17 -O2 -fexceptions -I${OCCT}/include/opencascade -I${OCCT}/include"

LINKFLAGS=(
  -O2 -fexceptions
  -lembind
  -sMODULARIZE=1
  -sEXPORT_NAME=createOccModule
  -sEXPORT_ES6=1
  -sENVIRONMENT=web,node
  -sALLOW_MEMORY_GROWTH=1
  -sMAXIMUM_MEMORY=4GB
  # OCCT's modeling algorithms recurse deeply; the 64 KB default stack
  # traps as "memory access out of bounds" (the stack probe hits its guard
  # page) on deep call chains — e.g. variable-fillet error paths after a
  # two-radius blend. The stack does NOT grow with ALLOW_MEMORY_GROWTH.
  -sSTACK_SIZE=1048576
  # TypeScript reads mesh buffers straight out of the wasm heap.
  -sEXPORTED_RUNTIME_METHODS=HEAPU8
  -sEXPORTED_FUNCTIONS=_malloc,_free
)

work=$(mktemp -d)
cd "$work"

echo "[build-glue] compiling glue sources..."
for f in "${SRC}"/*.cpp; do
  em++ $CXXFLAGS -c "$f" -o "$(basename "${f%.cpp}").o"
done

echo "[build-glue] linking against OCCT static libraries..."
ls "${OCCT}"/lib/*.a >/dev/null
em++ "${LINKFLAGS[@]}" ./*.o "${OCCT}"/lib/*.a -o "${OUT}/occtjs.js"

echo "[build-glue] done:"
ls -la "${OUT}"
