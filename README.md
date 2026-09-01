# opencascade-ts

**[English](README.md)** | [简体中文](README.zh-CN.md)

npm package: **`occt.ts`** · repo: `opencascade-ts`

> **Open CASCADE for the agent era.** A modern OCCT kernel compiled to WebAssembly with first-class
> TypeScript bindings, STEP/BRep import, hidden-line removal, and a zero-dependency WebGL2 viewer.
> Runs headless in Node and in the browser. No Qt, no native toolchain.

OCCT **7.9.3** · Emscripten · TypeScript · LGPL-2.1

## Why

The existing WebAssembly builds of OCCT are roughly five years old, ship without hidden-line
removal, without usable STEP/BRep import in the default bundle, without TypeScript bindings, and
without rendering (or they drag a Qt-based windowing stack along). This project rebuilds that
stack for how software gets written now — by humans **and** by agents:

| Capability | Status |
|---|---|
| Modern OCCT (7.9.3; version is a build argument, 8.0 supported experimentally) | ✅ |
| TypeScript bindings — hand-written types, ESM, strict mode | ✅ |
| STEP (AP203/AP214/AP242) and BRep **import** | ✅ |
| STEP and BRep export (incl. tessellation-in-BRep) | ✅ |
| IGES import + export | ✅ |
| XCAF document reading: assembly **tree, names, colors**, instance transforms | ✅ |
| Unit selection on STEP I/O (`mm/cm/m/km/inch/ft/mi/um`) | ✅ |
| Modeling: primitives, booleans (fuse/cut/common), transforms, scale | ✅ |
| Measures: volume, area, bounds, validity, sub-shape counts | ✅ |
| **Geometry interrogation** — analytic face/edge parameters, min distance + closest points, section curves, point-in-solid | ✅ |
| **Hole detection** — heuristic bore recognition (radius/axis/depth) from the description | ✅ |
| **HLR** — hidden-line removal → visible/hidden edge segments → SVG drawings | ✅ |
| WebGL2 viewer — zero dependencies, orbit/pan/zoom, wireframe, dashed hidden edges | ✅ |
| Headless in Node 18+ (no GPU, no browser needed) | ✅ |
| CLI (`info` / `describe` / `tree` / `convert` / `hlr`) with JSON output | ✅ |
| Outputs: STEP, BRep, IGES, STL, OBJ, SVG, glTF (.glb) | ✅ |
| Sketch→solid modeling (extrude/revolve), fillets/chamfers, MCP server, XCAF write-back | 🚧 roadmap |

## Install

```bash
npm install occt.ts
```

The package ships the prebuilt wasm artifact. Building it yourself takes Docker and roughly
1–2 h the first time ([docs/BUILDING.md](docs/BUILDING.md)); relinking after C++ changes takes
about a minute.

## Quickstart — Node (headless, agent-friendly)

```ts
import { OccSession, hiddenLinesToSvg, meshToAsciiStl } from "occt.ts";
import { readFile, writeFile } from "node:fs/promises";

const occ = await OccSession.create();

// model: a plate with a center bore
const plate = occ.makeBox(80, 50, 10);
const bore = occ.makeCylinder(14, 30, { origin: [40, 25, -10] });
const part = occ.cut(plate, bore);

console.log(part.volume());      // 36675.9...
console.log(part.bounds());      // { min: [0,0,0], max: [80,50,10] }
console.log(part.isValid());     // true

// import a STEP file (Uint8Array in, geometry out)
const imported = occ.readStep(await readFile("bracket.step"));

// engineering drawing: hidden-line removal from the top, as SVG
const drawing = occ.hiddenLines(part, { direction: [0, 0, 1] });
await writeFile("drawing.svg", hiddenLinesToSvg(drawing, { showHidden: true }));

// mesh export
await writeFile("part.stl", meshToAsciiStl(occ.tessellate(part, { linearDeflection: 0.2 })));
```

## Quickstart — browser (WebGL2, no dependencies)

```ts
import { OccSession } from "occt.ts";
import { WebGLViewer } from "occt.ts/viewer";

const occ = await OccSession.create();
const viewer = new WebGLViewer(canvas);

const part = occ.cut(occ.makeBox(80, 50, 10), occ.makeCylinder(14, 30, { origin: [40, 25, -10] }));
viewer.addMesh(part.tessellate());
viewer.addHiddenLines(part.hiddenLines({ direction: [0, 0, 1] }), { showHidden: true });
viewer.fit();
```

Full example with STEP drag & drop, wireframe/HLR toggles and SVG export:
`npm run build && npm run example` → http://localhost:8787/examples/browser-viewer/

## CLI — CAD from the shell

Made for agent harnesses that live in a terminal:

```console
$ occt-ts info bracket.step --json
{
  "file": "/work/bracket.step",
  "shapeType": "Solid",
  "isValid": true,
  "volume": 36675.917,
  "area": 12479.08,
  "bounds": { "min": [0,0,0], "max": [80,50,10], "size": [80,50,10] },
  "counts": { "solids": 1, "shells": 1, "faces": 10, "wires": 10, "edges": 24, "vertices": 16 }
}

$ occt-ts convert bracket.step drawing.svg --view 1,1,2 --hidden
$ occt-ts convert bracket.step mesh.stl --deflection 0.05
$ occt-ts convert bracket.step model.glb
$ occt-ts hlr bracket.step top.svg
```

Interrogate a part — the "agent eyes" (analytic parameters, holes):

```console
$ occt-ts describe bracket.step
bracket.step: Solid
  faces: 7 (6 plane, 1 cylinder)
  edges: 15 (13 line, 2 circle)
  holes:
    r=14  depth=10  axis=[0,0,1]  center=[40,25,5]

$ occt-ts tree assembly.step
assembly.step: 3 shape(s)
└─ robot-arm · transformed
   ├─ base · #0 Solid vol=8421.4
   └─ gripper · #FF5500 · transformed · #2 Solid vol=315.8
```

## Built for agent harnesses

This repository is designed to be operated by coding agents as much as by people.

- **dsh** — primary target harness.
- **[pi](https://pi.dev/)** (earendil-works/pi) — supported.
- **[codex](https://github.com/openai/codex)** (OpenAI Codex CLI) — supported.

All three read the repo-root **[AGENTS.md](AGENTS.md)**: build/test commands, the repository map,
and the step-by-step recipe for adding new OCCT bindings. Agent-friendly by design:

- **Headless first** — the whole kernel runs in Node; no GPU or browser required.
- **Deterministic CLI with `--json`** — agents verify their own work without writing code.
- **Errors that teach** — e.g. a missing wasm artifact lists every searched path *and* the
  one-line build command to fix it.
- **Small, typed, documented surface** — a curated API instead of 10,000 raw embind classes.
- **Self-skipping integration tests** — `npm test` works on a fresh clone before the (optional)
  wasm artifact exists; CI builds the artifact and runs the full suite.

## Building from source

```bash
git clone <this repo> && cd opencascade-ts
npm install
npm run build:wasm     # Docker; OCCT_VERSION=7.9.3 by default, first run 1–2 h
npm run build          # TypeScript
npm test
```

Details, toolchain versions and troubleshooting: [docs/BUILDING.md](docs/BUILDING.md).
API reference: [docs/API.md](docs/API.md).

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│  your app / agent harness (Node or browser)              │
├──────────────────────────┬───────────────────────────────┤
│  occt.ts (TS)     │  viewer (TS, WebGL2, 0 deps)  │
│  OccSession · types      │  orbit camera · mesh+line     │
│  exporters: STL/OBJ/SVG  │  shaders · dashed HLR edges   │
├──────────────────────────┴───────────────────────────────┤
│  embind glue (C++, curated surface)                      │
├──────────────────────────────────────────────────────────┤
│  OCCT 7.9.3 → wasm static libs                           │
│  modeling · STEP/BRep exchange · meshing · HLR           │
│  (no Visualization, no Qt, no Tcl — rendering is WebGL)  │
└──────────────────────────────────────────────────────────┘
```

## Acknowledgements

- **[Open CASCADE SAS & the OCCT community](https://github.com/Open-Cascade-SAS/OCCT)** — the
  geometry kernel this project stands on.
- **[donalffons/opencascade.js](https://github.com/donalffons/opencascade.js)** — pioneered
  OCCT-to-WebAssembly with embind. Our build pipeline and binding strategy follow the trail it
  blazed; this project exists because that one stalled years ago.
- **[tpaviot/oce](https://github.com/tpaviot/oce)** — the OpenCASCADE Community Edition kept
  OCCT usable in the open-source world through years when upstream was hard to reach.
- **[tpaviot/pythonocc-core](https://github.com/tpaviot/pythonocc-core)** — the reference for
  wrapping OCCT in a high-level language; our API conventions borrow from it heavily.

## License

LGPL-2.1 — the same license as OCCT itself. See [LICENSE](LICENSE).
