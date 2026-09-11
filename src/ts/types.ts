/** Public shared types of opencascade-ts. */

export type Vec3 = readonly [number, number, number];

/** Unit keywords for STEP import/export ("mm" is the OCCT default). */
export type UnitOption = "mm" | "cm" | "m" | "km" | "in" | "inch" | "ft" | "mi" | "um";

/** Result of point-in-solid classification. */
export type PointClassification = "in" | "out" | "on" | "unknown";

export type ShapeTypeName =
  | "Compound"
  | "CompSolid"
  | "Solid"
  | "Shell"
  | "Face"
  | "Wire"
  | "Edge"
  | "Vertex"
  | "Shape";

export interface BoundingBox {
  readonly min: Vec3;
  readonly max: Vec3;
}

/** Angular deflection is in degrees, linear deflection in model units (mm for STEP). */
export interface TessellationOptions {
  /** Max distance between a curve and its tessellation. Default `0.1`. */
  linearDeflection?: number;
  /** Max angle between adjacent tessellation normals, degrees. Default `20`. */
  angularDeflection?: number;
  /** Interpret `linearDeflection` relative to each edge's size. Default `false`. */
  relative?: boolean;
}

/**
 * Triangulated shape ready for WebGL. `edges` holds wireframe line segments:
 * consecutive point pairs are independent segments (`p0 p1`, `p2 p3`, ...).
 */
export interface MeshData {
  readonly positions: Float32Array;
  readonly indices: Uint32Array;
  readonly edges: Float32Array;
}

export interface PrimitiveOptions {
  /** Axis direction. Default `[0, 0, 1]`. */
  direction?: Vec3;
  /** Origin. Default `[0, 0, 0]`. */
  origin?: Vec3;
}

export interface ShellOptions {
  /**
   * 1-based face indices (as listed by `describe`) that become openings.
   * Default: none — a sealed hollow.
   */
  openFaces?: number[];
}

/** Shared by `fillet` / `chamfer`: which edges to blend. */
export interface EdgeBlendOptions {
  /**
   * 1-based edge indices (as listed by `describe`) to blend.
   * Default: every edge of the shape.
   */
  edges?: number[];
}

export interface CircleOptions {
  /** Center. Default `[0, 0, 0]`. */
  origin?: Vec3;
  /** Plane normal. Default `[0, 0, 1]`. */
  normal?: Vec3;
}

export interface PolygonOptions {
  /** Loop the wire back to the first point. Default `true`. */
  close?: boolean;
}

/** Shared by `extrude` / `revolve` / `sweep`: cap wire profiles into solids. */
export interface SolidProfileOptions {
  /**
   * Build a solid (default): planar wire sections are capped into faces
   * before sweeping. `false` sweeps the bare wire and returns a shell.
   */
  solid?: boolean;
}

export interface RevolveOptions extends SolidProfileOptions {
  /** Revolution axis direction. Required. */
  direction: Vec3;
  /** A point on the axis. Default `[0, 0, 0]`. */
  origin?: Vec3;
  /** Sweep angle in degrees; `360` (default) makes a full revolution. */
  angleDegrees?: number;
}

export interface LoftOptions extends SolidProfileOptions {
  /**
   * Rule straight sections between consecutive profiles instead of
   * smoothing a B-spline skin across all of them. Default `false`.
   */
  ruled?: boolean;
}

export interface DraftOptions {
  /** Pull direction. Default `[0, 0, 1]`. */
  direction?: Vec3;
  /**
   * 1-based face indices (as listed by `describe`) to draft.
   * Default: the faces running parallel to `direction` (the walls).
   */
  faces?: number[];
  /**
   * A point on the neutral plane — faces pivot about it and dimensions there
   * are unchanged. Default: the center of the bounding box.
   */
  neutralPoint?: Vec3;
}

export interface HiddenLineOptions {
  /** Viewing direction (points from the model towards the viewer). Required. */
  direction: Vec3;
  /** Approximate world-up for the projection frame. Default `[0, 0, 1]`. */
  up?: Vec3;
  /** Chord deflection for edge discretization. Default `0.1`. */
  deflection?: number;
}

/**
 * Hidden-line-removal result. Line arrays hold segments as consecutive point
 * pairs, already expressed in the projection frame (x = right, y = up, z ≈ depth).
 */
export interface HiddenLineResult {
  readonly visible: Float32Array;
  readonly hidden: Float32Array;
  /** Unit basis vectors of the projection frame (right and up). */
  readonly xAxis: Vec3;
  readonly yAxis: Vec3;
}
