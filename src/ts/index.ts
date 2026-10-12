/**
 * opencascade-ts — Open CASCADE for the agent era.
 * Modern OCCT on WebAssembly: TypeScript bindings, STEP/BREP IO,
 * hidden-line removal, and a zero-dependency WebGL2 viewer.
 */

export { OccSession, OccShape } from "./occ.js";
export type { OccCreateOptions, WriteDocumentNode } from "./occ.js";
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
  VertexInfo,
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
