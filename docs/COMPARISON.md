# Comparison: opencascade.js vs occt.ts

An evidence-backed scorecard between the incumbent,
[opencascade.js](https://github.com/donalffons/opencascade.js), and this project (`occt.ts`,
repo `opencascade-ts`). The [README](../README.md) carries the one-table summary; this document
is the long version — release facts, dimension-by-dimension analysis, the catch-up plan, and how
every claim was verified.

All facts checked 2026-09-11. Numbers drift; see [Methodology](#methodology) before quoting
them elsewhere.

## The contenders

### opencascade.js

Pioneered OCCT-on-WebAssembly (donalffons, LGPL-2.1; docs at [ocjs.org](https://ocjs.org)).
Early versions used the WebIDL binder; v1.0.0 (Sep 2020) moved to auto-generated embind
bindings that expose essentially all of OCCT — thousands of classes — and that architecture
still defines the project.

| Line | Date | OCCT | Notes |
|---|---|---|---|
| `1.1.1` — npm `latest` | 2020-09-27 | **7.4.0p1** (2019) | what `npm install opencascade.js` gives you today |
| `2.0.0-beta.b5ff984` — npm `beta` | 2023-03-23 | **7.6.2** (2022) | the last artifact ever published |
| master | last push 2023-08-15 | 7.6.2 | no release cut from it |

~927 stars, 77 open issues, not archived — but no stable release in six years and no commits in
three. The 1.x line is a chain of same-week patches (v1.0.0 → v1.1.1, all Sep 2020); the 2.0
line exists only as that single beta.

### occt.ts

This project (LGPL-2.1). `0.8.0` on OCCT **7.9.3** (2025) with Emscripten 3.1.74. The OCCT
version is a single build argument (`OCCT_VERSION`); 8.0 is supported experimentally. A small
curated TypeScript API (~70 calls), a zero-dependency WebGL2 viewer, a JSON CLI, and hidden-line
drawings — actively developed.

## Scorecard

✅/❌ means *first-class, documented API* — it arrives ready-made, typed and tested.
opencascade.js binds nearly all OCCT classes, so a determined user can hand-assemble much of
the ❌ from raw calls; the difference is what you get out of the box.

| Dimension | opencascade.js | occt.ts |
|---|---|---|
| OCCT kernel | 7.4.0p1 (2019) stable · 7.6.2 (2022) beta/master | **7.9.3 (2025)**; 8.0 experimental |
| Emscripten | 3.1.14 | 3.1.74 |
| Maintenance | last stable 2020 · quiet since Aug 2023 | active |
| API surface | **auto-generated bindings for nearly all of OCCT** — thousands of classes | ~70 curated, hand-written calls |
| API style | raw embind: manual `.delete()`, downcasts, machine-generated typings | strict TypeScript, ESM, validated options, errors that teach |
| Fillets · chamfers · extrude/revolve · 2D | ✅ raw classes | ✅ `fillet` / `chamfer` / `variableFillet` / `extrude` / `revolve` / `loft` / `sweep` + line/arc/ellipse/B-spline profiles & wire assembly |
| Pipe sweeps w/ frame control · helices | ✅ raw classes | ✅ `pipeShell` (Frenet/binormal, corner modes) + `makeHelix` |
| Healing (sew + shape repair) · mirror · patterns | ✅ raw classes | ✅ `heal` / `mirror` / `rectangularPattern` / `circularPattern` |
| Freeform surfaces | ✅ raw classes | ✅ B-spline surfaces from poles / through points, `describeSurface` + `setBsplinePoles` editing |
| Shelling (thick solid) · draft angle | ❌ bound as empty stubs — no callable methods | ✅ `shell` / `draft` |
| STEP · BRep · IGES I/O | ✅ raw XCAF/XSControl classes | ✅ first-class, with unit selection |
| Assembly tree: names · colors · transforms | raw calls | ✅ `readStepDocument` → JSON · `writeStepDocument` ← tree |
| HLR drawings (visible + hidden segments) | ❌ | ✅ one call → SVG |
| WebGL viewer | ❌ bring your own (three.js…) | ✅ zero-dependency WebGL2 |
| Headless Node | ✅ | ✅ plus CLI with `--json` |
| Interrogation: describe · holes · distance · section · point-in-solid | ❌ | ✅ JSON out of the box |
| Exports beyond kernel formats | — | SVG drawings · glTF (.glb) · OBJ, one call each |
| npm package (unpacked) | ~67 MB — full API | ~35 MB |
| Custom/slim builds | ✅ regenerate from a class list | not needed — curation happened at design time |
| Ecosystem | CascadeStudio · RepliCAD · BitByBit · ArchiYou | young |

## Dimension by dimension

### Kernel and toolchain

The kernel is the clearest gap. opencascade.js's stable npm artifact wraps OCCT **7.4.0p1**
(late 2019); even its unpublished master sits on **7.6.2** (2022). occt.ts ships **7.9.3**
(2025) — six years of upstream development beyond the stable, three years and three major
releases (7.7, 7.8, 7.9) beyond the newest thing opencascade.js ever built. Those releases carry
years of robustness fixes in booleans and data exchange, meshing and performance work, and
ongoing STEP support improvements. Both projects wrap OCCT rather than fork it, so a newer
kernel benefits every call you make.

Toolchain follows the same story: Emscripten 3.1.14 (2022) there, 3.1.74 here. Ours upgrades as
a one-line Dockerfile change; theirs would need the whole pipeline woken up first.

### API design: breadth vs curation

opencascade.js's answer: bind everything. Auto-generation from OCCT headers produces thousands
of classes with machine-generated TypeScript definitions — if OCCT has it, you can call it. The
cost is the raw embind experience: manual `.delete()` on every handle, downcasts to move between
`TopoDS` levels, C++-shaped signatures, and documentation that is OCCT's, not the wrapper's.

occt.ts's answer: curate. ~40 hand-written calls with strict types, options objects, ESM, and
validation at the boundary (a zero-length axis is rejected with a clear message, not a kernel
exception). `OccSession` tracks every shape it hands out and frees them on `dispose()` — the
common path never touches manual memory management. Errors follow the house style: what failed,
and the next step.

These are different products more than a leader and a laggard. If you need a class we haven't
curated yet, opencascade.js reaches it today and we don't — that gap is real and tracked below.
Our bet is that a small, excellent surface plus a documented recipe for growing it
([AGENTS.md](../AGENTS.md)) beats a complete-but-raw one for how most code is written now.

Breadth can also fail silently, and shelling/draft is the case in point. The generator sometimes
binds a class name without its members, and nothing in the pipeline flags it: in the shipped
opencascade.js builds, `BRepOffsetAPI_DraftAngle` refuses construction or yields objects with an
empty prototype (no `Build`, no `Shape`, nothing to call), `BRepOffsetAPI_MakeThickSolid` is the
same kind of stub, and `BRepOffset_MakeOffset` is not bound at all — so hollowing and mold draft
are unreachable there, not merely inconvenient. Hand-written glue cannot ship an empty class:
occt.ts's `shell(shape, thickness, openFaces)` and `draft(shape, angle, …)` exist because someone
wrote, compiled and analytically tested them against the 7.9.3 kernel.

### Data exchange

Both kernels contain OCCT's DataExchange. In opencascade.js you drive `XSControl`/`XCAF`
classes by hand. In occt.ts it is one call each way — `readStep` / `readBrep` / `readIges` /
`writeStep` / `writeBrep` / `writeIges` — with `Uint8Array` in and out, error messages prefixed
by the failing format, optional tessellation-in-BRep on export, and unit selection on STEP I/O
(`mm/cm/m/km/inch/ft/mi/um`). IGES is included rather than an afterthought.

### Assemblies (XCAF)

`readStepDocument` returns the assembly tree as JSON — names, `"#RRGGBB"` colors, 12-number
instance transforms — plus world-positioned leaf shapes by index. In opencascade.js the same
result is a raw XCAF programming exercise. Write-back (names and colors *on export*) is on our
roadmap and not done; flagged honestly.

### Hidden-line removal and drawings

occt.ts: `hiddenLines(shape, { direction, up? })` → visible and hidden **segment pairs** in a
documented projection frame, and `hiddenLinesToSvg` for a drawing with dashed hidden edges. The
CLI wraps both (`occt-ts hlr in.step out.svg`; `convert --view x,y,z --hidden`).

opencascade.js: nothing packaged — no projector setup, no segment output, no SVG, whatever the
raw class situation in a given build. HLR is the classic raw-API gap: "make me a drawing of
this STEP file" is a one-liner here and a self-guided research project there.

### Rendering

opencascade.js ships no viewer; its ecosystem standardizes on three.js. occt.ts includes a
zero-dependency WebGL2 viewer (`occt.ts/viewer`): orbit/pan/zoom, meshes with per-handle
color/opacity, dashed line segments (for HLR hidden edges), and a public camera for
deterministic screenshots or animation. `viewer/mat4.ts` is the entire math library — no
gl-matrix, no three.js, nothing for your bundler to fight.

### Headless operation and agents

Both run headless in Node. On top of that, occt.ts treats the terminal as a first-class client:
the `occt-ts` CLI (`info` / `describe` / `tree` / `convert` / `hlr`) with `--json` and exit
codes, so an agent can verify its own work without writing code. The interrogation API is the
deeper layer: `describe` (analytic face/edge parameters), heuristic hole detection, `distance`
with closest-point pairs, `section` curves, and `classifyPoint`. None of that has an
opencascade.js equivalent short of assembling raw calls.

### Output formats

Kernel formats (STEP, BRep, IGES, STL) are available in both — raw there, one-call here.
Beyond them occt.ts exports SVG drawings, OBJ with wireframe lines, and binary glTF `.glb`
(pure TypeScript, wireframe included), one call each. opencascade.js's build image compiles
RapidJSON, so the raw `RWGltf` writer is plausibly present in its bundle — what it lacks is the
typed, tested, one-call path.

### Artifact size and delivery

opencascade.js on npm unpacks to ~67 MB — the price of binding everything — and offers a
custom-build system that regenerates a slimmer wasm from a list of classes you provide.
occt.ts's npm package is ~35 MB unpacked (the wasm is 34.3 MB; the 0.4.0–0.8.0 modeling
releases pulled in the surface, sweep and healing libraries) because the curation happened at
design time instead of at your build time. No configuration, no codegen step: `npm install
occt.ts` and the artifact is there.

### Ecosystem and maturity

The honest win for opencascade.js. CascadeStudio, RepliCAD, BitByBit and ArchiYou are real
products built on it, and years of production use have shaken out its bindings. ~927 stars
against our young repository; search for "opencascade three.js example" and you find their
answers, not ours. If you want battlefield-proven raw bindings today, that is the project —
with the caveat that maintenance stopped three years ago and new work would sit on a 2019
kernel. Our ecosystem is the thing we have to grow; an examples gallery and integration recipes
are the early moves.

## Where occt.ts must catch up

In priority order — each item is an OCCT module away, not a research project (the recipe is in
[AGENTS.md](../AGENTS.md)). Done since the scorecard above was written: fillets/chamfers incl. variable radius
(`BRepFilletAPI`), sketch→solid (`extrude`/`revolve`), lofts and pipe sweeps
(`BRepOffsetAPI_ThruSections`/`MakePipe`), full profile authoring — lines, arcs, ellipses,
B-splines (control points and through-point interpolation) with wire assembly (`makeWire`) —
faces with holes (`makeFace`, which also composes 2D trim/intersect with `cut`/`common`),
splitting and solid offsetting, mass centroids, and XCAF write-back
(`writeStepDocument`: names, colors, assembly structure, placements) landed with the
0.4.0–0.7.0 modeling releases; healing (`heal`: sewing + ShapeFix), `mirror`,
rectangular/circular patterns, `makeHelix` + `pipeShell` (frame-controlled sweeps) and B-spline
surfaces (`makeBsplineSurface` / `makeBsplineSurfaceThrough` / `describeSurface` /
`setBsplinePoles`) landed with 0.8.0.

1. **MCP server**: first-class agent access — the flagship next step.
2. **Sketch constraints**: dimensions and coincidences on 2D profiles.
3. **Ecosystem**: examples gallery, integration recipes (a three.js bridge for users who want
   it), community docs.

We grow these deliberately as curated API — five steps each per the recipe — rather than
regenerating 10,000 raw classes. If you need one of them today, opencascade.js reaches it via
raw classes; that is the gap, and it closes one binding at a time.

Migration note: there is no drop-in compatibility, by design. Code written against
opencascade.js's raw classes does not port, and code that needs raw-class power is not served
by occt.ts yet.

## Where occt.ts already leads

- **Kernel currency**: 7.9.3 (2025) vs 7.4.0p1 (2019) / 7.6.2 (2022) — five major releases past
  their stable, three past their beta, and one build argument from following upstream.
- **Maintenance**: active, vs three years of silence and six since a stable release.
- **Shelling and draft**: `shell` / `draft` are first-class and analytically tested here; in the
  shipped opencascade.js builds the underlying classes are empty stubs, so the operations are
  unreachable there.
- **HLR drawings**: one call to visible/hidden segments, one more to SVG.
- **Zero-dependency WebGL2 viewer** in the box.
- **Agent surface**: JSON CLI with exit codes; interrogation (describe, holes, distance,
  section, classifyPoint) as first-class API.
- **Ergonomics**: strict typed ESM, validated options, session-managed shape lifetime, unit and
  degree/radian conventions handled at the boundary, errors that state the next step.

## Methodology

Checked 2026-09-11; numbers drift, so re-verify before quoting elsewhere.

- npm registry (`opencascade.js`): dist-tags — `latest` → 1.1.1 (published 2020-09-27), `beta`
  → 2.0.0-beta.b5ff984 (published 2023-03-23); unpacked size ~66.7 MB.
- GitHub `donalffons/opencascade.js`: releases v0.1.19 → v1.1.1 all dated Sep 2020; repo
  `pushed_at` 2023-08-15; ~927 stars; 77 open issues; not archived.
- README at tag `v1.1.1`: "Current OCCT version: V7_4_0p1". README at master: OCCT 7.6.2 badge.
- Master `Dockerfile`: OCCT pinned to commit `bb368e2…`, `emscripten/emsdk:3.1.14`, RapidJSON
  v1.1.0, FreeType 2.13.0.
- This repo: `package.json` (occt.ts 0.8.0), `etc/docker/Dockerfile` (`ARG OCCT_VERSION=7.9.3`,
  `emscripten/emsdk:3.1.74`), `dist/wasm/occtjs.wasm` ≈ 34.3 MB, npm `files` (dist, bin, docs)
  → ~35 MB unpacked (the 0.4.0–0.8.0 modeling releases grew it from the ~25 MB of 0.2.0;
  freeform surfaces, sweeps and ShapeFix bring their OCCT libraries along).
- Empty-stub status of `BRepOffsetAPI_DraftAngle` / `BRepOffsetAPI_MakeThickSolid` (and the
  absent `BRepOffset_MakeOffset`) in the shipped opencascade.js builds: observed by hands-on
  porting work (2026-09), accepted as reported. occt.ts's `shell`/`draft` are verified against
  OCCT 7.9.3 with analytic volume tests (`tests/integration.test.ts`).
- ✅/❌ throughout means *first-class, documented API* — see the note under the scorecard.
