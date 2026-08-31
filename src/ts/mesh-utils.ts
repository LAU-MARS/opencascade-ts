import type { MeshData } from "./types.js";

/**
 * Area-weighted vertex normals for a triangle mesh. Vertices that belong to no
 * triangle (or degenerate fans) keep a zero normal; the viewer's shader falls
 * back to screen-space-derivative normals for those, so they still render.
 */
export function computeVertexNormals(positions: Float32Array, indices: Uint32Array): Float32Array {
  const normals = new Float32Array(positions.length);

  for (let i = 0; i + 2 < indices.length; i += 3) {
    const ia = indices[i]! * 3;
    const ib = indices[i + 1]! * 3;
    const ic = indices[i + 2]! * 3;

    const ax = positions[ib]! - positions[ia]!;
    const ay = positions[ib + 1]! - positions[ia + 1]!;
    const az = positions[ib + 2]! - positions[ia + 2]!;
    const bx = positions[ic]! - positions[ia]!;
    const by = positions[ic + 1]! - positions[ia + 1]!;
    const bz = positions[ic + 2]! - positions[ia + 2]!;

    // cross product, not normalized: area weighting
    const nx = ay * bz - az * by;
    const ny = az * bx - ax * bz;
    const nz = ax * by - ay * bx;

    for (const base of [ia, ib, ic]) {
      normals[base]! += nx;
      normals[base + 1]! += ny;
      normals[base + 2]! += nz;
    }
  }

  for (let v = 0; v < normals.length; v += 3) {
    const nx = normals[v]!;
    const ny = normals[v + 1]!;
    const nz = normals[v + 2]!;
    const len = Math.hypot(nx, ny, nz);
    if (len > 1e-12) {
      normals[v]! = nx / len;
      normals[v + 1]! = ny / len;
      normals[v + 2]! = nz / len;
    }
  }
  return normals;
}

/** Convenience: MeshData with precomputed normals for the viewer. */
export interface MeshWithNormals extends MeshData {
  readonly normals: Float32Array;
}

export function withVertexNormals(mesh: MeshData): MeshWithNormals {
  return { ...mesh, normals: computeVertexNormals(mesh.positions, mesh.indices) };
}
