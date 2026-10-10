/**
 * Hand-written declarations for the embind surface registered in
 * src/cpp/glue.cpp. Keep both files in sync — AGENTS.md documents the recipe.
 *
 * Error contract: C++ exceptions never cross the boundary. On failure a
 * function returns a null shape / empty buffers and `hasError()` reports the
 * message from `lastError()`. TypeScript turns that into a JS Error.
 *
 * These types are internal; the public API wraps them in `OccSession`.
 */

export interface WasmShape {
  isNull(): boolean;
  shapeType(): string;
  volume(): number;
  area(): number;
  /** [xmin, ymin, zmin, xmax, ymax, zmax] */
  bounds(): number[];
  /** [x, y, z] center of mass (volume-weighted for solids, else surface/curve). */
  centroid(): number[];
  isValid(): boolean;
  countSubShapes(typeName: string): number;
  /** TopoDS_Shape::IsSame — same TShape at the same location (orientation ignored). */
  isSame(other: WasmShape): boolean;
  delete(): void;
}

/** register_vector<OccShape> handle — build one to pass a shape list to `loft`. */
export interface WasmShapeVector {
  push_back(shape: WasmShape): void;
  /** Element copies (each owns its C++ instance — delete via the session). */
  get(index: number): WasmShape;
  size(): number;
  delete(): void;
}

/** register_vector<std::string> handle for writeStepDocument's name/color lists. */
export interface WasmStringVector {
  push_back(value: string): void;
  size(): number;
  delete(): void;
}

export interface WasmMeshData {
  positionsPtr(): number;
  positionCount(): number;
  indicesPtr(): number;
  indexCount(): number;
  edgesPtr(): number;
  edgePointCount(): number;
  delete(): void;
}

export interface WasmHlrData {
  visiblePtr(): number;
  visiblePointCount(): number;
  hiddenPtr(): number;
  hiddenPointCount(): number;
  delete(): void;
}

import type { RawBindings } from "./raw.generated.js";

/**
 * The raw OCCT escape hatch rides the same module object as the curated
 * surface — generated declarations only (see tools/codegen). Manual `.delete()`
 * discipline applies there.
 */
export interface OccWasmModule extends RawBindings {
  /** Uint8Array view over the wasm heap (detaches on memory growth — copy early). */
  readonly HEAPU8: Uint8Array;
  _malloc(bytes: number): number;
  _free(ptr: number): void;

  hasError(): boolean;
  lastError(): string;

  /**
   * Re-enable (true) or re-silence (false) OCCT's console output (STEP/IGES
   * transfer banners and friends). Silent by default — the module mutes the
   * default messenger's std::cout printer at load; verbose routes OCCT
   * diagnostics back to stdout, so keep it off when stdout is a protocol.
   */
  setVerbose(verbose: boolean): void;

  occtVersion(): string;

  /** register_vector<OccShape> constructor (loft's section list). */
  readonly VectorShape: new () => WasmShapeVector;
  /** register_vector<std::string> constructor (writeStepDocument's lists). */
  readonly VectorString: new () => WasmStringVector;

  makeBox(dx: number, dy: number, dz: number): WasmShape;
  makeCylinder(
    radius: number, height: number,
    dx: number, dy: number, dz: number,
    ox: number, oy: number, oz: number,
  ): WasmShape;
  makeSphere(radius: number, ox: number, oy: number, oz: number): WasmShape;
  makeCone(
    radius1: number, radius2: number, height: number,
    dx: number, dy: number, dz: number,
    ox: number, oy: number, oz: number,
  ): WasmShape;
  makeTorus(
    majorRadius: number, minorRadius: number,
    dx: number, dy: number, dz: number,
    ox: number, oy: number, oz: number,
  ): WasmShape;
  /** Circle wire of `radius` in the plane through (ox, oy, oz) normal to (nx, ny, nz). */
  makeCircle(
    radius: number,
    nx: number, ny: number, nz: number,
    ox: number, oy: number, oz: number,
  ): WasmShape;
  /** `pointCount` triples of float64 at `ptsPtr`; `close` loops back to the first point. */
  makePolygon(ptsPtr: number, pointCount: number, close: boolean): WasmShape;
  makeLine(x1: number, y1: number, z1: number, x2: number, y2: number, z2: number): WasmShape;
  /** Arc on the circle (radius, center, plane normal) between circle parameters u1 < u2 (radians). */
  makeArc(
    radius: number,
    nx: number, ny: number, nz: number,
    ox: number, oy: number, oz: number,
    u1: number, u2: number,
  ): WasmShape;
  makeEllipse(
    majorRadius: number, minorRadius: number,
    nx: number, ny: number, nz: number,
    ox: number, oy: number, oz: number,
  ): WasmShape;
  /** `poleCount` control-point triples (float64) at `polesPtr`; clamped uniform knots. */
  makeBspline(polesPtr: number, poleCount: number, degree: number): WasmShape;
  /** B-spline interpolated through `pointCount` triples (float64) at `ptsPtr`. */
  makeBsplineThrough(
    ptsPtr: number, pointCount: number, periodic: boolean, tolerance: number,
  ): WasmShape;
  /** Helix wire: `radius`, rising `pitch` per turn, ending at `height`. */
  makeHelix(
    radius: number, pitch: number, height: number,
    ax: number, ay: number, az: number,
    ox: number, oy: number, oz: number,
    leftHanded: boolean,
  ): WasmShape;
  /** B-spline surface face from a pole grid: `uCount × vCount` triples at `polesPtr`. */
  makeBsplineSurface(
    polesPtr: number, uCount: number, vCount: number, uDegree: number, vDegree: number,
  ): WasmShape;
  /** Surface face interpolated through a `uCount × vCount` point grid at `ptsPtr`. */
  makeBsplineSurfaceThrough(ptsPtr: number, uCount: number, vCount: number): WasmShape;
  /** Replace the pole grid of a B-spline surface face (dimensions must match). */
  setBsplineSurfacePoles(s: WasmShape, polesPtr: number, uCount: number, vCount: number): WasmShape;
  /** Concatenate connected wires/edges, in order. */
  makeWire(parts: WasmShapeVector): WasmShape;
  /** Planar face from an outer wire with optional hole wires (all planar). */
  makeFace(outer: WasmShape, holes: WasmShapeVector): WasmShape;
  /** Split the shape by tools, keeping every piece (compound result). */
  split(s: WasmShape, tools: WasmShapeVector): WasmShape;
  /** Grow (positive) / shrink (negative) the whole solid by `distance`. */
  offsetSolid(s: WasmShape, distance: number): WasmShape;

  fuse(a: WasmShape, b: WasmShape, clean: boolean): WasmShape;
  cut(a: WasmShape, b: WasmShape, clean: boolean): WasmShape;
  common(a: WasmShape, b: WasmShape, clean: boolean): WasmShape;
  /** Merge same-domain faces/edges (the boolean `clean` pass, on demand). */
  unify(s: WasmShape): WasmShape;
  /** Compound of one or more shapes (copies share the inputs' geometry). */
  compound(shapes: WasmShapeVector): WasmShape;
  /** The outer boundary wire of a Face. */
  outerWire(s: WasmShape): WasmShape;

  translate(s: WasmShape, dx: number, dy: number, dz: number): WasmShape;
  rotate(s: WasmShape, ax: number, ay: number, az: number, angleRadians: number): WasmShape;
  scale(s: WasmShape, factor: number): WasmShape;
  /** mode 0 = mirror plane through (ox,oy,oz) normal to (dx,dy,dz); 1 = about that axis line. */
  mirror(s: WasmShape, mode: number, ox: number, oy: number, oz: number,
    dx: number, dy: number, dz: number): WasmShape;
  /** Compound of countX × countY translated copies (unit directions given). */
  rectangularPattern(
    s: WasmShape, countX: number, countY: number, spacingX: number, spacingY: number,
    ux: number, uy: number, uz: number, vx: number, vy: number, vz: number,
  ): WasmShape;
  /** Compound of `count` rotated copies over `sweepRadians` around the axis. */
  circularPattern(
    s: WasmShape, count: number, sweepRadians: number,
    ax: number, ay: number, az: number, ox: number, oy: number, oz: number,
  ): WasmShape;
  /** Sew + ShapeFix a shape (or assemble several into one) at `tolerance`. */
  heal(shapes: WasmShapeVector, tolerance: number, sew: boolean, fix: boolean): WasmShape;

  /** 1-based face indices at `facesPtr` (`faceCount` × int32; 0 = none). */
  shell(s: WasmShape, thickness: number, facesPtr: number, faceCount: number): WasmShape;
  draft(
    s: WasmShape, angleRadians: number,
    dx: number, dy: number, dz: number,
    nx: number, ny: number, nz: number,
    facesPtr: number, faceCount: number, autoSelectWalls: boolean,
  ): WasmShape;
  /** 1-based edge indices at `edgesPtr` (`edgeCount` × int32; 0 = all edges). */
  fillet(s: WasmShape, radius: number, edgesPtr: number, edgeCount: number): WasmShape;
  /**
   * Bevel by `distance` (NaN `distance2` = equal legs) — `distance` is
   * measured on the first face adjacent to each edge (indexed-map order).
   */
  chamfer(
    s: WasmShape, distance: number, distance2: number, edgesPtr: number, edgeCount: number,
  ): WasmShape;
  /**
   * Per-edge/per-position fillet radii as parallel arrays: int32 edge indices
   * at `edgesPtr`, float64 radii at `radiiPtr`, float64 positions at
   * `positionsPtr` (NaN = constant radius on that edge).
   */
  variableFillet(
    s: WasmShape, edgesPtr: number, edgeCount: number, radiiPtr: number, positionsPtr: number,
  ): WasmShape;
  /** The same blends driven by edge handles (e.g. from `subShapes`). */
  filletEdges(s: WasmShape, radius: number, edges: WasmShapeVector): WasmShape;
  chamferEdges(
    s: WasmShape, distance: number, distance2: number, edges: WasmShapeVector,
  ): WasmShape;
  /**
   * Variable fillet by edge handles: float64 radii at `radiiPtr` and
   * positions at `positionsPtr`, parallel to the `edges` list (NaN position =
   * constant radius).
   */
  variableFilletEdges(
    s: WasmShape, edges: WasmShapeVector, radiiPtr: number, positionsPtr: number,
  ): WasmShape;
  /** Sub-shape handles of one type, indexed-map order (element copies). */
  subShapes(s: WasmShape, typeName: string): WasmShapeVector;

  /** Straight sweep of a wire/face profile; `solid` caps wire profiles into faces first. */
  extrude(profile: WasmShape, dx: number, dy: number, dz: number, solid: boolean): WasmShape;
  revolve(
    profile: WasmShape,
    ax: number, ay: number, az: number,
    ox: number, oy: number, oz: number,
    angleRadians: number, solid: boolean,
  ): WasmShape;
  loft(sections: WasmShapeVector, ruled: boolean, solid: boolean): WasmShape;
  sweep(profile: WasmShape, spine: WasmShape, solid: boolean): WasmShape;
  /**
   * Controllable sweep (BRepOffsetAPI_MakePipeShell): mode 0 = corrected
   * Frenet, 1 = Frenet, 2 = fixed binormal (bx/by/bz); transition 0 =
   * transformed, 1 = round corner, 2 = right corner; `correction` re-orients
   * the profile perpendicular to the spine start.
   */
  pipeShell(
    profile: WasmShape, spine: WasmShape,
    mode: number, bx: number, by: number, bz: number,
    transition: number, correction: boolean, solid: boolean,
  ): WasmShape;

  tessellate(s: WasmShape, linDefl: number, angDeflDegrees: number, relative: boolean): WasmMeshData;
  hiddenLines(
    s: WasmShape,
    dirX: number, dirY: number, dirZ: number,
    upX: number, upY: number, upZ: number,
    deflection: number,
  ): WasmHlrData;

  readStep(ptr: number, length: number, unit: string): WasmShape;
  readBrep(ptr: number, length: number): WasmShape;
  readIges(ptr: number, length: number): WasmShape;
  /** JSON: ShapeDocument (assembly tree, names, colors). */
  readStepDocument(ptr: number, length: number, unit: string): string;
  documentShapeCount(): number;
  getDocumentShape(index: number): WasmShape;
  writeStep(s: WasmShape, unit: string): string;
  /**
   * XCAF document export, mirror of readStepDocument. Flat tree arrays:
   * per-node int32 parent index (-1 = root) at `parentsPtr`, int32 leaf-shape
   * index at `shapeIdxPtr` (-1 = assembly node), names/colors ("" = skip,
   * "#RRGGBB"), and 12 row-major 3×4 transform doubles per node at
   * `transformsPtr` (NaN first value = identity).
   */
  writeStepDocument(
    shapes: WasmShapeVector,
    parentsPtr: number, shapeIdxPtr: number, nodeCount: number,
    names: WasmStringVector, colors: WasmStringVector,
    transformsPtr: number, unit: string,
  ): string;
  writeBrep(s: WasmShape, withTriangles: boolean): string;
  writeIges(s: WasmShape): string;

  /** JSON: GeometryDescription (faces/edges with analytic parameters). */
  describe(s: WasmShape): string;
  /** JSON: ShapeDistance. */
  distance(a: WasmShape, b: WasmShape): string;
  section(a: WasmShape, b: WasmShape): WasmShape;
  classifyPoint(s: WasmShape, x: number, y: number, z: number): string;
  /** JSON: BsplineSurfaceInfo — degrees, knots and the pole grid of a face. */
  describeSurface(s: WasmShape): string;
}

export type OccModuleFactory = (config: {
  wasmBinary: ArrayBuffer | Uint8Array;
  /** Receives every line the wasm module writes to stdout. */
  print?: (text: string) => void;
}) => Promise<OccWasmModule>;
