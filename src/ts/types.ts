/** Public shared types of opencascade-ts. */

import type { OccShape } from "./occ.js";

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

/** Sub-shape type names accepted by `subShapes` (and `OccShape.count`). */
export type SubShapeType =
  | "Compound"
  | "CompSolid"
  | "Solid"
  | "Shell"
  | "Face"
  | "Wire"
  | "Edge"
  | "Vertex";

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
   * Edges to blend: 1-based indices (as listed by `describe`) or edge handles
   * from `subShapes`/`edges`. Default: every edge of the shape.
   */
  edges?: readonly (number | OccShape)[];
}

/** Options of `chamfer` beyond the shared edge selection. */
export interface ChamferOptions extends EdgeBlendOptions {
  /**
   * Second leg length for an asymmetric chamfer: `distance` is measured on
   * the first face adjacent to the edge (as ordered by `describe`), `length2`
   * on the other one. Omit for the symmetric `distance`/`distance` bevel.
   */
  length2?: number;
}

/** Shared by `fuse` / `cut` / `common`. */
export interface BooleanOptions {
  /**
   * Merge the coplanar faces and collinear edges booleans leave behind
   * (UnifySameDomain — build123d/CadQuery call this "clean"). Default `true`;
   * `false` keeps the raw fragment topology. Geometry is unchanged either way.
   */
  clean?: boolean;
}

export interface CircleOptions {
  /** Center. Default `[0, 0, 0]`. */
  origin?: Vec3;
  /** Plane normal. Default `[0, 0, 1]`. */
  normal?: Vec3;
}

export interface ArcOptions {
  /** Center. Default `[0, 0, 0]`. */
  origin?: Vec3;
  /** Plane normal — the arc sweeps counterclockwise around it. Default `[0, 0, 1]`. */
  normal?: Vec3;
  /** Start angle in degrees. Required. */
  startDegrees: number;
  /** End angle in degrees; must satisfy `start < end < start + 360`. Required. */
  endDegrees: number;
}

export interface EllipseOptions {
  /** Center. Default `[0, 0, 0]`. */
  origin?: Vec3;
  /** Plane normal; the major axis lands along the plane's in-plane X. Default `[0, 0, 1]`. */
  normal?: Vec3;
}

export interface BsplineOptions {
  /**
   * Polynomial degree. Default `3`. Knots are clamped and uniform: the curve
   * starts at the first pole and ends at the last.
   */
  degree?: number;
}

/** Degrees per direction for `makeBsplineSurface` (each defaults to `3`). */
export interface BsplineSurfaceOptions {
  /** Polynomial degree along u. Default `3`. */
  uDegree?: number;
  /** Polynomial degree along v. Default `3`. */
  vDegree?: number;
}

/** B-spline surface description returned by `describeSurface`. */
export interface BsplineSurfaceInfo {
  surface: "bspline";
  uDegree: number;
  vDegree: number;
  /** Pole grid dimensions: `uPoles` × `vPoles`. */
  uPoles: number;
  vPoles: number;
  uKnots: number[];
  vKnots: number[];
  uMultiplicities: number[];
  vMultiplicities: number[];
  /**
   * Row-major pole grid: rows of constant v, each running along u — the same
   * layout `setBsplinePoles` consumes.
   */
  poles: Vec3[][];
  /** True when the surface carries per-pole weights (e.g. imported geometry). */
  rational: boolean;
  /** Pole weights, same grid layout as `poles` (only when `rational`). */
  weights?: number[][];
}

export interface InterpolateOptions {
  /** Close the curve smoothly through the last point back to the first. Default `false`. */
  periodic?: boolean;
  /** Point-coincidence tolerance. Default `1e-6`. */
  tolerance?: number;
}

/** One radius assignment for `variableFillet`. */
export interface VariableFilletSpec {
  /** The edge to blend: a 1-based index (as listed by `describe`) or an edge handle. */
  edge: number | OccShape;
  /** Fillet radius on this edge (constant unless paired with a second spec). */
  radius: number;
  /**
   * Position along the edge where `radius` applies, in the edge's curve
   * parameter (for line edges: distance from the start). Two specs on one
   * edge give the start and end radius — the kernel blends the radius
   * linearly between the edge's first and last vertex. Omit for a constant
   * radius.
   */
  at?: number;
}

export interface PolygonOptions {
  /** Loop the wire back to the first point. Default `true`. */
  close?: boolean;
}

/** Helix parameters beyond the axis placement. */
export interface HelixOptions extends PrimitiveOptions {
  /** Wind counterclockwise falling (default) or clockwise rising. Default `false` (right-handed). */
  leftHanded?: boolean;
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

export interface PipeShellOptions extends SolidProfileOptions {
  /**
   * Trihedron carried along the spine. `"correctedFrenet"` (default) is
   * stable everywhere; `"frenet"` spins where the spine inflects;
   * `"binormal"` locks the given direction as the profile's in-plane axis.
   */
  mode?: "correctedFrenet" | "frenet" | "binormal";
  /** Fixed in-plane axis direction — required when `mode` is `"binormal"`. */
  binormal?: Vec3;
  /**
   * Corner handling where the spine bends sharply: `"transformed"` (default)
   * keeps the profile rigid, `"round"` rounds the corner, `"rightCorner"`
   * extends the segments to a sharp corner.
   */
  transition?: "transformed" | "round" | "rightCorner";
  /**
   * Re-orient the profile onto the spine's normal plane before sweeping, so
   * it need not be placed exactly perpendicular by hand. Default `false`.
   */
  correction?: boolean;
}

/** Which mirror to apply — exactly one of `plane` / `axis`. */
export interface MirrorOptions {
  /** Mirror plane: a point on it plus its normal. */
  plane?: { origin?: Vec3; normal: Vec3 };
  /** Mirror axis line: a point on it plus its direction. */
  axis?: { origin?: Vec3; direction: Vec3 };
}

export interface RectangularPatternOptions {
  /** Copies along the first direction (including the original). Required. */
  countX: number;
  /** Copies along the second direction. Default `1`. */
  countY?: number;
  /** Step along the first direction, in model units. Required. */
  spacingX: number;
  /** Step along the second direction. Default `spacingX`. */
  spacingY?: number;
  /** First direction. Default `[1, 0, 0]`. */
  directionX?: Vec3;
  /** Second direction (must not be parallel to `directionX`). Default `[0, 1, 0]`. */
  directionY?: Vec3;
}

export interface CircularPatternOptions {
  /** Number of copies (including the original at angle 0). Required. */
  count: number;
  /**
   * Total sweep in degrees the copies spread over. Default `360` — a full,
   * evenly spaced ring.
   */
  sweepDegrees?: number;
  /** Rotation axis. Default `[0, 0, 1]`. */
  axis?: Vec3;
  /** A point on the axis. Default `[0, 0, 0]`. */
  origin?: Vec3;
}

export interface HealOptions {
  /**
   * Coincidence tolerance for stitching and fixing — raise it for sloppy
   * imports (typical gaps: 1e-3 … 1e-1). Default `1e-6`.
   */
  tolerance?: number;
  /**
   * Stitch coincident boundaries — several shapes assemble into one shell,
   * faces of a compound merge shared edges. Default `true`. Solids pass
   * through untouched: they are closed by construction.
   */
  sew?: boolean;
  /**
   * Repair the shape (ShapeFix): faces, wires, orientation, tolerances.
   * Default `true`.
   */
  fix?: boolean;
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
