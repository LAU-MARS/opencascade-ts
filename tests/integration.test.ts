import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";

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
  // Emscripten binds console.log while the factory initializes the module,
  // so the spy must be in place before create() — and it doubles as a
  // suite-wide guard: nothing below may write to stdout.
  let stdout: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    stdout = vi.spyOn(console, "log").mockImplementation(() => {});
    occ = await OccSession.create();
  });

  afterAll(() => {
    occ?.dispose();
    stdout?.mockRestore();
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

  it("extracts sub-shape handles that match describe's numbering", () => {
    const box = occ.makeBox(10, 10, 10);
    expect(occ.faces(box)).toHaveLength(6);
    expect(occ.edges(box)).toHaveLength(12);
    expect(occ.vertices(box)).toHaveLength(8);
    expect(occ.wires(box)).toHaveLength(6);
    expect(occ.shells(box)).toHaveLength(1);
    expect(occ.solids(box)).toHaveLength(1);
    expect(occ.compounds(box)).toHaveLength(0);
    expect(occ.faces(box).every((f) => f.shapeType() === "Face")).toBe(true);

    // subShapes(shape, "Edge")[i] IS edge i+1: each handle interrogates as the
    // same curve describe() numbered at i+1.
    const described = occ.describe(box).edges;
    const handles = occ.edges(box);
    for (let i = 0; i < handles.length; i++) {
      const own = occ.describe(handles[i]!).edges[0]!;
      expect(own.curve).toBe(described[i]!.curve);
      expect(own.length).toBeCloseTo(described[i]!.length, 6);
    }
    // counts and handle lists stay in lockstep for every type
    for (const type of ["Compound", "Solid", "Shell", "Face", "Wire", "Edge", "Vertex"] as const) {
      expect(box.count(type)).toBe(occ.subShapes(box, type).length);
    }
    expect(() => occ.subShapes(box, "Plumbus" as never)).toThrow(/unknown type/);
  });

  it("compares sub-shape identity with isSame", () => {
    const box = occ.makeBox(10, 10, 10);
    const a = occ.edges(box)[3]!;
    expect(a.isSame(occ.edges(box)[3]!)).toBe(true);
    expect(a.isSame(occ.edges(box)[4]!)).toBe(false);
    // a modeling result is a fresh shape tree, and another box shares nothing
    expect(occ.fillet(box, 1).isSame(box)).toBe(false);
    expect(a.isSame(occ.edges(occ.makeBox(10, 10, 10))[3]!)).toBe(false);
  });

  it("fillets and chamfers by edge handle exactly like by index", () => {
    const box = occ.makeBox(10, 10, 10);
    const edges = occ.edges(box);
    const verticalHandles = occ.describe(box).edges
      .filter((e) => e.curve === "line" && Math.abs(e.direction[2]) > 0.999)
      .map((e) => edges[e.index - 1]!);
    const verticalIndices = occ.describe(box).edges
      .filter((e) => e.curve === "line" && Math.abs(e.direction[2]) > 0.999)
      .map((e) => e.index);
    expect(verticalHandles).toHaveLength(4);

    const byHandle = occ.fillet(box, 1, { edges: verticalHandles });
    const byIndex = occ.fillet(box, 1, { edges: verticalIndices });
    expect(byHandle.isValid()).toBe(true);
    expect(byHandle.count("Face")).toBe(10);
    expect(byHandle.volume()).toBeCloseTo(byIndex.volume(), 6);
    expect(byHandle.volume()).toBeCloseTo(1000 - 10 * (4 - Math.PI), 2);

    const box2 = occ.makeBox(10, 10, 10);
    const topHandles = occ.describe(box2).edges
      .filter((e) => e.curve === "line"
        && Math.abs(e.start[2] - 10) < 1e-6 && Math.abs(e.end[2] - 10) < 1e-6)
      .map((e) => occ.edges(box2)[e.index - 1]!);
    const bevel = occ.chamfer(box2, 1, { edges: topHandles });
    expect(bevel.count("Face")).toBe(10);
    expect(bevel.volume()).toBeCloseTo(1000 - 4 * 10 * 0.5 + 4 / 3, 1);

    // a cylinder's top circle, picked by handle and rounded
    const cyl = occ.makeCylinder(5, 10);
    const rimEdges = occ.describe(cyl).edges
      .filter((e) => e.curve === "circle" && Math.abs(e.axisPoint[2] - 10) < 1e-6);
    expect(rimEdges).toHaveLength(1);
    const rim = rimEdges.map((e) => occ.edges(cyl)[e.index - 1]!);
    const rimFillet = occ.fillet(cyl, 1, { edges: rim });
    expect(rimFillet.isValid()).toBe(true);
    // bottom + side + shrunk top + the torus fillet face
    expect(rimFillet.count("Face")).toBe(4);
    expect(rimFillet.volume()).toBeCloseTo(
      occ.fillet(cyl, 1, { edges: [rimEdges[0]!.index] }).volume(), 6,
    );
  });

  it("variable-fillets by edge handle", () => {
    const box = occ.makeBox(10, 10, 10);
    const vertical = occ.describe(box).edges
      .filter((e) => e.curve === "line" && Math.abs(e.direction[2]) > 0.999)
      .map((e) => occ.edges(box)[e.index - 1]!);
    const edge = vertical[0]!;

    // two equal radii at both ends = the constant fillet on that one edge
    const constant = occ.variableFillet(box, [
      { edge, radius: 1, at: 0 },
      { edge, radius: 1, at: 10 },
    ]);
    expect(constant.isValid()).toBe(true);
    expect(constant.volume()).toBeCloseTo(1000 - 10 * (1 - Math.PI / 4), 2);

    // one constant spec + two positioned specs on another handle, mixed
    const mixed = occ.variableFillet(box, [
      { edge: vertical[1]!, radius: 1 },
      { edge: vertical[2]!, radius: 1, at: 0 },
      { edge: vertical[2]!, radius: 2, at: 10 },
    ]);
    expect(mixed.isValid()).toBe(true);

    expect(() =>
      occ.fillet(box, 1, { edges: [1, vertical[0]!] }),
    ).toThrow(/all 1-based indices or all shape handles/);
  });

  it("raw generated bindings answer like the curated API", () => {
    // The raw escape hatch (tools/codegen): verbatim OCCT classes, manual
    // delete() discipline, same guarded() error contract.
    const raw = occ.module;
    const maker = new raw.BRepPrimAPI_MakeBox(3, 4, 5);
    try {
      const shape = maker.Shape();
      try {
        // enums cross as ints; TopAbs_ShapeEnum: COMPOUND=0 … SOLID=2
        expect(shape.ShapeType()).toBe(2);
        const props = new raw.GProp_GProps();
        try {
          raw.BRepGProp.VolumeProperties(shape, props);
          expect(props.Mass()).toBeCloseTo(60, 6);
        } finally {
          props.delete();
        }
        expect(occ.makeBox(3, 4, 5).volume()).toBeCloseTo(60, 6);
      } finally {
        shape.delete();
      }
    } finally {
      maker.delete();
    }
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

  it("makes lines, arcs and ellipses as wires", () => {
    const line = occ.makeLine([0, 0, 0], [10, 0, 0]);
    expect(line.shapeType()).toBe("Wire");
    expect(occ.describe(line).edges[0]!.length).toBeCloseTo(10, 6);

    const quarter = occ.makeArc(5, { startDegrees: 0, endDegrees: 90 });
    const arcEdge = occ.describe(quarter).edges[0]!;
    if (arcEdge.curve !== "circle") throw new Error("expected a circle edge");
    expect(arcEdge.length).toBeCloseTo((2 * Math.PI * 5) / 4, 4);
    expectVec3Close(arcEdge.axisPoint, [0, 0, 0]);

    const ellipse = occ.makeEllipse(10, 4);
    const ellipseEdge = occ.describe(ellipse).edges[0]!;
    expect(ellipseEdge.curve).toBe("ellipse");
    const solid = occ.extrude(ellipse, [0, 0, 5]);
    expect(solid.volume()).toBeCloseTo(Math.PI * 10 * 4 * 5, 1);
    expectVec3Close(solid.bounds().min, [-10, -4, 0]);
    expectVec3Close(solid.bounds().max, [10, 4, 5]);
  });

  it("assembles arcs and lines into a slot profile and extrudes it", () => {
    const left = occ.makeArc(5, { startDegrees: 90, endDegrees: 270 }); // (0,5) → (0,-5)
    const bottom = occ.makeLine([0, -5, 0], [20, -5, 0]);
    const right = occ.makeArc(5, { origin: [20, 0, 0], startDegrees: -90, endDegrees: 90 });
    const top = occ.makeLine([20, 5, 0], [0, 5, 0]);
    const slot = occ.makeWire([left, bottom, right, top]);
    expect(slot.shapeType()).toBe("Wire");

    const part = occ.extrude(slot, [0, 0, 10]);
    expect(part.shapeType()).toBe("Solid");
    expect(part.isValid()).toBe(true);
    // stadium cross-section πr² + 2rL = 25π + 200, extruded 10 tall
    expect(part.volume()).toBeCloseTo((25 * Math.PI + 200) * 10, 1);
    expectVec3Close(part.bounds().min, [-5, -5, 0]);
    expectVec3Close(part.bounds().max, [25, 5, 10]);

    expect(() => occ.makeWire([left, occ.makeLine([1, 1, 0], [2, 2, 0])])).toThrow(
      /does not connect/,
    );
  });

  it("extrudes a pie-slice profile (arc + two lines to the center)", () => {
    const arc = occ.makeArc(5, { startDegrees: 0, endDegrees: 90 }); // (5,0) → (0,5)
    const toCenter = occ.makeLine([0, 5, 0], [0, 0, 0]);
    const fromCenter = occ.makeLine([0, 0, 0], [5, 0, 0]);
    const sector = occ.extrude(occ.makeWire([arc, toCenter, fromCenter]), [0, 0, 2]);
    expect(sector.isValid()).toBe(true);
    // quarter disc of radius 5, thickness 2: (π/4)r² · 2
    expect(sector.volume()).toBeCloseTo((Math.PI / 4) * 25 * 2, 1);
  });

  it("builds B-spline wires from control points", () => {
    // degree 1 passes through every pole: two straight segments
    const polyline = occ.makeBspline([[0, 0, 0], [10, 0, 0], [10, 10, 0]], { degree: 1 });
    const d = occ.describe(polyline);
    expect(d.edges).toHaveLength(1);
    expect(d.edges[0]!.curve).toBe("bspline");
    expect(d.edges[0]!.length).toBeCloseTo(20, 3);

    // degree 3 with collinear poles collapses to the straight span [0, 10]
    // (clamped knots: the curve still runs first pole → last pole)
    const flat = occ.makeBspline([[0, 0, 0], [3, 0, 0], [7, 0, 0], [10, 0, 0]]);
    expect(occ.describe(flat).edges[0]!.length).toBeCloseTo(10, 3);
  });

  it("interpolates a B-spline through points", () => {
    const through = occ.makeBsplineThrough([[0, 0, 0], [10, 0, 0], [20, 0, 0]]);
    expect(occ.describe(through).edges[0]!.length).toBeCloseTo(20, 3);
    // passes through (10, 0, 0): a crossing line there touches it
    const crossing = occ.makeLine([10, 0, -5], [10, 0, 5]);
    expect(occ.distance(through, crossing).distance).toBeCloseTo(0, 6);

    // periodic interpolation closes smoothly — extrudes into a valid solid
    const loop = occ.makeBsplineThrough(
      [[-5, -5, 0], [5, -5, 0], [5, 5, 0], [-5, 5, 0]],
      { periodic: true },
    );
    const solid = occ.extrude(loop, [0, 0, 3]);
    expect(solid.shapeType()).toBe("Solid");
    expect(solid.isValid()).toBe(true);
    expect(solid.volume()).toBeGreaterThan(0);
    expect(solid.volume()).toBeLessThan(500); // stays near the 10×10 hull
  });

  it("fillets with variable radii along an edge", () => {
    const box = occ.makeBox(10, 10, 10);
    const vertical = occ.describe(box).edges
      .filter((e) => e.curve === "line" && Math.abs(e.direction[2]) > 0.999)
      .map((e) => e.index);
    const edge = vertical[0]!;
    // the vertical edges' line parameters run 0..10 with the edge

    // two equal radii at both ends = the constant fillet on that one edge
    const constant = occ.variableFillet(box, [
      { edge, radius: 1, at: 0 },
      { edge, radius: 1, at: 10 },
    ]);
    expect(constant.isValid()).toBe(true);
    expect(constant.volume()).toBeCloseTo(1000 - 10 * (1 - Math.PI / 4), 2);

    // tapering 1 → 2 must land between the constant-1 and constant-2 fillets
    const tapered = occ.variableFillet(box, [
      { edge, radius: 1, at: 0 },
      { edge, radius: 2, at: 10 },
    ]);
    expect(tapered.isValid()).toBe(true);
    const v1 = 1000 - 10 * (1 - Math.PI / 4);
    const v2 = 1000 - 10 * 4 * (1 - Math.PI / 4);
    expect(tapered.volume()).toBeGreaterThan(v2);
    expect(tapered.volume()).toBeLessThan(v1);

    // more than two positions per edge is not supported
    expect(() =>
      occ.variableFillet(box, [
        { edge, radius: 1, at: 0 },
        { edge, radius: 2, at: 5 },
        { edge, radius: 1, at: 10 },
      ]),
    ).toThrow(/only two are supported/);
  });

  it("computes centroids of solids, shells and wires", () => {
    expectVec3Close(occ.makeBox(10, 10, 10).centroid(), [5, 5, 5]);
    expectVec3Close(occ.translate(occ.makeBox(10, 10, 10), [10, 0, 0]).centroid(), [15, 5, 5]);

    // a symmetric plate with a central bore keeps its center
    const plate = occ.cut(
      occ.makeBox(20, 20, 5),
      occ.makeCylinder(4, 20, { origin: [10, 10, -5] }),
    );
    expectVec3Close(plate.centroid(), [10, 10, 2.5]);

    // no solids → the curve integral: a circle's centroid is its center
    expectVec3Close(occ.makeCircle(5, { origin: [3, 4, 0] }).centroid(), [3, 4, 0]);
  });

  it("rejects bad curve/wire/fillet input with useful errors", () => {
    expect(() => occ.makeLine([0, 0, 0], [0, 0, 0])).toThrow(/distinct/);
    expect(() => occ.makeArc(5, { startDegrees: 90, endDegrees: 90 })).toThrow(/greater than/);
    expect(() => occ.makeArc(5, { startDegrees: 0, endDegrees: 360 })).toThrow(/360/);
    expect(() => occ.makeArc(0, { startDegrees: 0, endDegrees: 90 })).toThrow(/positive/);
    expect(() => occ.makeEllipse(4, 10)).toThrow(/majorRadius/);
    expect(() => occ.makeBspline([[0, 0, 0]])).toThrow(/at least 2 poles/);
    expect(() => occ.makeBspline([[0, 0, 0], [1, 0, 0]], { degree: 5 })).toThrow(/degree \+ 1/);
    expect(() => occ.makeBsplineThrough([[0, 0, 0]])).toThrow(/at least 2 points/);
    expect(() => occ.makeWire([occ.makeCircle(5)])).toThrow(/at least 2/);
    expect(() => occ.variableFillet(occ.makeBox(10, 10, 10), [])).toThrow(/at least one/);
    expect(() => occ.variableFillet(occ.makeBox(10, 10, 10), [{ edge: 99, radius: 1 }])).toThrow(
      /1\.\.12/,
    );
  });

  it("makes faces with holes and extrudes them", () => {
    const annulus = occ.extrude(occ.makeFace(occ.makeCircle(10), [occ.makeCircle(4)]), [0, 0, 5]);
    expect(annulus.shapeType()).toBe("Solid");
    expect(annulus.isValid()).toBe(true);
    // π(R² − r²)·h = π(100 − 16)·5; 4 faces: outer/inner wall + two annular caps
    expect(annulus.volume()).toBeCloseTo(Math.PI * (100 - 16) * 5, 1);
    expect(annulus.count("Face")).toBe(4);

    const plate = occ.extrude(
      occ.makeFace(
        occ.makePolygon([[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0]]),
        [occ.makeCircle(2, { origin: [5, 5, 0] })],
      ),
      [0, 0, 2],
    );
    expect(plate.isValid()).toBe(true);
    expect(plate.volume()).toBeCloseTo((100 - Math.PI * 4) * 2, 1);

    expect(() => occ.makeFace(occ.makeBox(10, 10, 10))).toThrow(/outer boundary must be a Wire/);
  });

  it("composes 2D trim via makeFace + cut", () => {
    // two overlapping discs (z = 0): the lens stays, the crescent is trimmed
    const a = occ.makeFace(occ.makeCircle(5));
    const b = occ.makeFace(occ.makeCircle(5, { origin: [6, 0, 0] }));
    const lens = occ.common(a, b);
    const lensVolume = occ.extrude(lens, [0, 0, 2]).volume();
    // lens area of two r=5 circles d=6 apart: 2r²·acos(d/2r) − (d/2)·√(4r²−d²)
    const lensArea = 2 * 25 * Math.acos(6 / 10) - 3 * Math.sqrt(100 - 36);
    expect(lensVolume).toBeCloseTo(lensArea * 2, 1);

    const crescent = occ.cut(a, b);
    expect(occ.extrude(crescent, [0, 0, 2]).volume()).toBeCloseTo((25 * Math.PI - lensArea) * 2, 1);
  });

  it("splits a shape and keeps every piece", () => {
    const box = occ.makeBox(10, 10, 10);
    const blade = occ.translate(occ.makeBox(2, 30, 30), [4, -10, -10]); // x ∈ [4, 6]
    const pieces = occ.split(box, blade);
    expect(pieces.isValid()).toBe(true);
    // left 400 + right 400 + the 2-slab under the blade: all fragments
    // reassemble the original (use cut to discard the tool region instead)
    expect(pieces.count("Solid")).toBe(3);
    expect(pieces.volume()).toBeCloseTo(1000, 1);

    // a tool that misses the shape leaves it whole
    expect(occ.split(box, occ.translate(occ.makeBox(2, 30, 30), [50, 0, 0])).volume())
      .toBeCloseTo(1000, 1);
    expect(() => occ.split(box, [])).toThrow(/at least one tool/);
  });

  it("offsets solids outward and inward", () => {
    const grown = occ.offsetSolid(occ.makeBox(10, 10, 10), 1);
    expect(grown.isValid()).toBe(true);
    expect(grown.volume()).toBeCloseTo(12 * 12 * 12, 1);
    expectVec3Close(grown.bounds().min, [-1, -1, -1]);
    expectVec3Close(grown.bounds().max, [11, 11, 11]);

    expect(occ.offsetSolid(occ.makeBox(10, 10, 10), -1).volume()).toBeCloseTo(512, 1);
    // a sphere offsets to an exact sphere: (4/3)π·12³
    expect(occ.offsetSolid(occ.makeSphere(10), 2).volume()).toBeCloseTo(
      (4 / 3) * Math.PI * 1728, 0,
    );
    expect(() => occ.offsetSolid(occ.makeBox(10, 10, 10), 0)).toThrow(/non-zero/);
  });

  it("writes and reads back a named, colored STEP document", () => {
    const gasket = occ.cut(
      occ.makeBox(20, 20, 5),
      occ.makeCylinder(4, 20, { origin: [10, 10, -5] }),
    );
    const bytes = occ.writeStepDocument([
      { name: "gasket", color: "#3388ff", shape: gasket },
    ]);
    const document = occ.readStepDocument(bytes);
    expect(document.format).toBe("step");
    const root = document.tree[0]!;
    expect(root.name).toBe("gasket");
    expect(root.color).toBe("#3388FF");
    const shape = occ.documentShape(root.shape!);
    expect(shape.isValid()).toBe(true);
    expect(shape.volume()).toBeCloseTo(gasket.volume(), 2);
  });

  it("writes and reads back an assembly with positioned children", () => {
    const bytes = occ.writeStepDocument([
      {
        name: "post-assembly",
        children: [
          { name: "base", shape: occ.makeBox(10, 10, 2) },
          {
            name: "post",
            color: "#ff8800",
            shape: occ.makeCylinder(2, 8),
            transform: [1, 0, 0, 5, 0, 1, 0, 5, 0, 0, 1, 2],
          },
        ],
      },
    ]);
    const document = occ.readStepDocument(bytes);
    const root = document.tree[0]!;
    expect(root.name).toBe("post-assembly");
    expect(root.children).toHaveLength(2);

    const base = root.children![0]!;
    expect(base.name).toBe("base");
    expect(occ.documentShape(base.shape!).volume()).toBeCloseTo(200, 1);

    const post = root.children![1]!;
    expect(post.name).toBe("post");
    expect(post.color).toBe("#FF8800");
    // the 12-number placement survives: translate (5, 5, 2)
    expect(post.transform).toBeDefined();
    expect(post.transform![3]).toBeCloseTo(5, 4);
    expect(post.transform![7]).toBeCloseTo(5, 4);
    expect(post.transform![11]).toBeCloseTo(2, 4);
    // and the leaf is world-positioned on read-back
    const placed = occ.documentShape(post.shape!);
    expectVec3Close(placed.bounds().min, [3, 3, 2]);
    expectVec3Close(placed.bounds().max, [7, 7, 10]);
  });

  it("rejects bad document trees with useful errors", () => {
    expect(() => occ.writeStepDocument([])).toThrow(/tree is empty/);
    expect(() =>
      occ.writeStepDocument([{ name: "x", shape: occ.makeBox(1, 1, 1), children: [{ shape: occ.makeBox(1, 1, 1) }] }]),
    ).toThrow(/both a shape and children/);
    expect(() =>
      occ.writeStepDocument([{ name: "x", color: "red", shape: occ.makeBox(1, 1, 1) }]),
    ).toThrow(/#RRGGBB/);
    expect(() =>
      occ.writeStepDocument([{ name: "x", shape: occ.makeBox(1, 1, 1), transform: [1, 2, 3] }]),
    ).toThrow(/12 finite numbers/);
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
      expect(Math.hypot(c.axisPoint[0] - 10, c.axisPoint[1] - 10)).toBeLessThan(1e-6);
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

  it("sews adjacent faces into a shared-edge shell", () => {
    const left = occ.makeFace(occ.makePolygon([[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]]));
    const right = occ.makeFace(occ.makePolygon([[1, 0, 0], [2, 0, 0], [2, 1, 0], [1, 1, 0]]));
    const shell = occ.heal([left, right]);
    expect(shell.count("Shell")).toBe(1);
    expect(shell.isValid()).toBe(true);
    expect(shell.count("Face")).toBe(2);
    // 8 unsewn edges; the two along the shared boundary merge into one: 7 remain
    expect(shell.count("Edge")).toBe(7);
    expect(shell.area()).toBeCloseTo(2, 6);
  });

  it("heals a valid solid without changing it", () => {
    const healed = occ.heal(occ.makeBox(10, 10, 10));
    expect(healed.shapeType()).toBe("Solid");
    expect(healed.isValid()).toBe(true);
    expect(healed.volume()).toBeCloseTo(1000, 6);
    expect(() => occ.heal([])).toThrow(/at least one/);
    expect(() => occ.heal(occ.makeBox(1, 1, 1), { tolerance: 0 })).toThrow(/positive/);
  });

  it("mirrors through planes and about axes", () => {
    const part = occ.translate(occ.makeBox(2, 4, 6), [1, 0, 0]); // x ∈ [1, 3]
    const flipped = occ.mirror(part, { plane: { origin: [0, 0, 0], normal: [0, 0, 1] } });
    expect(flipped.shapeType()).toBe("Solid");
    expect(flipped.isValid()).toBe(true);
    expect(flipped.volume()).toBeCloseTo(48, 6);
    expectVec3Close(flipped.bounds().min, [1, 0, -6]);
    expectVec3Close(flipped.bounds().max, [3, 4, 0]);

    // a rotation by π about the X axis: both y and z flip
    const aboutX = occ.mirror(part, { axis: { origin: [0, 0, 0], direction: [1, 0, 0] } });
    expectVec3Close(aboutX.bounds().min, [1, -4, -6]);
    expectVec3Close(aboutX.bounds().max, [3, 0, 0]);

    expect(() => occ.mirror(part, {})).toThrow(/exactly one/);
    expect(() =>
      occ.mirror(part, { plane: { normal: [0, 0, 1] }, axis: { direction: [1, 0, 0] } }),
    ).toThrow(/exactly one/);
    expect(() => occ.mirror(part, { plane: { normal: [0, 0, 0] } })).toThrow(/non-zero/);
  });

  it("lays out rectangular and circular patterns", () => {
    const grid = occ.rectangularPattern(occ.makeBox(1, 1, 1), {
      countX: 3, countY: 2, spacingX: 2, spacingY: 3,
    });
    expect(grid.shapeType()).toBe("Compound");
    expect(grid.count("Solid")).toBe(6);
    expect(grid.volume()).toBeCloseTo(6, 6);
    expectVec3Close(grid.bounds().min, [0, 0, 0]);
    expectVec3Close(grid.bounds().max, [5, 4, 1]);

    const spoke = occ.translate(occ.makeBox(1, 1, 1), [1, 0, 0]); // x ∈ [1, 2]
    const ring = occ.circularPattern(spoke, { count: 4 });
    expect(ring.shapeType()).toBe("Compound");
    expect(ring.count("Solid")).toBe(4);
    expect(ring.volume()).toBeCloseTo(4, 6);
    expectVec3Close(ring.bounds().min, [-2, -2, 0]);
    expectVec3Close(ring.bounds().max, [2, 2, 1]);

    // a half ring: copies at 0°, 60°, 120° — all in y ≥ 0
    const arc = occ.circularPattern(spoke, { count: 3, sweepDegrees: 180 });
    expect(arc.count("Solid")).toBe(3);
    expect(arc.bounds().min[1]).toBeGreaterThanOrEqual(-1e-6);

    expect(() =>
      occ.rectangularPattern(spoke, { countX: 1, countY: 1, spacingX: 1 }),
    ).toThrow(/single copy/);
    expect(() =>
      occ.rectangularPattern(spoke, { countX: 2, countY: 1, spacingX: 1, directionY: [1, 0, 0] }),
    ).toThrow(/parallel/);
    expect(() => occ.circularPattern(spoke, { count: 1 })).toThrow(/at least 2/);
  });

  it("builds a helix and sweeps a spring along it", () => {
    const helix = occ.makeHelix(5, 2, 2); // one full turn: radius 5, pitch 2
    expect(helix.shapeType()).toBe("Wire");
    expect(helix.count("Edge")).toBe(1);
    // the helix walks on the r=5 cylinder — bounds are optimal (geometry, not
    // control points) but allow a hair of slack on x/y, none on the exact z range
    const bounds = helix.bounds();
    for (const value of [bounds.min[0], bounds.min[1], bounds.max[0], bounds.max[1]]) {
      expect(Math.abs(Math.abs(value) - 5)).toBeLessThan(0.3);
    }
    expect(bounds.min[2]).toBeCloseTo(0, 2);
    expect(bounds.max[2]).toBeCloseTo(2, 2);

    // circle at the helix start — `correction` re-orients it onto the normal
    // plane. Tube volume ≈ cross-section × centerline length.
    const profile = occ.makeCircle(0.25, { origin: [5, 0, 0], normal: [0, 1, 0] });
    const spring = occ.pipeShell(profile, helix, { correction: true });
    expect(spring.shapeType()).toBe("Solid");
    expect(spring.isValid()).toBe(true);
    const centerline = Math.hypot(2 * Math.PI * 5, 2);
    expect(spring.volume()).toBeCloseTo(Math.PI * 0.25 * 0.25 * centerline, 0);

    const left = occ.makeHelix(5, 2, 2, { leftHanded: true });
    expect(left.bounds().min[2]).toBeCloseTo(0, 2);
    expect(left.bounds().max[2]).toBeCloseTo(2, 2);
    expect(() => occ.makeHelix(0, 2, 2)).toThrow(/positive/);
    expect(() => occ.makeHelix(5, 0, 2)).toThrow(/positive/);
  });

  it("pipe-shells a circle along a circle into an exact torus", () => {
    const spine = occ.makeCircle(4, { normal: [0, 0, 1] }); // starts at (4, 0, 0)
    const profile = occ.makeCircle(1, { origin: [4, 0, 0], normal: [0, 1, 0] });
    const torus = occ.pipeShell(profile, spine);
    expect(torus.shapeType()).toBe("Solid");
    expect(torus.isValid()).toBe(true);
    expect(torus.volume()).toBeCloseTo(2 * Math.PI * Math.PI * 4, 1);
    // the swept surface is a B-spline — optimal bounds hug the geometry,
    // with a little slack for the surface's internal tolerance
    const bounds = torus.bounds();
    for (const value of [bounds.min[0], bounds.min[1], bounds.max[0], bounds.max[1]]) {
      expect(Math.abs(Math.abs(value) - 5)).toBeLessThan(0.5);
    }
    expect(bounds.min[2]).toBeCloseTo(-1, 1);
    expect(bounds.max[2]).toBeCloseTo(1, 1);

    expect(() =>
      occ.pipeShell(profile, spine, { mode: "binormal" }),
    ).toThrow(/binormal.*direction/);
  });

  it("keeps a swept rectangle flat with a fixed binormal", () => {
    const helix = occ.makeHelix(5, 2, 2);
    // rectangle in the XZ plane at the helix start (the tangent there is +Y)
    const ribbon = occ.makePolygon([
      [4.9, 0, -0.25], [5.1, 0, -0.25], [5.1, 0, 0.25], [4.9, 0, 0.25],
    ]);
    const flight = occ.pipeShell(ribbon, helix, {
      mode: "binormal", binormal: [0, 0, 1], correction: true,
    });
    expect(flight.shapeType()).toBe("Solid");
    expect(flight.isValid()).toBe(true);
    // the ribbon stays level the whole way: 2 of climb + 0.5 of ribbon height
    const z = flight.bounds();
    expect(z.max[2] - z.min[2]).toBeCloseTo(2.5, 1);
    // cross-section 0.2 × 0.5 carried along the centerline (length ≈ 31.5)
    expect(flight.volume()).toBeGreaterThan(2.5);
    expect(flight.volume()).toBeLessThan(4);
  });

  it("builds B-spline surfaces from control points", () => {
    const surface = occ.makeBsplineSurface(
      [
        [[0, 0, 0], [2, 0, 0]],
        [[0, 3, 0], [2, 3, 0]],
      ],
      { uDegree: 1, vDegree: 1 },
    );
    expect(surface.shapeType()).toBe("Face");
    expect(surface.isValid()).toBe(true);
    // the bilinear patch between the four corners: a flat 2 × 3 rectangle
    expect(surface.area()).toBeCloseTo(6, 3);

    // a 4 × 4 planar grid at the default degree 3 is still exactly planar
    const smooth = occ.makeBsplineSurface(
      Array.from({ length: 4 }, (_, v) =>
        Array.from({ length: 4 }, (_, u) => [u, v, 0]),
      ),
    );
    expect(smooth.isValid()).toBe(true);
    expect(smooth.area()).toBeCloseTo(9, 3);

    expect(() => occ.makeBsplineSurface([[[0, 0, 0], [1, 0, 0]]])).toThrow(/2 × 2/);
    expect(() =>
      occ.makeBsplineSurface([[[0, 0, 0], [1, 0, 0]], [[0, 1, 0]]]),
    ).toThrow(/rectangular/);
    expect(() =>
      occ.makeBsplineSurface(
        [[[0, 0, 0], [2, 0, 0]], [[0, 3, 0], [2, 3, 0]]],
        { uDegree: 2, vDegree: 1 },
      ),
    ).toThrow(/degree/);
  });

  it("interpolates a surface through a point grid", () => {
    const flat = occ.makeBsplineSurfaceThrough([
      [[0, 0, 0], [1, 0, 0], [2, 0, 0]],
      [[0, 1, 0], [1, 1, 0], [2, 1, 0]],
      [[0, 2, 0], [1, 2, 0], [2, 2, 0]],
    ]);
    expect(flat.shapeType()).toBe("Face");
    expect(flat.isValid()).toBe(true);
    expect(flat.area()).toBeCloseTo(4, 3);

    // a lifted middle point bends the patch beyond the flat 2 × 2
    const saddle = occ.makeBsplineSurfaceThrough([
      [[0, 0, 0], [1, 0, 0], [2, 0, 0]],
      [[0, 1, 0], [1, 1, 0.5], [2, 1, 0]],
      [[0, 2, 0], [1, 2, 0], [2, 2, 0]],
    ]);
    expect(saddle.isValid()).toBe(true);
    expect(saddle.area()).toBeGreaterThan(4);
  });

  it("describes and re-poles B-spline surfaces", () => {
    const surface = occ.makeBsplineSurface(
      [[[0, 0, 0], [2, 0, 0]], [[0, 3, 0], [2, 3, 0]]],
      { uDegree: 1, vDegree: 1 },
    );
    const info = occ.describeSurface(surface);
    expect(info.surface).toBe("bspline");
    expect(info.uPoles).toBe(2);
    expect(info.vPoles).toBe(2);
    expect(info.uDegree).toBe(1);
    expect(info.vDegree).toBe(1);
    expect(info.rational).toBe(false);
    expectVec3Close(info.poles[0]![0]!, [0, 0, 0]);
    expectVec3Close(info.poles[1]![1]!, [2, 3, 0]);

    const edited = occ.setBsplinePoles(surface, [
      [[0, 0, 2], [2, 0, 0]],
      [[0, 3, 0], [2, 3, 0]],
    ]);
    // the original is untouched — the edit works on a copy
    expect(surface.area()).toBeCloseTo(6, 3);
    expect(edited.area()).toBeGreaterThan(6);
    expectVec3Close(occ.describeSurface(edited).poles[0]![0]!, [0, 0, 2]);

    expect(() =>
      occ.setBsplinePoles(surface, [
        [[0, 0, 0], [1, 0, 0]],
        [[0, 1, 0], [1, 1, 0]],
        [[0, 2, 0], [1, 2, 0]],
      ]),
    ).toThrow(/pole grid/);
    expect(() => occ.describeSurface(occ.makeBox(1, 1, 1))).toThrow(/Face/);
    expect(() => occ.describeSurface(occ.makeFace(occ.makeCircle(1)))).toThrow(/not a B-spline/);
  });

  // --- cadorange contract wave (P0 + P1 gaps) -----------------------------------

  it("keeps stdout silent during STEP export, verbose re-enables diagnostics", () => {
    const gasket = occ.cut(
      occ.makeBox(20, 20, 5),
      occ.makeCylinder(4, 20, { origin: [10, 10, -5] }),
    );
    occ.writeStep(gasket);
    // OCCT used to print "Statistics on Transfer" + "Write Done" banners
    // here — stdout is a protocol (MCP stdio transport), not a log.
    expect(stdout).not.toHaveBeenCalled();

    occ.setVerbose(true);
    try {
      occ.writeStep(gasket);
      expect(
        stdout.mock.calls.some((args) => /Statistics on Transfer/.test(args.join(" "))),
      ).toBe(true);
    } finally {
      occ.setVerbose(false);
    }
    stdout.mockClear();
    occ.writeStep(gasket);
    expect(stdout).not.toHaveBeenCalled();
  });

  it("describes face and edge centroids (build123d Shape.center() semantics)", () => {
    const box = occ.makeBox(10, 20, 3);
    const d = occ.describe(box);

    // every face and edge carries the integral centroid, not the surface's
    // parameter origin. The top face (highest centroid) is centered at
    // (5, 10, 3) even though its plane's parameter origin sits in a corner —
    // that gap is why `center` exists. (The plane `normal` field is the
    // surface axis direction, which need not match the face's outward
    // orientation, so pick by centroid, not by normal.)
    const top = d.faces.reduce((a, b) => (a.center[2] >= b.center[2] ? a : b));
    expectVec3Close(top.center, [5, 10, 3]);

    for (const face of d.faces) expect(face.center).toBeDefined();
    for (const edge of d.edges) expect(edge.center).toBeDefined();

    // a line edge's centroid is its midpoint
    const anEdge = d.edges.find((e) => e.curve === "line");
    if (!anEdge || anEdge.curve !== "line") throw new Error("expected a line edge");
    expectVec3Close(anEdge.center, [
      (anEdge.start[0] + anEdge.end[0]) / 2,
      (anEdge.start[1] + anEdge.end[1]) / 2,
      (anEdge.start[2] + anEdge.end[2]) / 2,
    ]);

    // a quarter arc's centroid sits on the bisector at 2R·sin(θ/2)/θ from the
    // center — NOT at the circle center (that is axisPoint now)
    const arc = occ.describe(occ.makeArc(5, { startDegrees: 0, endDegrees: 90 })).edges[0]!;
    if (arc.curve !== "circle") throw new Error("expected a circle edge");
    const bisector = (5 * Math.sin(Math.PI / 4)) / (Math.PI / 4) / Math.SQRT2;
    expectVec3Close(arc.center, [bisector, bisector, 0]);
    expectVec3Close(arc.axisPoint, [0, 0, 0]);

    // sphere/torus faces renamed the same way: centroid under center,
    // surface placement under axisPoint
    const torusFace = occ.describe(occ.makeTorus(20, 5)).faces[0]!;
    if (torusFace.surface !== "torus") throw new Error("expected a torus face");
    expectVec3Close(torusFace.center, [0, 0, 0]);
    expectVec3Close(torusFace.axisPoint, [0, 0, 0]);
  });

  it("describes vertices in subShapes order", () => {
    const box = occ.makeBox(10, 20, 3);
    const d = occ.describe(box);
    expect(d.vertices).toHaveLength(8);
    expect(d.vertices.map((v) => v.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    const positions = d.vertices.map((v) => v.position.join(",")).sort();
    for (const corner of ["0,0,0", "10,0,0", "0,20,0", "0,0,3", "10,20,3", "0,20,3", "10,0,3", "10,20,0"]) {
      expect(positions).toContain(corner);
    }
    // vertex i is subShapes(shape, "Vertex")[i - 1]
    const handles = occ.vertices(box);
    expect(handles).toHaveLength(d.vertices.length);
    for (let i = 0; i < handles.length; i++) {
      expectVec3Close(
        occ.describe(handles[i]!).vertices[0]!.position,
        d.vertices[i]!.position,
      );
    }

    // an open arc carries exactly its two endpoints
    const arc = occ.describe(occ.makeArc(5, { startDegrees: 0, endDegrees: 90 }));
    expect(arc.vertices).toHaveLength(2);
  });

  it("cleans boolean results by default and keeps raw topology on demand", () => {
    // two overlapping boxes fuse into one clean box: 6 faces, 12 edges
    // (the raw BOP result carries the imprinted intersection edges)
    const a = occ.makeBox(10, 10, 10);
    const b = occ.translate(occ.makeBox(10, 10, 10), [5, 0, 0]);
    const fused = occ.fuse(a, b);
    expect(fused.isValid()).toBe(true);
    expect(fused.volume()).toBeCloseTo(1500, 1);
    expect(fused.count("Face")).toBe(6);
    expect(fused.count("Edge")).toBe(12);

    const raw = occ.fuse(a, b, { clean: false });
    expect(raw.volume()).toBeCloseTo(1500, 1);
    expect(raw.count("Face")).toBeGreaterThan(6);

    // the cleaned result is what describe/subShapes index into
    expect(occ.describe(fused).faces).toHaveLength(6);
    expect(occ.faces(fused)).toHaveLength(6);

    // cut keeps parity with build123d on a plate-with-bore: 7 faces, 15 edges
    const plate = occ.cut(
      occ.makeBox(20, 20, 5),
      occ.makeCylinder(4, 20, { origin: [10, 10, -5] }),
    );
    expect(plate.count("Face")).toBe(7);
    expect(plate.count("Edge")).toBe(15);
  });

  it("unifies same-domain faces on demand", () => {
    const a = occ.makeBox(10, 10, 10);
    const b = occ.translate(occ.makeBox(10, 10, 10), [5, 0, 0]);
    const raw = occ.fuse(a, b, { clean: false });
    expect(raw.count("Face")).toBeGreaterThan(6);
    const cleaned = occ.unify(raw);
    expect(cleaned.isValid()).toBe(true);
    expect(cleaned.volume()).toBeCloseTo(raw.volume(), 6);
    expect(cleaned.count("Face")).toBe(6);
    expect(cleaned.count("Edge")).toBe(12);
  });

  it("chamfers asymmetric legs (length + length2)", () => {
    const box = occ.makeBox(10, 10, 10);
    const vertical = occ.describe(box).edges
      .filter((e) => e.curve === "line" && Math.abs(e.direction[2]) > 0.999)
      .map((e) => e.index);

    // one vertical edge, legs 2 × 3: the removed wedge is d1·d2/2 × height
    const part = occ.chamfer(box, 2, { length2: 3, edges: [vertical[0]!] });
    expect(part.isValid()).toBe(true);
    expect(part.volume()).toBeCloseTo(1000 - (2 * 3 / 2) * 10, 1);
    expect(part.count("Face")).toBe(7);

    // by handle, same result
    const box2 = occ.makeBox(10, 10, 10);
    const handle = occ.edges(box2)[vertical[0]! - 1]!;
    const byHandle = occ.chamfer(box2, 2, { length2: 3, edges: [handle] });
    expect(byHandle.volume()).toBeCloseTo(part.volume(), 6);

    // asymmetric > symmetric wedge of the same max leg: 2×3 removes more
    // than 2×2 but less than 3×3
    const small = occ.chamfer(occ.makeBox(10, 10, 10), 2, { edges: [vertical[0]!] }).volume();
    const big = occ.chamfer(occ.makeBox(10, 10, 10), 3, { edges: [vertical[0]!] }).volume();
    expect(part.volume()).toBeLessThan(small);
    expect(part.volume()).toBeGreaterThan(big);

    expect(() => occ.chamfer(box, 2, { length2: -1 })).toThrow(/length2 must be a positive/);
  });

  it("builds compounds of independent bodies", () => {
    const left = occ.makeBox(10, 10, 10);
    const right = occ.translate(occ.makeBox(5, 5, 5), [30, 0, 0]);
    const both = occ.compound([left, right]);
    expect(both.shapeType()).toBe("Compound");
    expect(both.count("Solid")).toBe(2);
    expect(both.volume()).toBeCloseTo(1125, 6);
    expectVec3Close(both.bounds().min, [0, 0, 0]);
    expectVec3Close(both.bounds().max, [35, 10, 10]);
    // describe and subShapes walk the whole tree (6 + 6 faces)
    expect(occ.describe(both).faces).toHaveLength(12);
    expect(occ.faces(both)).toHaveLength(12);
    expect(() => occ.compound([])).toThrow(/at least one/);
  });

  it("separates a face's outer wire from its inner (hole) wires", () => {
    // any box face: exactly one boundary wire, no holes
    const anyFace = occ.faces(occ.makeBox(10, 10, 10))[0]!;
    const solidOuter = occ.faceWires(anyFace);
    expect(solidOuter.outer.shapeType()).toBe("Wire");
    expect(solidOuter.inners).toHaveLength(0);

    const annulus = occ.makeFace(occ.makeCircle(10), [occ.makeCircle(4)]);
    const rings = occ.faceWires(annulus);
    expect(rings.inners).toHaveLength(1);
    expect(rings.inners[0]!.isSame(rings.outer)).toBe(false);
    // sketch-on-face wants the inner boundary as the hole to avoid
    expect(occ.describe(rings.outer).edges[0]!.curve).toBe("circle");

    expect(() => occ.faceWires(occ.makeBox(1, 1, 1))).toThrow(/expected a Face/);
  });

  it("bounds are optimal — torus reports the true ±(R + r)", () => {
    const torus = occ.makeTorus(20, 5);
    const bounds = torus.bounds();
    // the control-point envelope would say ±27.0598; the geometry says ±25
    expectVec3Close(bounds.min, [-25, -25, -5]);
    expectVec3Close(bounds.max, [25, 25, 5]);

    // analytic primitives stay exact
    const box = occ.makeBox(1, 2, 3);
    expectVec3Close(box.bounds().min, [0, 0, 0]);
    expectVec3Close(box.bounds().max, [1, 2, 3]);
  });

  it("enumerates count / subShapes / describe in the same indexed-map order", () => {
    // the counting rule (R11): every path enumerates via TopExp::MapShapes
    // over an indexed map — deduplicated by TShape + location, orientation
    // insensitive — so indices are interchangeable across the three.
    const part = occ.cut(
      occ.makeBox(20, 20, 5),
      occ.makeCylinder(4, 20, { origin: [10, 10, -5] }),
    );
    for (const type of ["Face", "Edge", "Vertex"] as const) {
      expect(part.count(type)).toBe(occ.subShapes(part, type).length);
    }
    expect(part.count("Face")).toBe(occ.describe(part).faces.length);
    // describe skips degenerated edges (sphere poles) from its list but keeps
    // their index space — count("Edge") is the index range, the list can be
    // shorter; vertices have no degenerate cases and match exactly
    expect(part.count("Vertex")).toBe(occ.describe(part).vertices.length);
    const sphere = occ.describe(occ.makeSphere(5));
    expect(sphere.edges.every((e) => e.curve === "circle")).toBe(true);
  });
});
