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

  tessellate(s: WasmShape, linDefl: number, angDeflDegrees: number, relative: boolean): WasmMeshData;
  hiddenLines(
    s: WasmShape,
    dirX: number, dirY: number, dirZ: number,
    upX: number, upY: number, upZ: number,
    deflection: number,
  ): WasmHlrData;

  readStep(ptr: number, length: number): WasmShape;
  readBrep(ptr: number, length: number): WasmShape;
  writeStep(s: WasmShape): string;
  writeBrep(s: WasmShape, withTriangles: boolean): string;
}

export type OccModuleFactory = (config: {
  wasmBinary: ArrayBuffer | Uint8Array;
}) => Promise<OccWasmModule>;
