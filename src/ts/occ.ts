/**
 * OccSession — the main entry point of opencascade-ts.
 *
 * ```ts
 * const occ = await OccSession.create();
 * const box = occ.makeBox(30, 20, 10);
 * const hole = occ.makeCylinder(4, 30, { origin: [15, 10, -5] });
 * const part = occ.cut(box, hole);
 * console.log(part.volume(), part.bounds());
 * ```
 */

import { loadOccModule, type WasmLocationOptions } from "./loader.js";
import type {
  BoundingBox,
  HiddenLineOptions,
  HiddenLineResult,
  MeshData,
  PrimitiveOptions,
  ShapeTypeName,
  TessellationOptions,
  Vec3,
} from "./types.js";
import type { OccWasmModule, WasmShape } from "./wasm-module.js";

const DEFAULT_LINEAR_DEFLECTION = 0.1;
const DEFAULT_ANGULAR_DEFLECTION_DEG = 20;

export type OccCreateOptions = WasmLocationOptions;

/** A shape owned by a session; call `dispose()` (or `session.dispose()`) to free it. */
export class OccShape {
  /** @internal embind handle */
  readonly raw: WasmShape;

  constructor(raw: WasmShape) {
    this.raw = raw;
  }

  isNull(): boolean {
    return this.raw.isNull();
  }

  shapeType(): ShapeTypeName {
    return this.raw.shapeType() as ShapeTypeName;
  }

  /** Enclosed volume of solids, in model units³ (0 for open shapes). */
  volume(): number {
    return this.raw.volume();
  }

  /** Total surface area in model units². */
  area(): number {
    return this.raw.area();
  }

  bounds(): BoundingBox {
    const b = vectorToArray(this.raw.bounds());
    return {
      min: [b[0]!, b[1]!, b[2]!],
      max: [b[3]!, b[4]!, b[5]!],
    };
  }

  /** BRepCheck_Analyzer result — catch corrupt imports before modeling. */
  isValid(): boolean {
    return this.raw.isValid();
  }

  /** Count sub-shapes: `count("Face")`, `count("Edge")`, ... */
  count(typeName: "Solid" | "Shell" | "Face" | "Wire" | "Edge" | "Vertex" | "Compound" | "CompSolid"): number {
    return this.raw.countSubShapes(typeName);
  }

  dispose(): void {
    this.raw.delete();
  }
}

export class OccSession {
  /** @internal the raw embind module; exposed for advanced/experimental use. */
  readonly module: OccWasmModule;

  #owned = new Set<WasmShape>();

  private constructor(module: OccWasmModule) {
    this.module = module;
  }

  /** Load the wasm kernel (Node or browser; see loader.ts for search paths). */
  static async create(options: OccCreateOptions = {}): Promise<OccSession> {
    const module = await loadOccModule(options);
    return new OccSession(module);
  }

  /** OCCT version string, e.g. `"7.9.3"`. */
  get occtVersion(): string {
    return this.module.occtVersion();
  }

  // --- primitives ------------------------------------------------------------

  makeBox(dx: number, dy: number, dz: number): OccShape {
    return this.adopt(this.module.makeBox(dx, dy, dz));
  }

  makeCylinder(radius: number, height: number, options: PrimitiveOptions = {}): OccShape {
    const [dx, dy, dz] = options.direction ?? [0, 0, 1];
    const [ox, oy, oz] = options.origin ?? [0, 0, 0];
    return this.adopt(this.module.makeCylinder(radius, height, dx, dy, dz, ox, oy, oz));
  }

  makeSphere(radius: number, origin: Vec3 = [0, 0, 0]): OccShape {
    return this.adopt(this.module.makeSphere(radius, origin[0], origin[1], origin[2]));
  }

  makeCone(bottomRadius: number, topRadius: number, height: number, options: PrimitiveOptions = {}): OccShape {
    const [dx, dy, dz] = options.direction ?? [0, 0, 1];
    const [ox, oy, oz] = options.origin ?? [0, 0, 0];
    return this.adopt(this.module.makeCone(bottomRadius, topRadius, height, dx, dy, dz, ox, oy, oz));
  }

  makeTorus(majorRadius: number, minorRadius: number, options: PrimitiveOptions = {}): OccShape {
    const [dx, dy, dz] = options.direction ?? [0, 0, 1];
    const [ox, oy, oz] = options.origin ?? [0, 0, 0];
    return this.adopt(this.module.makeTorus(majorRadius, minorRadius, dx, dy, dz, ox, oy, oz));
  }

  // --- booleans ----------------------------------------------------------------

  fuse(a: OccShape, b: OccShape): OccShape {
    return this.adopt(this.module.fuse(a.raw, b.raw));
  }

  cut(a: OccShape, b: OccShape): OccShape {
    return this.adopt(this.module.cut(a.raw, b.raw));
  }

  common(a: OccShape, b: OccShape): OccShape {
    return this.adopt(this.module.common(a.raw, b.raw));
  }

  // --- transforms ----------------------------------------------------------------

  translate(shape: OccShape, by: Vec3): OccShape {
    return this.adopt(this.module.translate(shape.raw, by[0], by[1], by[2]));
  }

  /** Rotate `angleDegrees` around the axis through the origin. */
  rotate(shape: OccShape, axis: Vec3, angleDegrees: number): OccShape {
    const len = Math.hypot(axis[0], axis[1], axis[2]);
    if (len < 1e-12) throw new Error("rotate: axis must be a non-zero vector");
    const radians = (angleDegrees * Math.PI) / 180;
    return this.adopt(
      this.module.rotate(shape.raw, axis[0] / len, axis[1] / len, axis[2] / len, radians),
    );
  }

  scale(shape: OccShape, factor: number): OccShape {
    return this.adopt(this.module.scale(shape.raw, factor));
  }

  // --- data exchange ----------------------------------------------------------------

  /** Import a STEP file (AP203/AP214/AP242) from raw bytes. */
  readStep(bytes: Uint8Array): OccShape {
    return this.adopt(this.withHeapBytes(bytes, (ptr, len) => this.module.readStep(ptr, len)));
  }

  /** Import a BRep file (OCCT's native format) from raw bytes. */
  readBrep(bytes: Uint8Array): OccShape {
    return this.adopt(this.withHeapBytes(bytes, (ptr, len) => this.module.readBrep(ptr, len)));
  }

  /** Export as STEP text. */
  writeStep(shape: OccShape): Uint8Array {
    const text = this.module.writeStep(shape.raw);
    this.throwIfError();
    return new TextEncoder().encode(text);
  }

  /** Export as BRep text. Set `withTriangles` to carry the tessellation along. */
  writeBrep(shape: OccShape, withTriangles = false): Uint8Array {
    const text = this.module.writeBrep(shape.raw, withTriangles);
    this.throwIfError();
    return new TextEncoder().encode(text);
  }

  // --- tessellation & hidden lines ---------------------------------------------------

  tessellate(shape: OccShape, options: TessellationOptions = {}): MeshData {
    const linear = options.linearDeflection ?? DEFAULT_LINEAR_DEFLECTION;
    const angular = options.angularDeflection ?? DEFAULT_ANGULAR_DEFLECTION_DEG;
    const relative = options.relative ?? false;

    const raw = this.module.tessellate(shape.raw, linear, angular, relative);
    try {
      this.throwIfError();
      return {
        positions: this.copyF32(raw.positionsPtr(), raw.positionCount() * 3),
        indices: this.copyU32(raw.indicesPtr(), raw.indexCount()),
        edges: this.copyF32(raw.edgesPtr(), raw.edgePointCount() * 3),
      };
    } finally {
      raw.delete();
    }
  }

  /**
   * Hidden-line removal for a viewing direction — engineering-drawing style.
   * Result line arrays hold segments (consecutive point pairs) in the
   * projection frame described by `result.xAxis` / `result.yAxis`.
   */
  hiddenLines(shape: OccShape, options: HiddenLineOptions): HiddenLineResult {
    const dir = normalize(options.direction);
    const upInput = options.up ?? [0, 0, 1] as Vec3;
    const deflection = options.deflection ?? DEFAULT_LINEAR_DEFLECTION;

    // Mirror hlr.cpp's frame: x = up projected onto the view plane, y = dir × x.
    const d = dir[0] * upInput[0] + dir[1] * upInput[1] + dir[2] * upInput[2];
    let x: Vec3 = [
      upInput[0] - dir[0] * d,
      upInput[1] - dir[1] * d,
      upInput[2] - dir[2] * d,
    ];
    if (Math.hypot(x[0], x[1], x[2]) < 1e-9) {
      x = Math.abs(dir[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    }
    x = normalize(x);
    const y = normalize(cross(dir, x));

    const raw = this.module.hiddenLines(
      shape.raw,
      dir[0], dir[1], dir[2],
      x[0], x[1], x[2],
      deflection,
    );
    try {
      this.throwIfError();
      return {
        visible: this.copyF32(raw.visiblePtr(), raw.visiblePointCount() * 3),
        hidden: this.copyF32(raw.hiddenPtr(), raw.hiddenPointCount() * 3),
        xAxis: x,
        yAxis: y,
      };
    } finally {
      raw.delete();
    }
  }

  // --- lifetime ------------------------------------------------------------------

  /** Free every shape created by this session. */
  dispose(): void {
    for (const raw of this.#owned) {
      raw.delete();
    }
    this.#owned.clear();
  }

  // --- internals ------------------------------------------------------------------

  private throwIfError(): void {
    if (this.module.hasError()) {
      throw new Error(this.module.lastError());
    }
  }

  private adopt(raw: WasmShape): OccShape {
    if (this.module.hasError()) {
      const message = this.module.lastError();
      raw.delete();
      throw new Error(message);
    }
    this.#owned.add(raw);
    return new OccShape(raw);
  }

  private copyF32(ptr: number, floats: number): Float32Array {
    if (floats <= 0) return new Float32Array(0);
    return new Float32Array(new Float32Array(this.module.HEAPU8.buffer, ptr, floats));
  }

  private copyU32(ptr: number, ints: number): Uint32Array {
    if (ints <= 0) return new Uint32Array(0);
    return new Uint32Array(new Uint32Array(this.module.HEAPU8.buffer, ptr, ints));
  }

  private withHeapBytes<T>(bytes: Uint8Array, fn: (ptr: number, length: number) => T): T {
    if (bytes.length === 0) throw new Error("expected a non-empty file payload");
    const ptr = this.module._malloc(bytes.length);
    try {
      this.module.HEAPU8.set(bytes, ptr);
      return fn(ptr, bytes.length);
    } finally {
      this.module._free(ptr);
    }
  }
}

/**
 * embind's register_vector returns a vector-like object ({size(), get()}) in
 * the pinned Emscripten version; accept plain arrays too for forwards
 * compatibility.
 */
function vectorToArray(value: number[] | { size(): number; get(index: number): number }): number[] {
  if (Array.isArray(value)) return value;
  const out: number[] = [];
  for (let i = 0; i < value.size(); i++) {
    out.push(value.get(i));
  }
  return out;
}

function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (len < 1e-12) throw new Error("direction must be a non-zero vector");
  return [v[0] / len, v[1] / len, v[2] / len];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}
