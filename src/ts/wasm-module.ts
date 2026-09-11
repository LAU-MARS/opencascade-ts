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
  isValid(): boolean;
  countSubShapes(typeName: string): number;
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

export interface OccWasmModule {
  /** Uint8Array view over the wasm heap (detaches on memory growth — copy early). */
  readonly HEAPU8: Uint8Array;
  _malloc(bytes: number): number;
  _free(ptr: number): void;

  hasError(): boolean;
  lastError(): string;

  occtVersion(): string;

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

  fuse(a: WasmShape, b: WasmShape): WasmShape;
  cut(a: WasmShape, b: WasmShape): WasmShape;
  common(a: WasmShape, b: WasmShape): WasmShape;

  translate(s: WasmShape, dx: number, dy: number, dz: number): WasmShape;
  rotate(s: WasmShape, ax: number, ay: number, az: number, angleRadians: number): WasmShape;
  scale(s: WasmShape, factor: number): WasmShape;

  /** 1-based face indices at `facesPtr` (`faceCount` × int32; 0 = none). */
  shell(s: WasmShape, thickness: number, facesPtr: number, faceCount: number): WasmShape;
  draft(
    s: WasmShape, angleRadians: number,
    dx: number, dy: number, dz: number,
    nx: number, ny: number, nz: number,
    facesPtr: number, faceCount: number, autoSelectWalls: boolean,
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
  writeBrep(s: WasmShape, withTriangles: boolean): string;
  writeIges(s: WasmShape): string;

  /** JSON: GeometryDescription (faces/edges with analytic parameters). */
  describe(s: WasmShape): string;
  /** JSON: ShapeDistance. */
  distance(a: WasmShape, b: WasmShape): string;
  section(a: WasmShape, b: WasmShape): WasmShape;
  classifyPoint(s: WasmShape, x: number, y: number, z: number): string;
}

export type OccModuleFactory = (config: {
  wasmBinary: ArrayBuffer | Uint8Array;
}) => Promise<OccWasmModule>;
