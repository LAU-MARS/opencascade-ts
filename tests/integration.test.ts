import { beforeAll, afterAll, describe, expect, it } from "vitest";

import { OccSession } from "../src/ts/occ.js";
import { computeVertexNormals } from "../src/ts/mesh-utils.js";
import { describeWasm } from "./wasm-available.js";

// OCCT's Bnd_Box pads results by a ~1e-7 tolerance; exact equality lies.
function expectVec3Close(actual: readonly number[], expected: readonly number[]): void {
  for (let i = 0; i < 3; i++) {
    expect(actual[i]).toBeCloseTo(expected[i]!, 4);
  }
}

describeWasm("opencascade-ts kernel (wasm integration)", () => {
  let occ: OccSession;

  beforeAll(async () => {
    occ = await OccSession.create();
  });

  afterAll(() => {
    occ?.dispose();
  });

  it("reports a modern OCCT version", () => {
    const version = occ.occtVersion;
    expect(version).toMatch(/^\d+\.\d+/);
    const [major, minor] = version.split(".").map(Number);
    expect(major).toBeGreaterThanOrEqual(7);
    expect(major === 7 ? minor : 0).toBeGreaterThanOrEqual(major === 7 ? 9 : 0);
  });

  it("measures a box", () => {
    const box = occ.makeBox(10, 20, 3);
    expect(box.shapeType()).toBe("Solid");
    expect(box.volume()).toBeCloseTo(600, 3);
    expect(box.area()).toBeCloseTo(2 * (10 * 20 + 10 * 3 + 20 * 3), 2);
    expect(box.isValid()).toBe(true);
    expect(box.count("Solids" as never)).toBe(0); // unknown type names are not an error
    expect(box.count("Solid")).toBe(1);
    expect(box.count("Face")).toBe(6);
    expect(box.count("Edge")).toBe(12);
    expect(box.count("Vertex")).toBe(8);

    const bounds = box.bounds();
    expectVec3Close(bounds.min, [0, 0, 0]);
    expectVec3Close(bounds.max, [10, 20, 3]);
  });

  it("cuts a cylindrical hole through a box", () => {
    const box = occ.makeBox(10, 10, 10);
    const hole = occ.makeCylinder(2, 12, { origin: [5, 5, -1] });
    const part = occ.cut(box, hole);
    expect(part.isValid()).toBe(true);
    // box 1000 minus cylinder π·r²·h = π·4·10 ≈ 125.66
    expect(part.volume()).toBeCloseTo(1000 - Math.PI * 4 * 10, 1);
    expect(part.count("Face")).toBeGreaterThan(6);
  });

  it("fuses disjoint solids and intersects overlapping ones", () => {
    const a = occ.makeBox(10, 10, 10);
    const b = occ.translate(occ.makeBox(10, 10, 10), [30, 0, 0]);
    expect(occ.fuse(a, b).volume()).toBeCloseTo(2000, 1);

    const c = occ.translate(occ.makeBox(10, 10, 10), [5, 0, 0]);
    expect(occ.common(a, c).volume()).toBeCloseTo(500, 1);
  });

  it("transforms shapes", () => {
    const box = occ.makeBox(1, 1, 1);
    const moved = occ.translate(box, [10, 0, 0]);
    expectVec3Close(moved.bounds().min, [10, 0, 0]);

    const rotated = occ.rotate(moved, [0, 0, 1], 90);
    // +90° about +Z maps (x,y) → (-y,x): the box [10,11]×[0,1] lands at x∈[-1,0], y∈[10,11]
    const bounds = rotated.bounds();
    expect(bounds.min[0]).toBeCloseTo(-1, 4);
    expect(bounds.min[1]).toBeCloseTo(10, 4);

    expect(occ.scale(box, 2).volume()).toBeCloseTo(8, 6);
  });

  it("round-trips through STEP", () => {
    const part = occ.cut(
      occ.makeBox(20, 20, 5),
      occ.makeCylinder(4, 20, { origin: [10, 10, -5] }),
    );
    const stepBytes = occ.writeStep(part);
    const header = new TextDecoder().decode(stepBytes.slice(0, 32));
    expect(header).toContain("ISO-10303-21");

    const restored = occ.readStep(stepBytes);
    expect(restored.isValid()).toBe(true);
    expect(restored.volume()).toBeCloseTo(part.volume(), 2);
  });

  it("round-trips through BRep", () => {
    const part = occ.makeTorus(20, 5);
    const brepBytes = occ.writeBrep(part);
    const restored = occ.readBrep(brepBytes);
    expect(restored.isValid()).toBe(true);
    expect(restored.volume()).toBeCloseTo(part.volume(), 2);
    // volume of a torus: 2π²Rr²
    expect(restored.volume()).toBeCloseTo(2 * Math.PI * Math.PI * 20 * 25, 0);
  });

  it("rejects corrupt files with useful errors", () => {
    const garbage = new TextEncoder().encode("this is not a CAD file");
    expect(() => occ.readStep(garbage)).toThrow(/STEP import failed/);
    expect(() => occ.readBrep(garbage)).toThrow(/BREP import failed/);
  });

  it("tessellates a sphere into sane triangles and normals", () => {
    const sphere = occ.makeSphere(10);
    const mesh = occ.tessellate(sphere, { linearDeflection: 0.5 });
    expect(mesh.positions.length).toBeGreaterThan(100 * 3);
    expect(mesh.indices.length % 3).toBe(0);
    expect(mesh.edges.length).toBeGreaterThan(0);

    const normals = computeVertexNormals(mesh.positions, mesh.indices);
    let unitCount = 0;
    for (let i = 0; i < normals.length; i += 3) {
      const len = Math.hypot(normals[i]!, normals[i + 1]!, normals[i + 2]!);
      if (Math.abs(len - 1) < 1e-3) unitCount++;
    }
    expect(unitCount).toBe(mesh.positions.length / 3);
  });

  it("produces visible and hidden edges from a box", () => {
    const box = occ.makeBox(10, 10, 5);

    // From the top: the 4 top edges are visible, the 4 bottom edges hidden
    // (vertical edges project to points, so they add nothing).
    const top = occ.hiddenLines(box, { direction: [0, 0, 1] });
    expect(top.visible.length / 6).toBeGreaterThanOrEqual(4);
    expect(top.hidden.length / 6).toBeGreaterThanOrEqual(4);

    // From a corner the vertical edges become silhouettes → more visible edges.
    const iso = occ.hiddenLines(box, { direction: [1, 1, 1] });
    expect(iso.visible.length / 6).toBeGreaterThan(top.visible.length / 6);
    const hlr = top;

    // frame sanity: orthonormal, both ⟂ to the view direction
    const dot = (a: readonly number[], b: readonly number[]): number =>
      a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
    expect(dot(hlr.xAxis, hlr.yAxis)).toBeCloseTo(0, 6);
    expect(Math.abs(dot(hlr.xAxis, [0, 0, 1]))).toBeCloseTo(0, 6);
  });
});
