# Building the wasm artifact

The kernel ships as a prebuilt artifact (`dist/wasm/occtjs.js` + `occtjs.wasm`) in the npm
package. You only need this page to build it yourself, bump OCCT, or change the C++ glue.

## Requirements

- **Docker** (any recent Desktop/engine). No local Emscripten install needed.
- ~10 GB free disk (image + OCCT sources + object files).
- Time: **1–2 h** for the first OCCT compile, ~**1 min** for glue-only rebuilds.

## Two-stage build

```
etc/docker/Dockerfile    stage 1 (slow, cached): emsdk 3.1.74 + OCCT compiled to
                         static wasm libraries → image opencascade-ts/occt-wasm:<ver>
src/cpp/build-glue.sh    stage 2 (fast): compiles src/cpp/*.cpp and links them
                         against every OCCT .a → dist/wasm/occtjs.{js,wasm}
etc/build-wasm.sh        orchestrates both from the host
```

```bash
npm run build:wasm                 # OCCT_VERSION defaults to 7.9.3
OCCT_VERSION=8.0.0 npm run build:wasm   # experimental; OCCT 8 changed toolkits
```

While iterating on C++ glue you usually want the image cached and only the link rerun —
that is exactly what rerunning `npm run build:wasm` does (Docker layer cache skips stage 1).

## What gets compiled

OCCT modules: `FoundationClasses`, `ModelingData`, `ModelingAlgorithms` (includes
`TKHLR`, `TKMesh`), `DataExchange` (STEP). Deliberately **off**: Visualization,
ApplicationFramework, Draw, DETools — rendering is WebGL2 in TypeScript, so there is no
Qt, Tcl/Tk, or freetype anywhere in the artifact.

Compiler flags that matter:

- `-fexceptions` on OCCT **and** glue — OCCT reports errors via exceptions; a mixed
  exception model silently breaks error propagation into JavaScript.
- `-sMODULARIZE -sEXPORT_ES6 -sEXPORT_NAME=createOccModule` — an ESM factory importable
  from both Node and browsers.
- `-sALLOW_MEMORY_GROWTH -sMAXIMUM_MEMORY=4GB` — big STEP files need room.
- `-sEXPORTED_RUNTIME_METHODS=HEAPU8 -sEXPORTED_FUNCTIONS=_malloc,_free` — TypeScript
  copies mesh buffers straight off the wasm heap (one copy, no JS-array crossing).

## Pinning / upgrading

| What | Where |
|---|---|
| Emscripten | `FROM emscripten/emsdk:3.1.74` in `etc/docker/Dockerfile` |
| OCCT | `ARG OCCT_VERSION=7.9.3` (overridable via env/`--build-arg`) |
| OCCT source | GitHub release tarball from `Open-Cascade-SAS/OCCT` |

When bumping OCCT, expect toolkit reorganizations (e.g. 7.8 merged several toolkits,
8.0 restructured more). The link step globs **all** `.a` files under `/opt/occt/lib`, so
toolkit renames are absorbed automatically; header-level API changes may require edits
in `src/cpp/*` (the glue uses long-stable OCCT APIs on purpose).

## Troubleshooting

- **`docker build` can't reach github.com** — networks behind a proxy may need
  `--build-arg HTTP_PROXY=…` or a registry mirror in Docker Desktop settings.
- **Out of disk** — `docker system prune` removes the build cache; the image itself is
  ~3 GB.
- **Glue compile errors after an OCCT bump** — see the table above; fix includes in
  `src/cpp/`, keeping to long-stable APIs where possible.
- **Runtime `LinkError` / "abort(compile exception)"** — almost always a mismatch of
  exception flags between OCCT and glue; rebuild the whole image without cache:
  `docker build --no-cache -f etc/docker/Dockerfile …`.
- **STEP import complains about units/resources** — the build stages file IO through
  MEMFS; OCCT unit tables are compiled in for STEP. If a future OCCT version moves to
  runtime resource files, mount `OCCT_ROOT/src/Resources` and preload it.

## CI

`.github/workflows/ci.yml` runs three jobs: `test` (TypeScript-only), `build-wasm`
(Docker with layer caching, uploads `dist/wasm`), and `integration` (full kernel tests
against the fresh artifact).
