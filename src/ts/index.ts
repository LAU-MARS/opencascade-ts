/**
 * opencascade-ts — Open CASCADE for the agent era.
 * Modern OCCT on WebAssembly: TypeScript bindings, STEP/BREP IO,
 * hidden-line removal, and a zero-dependency WebGL2 viewer.
 */

export { OccSession, OccShape } from "./occ.js";
export type { OccCreateOptions } from "./occ.js";
export { loadOccModule } from "./loader.js";
export type { WasmLocationOptions } from "./loader.js";
export { computeVertexNormals, withVertexNormals } from "./mesh-utils.js";
export type { MeshWithNormals } from "./mesh-utils.js";
export { detectHoles } from "./interrogate.js";
export type {
  BSplineEdgeInfo,
  CircleEdgeInfo,
  ConeFaceInfo,
  CylinderFaceInfo,
  DocumentNode,
  EdgeInfo,
  EllipseEdgeInfo,
  FaceInfo,
  GenericEdgeInfo,
  GenericFaceInfo,
  GeometryDescription,
  HoleCandidate,
  LineEdgeInfo,
  PartDescription,
  PlaneFaceInfo,
  ShapeDistance,
  ShapeDocument,
  SphereFaceInfo,
  TorusFaceInfo,
} from "./interrogate.js";
export {
  hiddenLinesToSvg,
  lineSegmentsToSvg,
  meshToAsciiStl,
  meshToGlb,
  meshToObj,
} from "./exporters.js";
export type { GlbExportOptions, SvgExportOptions } from "./exporters.js";
export type {
  BoundingBox,
  CircleOptions,
  DraftOptions,
  EdgeBlendOptions,
  HiddenLineOptions,
  HiddenLineResult,
  LoftOptions,
  MeshData,
  PointClassification,
  PolygonOptions,
  PrimitiveOptions,
  RevolveOptions,
  ShapeTypeName,
  ShellOptions,
  SolidProfileOptions,
  TessellationOptions,
  UnitOption,
  Vec3,
} from "./types.js";
