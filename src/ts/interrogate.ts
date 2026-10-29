/**
 * Geometry interrogation types and heuristics.
 *
 * The C++ layer (src/cpp/interrogate.cpp) emits the JSON for faces/edges with
 * analytic parameters; TypeScript types it here and adds pure heuristics
 * (hole detection) that are unit-tested without the kernel.
 */

import type { ShapeTypeName, Vec3 } from "./types.js";

// --- edges ----------------------------------------------------------------------
//
// Every edge carries `center`: the curve-integral midpoint (an arc's balance
// point — for a full circle it coincides with the circle's center, for an arc
// it does not). The conic's own placement point is `axisPoint`, mirroring the
// cylinder/cone faces.

export interface LineEdgeInfo {
  index: number;
  curve: "line";
  length: number;
  center: Vec3;
  start: Vec3;
  end: Vec3;
  direction: Vec3;
}

/** Circle parameters are in radians (`uRange` spans 2π for a full circle). */
export interface CircleEdgeInfo {
  index: number;
  curve: "circle";
  length: number;
  center: Vec3;
  /** Center of the underlying circle (the arc's axis-system origin). */
  axisPoint: Vec3;
  axis: Vec3;
  radius: number;
  uRange: [number, number];
  closed: boolean;
}

export interface EllipseEdgeInfo {
  index: number;
  curve: "ellipse";
  length: number;
  center: Vec3;
  /** Center of the underlying ellipse. */
  axisPoint: Vec3;
  axis: Vec3;
  majorRadius: number;
  minorRadius: number;
}

export interface BSplineEdgeInfo {
  index: number;
  curve: "bspline";
  length: number;
  center: Vec3;
  degree?: number;
  poles?: number;
}

export interface GenericEdgeInfo {
  index: number;
  curve: "bezier" | "offset" | "other";
  length: number;
  center: Vec3;
}

export type EdgeInfo =
  | LineEdgeInfo
  | CircleEdgeInfo
  | EllipseEdgeInfo
  | BSplineEdgeInfo
  | GenericEdgeInfo;

// --- faces ----------------------------------------------------------------------
//
// Every face carries `center`: the area-integral centroid (build123d's
// Shape.center() semantics — the middle of the material the face covers,
// NOT the surface's parameter origin, which can sit in a corner).

export interface PlaneFaceInfo {
  index: number;
  surface: "plane";
  area: number;
  center: Vec3;
  origin: Vec3;
  normal: Vec3;
}

export interface CylinderFaceInfo {
  index: number;
  surface: "cylinder";
  area: number;
  center: Vec3;
  axisPoint: Vec3;
  axis: Vec3;
  radius: number;
}

/** `semiAngle` is in degrees. */
export interface ConeFaceInfo {
  index: number;
  surface: "cone";
  area: number;
  center: Vec3;
  axisPoint: Vec3;
  axis: Vec3;
  refRadius: number;
  semiAngle: number;
}

export interface SphereFaceInfo {
  index: number;
  surface: "sphere";
  area: number;
  center: Vec3;
  /** Center of the underlying sphere. */
  axisPoint: Vec3;
  radius: number;
}

export interface TorusFaceInfo {
  index: number;
  surface: "torus";
  area: number;
  center: Vec3;
  /** Center of the underlying torus (on its axis). */
  axisPoint: Vec3;
  axis: Vec3;
  majorRadius: number;
  minorRadius: number;
}

export interface GenericFaceInfo {
  index: number;
  surface: "bspline-surface" | "revolution" | "extrusion" | "offset-surface" | "other";
  area: number;
  center: Vec3;
}

export type FaceInfo =
  | PlaneFaceInfo
  | CylinderFaceInfo
  | ConeFaceInfo
  | SphereFaceInfo
  | TorusFaceInfo
  | GenericFaceInfo;

// --- vertices ---------------------------------------------------------------------

export interface VertexInfo {
  index: number;
  position: Vec3;
}

// --- composite results ------------------------------------------------------------

export interface GeometryDescription {
  shapeType: ShapeTypeName;
  faces: FaceInfo[];
  edges: EdgeInfo[];
  /**
   * Corner points in indexed-map order — vertex `i` is
   * `subShapes(shape, "Vertex")[i - 1]`. Sketch endpoints and
   * `.vertices()`-style selection read from here.
   */
  vertices: VertexInfo[];
}

/** A full-circle cylindrical feature: radius, axis, center (mid-height), length. */
export interface HoleCandidate {
  radius: number;
  axis: Vec3;
  center: Vec3;
  /** Distance between the two boundary circles; null when undeterminable. */
  length: number | null;
}

export type PartDescription = GeometryDescription & { holes: HoleCandidate[] };

/** Result of `occ.distance(a, b)`. */
export interface ShapeDistance {
  distance: number;
  /** Up to 8 closest point pairs `[onA, onB]`. */
  points: Array<[Vec3, Vec3]>;
}

// --- XCAF document tree ------------------------------------------------------------

/** STEP assembly node: leaves carry `shape` (an index for `documentShape`). */
export interface DocumentNode {
  name: string | null;
  /** `"#RRGGBB"` or null. */
  color: string | null;
  /**
   * The node's own placement in its PARENT's frame (top-level nodes: world
   * frame), as 12 row-major 3×4 numbers — or null for identity. Same
   * convention as `writeStepDocument`'s `transform` input.
   */
  transform: number[] | null;
  shape?: number;
  children?: DocumentNode[];
}

export interface ShapeDocument {
  format: "step";
  tree: DocumentNode[];
  shapeCount: number;
}

// --- hole detection (pure, unit-tested) ---------------------------------------------

/**
 * Detects cylindrical through-features: a cylindrical face whose axis line
 * passes exactly two full circles of the same radius. This finds bores,
 * holes and cylindrical bosses; it is a heuristic, not a feature-recognition
 * engine — fillets and partial cylinders are rejected by the two-circle rule.
 */
export function detectHoles(faces: FaceInfo[], edges: EdgeInfo[]): HoleCandidate[] {
  const cylinders = faces.filter((face): face is CylinderFaceInfo => face.surface === "cylinder");
  const circles = edges.filter(
    (edge): edge is CircleEdgeInfo => edge.curve === "circle" && edge.closed,
  );

  const holes: HoleCandidate[] = [];
  for (const cylinder of cylinders) {
    const matches = circles.filter(
      (circle) =>
        Math.abs(circle.radius - cylinder.radius) <= 1e-6 * Math.max(1, cylinder.radius) &&
        Math.abs(dot(circle.axis, cylinder.axis)) >= 1 - 1e-9 &&
        distanceToLine(circle.axisPoint, cylinder.axisPoint, cylinder.axis) <= 1e-6,
    );
    if (matches.length !== 2) continue;

    const [a, b] = matches;
    holes.push({
      radius: cylinder.radius,
      axis: cylinder.axis,
      center: mid(a.axisPoint, b.axisPoint),
      length: Math.hypot(
        a.axisPoint[0] - b.axisPoint[0],
        a.axisPoint[1] - b.axisPoint[1],
        a.axisPoint[2] - b.axisPoint[2],
      ),
    });
  }

  // fused bores can produce identical adjacent faces — dedupe
  const unique: HoleCandidate[] = [];
  for (const hole of holes) {
    const duplicate = unique.some(
      (other) =>
        Math.abs(other.radius - hole.radius) <= 1e-9 &&
        Math.abs(dot(other.axis, hole.axis)) >= 1 - 1e-9 &&
        dist(other.center, hole.center) <= 1e-6,
    );
    if (!duplicate) unique.push(hole);
  }
  return unique;
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function dist(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function mid(a: Vec3, b: Vec3): Vec3 {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
}

function distanceToLine(point: Vec3, linePoint: Vec3, direction: Vec3): number {
  const vx = point[0] - linePoint[0];
  const vy = point[1] - linePoint[1];
  const vz = point[2] - linePoint[2];
  const cx = vy * direction[2] - vz * direction[1];
  const cy = vz * direction[0] - vx * direction[2];
  const cz = vx * direction[1] - vy * direction[0];
  return Math.hypot(cx, cy, cz);
}
