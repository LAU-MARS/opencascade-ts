# AGENTS.md

Instructions for coding agents working in this repository — **dsh** (primary),
**pi**, **codex**, and any other AGENTS.md-aware harness. Humans: read this too.

## What this repo is

opencascade-ts: a modern OCCT (7.9.3) compiled to WebAssembly, wrapped in a small
curated TypeScript API, with a zero-dependency WebGL2 viewer. It replaces the
~5-year-old wasm OCCT builds: adds HLR, STEP/BRep import, TS bindings and WebGL
rendering without Qt. Runs headless in Node.

## Repository map

```
src/cpp/        C++ glue (embind). glue.cpp registers everything; wasm-module.ts mirrors it.
src/ts/         TypeScript library. occ.ts = OccSession (the main API).
src/ts/viewer/  WebGL2 viewer (viewer.ts, camera.ts, mat4.ts, shaders.ts).
bin/cli.mjs     CLI entry; src/ts/cli.ts = implementation.
etc/docker/     Dockerfile: emsdk + OCCT static wasm libs (the slow stage, cached).
etc/build-wasm.sh  Two-stage build: docker image → link glue → dist/wasm/.
tests/          vitest. Integration tests auto-skip until dist/wasm/occtjs.wasm exists.
examples/       Browser demo (plain ESM, no bundler).
docs/           BUILDING.md, API.md.
```

## Commands

```bash
npm install          # dev deps (typescript, vitest)
npm run build        # tsc → dist/ (pure TS, always works)
npm test             # vitest; wasm integration tests skip unless the artifact exists
npm run build:wasm   # dist/wasm/occtjs.{js,wasm} — needs Docker, first run 1–2 h
npm run example      # serve repo root on :8787 for examples/browser-viewer
```

`dist/` is generated — never edit it. `package-lock.json` changes only via npm.

## Hard rules

1. **Keep `src/cpp/glue.cpp` and `src/ts/wasm-module.ts` in sync.** One registers
   the embind surface, the other declares it. The recipe below covers both.
2. **The viewer stays zero-dependency.** No three.js, no gl-matrix — `viewer/mat4.ts`
   is the whole math library. Don't add runtime deps anywhere else either without
   strong justification.
3. **Unit tests must pass without the wasm artifact.** Anything that needs the kernel
   goes in `tests/integration.test.ts` behind `describeWasm` (auto-skip).
4. **User-facing errors must include the next step.** See the loader's
   "artifact not found" error for the house style.
5. OCCT reports failures through exceptions; every glue entry point converts them to
   `std::runtime_error("operation: message")` — keep the `OCC_TRY`/`OCC_CATCH` pattern.
6. Comments explain constraints, not narration. Match the surrounding density.

## Recipe: add an OCCT binding

Example: adding `makeWedge`.

1. **C++** — implement in the right `src/cpp/*.cpp` (`model.cpp` for modeling,
   `io.cpp` for exchange, `mesher.cpp` for tessellation, `hlr.cpp` for HLR),
   declared in the matching header. Wrap in `OCC_TRY`/`OCC_CATCH("makeWedge")`.
2. **Register** in `src/cpp/glue.cpp`: `function("makeWedge", &makeWedgeWrap);`
3. **Declare** it in `src/ts/wasm-module.ts` on `OccWasmModule`.
4. **Wrap** it in `src/ts/occ.ts` on `OccSession` with typed options and TS-side
   validation (e.g. zero-length axis vectors → `Error` with a clear message).
5. **Test** in `tests/integration.test.ts` with an analytic expectation
   (a volume/area/count you can compute by hand).
6. If it produces buffers: expose `xxxPtr()` + `xxxCount()` accessors and copy via
   `copyF32`/`copyU32` **before** `raw.delete()` — the wasm heap detaches on growth.

Rebuild wasm for C++ changes (`npm run build:wasm` relinks the glue in ~1 min once
the OCCT image is cached), then `npm test`.

## Gotchas

- **Memory**: embind objects need `.delete()`. `OccSession` tracks every shape and
  frees them on `dispose()`. Mesh/HLR buffers are copied out and deleted immediately.
- **Exceptions**: everything is compiled with `-fexceptions` (OCCT *and* glue — a
  mixed build breaks exception propagation).
- **Line data convention**: edge/HLR buffers are flat **segment pairs**
  (p0, p1, p2, p3 …) — consecutive pairs are independent segments. No polyline
  boundaries needed; renderers and SVG exporters rely on this.
- **Units**: STEP is mm; TS angles are degrees (OCCT wants radians — converted at
  the boundary); tessellation deflection is in model units.
- **HLR frames**: C++ and TS compute the projection basis independently but
  identically (x = up projected onto the view plane, y = dir × x). Change one →
  change the other (`hlr.cpp` / `occ.ts` `hiddenLines`).

## CI

`.github/workflows/ci.yml`: `test` (TS only) → `build-wasm` (Docker, cached) →
`integration` (full kernel tests against the fresh artifact).
