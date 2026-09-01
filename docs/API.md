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
| `fuse(a, b)` / `cut(a, b)` / `common(a, b)` | Boolean union / difference / intersection. |
| `translate(shape, [x,y,z])` | Rigid move. |
| `rotate(shape, axis, angleDegrees)` | Rotation about `axis` through the origin. |
| `scale(shape, factor)` | Uniform scaling (negative mirrors). |
| `readStep(bytes)` / `readBrep(bytes)` | Import from file bytes → shape. Throws with a `STEP`/`BREP`-prefixed message on bad input. |
| `writeStep(shape)` / `writeBrep(shape, withTriangles?)` | Export → `Uint8Array` (ASCII text). |
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
| `isValid()` | `BRepCheck_Analyzer` result. |
| `count(type)` | Sub-shape count, e.g. `count("Face")`, `count("Edge")`. |
| `dispose()` | Free this shape early (otherwise freed by `session.dispose()`). |

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
occt-ts info <input> [--json]
occt-ts convert <input> <output> [--deflection mm] [--view x,y,z] [--up x,y,z] [--hidden]
occt-ts hlr <input> <output.svg> [--view x,y,z] [--up x,y,z] [--hidden]
```

Inputs: `.step` `.stp` `.brep`. Outputs: `.step` `.stp` `.brep` `.stl` `.obj` `.svg`.
Exit code 0 on success, 1 with `error: …` on stderr otherwise — agent-shell friendly.
