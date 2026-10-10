# API reference

npm package: `occt.ts` · repo: `opencascade-ts`

Units: STEP/BRep geometry is in millimeters; angles in the TypeScript API are **degrees**
(converted to radians at the wasm boundary); tessellation deflection is in model units.

## `OccSession`

Created once per process/page. Owns the wasm module and tracks every shape it hands out.

```ts
import { OccSession } from "occt.ts";
const occ = await OccSession.create(options?);
```

`OccCreateOptions` = `WasmLocationOptions`: `{ moduleUrl?, wasmUrl? }` to point at the
embind factory / wasm binary explicitly (useful under bundlers). Default resolution order
is documented in `src/ts/loader.ts`.

| Method | Description |
|---|---|
| `occtVersion` | Kernel version string, e.g. `"7.9.3"`. |
| `makeBox(dx, dy, dz)` | Axis-aligned box at the origin. |
| `makeCylinder(r, h, { direction?, origin? })` | Cylinder along `direction` (default +Z). |
| `makeSphere(r, origin?)` | Sphere. |
| `makeCone(rBottom, rTop, h, opts?)` | Cone/frustum (`rTop = 0` for a pointed cone). |
| `makeTorus(majorR, minorR, opts?)` | Torus about `direction`. |
| `makeCircle(radius, { origin?, normal? })` | Circle as a closed **wire** — a section for `extrude`/`revolve`/`loft` or a sweep spine. |
| `makePolygon(points, { close? })` | Polygon wire through `points` (`[[x,y,z], …]`); closed by default. |
| `makeLine(start, end)` | Line-segment wire. |
| `makeArc(radius, { startDegrees, endDegrees, origin?, normal? })` | Circular arc wire, counterclockwise around `normal`; span < 360°. |
| `makeEllipse(majorR, minorR, { origin?, normal? })` | Ellipse wire (major axis along the plane's in-plane X). |
| `makeBspline(poles, { degree? })` | B-spline wire from control points — clamped uniform knots, runs from the first pole to the last. |
| `makeBsplineThrough(points, { periodic?, tolerance? })` | Smooth B-spline interpolated **through** every point. |
| `makeWire(parts)` | Concatenate connected wires/edges into one wire, in order. |
| `makeFace(outer, holes?)` | Cap a planar outer wire into a face, with optional hole wires — the section for plates, flanges and gaskets (also the base for 2D trim/intersect via `cut`/`common` on faces). |
| `fuse(a, b)` / `cut(a, b)` / `common(a, b)` | Boolean union / difference / intersection. |
| `split(shape, tools)` | Cut into pieces but keep **every** fragment — they reassemble the original (the region under a tool becomes its own piece). |
| `translate(shape, [x,y,z])` | Rigid move. |
| `rotate(shape, axis, angleDegrees)` | Rotation about `axis` through the origin. |
| `scale(shape, factor)` | Uniform scaling (negative mirrors). |
| `shell(shape, thickness, { openFaces? })` | Hollow into a wall of `thickness` (positive = inward; the outer skin is preserved). `openFaces` — 1-based face indices from `describe()` — become the openings; none = sealed hollow. |
| `offsetSolid(shape, distance)` | Grow (+) / shrink (−) the whole solid by a uniform offset. |
| `draft(shape, angleDegrees, { direction?, faces?, neutralPoint? })` | Mold-release tilt. Faces pivot about the neutral plane (default: bounds center, normal to `direction`); positive angles narrow the part towards the pull direction. Default drafted faces: the walls running parallel to `direction`. |
| `fillet(shape, radius, { edges? })` | Round edges (`BRepFilletAPI`). Default: every edge; `edges` — 1-based indices from `describe()` — selects a subset. |
| `chamfer(shape, distance, { edges? })` | Bevel edges by `distance` on both sides. Same edge selection as `fillet`. |
| `variableFillet(shape, specs)` | Per-edge radii: `[{ edge, radius, at? }]`. Two positioned specs on one edge give its start and end radius — the blend between them is linear. |
| `extrude(profile, vector, { solid? })` | Sweep a planar wire/face along a straight vector. Wires become solids by default; `solid: false` → shell. |
| `revolve(profile, { direction, origin?, angleDegrees?, solid? })` | Revolve a planar profile about the axis; `angleDegrees` defaults to a full turn. |
| `loft(sections, { ruled?, solid? })` | Skin ≥2 wire/face sections into one solid; `ruled: true` rules straight sections (two circles → an exact frustum). |
| `sweep(profile, spine, { solid? })` | Transport a planar profile along a spine wire from its start, perpendicular to the tangent. |
| `pipeShell(profile, spine, { mode?, binormal?, transition?, correction?, solid? })` | The controllable sweep (`MakePipeShell`): choose the profile's travelling frame — `"correctedFrenet"` (default) / `"frenet"` / `"binormal"` (fixed direction, keeps ribbons flat) — corner handling (`"transformed"` / `"round"` / `"rightCorner"`), and `correction` to re-orient the profile onto the spine's normal plane. |
| `makeHelix(radius, pitch, height, { direction?, origin?, leftHanded? })` | Helix wire — climbs `pitch` per full turn, ending at `height`. The spine for springs and threads. |
| `mirror(shape, { plane? \| axis? })` | Mirror through a plane (`{ origin, normal }`) or about a line (`{ origin, direction }`) — exactly one. |
| `rectangularPattern(shape, { countX, countY?, spacingX, spacingY?, directionX?, directionY? })` | Compound of translated copies on a grid (original at (0, 0)); `fuse` the result to merge. |
| `circularPattern(shape, { count, sweepDegrees?, axis?, origin? })` | Compound of copies rotated evenly over `sweepDegrees` (default 360) around the axis. |
| `heal(shapeOrShapes, { tolerance?, sew?, fix? })` | Repair: stitch coincident boundaries (several shapes assemble into one shell) + ShapeFix (faces, wires, orientation, tolerances). The safety net after a sloppy import. |
| `makeBsplineSurface(poles, { uDegree?, vDegree? })` | B-spline surface **face** from a control-point grid (array of rows, each running along u); clamped uniform knots. |
| `makeBsplineSurfaceThrough(points)` | Surface face interpolated **through** every point of a grid. |
| `describeSurface(shape)` | B-spline surface details of a face → `BsplineSurfaceInfo` (degrees, knots, pole grid, weights). |
| `setBsplinePoles(shape, poles)` | Replace a B-spline surface's pole grid → **new** face; the original is untouched. |
| `readStep(bytes, {unit?})` / `readBrep(bytes)` / `readIges(bytes)` | Import from file bytes → shape. Throws with a `STEP`/`BREP`/`IGES`-prefixed message on bad input. |
| `readStepDocument(bytes, {unit?})` | Import as an XCAF document: `{ format, tree, shapeCount }` with names, `"#RRGGBB"` colors and 12-number instance transforms. |
| `documentShape(index)` / `documentShapeCount` | World-positioned leaf shapes from the last `readStepDocument` (valid until the next call). |
| `writeStep(shape, {unit?})` / `writeIges(shape)` / `writeBrep(shape, withTriangles?)` | Export → `Uint8Array` (ASCII text). |
| `writeStepDocument(tree, {unit?})` | XCAF export — the mirror of `readStepDocument`: an assembly tree `[{ name?, color?, shape? \| children?, transform? }]` → named, colored, positioned STEP. |
| `writeGltf(shape)` | Export → binary glTF `.glb` (pure TypeScript exporter). |
| `describe(shape)` | Analytic faces/edges + heuristic holes → `PartDescription`. |
| `distance(a, b)` | `{distance, points: [[onA, onB], …]}` — minimum distance, up to 8 pairs. |
| `section(a, b)` | Intersection curve(s) of two shapes' surfaces (an edge/compound shape). |
| `classifyPoint(shape, [x,y,z])` | `"in"` / `"out"` / `"on"` / `"unknown"` against all solids. |
| `tessellate(shape, opts?)` | → `MeshData`. |
| `hiddenLines(shape, { direction, up?, deflection? })` | HLR → `HiddenLineResult`. |
| `dispose()` | Free every shape created by this session. |

## `OccShape`

| Method | Description |
|---|---|
| `shapeType()` | `"Solid"`, `"Shell"`, `"Face"`, `"Wire"`, `"Edge"`, `"Vertex"`, `"Compound"`, `"CompSolid"`, `"Shape"`. |
| `volume()` | Enclosed volume of solids (mm³). |
| `area()` | Total surface area (mm²). |
| `bounds()` | `{ min: [x,y,z], max: [x,y,z] }`. |
| `centroid()` | Center of mass: volume-weighted for solids, else surface/curve-weighted (a circle's is its center). |
| `isValid()` | `BRepCheck_Analyzer` result. |
| `count(type)` | Sub-shape count, e.g. `count("Face")`, `count("Edge")`. |
| `dispose()` | Free this shape early (otherwise freed by `session.dispose()`). |

## Shelling & drafting

```ts
const topFaceIndex = occ.describe(part).faces.find((f) => /* … */)?.index;
const cup = occ.shell(part, 2, { openFaces: [topFaceIndex] });
const molded = occ.draft(part, 3, { direction: [0, 0, 1] });
```

- `shell` — positive `thickness` grows the wall inward; the outer surface is
  preserved. With no `openFaces` the hollow is sealed (one solid carrying an
  inner void shell).
- `draft` — faces pivot about the **neutral plane**: dimensions on that plane
  are unchanged, and the part narrows by `2·d·tan(angle)` per side at distance
  `d` along the pull direction. Positive angles narrow towards the pull
  direction (mold release).
- Face indices are 1-based and match `describe()`'s `faces[].index`.

## Edge blends — fillets & chamfers

```ts
const rounded = occ.fillet(part, 2);                          // every edge
const frontLoop = occ.describe(part).edges
  .filter((e) => /* e.g. lines at z = 10 */).map((e) => e.index);
const beveled = occ.chamfer(part, 1.5, { edges: frontLoop }); // a selected subset
```

- `fillet` / `chamfer` blend **all** edges by default — for a box that means
  12 cylinders + 8 spherical/tetrahedral corners. Pass `edges` (1-based,
  `describe()`'s `edges[].index`) to blend a loop or a single edge.
- Edge indices line up with `describe()`'s `edges[].index`, like face
  indices do for `shell`/`draft`.
- A radius that is too large for the local geometry fails with the kernel's
  message — shrink it or select fewer edges.

## Curves & wire assembly — profile authoring

```ts
// a slot (stadium) profile: two semicircular ends, two straight sides
const left = occ.makeArc(5, { startDegrees: 90, endDegrees: 270 });    // (0,5) → (0,-5)
const bottom = occ.makeLine([0, -5, 0], [20, -5, 0]);
const right = occ.makeArc(5, { origin: [20, 0, 0], startDegrees: -90, endDegrees: 90 });
const top = occ.makeLine([20, 5, 0], [0, 5, 0]);
const part = occ.extrude(occ.makeWire([left, bottom, right, top]), [0, 0, 10]);

// a smooth freeform loop through measured points
const loop = occ.makeBsplineThrough(
  [[-5, -5, 0], [5, -5, 0], [5, 5, 0], [-5, 5, 0]],
  { periodic: true },
);
```

- Every constructor returns a **wire**; `makeWire` chains them in order and
  refuses parts that do not share endpoints.
- Angles are degrees, arcs sweep counterclockwise around `normal`.
- `makeBspline` takes control points (the curve approaches them, touching
  only the first and last); `makeBsplineThrough` passes through every point.
- Two positioned specs on one `variableFillet` edge are its start and end
  radius (`at` in the edge's curve parameter — for line edges, distance from
  the start).
- `makeFace` holes are wires inside the outer boundary — extrude it for
  plates with bores, or `cut`/`common` two faces for 2D trim/intersect.

## XCAF write-back — `writeStepDocument`

```ts
const bytes = occ.writeStepDocument([
  {
    name: "post-assembly",
    children: [
      { name: "base", shape: occ.makeBox(10, 10, 2) },
      { name: "post", color: "#ff8800", shape: occ.makeCylinder(2, 8),
        transform: [1,0,0,5, 0,1,0,5, 0,0,1,2] }, // 12 row-major 3×4 numbers
    ],
  },
]);
// readStepDocument(bytes) round-trips names, colors, the tree and placements
```

- A node carries either a `shape` or `children`; `transform` matches
  `readStepDocument`'s output format.
- Colors travel as sRGB `"#RRGGBB"` — the STEP convention.

## Sketch → solid — extrude / revolve / loft / sweep / pipe-shell

```ts
const cylinder = occ.extrude(occ.makeCircle(5), [0, 0, 10]);            // π·5²·10
const torus = occ.revolve(
  occ.makeCircle(2, { origin: [20, 0, 0], normal: [0, 1, 0] }),         // XZ-plane circle
  { direction: [0, 0, 1] },                                             // about +Z
);
const frustum = occ.loft(
  [occ.makeCircle(5), occ.makeCircle(10, { origin: [0, 0, 20] })],
  { ruled: true },
);
const pipe = occ.sweep(
  occ.makeCircle(3, { normal: [0, 0, 1] }),                             // at the spine start
  occ.makePolygon([[0, 0, 0], [0, 0, 20]], { close: false }),
);
```

- Profiles are planar wires (`makeCircle` / `makePolygon`) or faces; wires are
  capped into solids by default, `solid: false` sweeps the bare wire into a
  shell.
- `revolve` takes degrees (default 360); the profile must not cross the axis.
- `loft` smooths a B-spline skin across all sections by default; `ruled: true`
  interpolates linearly between neighbors.
- `sweep` transports the profile along the spine from its **start** — place
  the profile there, perpendicular to the tangent (a circle on a circular
  spine yields an exact torus).
- `pipeShell` adds frame control: a fixed `binormal` keeps a swept rectangle
  level (a flat spiral ribbon along a helix), `frenet` is the textbook frame,
  and `correction: true` re-orients the profile onto the spine's normal plane
  so it need not be placed perpendicular by hand:

```ts
const spring = occ.pipeShell(
  occ.makeCircle(0.25, { origin: [5, 0, 0], normal: [0, 1, 0] }),
  occ.makeHelix(5, 2, 20),                       // radius 5, pitch 2, 10 turns
  { correction: true },
);
```

## Healing — sewing & shape repair

```ts
const stitched = occ.heal([faceA, faceB, faceC]);   // → one shared-edge shell
const repaired = occ.heal(importedStep, { tolerance: 1e-3 });
```

- `sew` (default on) stitches boundaries within `tolerance`: faces of a
  compound merge shared edges, several shapes assemble into one shell.
  Solids skip it — they are closed by construction, and sewing would degrade
  them to shells.
- `fix` (default on) runs ShapeFix: repairs faces, wires, orientation and
  tolerances, allowed to relax tolerances up to 1.0 rather than drop geometry.
- Raise `tolerance` for sloppy imports (typical gaps: 1e-3 … 1e-1). Pair with
  `isValid()` before/after to see what changed.

## B-spline surfaces

```ts
const hull = occ.makeBsplineSurface([
  // rows of constant v, each running along u — here a 2 × 2 control grid
  [[0, 0, 0], [10, 0, 0]],
  [[0, 5, 0], [10, 5, 2]],
]);                                                 // bilinear patch
const fit = occ.makeBsplineSurfaceThrough(measuredGrid);
const info = occ.describeSurface(hull);            // degrees, knots, poles
const flatter = occ.setBsplinePoles(hull, newGrid); // new face; hull unchanged
```

- Grid layout everywhere: an array of rows, each row running along **u** (the
  row index is **v**) — `describeSurface().poles` feeds straight back into
  `setBsplinePoles`.
- `makeBsplineSurface` takes control points with clamped uniform knots (the
  surface passes through the border poles); degrees default to 3 and need
  at least degree + 1 poles per direction.
- `makeBsplineSurfaceThrough` interpolates exactly through every point.
- Results are open faces — extrude/loft/pipe with them, or cap them into
  solids with `makeFace` + `fuse`.

## Transforms & patterns

```ts
const leftHand = occ.mirror(rightHand, { plane: { normal: [1, 0, 0] } });
const boltCircle = occ.circularPattern(bolt, { count: 8 });           // full ring
const vents = occ.rectangularPattern(vent, { countX: 1, countY: 5, spacingY: 12 });
const grill = occ.fuse(occ.rectangularPattern(slat, {
  countX: 10, spacingX: 4, directionX: [1, 0, 0], directionY: [0, 0, 1],
}));
```

- Patterns return **compounds** of copies sharing the original's geometry —
  `fuse` merges them into one solid when the copies should become one body.
- `mirror` takes exactly one of `plane` (`{ origin?, normal }`) or `axis`
  (`{ origin?, direction }`); mirroring flips handedness, so the geometry is
  copied rather than location-shared.

## Tessellation — `MeshData`

```ts
occ.tessellate(shape, {
  linearDeflection?: number,   // default 0.1 — max chord deviation
  angularDeflection?: number,  // default 20 (degrees)
  relative?: boolean,          // deflection relative to edge size
});
// → { positions: Float32Array, indices: Uint32Array, edges: Float32Array }
```

- `positions` — xyz per vertex, triangles wound counter-clockwise on outward normals.
- `indices` — triangle indices into `positions`.
- `edges` — wireframe **segment pairs**: `(p0,p1), (p2,p3), …` from exact edge geometry
  (independent of the triangulation).
- `computeVertexNormals(positions, indices)` — area-weighted vertex normals (pure TS).

## Geometry interrogation — the "agent eyes"

```ts
const d = occ.describe(part);
// { shapeType, faces: [...], edges: [...], holes: [...] }
```

- **faces** — analytic per-face data: `{surface:"plane", origin, normal, area}`,
  `{surface:"cylinder", axisPoint, axis, radius, area}`, cone/sphere/torus likewise,
  or generic `{surface:"bspline-surface"|"revolution"|…, area}`.
- **edges** — `{curve:"line", start, end, direction, length}`,
  `{curve:"circle", center, axis, radius, uRange, closed, length}` (radians),
  ellipse/bspline likewise.
- **holes** — heuristic bore detection (`detectHoles`, pure TS): a cylindrical face
  bounded by exactly two coaxial full circles of the same radius →
  `{radius, axis, center (mid-depth), length}`.

The XCAF document tree (`readStepDocument`) nodes are `{name, color, transform,
shape?, children?}`; `transform` holds 12 row-major numbers (3×4) when an instance
is not at identity.

## Hidden-line removal — `HiddenLineResult`

```ts
const hlr = occ.hiddenLines(shape, { direction: [0, 0, 1], up?: [0,0,1], deflection?: 0.1 });
// → { visible: Float32Array, hidden: Float32Array, xAxis, yAxis }
```

`direction` points from the model towards the viewer. Points are already expressed in the
projection frame (x = right, y = up, z ≈ depth); `xAxis`/`yAxis` are that frame's world-space
basis, so `hiddenLinesToSvg` (and your own exporters) can project without recomputation.
Both line arrays use the same segment-pair convention as `MeshData.edges`.

## Exporters (pure TS, headless-safe)

| Function | Output |
|---|---|
| `meshToAsciiStl(mesh, name?)` | ASCII STL. |
| `meshToObj(mesh)` | Wavefront OBJ with wireframe `l` entries. |
| `hiddenLinesToSvg(hlr, opts?)` | SVG drawing. `opts`: `width/height/margin`, `showHidden`, `hiddenDash`, `strokeWidth`. |
| `lineSegmentsToSvg(segments, direction, opts?)` | SVG for arbitrary 3D segments viewed along `direction`. |
| `meshToGlb(mesh, opts?)` | Binary glTF 2.0 `.glb` (single file, wireframe included). |

## WebGL2 viewer — `occt.ts/viewer`

```ts
import { WebGLViewer } from "occt.ts/viewer";

const viewer = new WebGLViewer(canvas, { background?, antialias? });
const meshHandle = viewer.addMesh(meshOrMeshWithNormals, { color?, opacity? });
const lineHandle = viewer.addLineSegments(points, { color?, opacity?, dashed? });
const hlrHandles = viewer.addHiddenLines(hlr, { showHidden?, visibleColor?, hiddenColor? });

viewer.fit();            // frame the scene (or pass explicit min/max)
viewer.remove(handle);   // remove one model
viewer.clear();
viewer.render();         // manual draw; rendering is on-demand otherwise
viewer.dispose();
```

Interaction: drag = orbit, right/shift/two-finger drag = pan, wheel/pinch = zoom.
`viewer.camera` (an `OrbitCamera`) is public — drive it programmatically for
deterministic screenshots or animation.

Line data convention everywhere: **segment pairs**. `addLineSegments(points)` treats
`(p0,p1), (p2,p3), …` as independent segments — the same convention as
`MeshData.edges` and `HiddenLineResult.visible/hidden`.

## CLI

```
occt-ts info <input> [--json] [--unit mm]
occt-ts describe <input> [--json]
occt-ts tree <input>
occt-ts convert <input> <output> [--deflection mm] [--view x,y,z] [--up x,y,z] [--unit mm] [--hidden]
occt-ts hlr <input> <output.svg> [--view x,y,z] [--up x,y,z] [--hidden]
```

Inputs: `.step` `.stp` `.brep` `.igs` `.iges`. Outputs: `.step` `.stp` `.brep` `.igs` `.iges` `.stl` `.obj` `.svg` `.glb`.
Exit code 0 on success, 1 with `error: …` on stderr otherwise — agent-shell friendly.
