import { describe, expect, it } from "vitest";

import { computeVertexNormals } from "../src/ts/mesh-utils.js";

describe("computeVertexNormals", () => {
  it("computes +Z for a CCW triangle in the XY plane", () => {
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const indices = new Uint32Array([0, 1, 2]);
    const normals = computeVertexNormals(positions, indices);
    for (let v = 0; v < 3; v++) {
      expect(normals[v * 3]).toBeCloseTo(0, 6);
      expect(normals[v * 3 + 1]).toBeCloseTo(0, 6);
      expect(normals[v * 3 + 2]).toBeCloseTo(1, 6);
    }
  });

  it("flips for reversed winding", () => {
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const indices = new Uint32Array([0, 2, 1]);
    const normals = computeVertexNormals(positions, indices);
    expect(normals[2]).toBeCloseTo(-1, 6);
  });

  it("leaves degenerate vertices at zero", () => {
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 5, 5, 5]);
    const indices = new Uint32Array([0, 1, 2]);
    const normals = computeVertexNormals(positions, indices);
    // vertex 3 belongs to no triangle
    expect(normals[9]).toBe(0);
    expect(normals[10]).toBe(0);
    expect(normals[11]).toBe(0);
  });

  it("averages normals across a shared edge", () => {
    // two triangles sharing the diagonal of a unit square
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]);
    const indices = new Uint32Array([0, 1, 2, 0, 2, 3]);
    const normals = computeVertexNormals(positions, indices);
    // everything stays in the XY plane → normals point at +Z for all four
    for (let v = 0; v < 4; v++) {
      expect(normals[v * 3 + 2]).toBeCloseTo(1, 6);
    }
  });
});
