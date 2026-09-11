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

  it("hollows a box into an open-top shell", () => {
    const box = occ.makeBox(20, 20, 10);
    const top = occ.describe(box).faces.find(
      (f) => f.surface === "plane" && f.normal && Math.abs(f.normal[2] - 1) < 1e-9 && Math.abs(f.origin[2] - 10) < 1e-6,
    );
    expect(top).toBeDefined();
    const part = occ.shell(box, 2, { openFaces: [top!.index] });
    expect(part.isValid()).toBe(true);
    // 20×20×10 outer minus the 16×16×8 cavity: 2-thick floor, open at the top
    expect(part.volume()).toBeCloseTo(20 * 20 * 10 - 16 * 16 * 8, 1);
    expectVec3Close(part.bounds().min, [0, 0, 0]);
    expectVec3Close(part.bounds().max, [20, 20, 10]);
  });

  it("hollows a box on all sides (sealed)", () => {
    const part = occ.shell(occ.makeBox(20, 20, 10), 2);
    expect(part.isValid()).toBe(true);
    // sealed cavity 16×16×6; one solid carrying the outer shell and the void
    expect(part.volume()).toBeCloseTo(20 * 20 * 10 - 16 * 16 * 6, 1);
    expect(part.count("Solid")).toBe(1);
    expect(part.count("Shell")).toBe(2);
  });

  it("drafts box walls into a symmetric frustum", () => {
    const part = occ.draft(occ.makeBox(20, 20, 50), 10, { direction: [0, 0, 1] });
    expect(part.isValid()).toBe(true);
    // The neutral plane defaults to the bounds center (z = 25): the
    // cross-section stays 20×20 there and tapers by 2·25·tan(10°) per side.
    const taper = 2 * 25 * Math.tan((10 * Math.PI) / 180);
    const a = 20 - taper;
    const b = 20 + taper;
    const expected = (50 / 3) * (a * a + a * b + b * b);
    expect(part.volume()).toBeCloseTo(expected, 0);
  });

  it("drafts walls narrower along the pull direction", () => {
    // Neutral plane pinned to the floor: the bottom stays 20×20 and the top
    // narrows by 2·50·tan(10°) per side — the mold-release convention.
    const part = occ.draft(occ.makeBox(20, 20, 50), 10, {
      direction: [0, 0, 1],
      neutralPoint: [10, 10, 0],
    });
    expect(part.isValid()).toBe(true);
    const top = 20 - 2 * 50 * Math.tan((10 * Math.PI) / 180);
    expect(part.volume()).toBeCloseTo((50 / 3) * (20 * 20 + 20 * top + top * top), 0);
    expectVec3Close(part.bounds().min, [0, 0, 0]);
    expectVec3Close(part.bounds().max, [20, 20, 50]);
  });

  it("fillets every edge of a box into rounded corners", () => {
    const part = occ.fillet(occ.makeBox(10, 10, 10), 1);
    expect(part.isValid()).toBe(true);
    // 6 shrunk planes + 12 cylindrical fillets + 8 spherical corner patches
    expect(part.count("Face")).toBe(26);
    // Each of the 12 edge prisms removes at most (1 - π/4)r² per unit length
    // (corner overlaps only remove less): 1000 - (4-π)·1·30 < V < 1000.
    expect(part.volume()).toBeLessThan(1000);
    expect(part.volume()).toBeGreaterThan(1000 - (4 - Math.PI) * 30);
  });

  it("fillets selected edges with an exact prism prediction", () => {
    const box = occ.makeBox(10, 10, 10);
    const vertical = occ.describe(box).edges
      .filter((e) => e.curve === "line" && Math.abs(e.direction[2]) > 0.999)
      .map((e) => e.index);
    expect(vertical).toHaveLength(4);

    const part = occ.fillet(box, 1, { edges: vertical });
    expect(part.isValid()).toBe(true);
    // 4 caps + 4 shrunk side planes + 4 fillet cylinders, and each fillet
    // removes exactly (1 - π/4)r² × height over the full 10 units.
    expect(part.count("Face")).toBe(10);
    expect(part.volume()).toBeCloseTo(1000 - 10 * (4 - Math.PI), 2);
  });

  it("chamfers every edge of a box by the closed-form volume", () => {
    const part = occ.chamfer(occ.makeBox(10, 10, 10), 1);
    expect(part.isValid()).toBe(true);
    // 6 shrunk planes + 12 chamfer planes + 8 corner triangles.
    expect(part.count("Face")).toBe(26);
    // 12 prisms of d²/2, minus the corner overlaps: each corner keeps the
    // tetrahedron {x+y+z ≤ d} (d³/6), so V = abc - 2d²(a+b+c) + (16/3)d³.
    expect(part.volume()).toBeCloseTo(1000 - 2 * 1 * 30 + 16 / 3, 1);
  });

  it("chamfers only the top face loop", () => {
    const box = occ.makeBox(10, 10, 10);
    const top = occ.describe(box).edges
      .filter((e) => e.curve === "line"
        && Math.abs(e.start[2] - 10) < 1e-6 && Math.abs(e.end[2] - 10) < 1e-6)
      .map((e) => e.index);
    expect(top).toHaveLength(4);

    const part = occ.chamfer(box, 1, { edges: top });
    expect(part.isValid()).toBe(true);
    // 4 chamfer planes, mitred at the four corners: each edge prism removes
    // d²/2 × length 10 and each miter overlap adds back d³/3.
    expect(part.count("Face")).toBe(10);
    expect(part.volume()).toBeCloseTo(1000 - 4 * 10 * 0.5 + 4 / 3, 1);
  });

  it("rejects bad fillet/chamfer input with useful errors", () => {
    const box = occ.makeBox(10, 10, 10);
    expect(() => occ.fillet(box, 0)).toThrow(/radius must be a positive/);
    expect(() => occ.fillet(box, 1, { edges: [99] })).toThrow(/1\.\.12/);
    expect(() => occ.chamfer(box, -1)).toThrow(/distance must be a positive/);
    expect(() => occ.chamfer(box, 1, { edges: [0] })).toThrow(/1\.\.12/);
  });

  it("extrudes a circle into a cylinder and a polygon into a box", () => {
    const cylinder = occ.extrude(occ.makeCircle(5), [0, 0, 10]);
    expect(cylinder.shapeType()).toBe("Solid");
    expect(cylinder.isValid()).toBe(true);
    expect(cylinder.volume()).toBeCloseTo(Math.PI * 25 * 10, 1);

    const square = occ.makePolygon([[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0]]);
    const box = occ.extrude(square, [0, 0, 5]);
    expect(box.volume()).toBeCloseTo(500, 1);
    expectVec3Close(box.bounds().max, [10, 10, 5]);
  });

  it("extrudes a bare wire into a shell with solid: false", () => {
    const tube = occ.extrude(occ.makeCircle(5), [0, 0, 10], { solid: false });
    expect(tube.shapeType()).toBe("Shell");
    // one cylindrical face of area 2πrh
    expect(tube.count("Face")).toBe(1);
    expect(tube.area()).toBeCloseTo(2 * Math.PI * 5 * 10, 1);
  });

  it("revolves a circle into a full and a half torus", () => {
    const profile = occ.makeCircle(2, { origin: [20, 0, 0], normal: [0, 1, 0] });
    const torus = occ.revolve(profile, { direction: [0, 0, 1] });
    expect(torus.shapeType()).toBe("Solid");
    expect(torus.isValid()).toBe(true);
    expect(torus.volume()).toBeCloseTo(2 * Math.PI * Math.PI * 20 * 4, 1);

    const half = occ.revolve(profile, { direction: [0, 0, 1], angleDegrees: 180 });
    expect(half.isValid()).toBe(true);
    expect(half.volume()).toBeCloseTo(Math.PI * Math.PI * 20 * 4, 1);
  });

  it("lofts ruled and smoothed between circles", () => {
    const bottom = occ.makeCircle(5);
    const top = occ.makeCircle(10, { origin: [0, 0, 20] });
    const frustum = occ.loft([bottom, top], { ruled: true });
    expect(frustum.shapeType()).toBe("Solid");
    expect(frustum.isValid()).toBe(true);
    // ruled between aligned circles = an exact conical frustum
    expect(frustum.volume()).toBeCloseTo((Math.PI * 20 / 3) * (25 + 50 + 100), 1);

    const middle = occ.makeCircle(7, { origin: [0, 0, 10] });
    const smooth = occ.loft([bottom, middle, top]);
    expect(smooth.isValid()).toBe(true);
    expect(smooth.count("Solid")).toBe(1);
    expect(smooth.volume()).toBeGreaterThan(0);
  });

  it("sweeps a circle along straight and circular spines", () => {
    const straight = occ.makePolygon([[0, 0, 0], [0, 0, 20]], { close: false });
    const pipe = occ.sweep(occ.makeCircle(3), straight);
    expect(pipe.shapeType()).toBe("Solid");
    expect(pipe.isValid()).toBe(true);
    expect(pipe.volume()).toBeCloseTo(Math.PI * 9 * 20, 1);

    // profile placed at the spine start, perpendicular to its +Y tangent
    const spine = occ.makeCircle(20);
    const profile = occ.makeCircle(2, { origin: [20, 0, 0], normal: [0, 1, 0] });
    const torus = occ.sweep(profile, spine);
    expect(torus.isValid()).toBe(true);
    expect(torus.volume()).toBeCloseTo(2 * Math.PI * Math.PI * 20 * 4, 1);
  });

  it("rejects bad profile input with useful errors", () => {
    expect(() => occ.makeCircle(0)).toThrow(/radius must be a positive/);
    expect(() => occ.makeCircle(1, { normal: [0, 0, 0] })).toThrow(/non-zero vector/);
    expect(() => occ.makePolygon([[0, 0, 0], [1, 0, 0]])).toThrow(/at least 3 points/);
    expect(() => occ.makePolygon([[0, 0, 0], [1, 0, 0], [1, 0, 0]])).toThrow(/distinct/);
    expect(() => occ.makePolygon([[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 0, 0]])).toThrow(/closing point/);
    expect(() => occ.extrude(occ.makeCircle(1), [0, 0, 0])).toThrow(/non-zero vector/);
    expect(() => occ.revolve(occ.makeCircle(1), { direction: [0, 0, 0] })).toThrow(/non-zero vector/);
    expect(() => occ.loft([occ.makeCircle(1)])).toThrow(/at least 2 sections/);
  });

  it("rejects bad shell/draft input with useful errors", () => {
    const box = occ.makeBox(10, 10, 10);
    expect(() => occ.shell(box, 0)).toThrow(/thickness must be a positive/);
    expect(() => occ.shell(box, 2, { openFaces: [0] })).toThrow(/1\.\.6/);
    expect(() => occ.draft(box, 0)).toThrow(/non-zero/);
    expect(() => occ.draft(box, 5, { faces: [99] })).toThrow(/1\.\.6/);
    expect(() => occ.draft(box, 5, { direction: [0, 0, 0] })).toThrow(/non-zero vector/);
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

    // frame sanity: orthonormal, both ⟂ to the view direction
    const dot = (a: readonly number[], b: readonly number[]): number =>
      a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
    expect(dot(top.xAxis, top.yAxis)).toBeCloseTo(0, 6);
    expect(Math.abs(dot(top.xAxis, [0, 0, 1]))).toBeCloseTo(0, 6);
  });

  it("describes faces and edges with analytic parameters", () => {
    const part = occ.cut(
      occ.makeBox(20, 20, 5),
      occ.makeCylinder(4, 20, { origin: [10, 10, -5] }),
    );
    const d = occ.describe(part);

    const cylinders = d.faces.filter((f) => f.surface === "cylinder");
    expect(cylinders).toHaveLength(1);
    expect(cylinders[0]!.radius).toBeCloseTo(4, 6);

    const planes = d.faces.filter((f) => f.surface === "plane");
    expect(planes.length).toBeGreaterThanOrEqual(6);
    // the top face's normal is +Z
    const topFace = planes.find(
      (f) => f.normal && Math.abs(f.normal[2] - 1) < 1e-9 && Math.abs(f.origin[2] - 5) < 1e-6,
    );
    expect(topFace).toBeDefined();

    const circles = d.edges.filter((e) => e.curve === "circle");
    expect(circles.length).toBeGreaterThanOrEqual(2);
    const full = circles.filter((c) => c.closed);
    expect(full.every((c) => Math.abs(c.radius - 4) < 1e-9)).toBe(true);
    for (const c of full) {
      expect(Math.hypot(c.center[0] - 10, c.center[1] - 10)).toBeLessThan(1e-6);
      expect(c.length).toBeCloseTo(2 * Math.PI * 4, 4);
    }
  });

  it("detects the bore as a hole candidate", () => {
    const part = occ.cut(
      occ.makeBox(20, 20, 5),
      occ.makeCylinder(4, 20, { origin: [10, 10, -5] }),
    );
    const d = occ.describe(part);
    expect(d.holes).toHaveLength(1);
    expect(d.holes[0]!.radius).toBeCloseTo(4, 6);
    expect(d.holes[0]!.length).toBeCloseTo(5, 4);
    expect(d.holes[0]!.center).toEqual([10, 10, 2.5]);
  });

  it("measures the minimum distance between shapes", () => {
    const a = occ.makeBox(10, 10, 10);
    const b = occ.translate(occ.makeBox(10, 10, 10), [13, 0, 0]);
    const d = occ.distance(a, b);
    expect(d.distance).toBeCloseTo(3, 6);
    expect(d.points.length).toBeGreaterThanOrEqual(1);
    const [pa, pb] = d.points[0]!;
    expect(pa[0]).toBeCloseTo(10, 4);
    expect(pb[0]).toBeCloseTo(13, 4);
  });

  it("computes section curves between a box and a cylinder", () => {
    const box = occ.makeBox(10, 10, 10);
    const cylinder = occ.makeCylinder(2, 20, { origin: [5, 5, -5] });
    const section = occ.section(box, cylinder);
    const d = occ.describe(section);
    const circles = d.edges.filter((e) => e.curve === "circle");
    // the cylinder crosses the box top and bottom faces: two full circles
    expect(circles).toHaveLength(2);
    for (const circle of circles) {
      expect(circle.radius).toBeCloseTo(2, 6);
      expect(circle.closed).toBe(true);
    }
  });

  it("classifies points in, out and on a solid", () => {
    const box = occ.makeBox(10, 10, 10);
    expect(occ.classifyPoint(box, [5, 5, 5])).toBe("in");
    expect(occ.classifyPoint(box, [50, 5, 5])).toBe("out");
    expect(occ.classifyPoint(box, [5, 5, 0])).toBe("on");
    expect(occ.classifyPoint(box, [10, 10, 10])).toBe("on");
  });

  it("round-trips through IGES", () => {
    const part = occ.cut(
      occ.makeBox(20, 20, 5),
      occ.makeCylinder(4, 20, { origin: [10, 10, -5] }),
    );
    const igesBytes = occ.writeIges(part);
    // fixed-format IGES: section numbers in columns 73-80, "IGES" in the globals
    expect(igesBytes.length).toBeGreaterThan(100);
    const restored = occ.readIges(igesBytes);
    expect(restored.volume()).toBeCloseTo(part.volume(), 1);
  });

  it("reads STEP as an XCAF document with a shape tree", () => {
    const part = occ.cut(
      occ.makeBox(20, 20, 5),
      occ.makeCylinder(4, 20, { origin: [10, 10, -5] }),
    );
    const document = occ.readStepDocument(occ.writeStep(part));
    expect(document.format).toBe("step");
    expect(document.tree.length).toBeGreaterThanOrEqual(1);
    expect(document.shapeCount).toBeGreaterThanOrEqual(1);

    const first = document.tree[0]!;
    const leaf = first.children?.[0] ?? first;
    expect(leaf.shape).toBeDefined();

    const shape = occ.documentShape(leaf.shape!);
    expect(shape.isValid()).toBe(true);
    expect(shape.volume()).toBeCloseTo(part.volume(), 2);
  });

  it("exports binary glTF (.glb)", () => {
    const glb = occ.writeGltf(occ.makeBox(20, 10, 5));
    expect(glb.length).toBeGreaterThan(500);
    // glTF binary magic "glTF" little-endian
    expect(glb[0]).toBe(0x67);
    expect(glb[1]).toBe(0x6c);
    expect(glb[2]).toBe(0x54);
    expect(glb[3]).toBe(0x46);
  });

  it("exports STEP in a chosen unit", () => {
    const box = occ.makeBox(1000, 1000, 1000);
    const mm = new TextDecoder().decode(occ.writeStep(box));
    expect(mm).toContain("MILLI");

    const metres = new TextDecoder().decode(occ.writeStep(box, { unit: "m" }));
    expect(metres).toContain("METRE");
    expect(metres).not.toContain("MILLI");
  });
});
