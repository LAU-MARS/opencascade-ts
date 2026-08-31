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
export {
  hiddenLinesToSvg,
  lineSegmentsToSvg,
  meshToAsciiStl,
  meshToObj,
} from "./exporters.js";
export type { SvgExportOptions } from "./exporters.js";
export type {
  BoundingBox,
  HiddenLineOptions,
  HiddenLineResult,
  MeshData,
  PrimitiveOptions,
  ShapeTypeName,
  TessellationOptions,
  Vec3,
} from "./types.js";
