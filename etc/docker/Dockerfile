# Base image: Emscripten + Open CASCADE Technology compiled to static wasm libraries.
#
# This is the expensive stage (~1-2 h on a laptop). It is built once per OCCT
# version; TypeScript/C++ glue iteration never rebuilds it (see build-glue.sh).
#
# Build:
#   docker build -f etc/docker/Dockerfile --build-arg OCCT_VERSION=7.9.3 \
#                -t opencascade-ts/occt-wasm:7.9.3 .
#
# Deliberate scope: NO Visualization, NO Qt, NO Tcl/Tk, NO freetype.
# Rendering is WebGL2 implemented in TypeScript; OCCT here is a geometry kernel
# (modeling, STEP/BREP data exchange, meshing, hidden-line removal) only.

# Pin a known-good Emscripten toolchain. Upgrade deliberately, not by accident.
FROM emscripten/emsdk:3.1.74

ARG OCCT_VERSION=7.9.3

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl ninja-build \
 && rm -rf /var/lib/apt/lists/*

# Fetch OCCT release sources (upstream tags use underscores: 7.9.3 → V7_9_3).
RUN OCCT_TAG="V$(printf '%s' "$OCCT_VERSION" | tr '.' '_')" \
 && curl -fsSL \
      "https://github.com/Open-Cascade-SAS/OCCT/archive/refs/tags/${OCCT_TAG}.tar.gz" \
      -o /tmp/occt.tar.gz \
 && mkdir -p /opt/occt-src \
 && tar -xzf /tmp/occt.tar.gz -C /opt/occt-src --strip-components=1 \
 && rm /tmp/occt.tar.gz

# Compile the toolkits we need as static libraries.
# -fexceptions everywhere: OCCT reports errors through exceptions and embind
# needs a single consistent exception model across OCCT and the glue layer.
RUN emcmake cmake -S /opt/occt-src -B /tmp/occt-build -G Ninja \
      -DCMAKE_BUILD_TYPE=Release \
      -DCMAKE_INSTALL_PREFIX=/opt/occt \
      -DBUILD_LIBRARY_TYPE=Static \
      -DCMAKE_CXX_FLAGS="-fexceptions" \
      -DCMAKE_C_FLAGS="-fexceptions" \
      -DBUILD_MODULE_FoundationClasses=ON \
      -DBUILD_MODULE_ModelingData=ON \
      -DBUILD_MODULE_ModelingAlgorithms=ON \
      -DBUILD_MODULE_DataExchange=ON \
      -DBUILD_MODULE_Visualization=OFF \
      -DBUILD_MODULE_ApplicationFramework=OFF \
      -DBUILD_MODULE_Draw=OFF \
      -DBUILD_MODULE_DETools=OFF \
      -DBUILD_DOC_Overview=OFF \
      -DUSE_FREETYPE=OFF \
      -DUSE_TCL=OFF \
      -DUSE_TK=OFF \
      -DUSE_TBB=OFF \
      -DUSE_GLX=OFF \
      -DUSE_GLES2=OFF \
 && cmake --build /tmp/occt-build --parallel "$(nproc)" \
 && cmake --install /tmp/occt-build \
 && rm -rf /tmp/occt-build

# Ship the resource files (units definitions etc.) for data exchange run time.
ENV OCCT_ROOT=/opt/occt

# Codegen stage deps: libclang (python bindings + bundled native library) for
# tools/codegen/generate.py — the raw binding generator. Appended AFTER the
# expensive OCCT layers on purpose: adding or changing it never invalidates
# the kernel build cache.
RUN pip3 install --no-cache-dir libclang==16.0.6
