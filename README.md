# opencascade-ts

**[English](README.md)** | [简体中文](README.zh-CN.md)

[![npm version](https://img.shields.io/npm/v/occt.ts)](https://www.npmjs.com/package/occt.ts)
[![npm downloads](https://img.shields.io/npm/dm/occt.ts)](https://www.npmjs.com/package/occt.ts)
[![License: LGPL-2.1](https://img.shields.io/badge/License-LGPL--2.1-informational)](LICENSE)

npm package: **`occt.ts`** · repo: `opencascade-ts`

> **Open CASCADE for the agent era.** A modern OCCT kernel compiled to WebAssembly with first-class
> TypeScript bindings, STEP/BRep import, hidden-line removal, and a zero-dependency WebGL2 viewer.
> Runs headless in Node and in the browser. No Qt, no native toolchain.

OCCT **7.9.3** · Emscripten · TypeScript · LGPL-2.1

## Why

The existing WebAssembly builds of OCCT have stalled — the last stable one shipped in 2020 on a
2019-era kernel, with no hidden-line removal, no rendering, and TypeScript support limited to
machine-generated typings over a raw embind surface (or they drag a Qt-based windowing stack
along). This project rebuilds that stack for how software gets written now — by humans **and**
by agents:

| Capability | Status |
|---|---|
| Modern OCCT (7.9.3; version is a build argument, 8.0 supported experimentally) | ✅ |
| TypeScript bindings — hand-written types, ESM, strict mode | ✅ |
| STEP (AP203/AP214/AP242) and BRep **import** | ✅ |
| STEP and BRep export (incl. tessellation-in-BRep) | ✅ |
| IGES import + export | ✅ |
| XCAF document reading: assembly **tree, names, colors**, instance transforms | ✅ |
| XCAF **write-back**: `writeStepDocument` assembly tree with names, colors, placements | ✅ |
| Unit selection on STEP I/O (`mm/cm/m/km/inch/ft/mi/um`) | ✅ |
| Modeling: primitives, booleans (fuse/cut/common/split), transforms (translate/rotate/scale/mirror), patterns (rectangular/circular), shelling, draft, fillets/chamfers (incl. variable radius), sketch→solid (extrude/revolve/loft/sweep/pipe-shell), solid offsetting | ✅ |
| Profile & surface authoring: lines, arcs, ellipses, helices, B-splines (control points / through-points), wire assembly, B-spline surfaces (control points / through-points / pole editing), centroids | ✅ |
| **Healing** — sewing (stitch faces, assemble shapes) + ShapeFix (faces, wires, orientation, tolerances) | ✅ |
| Measures: volume, area, bounds, validity, sub-shape counts | ✅ |
| **Sub-shape handles** — edges/faces/vertices as first-class values: `subShapes`/`edges`/`faces`, pass back into blends, `isSame` identity | ✅ |
| **Geometry interrogation** — analytic face/edge parameters, min distance + closest points, section curves, point-in-solid | ✅ |
| **Hole detection** — heuristic bore recognition (radius/axis/depth) from the description | ✅ |
| **HLR** — hidden-line removal → visible/hidden edge segments → SVG drawings | ✅ |
| WebGL2 viewer — zero dependencies, orbit/pan/zoom, wireframe, dashed hidden edges | ✅ |
| Headless in Node 18+ (no GPU, no browser needed) | ✅ |
| CLI (`info` / `describe` / `tree` / `convert` / `hlr`) with JSON output | ✅ |
| Outputs: STEP, BRep, IGES, STL, OBJ, SVG, glTF (.glb) | ✅ |
| MCP server, deeper 2D authoring (sketch constraints) | 🚧 roadmap |

## Comparison with opencascade.js

[opencascade.js](https://github.com/donalffons/opencascade.js) pioneered OCCT-on-WebAssembly and
still has the widest API surface around. Its stable release (`1.1.1`, Sep 2020) wraps OCCT
**7.4.0p1** (2019), its beta (`2.0.0`, Mar 2023) wraps **7.6.2** (2022), and the repository has
been quiet since Aug 2023. The short scorecard (✅/❌ = first-class, documented API):

| | opencascade.js | occt.ts |
|---|---|---|
| OCCT kernel | 7.4.0p1 (2019) · 7.6.2 (2022, beta) | **7.9.3 (2025)**; 8.0 experimental |
| Maintenance | last stable 2020 · quiet since 2023 | active |
| API surface | auto-generated, nearly all of OCCT — thousands of classes | ~80 curated, hand-written calls |
| STEP · BRep · IGES I/O | ✅ raw XCAF/XSControl classes | ✅ first-class, with unit selection |
| Fillets · chamfers · sweeps · 2D | ✅ raw classes | ✅ `fillet` / `chamfer` / `variableFillet` / `extrude` / `revolve` / `loft` / `sweep` / `split` / `offsetSolid` + line/arc/ellipse/B-spline profiles, wire assembly & faces with holes |
| Pipe sweeps w/ frame control · helices | ✅ raw classes | ✅ `pipeShell` (Frenet/binormal, corner modes) + `makeHelix` |
| Healing (sew + shape repair) · mirror · patterns | ✅ raw classes | ✅ `heal` / `mirror` / `rectangularPattern` / `circularPattern` |
| Freeform surfaces | ✅ raw classes | ✅ B-spline surfaces from poles / through points, `describeSurface` + `setBsplinePoles` editing |
| Shelling (hollowing) · draft angle | ❌ bound as empty stubs | ✅ `shell` / `draft` |
| HLR drawings · WebGL viewer · JSON CLI · geometry interrogation | ❌ | ✅ |
| Ecosystem | CascadeStudio · RepliCAD · BitByBit · ArchiYou | young |

Full dimension-by-dimension scorecard, evidence and the catch-up plan:
**[docs/COMPARISON.md](docs/COMPARISON.md)**.

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

console.log(part.volume());      // 33842.48...
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
  "volume": 33842.478,
  "area": 10248.142,
  "bounds": { "min": [0,0,0], "max": [80,50,10], "size": [80,50,10] },
  "counts": { "solids": 1, "shells": 1, "faces": 7, "wires": 9, "edges": 15, "vertices": 10 }
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
- **[CadQuery/OCP](https://github.com/CadQuery/OCP)** — exhaustive pybind11-generated OCCT
  bindings; our go-to reference for how to expose OCCT types and naming faithfully.
- **[pybind11](https://github.com/pybind/pybind11)** — embind is a direct descendant of its
  design; our C++ glue follows the same conventions.
- **[sgenoud/replicad](https://github.com/sgenoud/replicad)** — proved that a small, friendly
  TypeScript API over wasm OCCT is what people actually want; our shape-first API style owes
  much to it.

## License

LGPL-2.1 — the same license as OCCT itself. See [LICENSE](LICENSE).
