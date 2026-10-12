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
import { meshToGlb } from "./exporters.js";
import {
  detectHoles,
  type GeometryDescription,
  type PartDescription,
  type ShapeDistance,
  type ShapeDocument,
} from "./interrogate.js";
import type {
  ArcOptions,
  BezierOptions,
  BooleanOptions,
  BoundingBox,
  BsplineOptions,
  BsplineSurfaceInfo,
  BsplineSurfaceOptions,
  ChamferOptions,
  CircleOptions,
  CircularPatternOptions,
  DraftOptions,
  EdgeBlendOptions,
  EllipseArcOptions,
  EllipseOptions,
  HealOptions,
  HelixOptions,
  HiddenLineOptions,
  HiddenLineResult,
  InterpolateOptions,
  LoftOptions,
  MeshData,
  MirrorOptions,
  OffsetWireOptions,
  PipeShellOptions,
  PointClassification,
  PolygonOptions,
  PrimitiveOptions,
  ProjectOptions,
  RectangularPatternOptions,
  RevolveOptions,
  ShapeTypeName,
  ShellOptions,
  SolidProfileOptions,
  SubShapeType,
  TessellationOptions,
  UnitOption,
  Vec3,
  VariableFilletSpec,
} from "./types.js";
import type { OccWasmModule, WasmShape, WasmShapeVector } from "./wasm-module.js";
import type { Raw_TopoDS_Shape } from "./raw.generated.js";

const DEFAULT_LINEAR_DEFLECTION = 0.1;
const DEFAULT_ANGULAR_DEFLECTION_DEG = 20;

/**
 * A node of a `writeStepDocument` tree — the mirror of `readStepDocument`'s
 * output. A node carries either a `shape` (leaf) or `children` (assembly).
 */
export interface WriteDocumentNode {
  /** Part/assembly name written into the STEP file. */
  name?: string;
  /** Surface color as `"#RRGGBB"`. */
  color?: string;
  /** The node's geometry (leaves only — mutually exclusive with `children`). */
  shape?: OccShape;
  /** Sub-nodes (assemblies only). */
  children?: readonly WriteDocumentNode[];
  /**
   * Instance placement as 12 row-major 3×4 numbers
   * (`[r11,r12,r13,t1, r21,r22,r23,t2, r31,r32,r33,t3]`), matching
   * `readStepDocument`'s `transform` output. Identity when omitted.
   */
  transform?: readonly number[];
}

export type OccCreateOptions = WasmLocationOptions & {
  /**
   * Re-enable OCCT's console diagnostics (STEP/IGES transfer banners). The
   * kernel is silent by default: OCCT prints those to stdout, which corrupts
   * anything treating stdout as structured output (MCP stdio transport,
   * captured agent logs). Verbose output also goes to stdout — opt in only
   * for interactive debugging. Default `false`.
   */
  verbose?: boolean;
};

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

  /**
   * Center of mass: volume-weighted for solids, otherwise the surface/curve
   * integral (open shells, wires — a circle's centroid is its center).
   */
  centroid(): Vec3 {
    const c = vectorToArray(this.raw.centroid());
    return [c[0]!, c[1]!, c[2]!];
  }

  /** BRepCheck_Analyzer result — catch corrupt imports before modeling. */
  isValid(): boolean {
    return this.raw.isValid();
  }

  /** Count sub-shapes: `count("Face")`, `count("Edge")`, ... */
  count(typeName: SubShapeType): number {
    return this.raw.countSubShapes(typeName);
  }

  /**
   * Identity test: true when both handles wrap the same underlying sub-shape
   * (same TShape at the same location — how build123d/OCP compare the edges
   * and faces they pick out of a solid).
   */
  isSame(other: OccShape): boolean {
    return this.raw.isSame(other.raw);
  }

  dispose(): void {
    this.raw.delete();
  }
}

export class OccSession {
  /** @internal the raw embind module; exposed for advanced/experimental use. */
  readonly module: OccWasmModule;

  #owned = new Set<WasmShape>();
  // Flips the stdout gate installed in create() — see #installStdoutGate.
  #setStdoutGate: (open: boolean) => void = () => {};

  private constructor(module: OccWasmModule) {
    this.module = module;
  }

  /** Load the wasm kernel (Node or browser; see loader.ts for search paths). */
  static async create(options: OccCreateOptions = {}): Promise<OccSession> {
    let stdoutOpen = false;
    // Belt-and-braces stdout gate. Mutating the OCCT default messenger
    // silences the STEP/IGES banners, but a few legacy OCCT paths print
    // straight to std::cout (the BRep reader's version warning) — Emscripten
    // funnels those through Module.print, so everything passes this gate.
    // It opens only in verbose mode: stdout is a protocol, not a log.
    const module = await loadOccModule({
      ...options,
      print: (text: string) => {
        if (stdoutOpen) console.log(text);
      },
    });
    const session = new OccSession(module);
    session.#setStdoutGate = (open: boolean) => {
      stdoutOpen = open;
    };
    if (options.verbose) session.setVerbose(true);
    return session;
  }

  /**
   * Toggle OCCT console diagnostics at runtime (the `verbose` create option,
   * mutable). Restores the STEP/IGES transfer banners and legacy kernel
   * prints on stdout — keep it off whenever stdout is captured as structured
   * output (MCP stdio transport, agent logs).
   */
  setVerbose(verbose: boolean): void {
    this.#setStdoutGate(verbose);
    this.module.setVerbose(verbose);
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

  /** Circle as a closed wire — a section for extrude/revolve/loft or a sweep spine. */
  makeCircle(radius: number, options: CircleOptions = {}): OccShape {
    if (!(radius > 0)) throw new Error("makeCircle: radius must be a positive number");
    const [dx, dy, dz] = options.normal ?? [0, 0, 1];
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-12) throw new Error("makeCircle: normal must be a non-zero vector");
    const [ox, oy, oz] = options.origin ?? [0, 0, 0];
    return this.adopt(
      this.module.makeCircle(radius, dx / len, dy / len, dz / len, ox, oy, oz),
    );
  }

  /** Polygon wire through `points` (closed by default) — a section or a sweep spine. */
  makePolygon(points: readonly Vec3[], options: PolygonOptions = {}): OccShape {
    const close = options.close ?? true;
    const minimum = close ? 3 : 2;
    if (points.length < minimum) {
      throw new Error(`makePolygon: needs at least ${minimum} points (got ${points.length})`);
    }
    const flat: number[] = [];
    for (let i = 0; i < points.length; i++) {
      const point = points[i]!;
      if (![point[0], point[1], point[2]].every(Number.isFinite)) {
        throw new Error("makePolygon: points must be finite numbers");
      }
      // Zero-length edges make OCCT's wire builder fail without a message.
      if (i > 0 && coincides(points[i - 1]!, point)) {
        throw new Error("makePolygon: consecutive points must be distinct");
      }
      flat.push(point[0], point[1], point[2]);
    }
    if (close && coincides(points[0]!, points[points.length - 1]!)) {
      throw new Error("makePolygon: drop the repeated closing point — close is automatic");
    }
    return this.adopt(
      this.withFloats(flat, (ptr, count) => this.module.makePolygon(ptr, count / 3, close)),
    );
  }

  /** Line-segment wire from `start` to `end`. */
  makeLine(start: Vec3, end: Vec3): OccShape {
    if (!allFinite([start, end])) throw new Error("makeLine: points must be finite numbers");
    if (coincides(start, end)) throw new Error("makeLine: start and end must be distinct");
    return this.adopt(
      this.module.makeLine(start[0], start[1], start[2], end[0], end[1], end[2]),
    );
  }

  /**
   * Circular arc wire from `startDegrees` to `endDegrees`, counterclockwise
   * around `normal` (right-hand rule). The span must be under 360° — use
   * `makeCircle` for the full turn.
   */
  makeArc(radius: number, options: ArcOptions): OccShape {
    if (!(radius > 0)) throw new Error("makeArc: radius must be a positive number");
    const [dx, dy, dz] = options.normal ?? [0, 0, 1];
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-12) throw new Error("makeArc: normal must be a non-zero vector");
    const span = options.endDegrees - options.startDegrees;
    if (!(span > 0)) throw new Error("makeArc: endDegrees must be greater than startDegrees");
    if (span >= 360) {
      throw new Error("makeArc: span must be under 360° — use makeCircle for a full circle");
    }
    const [ox, oy, oz] = options.origin ?? [0, 0, 0];
    const radians = (degrees: number) => (degrees * Math.PI) / 180;
    return this.adopt(
      this.module.makeArc(
        radius, dx / len, dy / len, dz / len, ox, oy, oz,
        radians(options.startDegrees), radians(options.endDegrees),
      ),
    );
  }

  /**
   * Ellipse wire — `majorRadius` along the plane's in-plane X axis (world +X
   * for the default +Z normal), `minorRadius` along Y.
   */
  makeEllipse(majorRadius: number, minorRadius: number, options: EllipseOptions = {}): OccShape {
    if (!(minorRadius > 0)) throw new Error("makeEllipse: minorRadius must be a positive number");
    if (majorRadius < minorRadius) {
      throw new Error("makeEllipse: majorRadius must be at least minorRadius (swap them?)");
    }
    const [dx, dy, dz] = options.normal ?? [0, 0, 1];
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-12) throw new Error("makeEllipse: normal must be a non-zero vector");
    const [ox, oy, oz] = options.origin ?? [0, 0, 0];
    return this.adopt(
      this.module.makeEllipse(
        majorRadius, minorRadius, dx / len, dy / len, dz / len, ox, oy, oz,
      ),
    );
  }

  /**
   * Elliptical arc wire from `startDegrees` to `endDegrees`, counterclockwise
   * around `normal` — the analytic conic, not a sampled approximation
   * (`describe` reports `"ellipse"`; it re-edits exactly). The span must be
   * under 360° — `makeEllipse` makes the full ellipse.
   */
  makeEllipseArc(majorRadius: number, minorRadius: number, options: EllipseArcOptions): OccShape {
    if (!(minorRadius > 0)) throw new Error("makeEllipseArc: minorRadius must be a positive number");
    if (majorRadius < minorRadius) {
      throw new Error("makeEllipseArc: majorRadius must be at least minorRadius (swap them?)");
    }
    const [dx, dy, dz] = options.normal ?? [0, 0, 1];
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-12) throw new Error("makeEllipseArc: normal must be a non-zero vector");
    const span = options.endDegrees - options.startDegrees;
    if (!(span > 0)) throw new Error("makeEllipseArc: endDegrees must be greater than startDegrees");
    if (span >= 360) {
      throw new Error("makeEllipseArc: span must be under 360° — use makeEllipse for the full ellipse");
    }
    const [ox, oy, oz] = options.origin ?? [0, 0, 0];
    const radians = (degrees: number) => (degrees * Math.PI) / 180;
    return this.adopt(
      this.module.makeEllipseArc(
        majorRadius, minorRadius, dx / len, dy / len, dz / len, ox, oy, oz,
        radians(options.startDegrees), radians(options.endDegrees),
      ),
    );
  }

  /**
   * Bézier wire from control points (`poles`) — one polynomial segment of
   * degree `poles.length - 1`: the curve starts at the first pole, ends at
   * the last, and stays inside their convex hull. Optional `weights` make it
   * rational (exact conic arcs).
   */
  makeBezier(poles: readonly Vec3[], options: BezierOptions = {}): OccShape {
    if (poles.length < 2) throw new Error("makeBezier: needs at least 2 poles");
    if (poles.length > 26) {
      throw new Error(`makeBezier: ${poles.length} poles exceed the degree-25 limit (26 poles)`);
    }
    if (!allFinite(poles)) throw new Error("makeBezier: poles must be finite numbers");
    const weights = options.weights;
    if (weights !== undefined) {
      if (weights.length !== poles.length) {
        throw new Error(`makeBezier: ${weights.length} weights do not match ${poles.length} poles`);
      }
      if (!weights.every((w) => w > 0)) {
        throw new Error("makeBezier: weights must all be positive");
      }
    }
    const flat = flatten(poles);
    const weightList = weights ?? [];
    return this.adopt(
      this.withFloats(flat, (polesPtr, _) =>
        this.withFloats([...weightList], (weightsPtr, __) =>
          this.module.makeBezier(polesPtr, poles.length, weightList.length > 0 ? weightsPtr : 0),
        ),
      ),
    );
  }

  /**
   * B-spline wire from control points (`poles`), with clamped uniform knots:
   * the curve starts at the first pole and ends at the last, approaching the
   * others. `degree` defaults to 3.
   */
  makeBspline(poles: readonly Vec3[], options: BsplineOptions = {}): OccShape {
    const degree = options.degree ?? 3;
    if (poles.length < 2) throw new Error("makeBspline: needs at least 2 poles");
    if (!Number.isInteger(degree) || degree < 1) {
      throw new Error("makeBspline: degree must be a positive integer");
    }
    if (poles.length < degree + 1) {
      throw new Error(
        `makeBspline: ${poles.length} poles cannot support degree ${degree} — need at least degree + 1 (${degree + 1})`,
      );
    }
    if (!allFinite(poles)) throw new Error("makeBspline: poles must be finite numbers");
    return this.adopt(
      this.withFloats(flatten(poles), (ptr, count) =>
        this.module.makeBspline(ptr, count / 3, degree),
      ),
    );
  }

  /**
   * Smooth B-spline wire interpolated THROUGH every point — the "curve
   * through points" primitive. `periodic: true` closes it smoothly.
   */
  makeBsplineThrough(points: readonly Vec3[], options: InterpolateOptions = {}): OccShape {
    const periodic = options.periodic ?? false;
    const minimum = periodic ? 3 : 2;
    if (points.length < minimum) {
      throw new Error(`makeBsplineThrough: needs at least ${minimum} points (got ${points.length})`);
    }
    if (!allFinite(points)) throw new Error("makeBsplineThrough: points must be finite numbers");
    return this.adopt(
      this.withFloats(flatten(points), (ptr, count) =>
        this.module.makeBsplineThrough(ptr, count / 3, periodic, options.tolerance ?? 1e-6),
      ),
    );
  }

  /**
   * Concatenate connected wires/edges (arcs, lines, B-splines, circles…) into
   * one wire, in order — how profiles with mixed segments are authored.
   */
  makeWire(parts: readonly OccShape[]): OccShape {
    if (parts.length < 2) throw new Error("makeWire: needs at least 2 parts");
    const list = new this.module.VectorShape();
    try {
      for (const part of parts) {
        list.push_back(part.raw);
      }
      return this.adopt(this.module.makeWire(list));
    } finally {
      list.delete();
    }
  }

  /**
   * Helix wire — climbs `pitch` per full turn around the axis, ending at
   * `height`. The spine for springs and threads: sweep a circle along it,
   * or a rectangle for a screw flight.
   */
  makeHelix(radius: number, pitch: number, height: number, options: HelixOptions = {}): OccShape {
    if (!(radius > 0)) throw new Error("makeHelix: radius must be a positive number");
    if (!(pitch > 0)) throw new Error("makeHelix: pitch must be a positive number");
    if (!(height > 0)) throw new Error("makeHelix: height must be a positive number");
    const [dx, dy, dz] = options.direction ?? [0, 0, 1];
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-12) throw new Error("makeHelix: direction must be a non-zero vector");
    const [ox, oy, oz] = options.origin ?? [0, 0, 0];
    return this.adopt(
      this.module.makeHelix(
        radius, pitch, height, dx / len, dy / len, dz / len, ox, oy, oz,
        options.leftHanded ?? false,
      ),
    );
  }

  /**
   * Cap a planar outer wire into a face, with optional `holes` inside it —
   * the section for plates, flanges and gaskets (extrude it, or compose 2D
   * trim/intersect via `cut`/`common` on faces).
   */
  makeFace(outer: OccShape, holes: readonly OccShape[] = []): OccShape {
    const holeList = new this.module.VectorShape();
    try {
      for (const hole of holes) {
        holeList.push_back(hole.raw);
      }
      return this.adopt(this.module.makeFace(outer.raw, holeList));
    } finally {
      holeList.delete();
    }
  }

  /**
   * Split `shape` by one or more `tools`, keeping **every** fragment — the
   * pieces reassemble the original, with the region under a tool becoming
   * its own piece (use `cut` to discard material instead).
   */
  split(shape: OccShape, tools: OccShape | readonly OccShape[]): OccShape {
    const toolList = Array.isArray(tools) ? tools : [tools];
    if (toolList.length === 0) throw new Error("split: needs at least one tool");
    const list = new this.module.VectorShape();
    try {
      for (const tool of toolList) {
        list.push_back(tool.raw);
      }
      return this.adopt(this.module.split(shape.raw, list));
    } finally {
      list.delete();
    }
  }

  /**
   * Grow (`distance` > 0) or shrink (`distance` < 0) the whole solid by a
   * uniform offset — the outer skin moves, features roughly keep their shape.
   */
  offsetSolid(shape: OccShape, distance: number): OccShape {
    if (distance === 0) throw new Error("offsetSolid: distance must be non-zero");
    return this.adopt(this.module.offsetSolid(shape.raw, distance));
  }

  // --- healing -------------------------------------------------------------------

  /**
   * Repair geometry — the safety net after a sloppy import. Coincident
   * boundaries are stitched (faces of a compound merge shared edges; several
   * shapes assemble into one shell) and the result is fixed (faces, wires,
   * orientation, tolerances). Pass an array to stitch multiple parts
   * together; solids skip the stitching step (they are closed already) but
   * still get fixed.
   */
  heal(shapes: OccShape | readonly OccShape[], options: HealOptions = {}): OccShape {
    const list = Array.isArray(shapes) ? shapes : [shapes];
    if (list.length === 0) throw new Error("heal: needs at least one shape");
    const tolerance = options.tolerance ?? 1e-6;
    if (!(tolerance > 0)) throw new Error("heal: tolerance must be a positive number");
    const vector = new this.module.VectorShape();
    try {
      for (const shape of list) {
        vector.push_back(shape.raw);
      }
      return this.adopt(
        this.module.heal(vector, tolerance, options.sew ?? true, options.fix ?? true),
      );
    } finally {
      vector.delete();
    }
  }

  // --- B-spline surfaces -----------------------------------------------------------

  /**
   * B-spline surface face from a control-point grid: `poles` is an array of
   * rows, each row running along u (the row index is v). Knots are clamped
   * and uniform in both directions — the surface passes through the border
   * poles and approaches the interior ones. Degrees default to `3`.
   */
  makeBsplineSurface(
    poles: readonly (readonly Vec3[])[],
    options: BsplineSurfaceOptions = {},
  ): OccShape {
    const { flat, uCount, vCount } = flattenGrid(poles, "makeBsplineSurface");
    const uDegree = options.uDegree ?? 3;
    const vDegree = options.vDegree ?? 3;
    for (const [degree, count, axis] of [[uDegree, uCount, "u"], [vDegree, vCount, "v"]] as const) {
      if (!Number.isInteger(degree) || degree < 1) {
        throw new Error(`makeBsplineSurface: degrees must be positive integers (got ${degree} along ${axis})`);
      }
      if (count <= degree) {
        throw new Error(
          `makeBsplineSurface: ${count} poles along ${axis} cannot support degree ${degree} — need at least degree + 1`,
        );
      }
    }
    return this.adopt(
      this.withFloats(flat, (ptr, _) =>
        this.module.makeBsplineSurface(ptr, uCount, vCount, uDegree, vDegree),
      ),
    );
  }

  /**
   * Smooth B-spline surface face interpolated THROUGH every point of a grid
   * — the "surface through points" primitive (`poles` layout as
   * `makeBsplineSurface`).
   */
  makeBsplineSurfaceThrough(points: readonly (readonly Vec3[])[]): OccShape {
    const { flat, uCount, vCount } = flattenGrid(points, "makeBsplineSurfaceThrough");
    return this.adopt(
      this.withFloats(flat, (ptr, _) =>
        this.module.makeBsplineSurfaceThrough(ptr, uCount, vCount),
      ),
    );
  }

  /**
   * B-spline surface details of a face: degrees, knots, multiplicities and
   * the pole grid — enough to understand an imported surface or plan edits.
   */
  describeSurface(shape: OccShape): BsplineSurfaceInfo {
    const json = this.module.describeSurface(shape.raw);
    this.throwIfError();
    return JSON.parse(json) as BsplineSurfaceInfo;
  }

  /**
   * Replace the pole grid of a B-spline surface face (`describeSurface`'s
   * `poles` layout) — returns a **new** face, the original is untouched.
   */
  setBsplinePoles(shape: OccShape, poles: readonly (readonly Vec3[])[]): OccShape {
    const { flat, uCount, vCount } = flattenGrid(poles, "setBsplinePoles");
    return this.adopt(
      this.withFloats(flat, (ptr, _) =>
        this.module.setBsplineSurfacePoles(shape.raw, ptr, uCount, vCount),
      ),
    );
  }

  // --- booleans ----------------------------------------------------------------

  /**
   * Union of two shapes. The result is cleaned by default: coplanar faces
   * merge and collinear edges join, so `faces(">Z")`-style selection sees the
   * fused part, not the fragments ({@link BooleanOptions}.clean controls it).
   */
  fuse(a: OccShape, b: OccShape, options: BooleanOptions = {}): OccShape {
    return this.adopt(this.module.fuse(a.raw, b.raw, options.clean ?? true));
  }

  /** Difference `a − b`; cleaned like `fuse`. */
  cut(a: OccShape, b: OccShape, options: BooleanOptions = {}): OccShape {
    return this.adopt(this.module.cut(a.raw, b.raw, options.clean ?? true));
  }

  /** Intersection `a ∩ b`; cleaned like `fuse`. */
  common(a: OccShape, b: OccShape, options: BooleanOptions = {}): OccShape {
    return this.adopt(this.module.common(a.raw, b.raw, options.clean ?? true));
  }

  /**
   * Merge same-domain faces and collinear edges of any shape — the same pass
   * booleans run by default, applied on demand (sloppy imports, `split`
   * fragments, tessellation-heavy patterns).
   */
  unify(shape: OccShape): OccShape {
    return this.adopt(this.module.unify(shape.raw));
  }

  /**
   * 2D offset of a planar wire or face (BRepOffsetAPI_MakeOffset): positive
   * `distance` grows the profile outward — wall `t` comes in as
   * `offsetWire(face, -t)` so holes shrink with the boundary. Corners join
   * by arc (default), tangent or intersection. This is sketch-level
   * offsetting; `offsetSolid` grows a solid's whole skin in 3D.
   */
  offsetWire(profile: OccShape, distance: number, options: OffsetWireOptions = {}): OccShape {
    if (distance === 0) throw new Error("offsetWire: distance must be non-zero");
    const join = options.join === "tangent" ? 1 : options.join === "intersection" ? 2 : 0;
    return this.adopt(this.module.offsetWire(profile.raw, distance, join));
  }

  /**
   * Project a wire or edge onto a face or shell (BRepProj_Projection), planar
   * along `direction` — the path a handle follows on a surface, or the
   * engraving curve for text on a curved face. Returns a wire (or compound
   * of wires) lying on the surface.
   */
  project(shape: OccShape, target: OccShape, options: ProjectOptions): OccShape {
    const [dx, dy, dz] = options.direction;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-12) throw new Error("project: direction must be a non-zero vector");
    return this.adopt(
      this.module.project(shape.raw, target.raw, dx / len, dy / len, dz / len),
    );
  }

  /**
   * A compound holding several shapes side by side — the multi-body
   * container for disjoint parts that must not fuse. `describe`,
   * `tessellate` and the measurements walk the whole tree.
   */
  compound(shapes: readonly OccShape[]): OccShape {
    if (shapes.length === 0) throw new Error("compound: needs at least one shape");
    return this.adopt(this.withShapes(shapes, (list) => this.module.compound(list)));
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

  /**
   * Mirror through a `plane` (a point on it plus its normal) or about an
   * `axis` line — pass exactly one of the two. Left/right handed parts and
   * symmetric assemblies start here.
   */
  mirror(shape: OccShape, options: MirrorOptions): OccShape {
    const usingPlane = options.plane !== undefined;
    const usingAxis = options.axis !== undefined;
    if (usingPlane === usingAxis) {
      throw new Error("mirror: pass exactly one of plane { origin, normal } or axis { origin, direction }");
    }
    if (usingPlane) {
      const [dx, dy, dz] = options.plane!.normal;
      const len = Math.hypot(dx, dy, dz);
      if (len < 1e-12) throw new Error("mirror: plane normal must be a non-zero vector");
      const [ox, oy, oz] = options.plane!.origin ?? [0, 0, 0];
      return this.adopt(
        this.module.mirror(shape.raw, 0, ox, oy, oz, dx / len, dy / len, dz / len),
      );
    }
    const [dx, dy, dz] = options.axis!.direction;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-12) throw new Error("mirror: axis direction must be a non-zero vector");
    const [ox, oy, oz] = options.axis!.origin ?? [0, 0, 0];
    return this.adopt(
      this.module.mirror(shape.raw, 1, ox, oy, oz, dx / len, dy / len, dz / len),
    );
  }

  /**
   * A grid of translated copies — bolt circles start as grids, ribs land on
   * grids. The original sits at (0, 0); the result is a compound of all
   * copies (`fuse` merges them into one solid).
   */
  rectangularPattern(shape: OccShape, options: RectangularPatternOptions): OccShape {
    const countX = options.countX;
    const countY = options.countY ?? 1;
    if (!Number.isInteger(countX) || countX < 1) {
      throw new Error("rectangularPattern: countX must be an integer of at least 1");
    }
    if (!Number.isInteger(countY) || countY < 1) {
      throw new Error("rectangularPattern: countY must be an integer of at least 1");
    }
    if (countX * countY < 2) {
      throw new Error("rectangularPattern: a 1 × 1 grid is a single copy — raise a count");
    }
    const spacingX = options.spacingX;
    const spacingY = options.spacingY ?? spacingX;
    if (!(Math.abs(spacingX) > 0)) throw new Error("rectangularPattern: spacingX must be non-zero");
    if (!(Math.abs(spacingY) > 0)) throw new Error("rectangularPattern: spacingY must be non-zero");
    const u = normalizedOption(options.directionX ?? [1, 0, 0], "rectangularPattern: directionX");
    const v = normalizedOption(options.directionY ?? [0, 1, 0], "rectangularPattern: directionY");
    if (Math.abs(u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) > 1 - 1e-9) {
      throw new Error("rectangularPattern: directionX and directionY must not be parallel");
    }
    return this.adopt(
      this.module.rectangularPattern(
        shape.raw, countX, countY, spacingX, spacingY,
        u[0], u[1], u[2], v[0], v[1], v[2],
      ),
    );
  }

  /**
   * Copies rotated around an axis, evenly spread over `sweepDegrees` (the
   * original sits at angle 0). The result is a compound of all copies —
   * `fuse` merges them into one solid.
   */
  circularPattern(shape: OccShape, options: CircularPatternOptions): OccShape {
    const count = options.count;
    if (!Number.isInteger(count) || count < 2) {
      throw new Error("circularPattern: count must be an integer of at least 2");
    }
    const sweepDegrees = options.sweepDegrees ?? 360;
    if (!(sweepDegrees > 0)) throw new Error("circularPattern: sweepDegrees must be positive");
    const [dx, dy, dz] = options.axis ?? [0, 0, 1];
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-12) throw new Error("circularPattern: axis must be a non-zero vector");
    const [ox, oy, oz] = options.origin ?? [0, 0, 0];
    // Like revolve: over-360° sweeps clamp to the full circle (copies would
    // otherwise land on top of earlier ones).
    const radians = Math.min(sweepDegrees, 360) * Math.PI / 180;
    return this.adopt(
      this.module.circularPattern(
        shape.raw, count, radians, dx / len, dy / len, dz / len, ox, oy, oz,
      ),
    );
  }

  // --- shelling & drafting ----------------------------------------------------

  /**
   * Hollow a solid into a shell of wall `thickness` — the wall grows inward,
   * the outer skin is preserved. `openFaces` (1-based indices as listed by
   * `describe`) are removed and become the openings; with no `openFaces` the
   * hollow is sealed.
   */
  shell(shape: OccShape, thickness: number, options: ShellOptions = {}): OccShape {
    if (!(thickness > 0)) {
      throw new Error("shell: thickness must be a positive number (the wall thickness)");
    }
    const openFaces = options.openFaces ?? [];
    this.validateFaceIndices("shell", shape, openFaces);
    return this.adopt(
      this.withInts(openFaces, (ptr, count) => this.module.shell(shape.raw, thickness, ptr, count)),
    );
  }

  /**
   * Tilt faces by `angleDegrees` for mold release. Faces pivot about the
   * neutral plane — dimensions there are unchanged. By default the plane
   * passes through the bounds center (normal to `direction`) and the faces
   * drafted are the ones running parallel to `direction` (the walls); pass
   * `faces` (1-based, as listed by `describe`) for a specific subset.
   */
  draft(shape: OccShape, angleDegrees: number, options: DraftOptions = {}): OccShape {
    const [dx, dy, dz] = options.direction ?? [0, 0, 1];
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-12) throw new Error("draft: direction must be a non-zero vector");
    if (angleDegrees === 0) throw new Error("draft: angleDegrees must be non-zero");

    const bounds = shape.bounds();
    const [nx, ny, nz] = options.neutralPoint ?? [
      (bounds.min[0] + bounds.max[0]) / 2,
      (bounds.min[1] + bounds.max[1]) / 2,
      (bounds.min[2] + bounds.max[2]) / 2,
    ];

    const faces = options.faces ?? [];
    this.validateFaceIndices("draft", shape, faces);

    const radians = (angleDegrees * Math.PI) / 180;
    return this.adopt(
      this.withInts(faces, (ptr, count) =>
        this.module.draft(
          shape.raw, radians,
          dx / len, dy / len, dz / len,
          nx, ny, nz,
          ptr, count, faces.length === 0,
        ),
      ),
    );
  }

  // --- edge blends: fillets & chamfers ----------------------------------------

  /**
   * Round edges with `radius`. Default: every edge; pass `edges` — 1-based
   * indices (as listed by `describe`) or handles from `edges(shape)` — for a
   * specific subset.
   */
  fillet(shape: OccShape, radius: number, options: EdgeBlendOptions = {}): OccShape {
    if (!(radius > 0)) {
      throw new Error("fillet: radius must be a positive number");
    }
    const { indices, handles } = this.edgeSelection("fillet", shape, options.edges ?? []);
    if (handles.length > 0) {
      return this.adopt(
        this.withShapes(handles, (list) => this.module.filletEdges(shape.raw, radius, list)),
      );
    }
    return this.adopt(
      this.withInts(indices, (ptr, count) => this.module.fillet(shape.raw, radius, ptr, count)),
    );
  }

  /**
   * Bevel edges by `distance` (equal on both sides). Same edge selection as
   * `fillet`; `length2` gives an asymmetric chamfer — `distance` is measured
   * on the first face adjacent to the edge (as ordered by `describe`),
   * `length2` on the other one.
   */
  chamfer(shape: OccShape, distance: number, options: ChamferOptions = {}): OccShape {
    if (!(distance > 0)) {
      throw new Error("chamfer: distance must be a positive number");
    }
    const length2 = options.length2;
    if (length2 !== undefined && !(length2 > 0)) {
      throw new Error("chamfer: length2 must be a positive number");
    }
    const { indices, handles } = this.edgeSelection("chamfer", shape, options.edges ?? []);
    if (handles.length > 0) {
      return this.adopt(
        this.withShapes(handles, (list) =>
          this.module.chamferEdges(shape.raw, distance, length2 ?? NaN, list),
        ),
      );
    }
    return this.adopt(
      this.withInts(indices, (ptr, count) =>
        this.module.chamfer(shape.raw, distance, length2 ?? NaN, ptr, count),
      ),
    );
  }

  /**
   * Fillet with per-edge (and per-position) radii: `[{ edge, radius, at? }]`
   * where `edge` is a 1-based index from `describe` or a handle from
   * `edges(shape)`. Two specs on one edge with different `at` positions blend
   * the radius between them — `at` is the edge's curve parameter (for line
   * edges: distance from the start).
   */
  variableFillet(shape: OccShape, specs: readonly VariableFilletSpec[]): OccShape {
    if (specs.length === 0) {
      throw new Error("variableFillet: needs at least one {edge, radius} spec");
    }
    for (const spec of specs) {
      if (!(spec.radius > 0)) {
        throw new Error("variableFillet: radius must be a positive number");
      }
    }
    const { indices, handles } = this.edgeSelection(
      "variableFillet", shape, specs.map((spec) => spec.edge),
    );
    const radii = specs.map((spec) => spec.radius);
    // NaN in the positions array means "constant radius" on that edge.
    const positions = specs.map((spec) => spec.at ?? NaN);
    if (handles.length > 0) {
      return this.adopt(
        this.withFloats(radii, (radiiPtr, _) =>
          this.withFloats(positions, (positionsPtr, __) =>
            this.withShapes(handles, (list) =>
              this.module.variableFilletEdges(shape.raw, list, radiiPtr, positionsPtr),
            ),
          ),
        ),
      );
    }
    return this.adopt(
      this.withInts(indices, (edgePtr, count) =>
        this.withFloats(radii, (radiiPtr, _) =>
          this.withFloats(positions, (positionsPtr, __) =>
            this.module.variableFillet(shape.raw, edgePtr, count, radiiPtr, positionsPtr),
          ),
        ),
      ),
    );
  }

  // --- sub-shape access -----------------------------------------------------------

  /**
   * Sub-shape handles of one type — first-class edges/faces/... that pass
   * back into operations (`fillet`, `chamfer`, transforms, booleans) and can
   * be interrogated (`describe` works on a handle). Order matches `describe`
   * and `count`: `subShapes(shape, "Edge")[i]` is edge `i + 1`.
   */
  subShapes(shape: OccShape, typeName: SubShapeType): OccShape[] {
    const list = this.module.subShapes(shape.raw, typeName);
    try {
      this.throwIfError();
      const out: OccShape[] = [];
      for (let i = 0; i < list.size(); i++) {
        out.push(this.adopt(list.get(i)));
      }
      return out;
    } finally {
      list.delete();
    }
  }

  /** Every edge of `shape` as a handle — `subShapes(shape, "Edge")`. */
  edges(shape: OccShape): OccShape[] {
    return this.subShapes(shape, "Edge");
  }

  /** Every face of `shape` as a handle — `subShapes(shape, "Face")`. */
  faces(shape: OccShape): OccShape[] {
    return this.subShapes(shape, "Face");
  }

  /** Every vertex of `shape` as a handle — `subShapes(shape, "Vertex")`. */
  vertices(shape: OccShape): OccShape[] {
    return this.subShapes(shape, "Vertex");
  }

  /** Every wire of `shape` as a handle — `subShapes(shape, "Wire")`. */
  wires(shape: OccShape): OccShape[] {
    return this.subShapes(shape, "Wire");
  }

  /** Every shell of `shape` as a handle — `subShapes(shape, "Shell")`. */
  shells(shape: OccShape): OccShape[] {
    return this.subShapes(shape, "Shell");
  }

  /** Every solid of `shape` as a handle — `subShapes(shape, "Solid")`. */
  solids(shape: OccShape): OccShape[] {
    return this.subShapes(shape, "Solid");
  }

  /** Every compound of `shape` as a handle — `subShapes(shape, "Compound")`. */
  compounds(shape: OccShape): OccShape[] {
    return this.subShapes(shape, "Compound");
  }

  /**
   * The boundary wires of a Face: `outer` is the containing loop, `inners`
   * are the holes inside it (sketch regions to avoid — or to pocket). The
   * face comes from `faces(shape)`, a boolean result or `makeFace`.
   */
  faceWires(face: OccShape): { outer: OccShape; inners: OccShape[] } {
    if (face.shapeType() !== "Face") {
      throw new Error('faceWires: expected a Face — get one via faces(shape) or subShapes(shape, "Face")');
    }
    const outer = this.adopt(this.module.outerWire(face.raw));
    const inners = this.wires(face).filter((wire) => !wire.isSame(outer));
    return { outer, inners };
  }

  // --- sketch → solid: extrude / revolve / loft / sweep --------------------------

  /**
   * Sweep a planar profile (wire or face) along a straight vector, e.g.
   * `extrude(makeCircle(5), [0, 0, 10])`. Wires become solids by default;
   * `solid: false` returns the extruded shell.
   */
  extrude(profile: OccShape, vector: Vec3, options: SolidProfileOptions = {}): OccShape {
    const len = Math.hypot(vector[0], vector[1], vector[2]);
    if (len < 1e-12) throw new Error("extrude: vector must be a non-zero vector");
    return this.adopt(
      this.module.extrude(profile.raw, vector[0], vector[1], vector[2], options.solid ?? true),
    );
  }

  /**
   * Revolve a planar profile about the axis through `origin` along
   * `direction`, by `angleDegrees` (default: a full turn). The profile must
   * not cross the axis.
   */
  revolve(profile: OccShape, options: RevolveOptions): OccShape {
    const [dx, dy, dz] = options.direction;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-12) throw new Error("revolve: direction must be a non-zero vector");
    const angleDegrees = options.angleDegrees ?? 360;
    if (!(angleDegrees > 0)) throw new Error("revolve: angleDegrees must be positive");
    const radians = Math.min((angleDegrees * Math.PI) / 180, 2 * Math.PI);
    const [ox, oy, oz] = options.origin ?? [0, 0, 0];
    return this.adopt(
      this.module.revolve(
        profile.raw, dx / len, dy / len, dz / len, ox, oy, oz, radians, options.solid ?? true,
      ),
    );
  }

  /**
   * Skin two or more sections (wires or faces) into one solid — default is a
   * smoothed B-spline surface; `ruled: true` rules straight sections between
   * neighbors (e.g. two circles become an exact frustum).
   */
  loft(sections: readonly OccShape[], options: LoftOptions = {}): OccShape {
    if (sections.length < 2) throw new Error("loft: needs at least 2 sections");
    // register_vector handles cannot be built from a plain JS array — fill
    // one per section and free it in one shot afterwards.
    const list = new this.module.VectorShape();
    try {
      for (const section of sections) {
        list.push_back(section.raw);
      }
      return this.adopt(
        this.module.loft(list, options.ruled ?? false, options.solid ?? true),
      );
    } finally {
      list.delete();
    }
  }

  /**
   * Sweep a planar profile along a spine wire. The profile is transported
   * from the spine's start — place it there, perpendicular to the spine's
   * tangent (a circle on a circular spine becomes a torus).
   */
  sweep(profile: OccShape, spine: OccShape, options: SolidProfileOptions = {}): OccShape {
    return this.adopt(this.module.sweep(profile.raw, spine.raw, options.solid ?? true));
  }

  /**
   * The controllable sweep (`BRepOffsetAPI_MakePipeShell`): everything
   * `sweep` does, plus a say in how the profile's frame travels. A fixed
   * `binormal` keeps a swept rectangle flat (a spiral ribbon); `frenet` is
   * the textbook frame; `correction: true` re-orients the profile onto the
   * spine's normal plane so it need not be placed perpendicular by hand.
   */
  pipeShell(profile: OccShape, spine: OccShape, options: PipeShellOptions = {}): OccShape {
    const mode = options.mode ?? "correctedFrenet";
    let modeIndex = 0;
    let binormal: Vec3 = [0, 0, 1];
    if (mode === "frenet") {
      modeIndex = 1;
    } else if (mode === "binormal") {
      modeIndex = 2;
      if (!options.binormal) {
        throw new Error('pipeShell: mode "binormal" needs a binormal direction');
      }
      binormal = normalizedOption(options.binormal, "pipeShell: binormal");
    }
    const transition = options.transition ?? "transformed";
    const transitionIndex = transition === "round" ? 1 : transition === "rightCorner" ? 2 : 0;
    return this.adopt(
      this.module.pipeShell(
        profile.raw, spine.raw, modeIndex, binormal[0], binormal[1], binormal[2],
        transitionIndex, options.correction ?? false, options.solid ?? true,
      ),
    );
  }

  // --- data exchange ----------------------------------------------------------------

  /** Import a STEP file (AP203/AP214/AP242) from raw bytes. */
  readStep(bytes: Uint8Array, options: { unit?: UnitOption } = {}): OccShape {
    return this.adopt(
      this.withHeapBytes(bytes, (ptr, len) => this.module.readStep(ptr, len, options.unit ?? "")),
    );
  }

  /** Import an IGES file from raw bytes. */
  readIges(bytes: Uint8Array): OccShape {
    return this.adopt(this.withHeapBytes(bytes, (ptr, len) => this.module.readIges(ptr, len)));
  }

  /**
   * Import a STEP file as an XCAF document: assembly tree with names, colors
   * and instance transforms. Leaf shapes (world-positioned) are available via
   * `documentShape(index)` until the next `readStepDocument` call.
   */
  readStepDocument(bytes: Uint8Array, options: { unit?: UnitOption } = {}): ShapeDocument {
    const json = this.withHeapBytes(
      bytes,
      (ptr, len) => this.module.readStepDocument(ptr, len, options.unit ?? ""),
    );
    this.throwIfError();
    return JSON.parse(json) as ShapeDocument;
  }

  /** Number of leaf shapes registered by the last `readStepDocument`. */
  get documentShapeCount(): number {
    return this.module.documentShapeCount();
  }

  /** Leaf shape by index from the last `readStepDocument` (world-positioned). */
  documentShape(index: number): OccShape {
    return this.adopt(this.module.getDocumentShape(index));
  }

  /** Import a BRep file (OCCT's native format) from raw bytes. */
  readBrep(bytes: Uint8Array): OccShape {
    return this.adopt(this.withHeapBytes(bytes, (ptr, len) => this.module.readBrep(ptr, len)));
  }

  /** Export as STEP text. */
  writeStep(shape: OccShape, options: { unit?: UnitOption } = {}): Uint8Array {
    const text = this.module.writeStep(shape.raw, options.unit ?? "");
    this.throwIfError();
    return new TextEncoder().encode(text);
  }

  /**
   * Export an XCAF document — the mirror of `readStepDocument`: an assembly
   * tree of named, colored, positioned shapes. A node carries either a
   * `shape` or `children`.
   */
  writeStepDocument(tree: readonly WriteDocumentNode[], options: { unit?: UnitOption } = {}): Uint8Array {
    const shapes: OccShape[] = [];
    const parents: number[] = [];
    const shapeIndices: number[] = [];
    const names: string[] = [];
    const colors: string[] = [];
    const transforms: number[] = [];

    const visit = (nodes: readonly WriteDocumentNode[], parent: number): void => {
      for (const node of nodes) {
        const index = parents.length;
        if (node.shape && node.children && node.children.length > 0) {
          throw new Error("writeStepDocument: a node cannot carry both a shape and children");
        }
        if (!node.shape && !node.children?.length) {
          throw new Error("writeStepDocument: every node needs a shape or children");
        }
        parents.push(parent);
        shapeIndices.push(-1);
        names.push(node.name ?? "");
        colors.push("");
        for (let i = 0; i < 12; i++) transforms.push(NaN);
        if (node.shape) {
          shapeIndices[index] = shapes.push(node.shape) - 1;
        }
        if (node.color) {
          if (!/^#[0-9a-fA-F]{6}$/.test(node.color)) {
            throw new Error(`writeStepDocument: color "${node.color}" is not #RRGGBB`);
          }
          colors[index] = node.color.toUpperCase();
        }
        if (node.transform) {
          if (node.transform.length !== 12 || !node.transform.every(Number.isFinite)) {
            throw new Error("writeStepDocument: transform must be 12 finite numbers (row-major 3×4)");
          }
          for (let i = 0; i < 12; i++) transforms[index * 12 + i] = node.transform[i]!;
        }
        if (node.children?.length) {
          visit(node.children, index);
        }
      }
    };
    visit(tree, -1);
    if (parents.length === 0) throw new Error("writeStepDocument: the tree is empty");

    const shapeList = new this.module.VectorShape();
    const nameList = new this.module.VectorString();
    const colorList = new this.module.VectorString();
    try {
      for (const shape of shapes) {
        shapeList.push_back(shape.raw);
      }
      for (const name of names) {
        nameList.push_back(name);
      }
      for (const color of colors) {
        colorList.push_back(color);
      }
      const text = this.withInts(parents, (parentsPtr, count) =>
        this.withInts(shapeIndices, (shapeIdxPtr, _) =>
          this.withFloats(transforms, (transformsPtr, __) =>
            this.module.writeStepDocument(
              shapeList, parentsPtr, shapeIdxPtr, count,
              nameList, colorList, transformsPtr, options.unit ?? "",
            ),
          ),
        ),
      );
      this.throwIfError();
      return new TextEncoder().encode(text);
    } finally {
      shapeList.delete();
      nameList.delete();
      colorList.delete();
    }
  }

  /** Export as IGES text. */
  writeIges(shape: OccShape): Uint8Array {
    const text = this.module.writeIges(shape.raw);
    this.throwIfError();
    return new TextEncoder().encode(text);
  }

  /**
   * Export as binary glTF (.glb, single file). Pure TypeScript exporter over
   * `tessellate` — the OCCT RWGltf writer is not compiled into the kernel
   * (it would require RapidJSON; see docs/BUILDING.md).
   */
  writeGltf(shape: OccShape): Uint8Array {
    return meshToGlb(this.tessellate(shape));
  }

  /** Export as BRep text. Set `withTriangles` to carry the tessellation along. */
  writeBrep(shape: OccShape, withTriangles = false): Uint8Array {
    const text = this.module.writeBrep(shape.raw, withTriangles);
    this.throwIfError();
    return new TextEncoder().encode(text);
  }

  // --- geometry interrogation ----------------------------------------------------

  /**
   * Analytic description of every face and edge (planes, cylinders, circles,
   * …) plus heuristic hole detection — the "agent eyes" on a part.
   */
  describe(shape: OccShape): PartDescription {
    const json = this.module.describe(shape.raw);
    this.throwIfError();
    const description = JSON.parse(json) as GeometryDescription;
    return { ...description, holes: detectHoles(description.faces, description.edges) };
  }

  /** Minimum distance between two shapes with up to 8 closest point pairs. */
  distance(a: OccShape, b: OccShape): ShapeDistance {
    const json = this.module.distance(a.raw, b.raw);
    this.throwIfError();
    return JSON.parse(json) as ShapeDistance;
  }

  /** Intersection curve(s) of two shapes' surfaces (an edge/compound shape). */
  section(a: OccShape, b: OccShape): OccShape {
    return this.adopt(this.module.section(a.raw, b.raw));
  }

  /** Classify a point against all solids: "in" wins over "on" over "out". */
  classifyPoint(shape: OccShape, point: Vec3): PointClassification {
    const result = this.module.classifyPoint(shape.raw, point[0], point[1], point[2]);
    this.throwIfError();
    return result as PointClassification;
  }

  /**
   * Bridge into the raw OCCT escape hatch: this shape as a raw
   * `TopoDS_Shape`. JS-owned — call `.delete()` when done (raw-layer
   * discipline). The raw classes ride the same module (`occ.module`).
   */
  toRaw(shape: OccShape): Raw_TopoDS_Shape {
    return this.module.toRaw(shape.raw);
  }

  /** Bridge back: the session adopts the curated copy of a raw shape. */
  fromRaw(raw: Raw_TopoDS_Shape): OccShape {
    return this.adopt(this.module.fromRaw(raw));
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

  /** Face indices are 1-based and match `describe()` output. */
  private validateFaceIndices(operation: string, shape: OccShape, indices: number[]): void {
    const faceCount = shape.count("Face");
    for (const index of indices) {
      if (!Number.isInteger(index) || index < 1 || index > faceCount) {
        throw new Error(
          `${operation}: face index ${index} is out of range — describe(shape) lists faces 1..${faceCount}`,
        );
      }
    }
  }

  /** Edge indices are 1-based and match `describe()` output. */
  private validateEdgeIndices(operation: string, shape: OccShape, indices: number[]): void {
    const edgeCount = shape.count("Edge");
    for (const index of indices) {
      if (!Number.isInteger(index) || index < 1 || index > edgeCount) {
        throw new Error(
          `${operation}: edge index ${index} is out of range — describe(shape) lists edges 1..${edgeCount}`,
        );
      }
    }
  }

  /**
   * Split an edge selection into all-indices or all-handles (mixing the two
   * would silently drop one kind). Handles are validated on the C++ side.
   */
  private edgeSelection(
    operation: string,
    shape: OccShape,
    edges: readonly (number | OccShape)[],
  ): { indices: number[]; handles: OccShape[] } {
    const indices: number[] = [];
    const handles: OccShape[] = [];
    for (const edge of edges) {
      if (typeof edge === "number") indices.push(edge);
      else handles.push(edge);
    }
    if (indices.length > 0 && handles.length > 0) {
      throw new Error(`${operation}: edges must be all 1-based indices or all shape handles`);
    }
    if (handles.length === 0) {
      this.validateEdgeIndices(operation, shape, indices);
    }
    return { indices, handles };
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

  private withInts<T>(values: number[], fn: (ptr: number, count: number) => T): T {
    if (values.length === 0) return fn(0, 0);
    const ptr = this.module._malloc(values.length * 4);
    try {
      new Uint32Array(this.module.HEAPU8.buffer, ptr, values.length).set(values);
      return fn(ptr, values.length);
    } finally {
      this.module._free(ptr);
    }
  }

  /** register_vector handle around a shape list, freed after `fn` returns. */
  private withShapes<T>(shapes: readonly OccShape[], fn: (list: WasmShapeVector) => T): T {
    const list = new this.module.VectorShape();
    try {
      for (const shape of shapes) {
        list.push_back(shape.raw);
      }
      return fn(list);
    } finally {
      list.delete();
    }
  }

  private withFloats<T>(values: number[], fn: (ptr: number, doubleCount: number) => T): T {
    if (values.length === 0) return fn(0, 0);
    const ptr = this.module._malloc(values.length * 8);
    try {
      new Float64Array(this.module.HEAPU8.buffer, ptr, values.length).set(values);
      return fn(ptr, values.length);
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

/** `normalize` with the house-style operation-prefixed error message. */
function normalizedOption(v: Vec3, message: string): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (len < 1e-12) throw new Error(`${message} must be a non-zero vector`);
  return [v[0] / len, v[1] / len, v[2] / len];
}

/**
 * Flatten a rectangular point grid (rows of constant v, running along u) to
 * the flat row-major doubles the wasm side consumes, validating the shape.
 */
function flattenGrid(
  grid: readonly (readonly Vec3[])[],
  operation: string,
): { flat: number[]; uCount: number; vCount: number } {
  const vCount = grid.length;
  if (vCount < 2) throw new Error(`${operation}: needs at least a 2 × 2 grid`);
  const uCount = grid[0]!.length;
  if (uCount < 2) throw new Error(`${operation}: needs at least a 2 × 2 grid`);
  const flat: number[] = [];
  for (const row of grid) {
    if (row.length !== uCount) {
      throw new Error(
        `${operation}: the grid must be rectangular — the first row has ${uCount} points, another has ${row.length}`,
      );
    }
    for (const point of row) {
      if (![point[0], point[1], point[2]].every(Number.isFinite)) {
        throw new Error(`${operation}: points must be finite numbers`);
      }
      flat.push(point[0], point[1], point[2]);
    }
  }
  return { flat, uCount, vCount };
}

function allFinite(points: readonly Vec3[]): boolean {
  return points.every(
    (p) => Number.isFinite(p[0]) && Number.isFinite(p[1]) && Number.isFinite(p[2]),
  );
}

function coincides(a: Vec3, b: Vec3): boolean {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 1e-9;
}

function flatten(points: readonly Vec3[]): number[] {
  const out: number[] = [];
  for (const p of points) {
    out.push(p[0], p[1], p[2]);
  }
  return out;
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}
