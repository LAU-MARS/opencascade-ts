import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { OccSession, type OccShape } from "../src/ts/occ.js";
import { describeWasm } from "./wasm-available.js";

// Every expectation in this file was measured by etc/reference/ocp-oracle.py on
// desktop OCCT (conda-forge `ocp`) — not derived by hand. To add a case: write
// the scenario there AND a builder here (same name), run `npm run reference`,
// then this test keeps the wasm kernel honest against the reference build.

interface ReferenceCase {
  name: string;
  digits?: number;
  volume?: number;
  area?: number;
  solids?: number;
  shells?: number;
  faces?: number;
  edges?: number;
  vertices?: number;
  bboxMin?: number[];
  bboxMax?: number[];
  centroid?: number[];
}

function loadFixture(): ReferenceCase[] {
  const fixturePath = path.resolve(process.cwd(), "tests", "fixtures", "ocp-reference.json");
  if (!existsSync(fixturePath)) {
    throw new Error(
      `OCP reference fixture not found at ${fixturePath} — regenerate it with ` +
        "`npm run reference` (needs conda-forge `ocp`; see docs/BUILDING.md)",
    );
  }
  return (JSON.parse(readFileSync(fixturePath, "utf8")) as { cases: ReferenceCase[] }).cases;
}

// Mirrors etc/reference/ocp-oracle.py scenario by scenario; keep the names in
// lockstep — a missing builder or stray fixture entry fails the run below.
function buildCase(occ: OccSession, name: string): OccShape {
  const verticalEdges = (shape: OccShape): number[] =>
    occ.describe(shape).edges
      .filter((e) => e.curve === "line" && Math.abs(e.direction[2]) > 0.999)
      .map((e) => e.index);
  const topFace = (shape: OccShape, z: number): number => {
    const face = occ.describe(shape).faces.find(
      (f) => f.surface === "plane" && f.normal && Math.abs(f.normal[2] - 1) < 1e-9
        && Math.abs(f.origin[2] - z) < 1e-6,
    );
    if (!face) throw new Error(`no +Z face at z=${z}`);
    return face.index;
  };

  const builders: Record<string, () => OccShape> = {
    box_10_20_3: () => occ.makeBox(10, 20, 3),
    cylinder_r5_h10: () => occ.makeCylinder(5, 10),
    sphere_r10: () => occ.makeSphere(10),
    torus_20_5: () => occ.makeTorus(20, 5),

    cut_box_cylinder: () =>
      occ.cut(occ.makeBox(10, 10, 10), occ.makeCylinder(2, 12, { origin: [5, 5, -1] })),
    fuse_disjoint: () =>
      occ.fuse(occ.makeBox(10, 10, 10), occ.translate(occ.makeBox(10, 10, 10), [30, 0, 0])),
    common_overlap: () =>
      occ.common(occ.makeBox(10, 10, 10), occ.translate(occ.makeBox(10, 10, 10), [5, 0, 0])),

    shell_open_top: () => {
      const box = occ.makeBox(20, 20, 10);
      return occ.shell(box, 2, { openFaces: [topFace(box, 10)] });
    },
    shell_sealed: () => occ.shell(occ.makeBox(20, 20, 10), 2),

    draft_symmetric: () => occ.draft(occ.makeBox(20, 20, 50), 10, { direction: [0, 0, 1] }),
    draft_floor_neutral: () =>
      occ.draft(occ.makeBox(20, 20, 50), 10, { direction: [0, 0, 1], neutralPoint: [10, 10, 0] }),

    fillet_all_r1: () => occ.fillet(occ.makeBox(10, 10, 10), 1),
    fillet_vertical_r1: () => {
      const box = occ.makeBox(10, 10, 10);
      return occ.fillet(box, 1, { edges: verticalEdges(box) });
    },
    chamfer_all_d1: () => occ.chamfer(occ.makeBox(10, 10, 10), 1),
    chamfer_top_d1: () => {
      const box = occ.makeBox(10, 10, 10);
      const top = occ.describe(box).edges
        .filter((e) => e.curve === "line"
          && Math.abs(e.start[2] - 10) < 1e-6 && Math.abs(e.end[2] - 10) < 1e-6)
        .map((e) => e.index);
      return occ.chamfer(box, 1, { edges: top });
    },
    variable_fillet_equal_radii: () => {
      const box = occ.makeBox(10, 10, 10);
      const edge = verticalEdges(box)[0]!;
      return occ.variableFillet(box, [
        { edge, radius: 1, at: 0 },
        { edge, radius: 1, at: 10 },
      ]);
    },

    extrude_circle_solid: () => occ.extrude(occ.makeCircle(5), [0, 0, 10]),
    extrude_polygon_solid: () =>
      occ.extrude(occ.makePolygon([[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0]]), [0, 0, 5]),
    extrude_wire_shell: () => occ.extrude(occ.makeCircle(5), [0, 0, 10], { solid: false }),

    revolve_full_torus: () => {
      const profile = occ.makeCircle(2, { origin: [20, 0, 0], normal: [0, 1, 0] });
      return occ.revolve(profile, { direction: [0, 0, 1] });
    },
    revolve_half_torus: () => {
      const profile = occ.makeCircle(2, { origin: [20, 0, 0], normal: [0, 1, 0] });
      return occ.revolve(profile, { direction: [0, 0, 1], angleDegrees: 180 });
    },
    loft_ruled_frustum: () =>
      occ.loft(
        [occ.makeCircle(5), occ.makeCircle(10, { origin: [0, 0, 20] })],
        { ruled: true },
      ),

    sweep_straight_pipe: () => {
      const spine = occ.makePolygon([[0, 0, 0], [0, 0, 20]], { close: false });
      return occ.sweep(occ.makeCircle(3), spine);
    },
    sweep_ring_torus: () => {
      const spine = occ.makeCircle(20);
      const profile = occ.makeCircle(2, { origin: [20, 0, 0], normal: [0, 1, 0] });
      return occ.sweep(profile, spine);
    },

    split_box_blade: () => {
      const box = occ.makeBox(10, 10, 10);
      const blade = occ.translate(occ.makeBox(2, 30, 30), [4, -10, -10]);
      return occ.split(box, [blade]);
    },

    offset_box_out: () => occ.offsetSolid(occ.makeBox(10, 10, 10), 1),
    offset_box_in: () => occ.offsetSolid(occ.makeBox(10, 10, 10), -1),
    offset_sphere_plus2: () => occ.offsetSolid(occ.makeSphere(10), 2),

    annulus_extrude: () =>
      occ.extrude(occ.makeFace(occ.makeCircle(10), [occ.makeCircle(4)]), [0, 0, 5]),
    extrude_ellipse_solid: () => occ.extrude(occ.makeEllipse(10, 4), [0, 0, 5]),

    extrude_slot: () => {
      const left = occ.makeArc(5, { startDegrees: 90, endDegrees: 270 });
      const bottom = occ.makeLine([0, -5, 0], [20, -5, 0]);
      const right = occ.makeArc(5, { origin: [20, 0, 0], startDegrees: -90, endDegrees: 90 });
      const top = occ.makeLine([20, 5, 0], [0, 5, 0]);
      return occ.extrude(occ.makeWire([left, bottom, right, top]), [0, 0, 10]);
    },
    extrude_pie_sector: () => {
      const arc = occ.makeArc(5, { startDegrees: 0, endDegrees: 90 });
      const toCenter = occ.makeLine([0, 5, 0], [0, 0, 0]);
      const fromCenter = occ.makeLine([0, 0, 0], [5, 0, 0]);
      return occ.extrude(occ.makeWire([arc, toCenter, fromCenter]), [0, 0, 2]);
    },

    rectangular_pattern_3x2: () =>
      occ.rectangularPattern(occ.makeBox(1, 1, 1), {
        countX: 3, countY: 2, spacingX: 2, spacingY: 3,
      }),
    circular_pattern_4: () =>
      occ.circularPattern(occ.translate(occ.makeBox(1, 1, 1), [1, 0, 0]), { count: 4 }),

    mirror_plane: () =>
      occ.mirror(occ.translate(occ.makeBox(2, 4, 6), [1, 0, 0]), {
        plane: { origin: [0, 0, 0], normal: [0, 0, 1] },
      }),

    centroid_box: () => occ.makeBox(10, 10, 10),
    centroid_plate_with_bore: () =>
      occ.cut(
        occ.makeBox(20, 20, 5),
        occ.makeCylinder(4, 20, { origin: [10, 10, -5] }),
      ),
    centroid_circle_wire: () => occ.makeCircle(5, { origin: [3, 4, 0] }),
  };

  const build = builders[name];
  if (!build) throw new Error(`no builder for OCP reference case "${name}"`);
  return build();
}

describeWasm("wasm kernel vs desktop OCCT (OCP reference)", () => {
  let occ: OccSession;
  const cases = loadFixture();

  beforeAll(async () => {
    occ = await OccSession.create();
  });

  afterAll(() => {
    occ?.dispose();
  });

  it("every fixture case has a builder", () => {
    // buildCase throws on unknown names; a dry registry probe keeps fixture
    // growth and this file in lockstep even when a case fails elsewhere.
    const known = new Set(cases.map((c) => c.name));
    for (const name of known) {
      expect(() => buildCase(occ, name)).not.toThrow();
    }
  });

  for (const reference of cases) {
    it(`${reference.name} matches desktop OCCT`, () => {
      const shape = buildCase(occ, reference.name);
      const digits = reference.digits ?? 6;

      if (reference.volume !== undefined) {
        expect(shape.volume()).toBeCloseTo(reference.volume, digits);
      }
      if (reference.area !== undefined) {
        expect(shape.area()).toBeCloseTo(reference.area, digits);
      }
      const counts: [keyof ReferenceCase, string][] = [
        ["solids", "Solid"],
        ["shells", "Shell"],
        ["faces", "Face"],
        ["edges", "Edge"],
        ["vertices", "Vertex"],
      ];
      for (const [field, type] of counts) {
        const expected = reference[field] as number | undefined;
        if (expected !== undefined) {
          expect(shape.count(type)).toBe(expected);
        }
      }
      // Bnd_Box pads by ~1e-7 on both sides, so four digits is the ceiling.
      if (reference.bboxMin !== undefined) {
        const min = shape.bounds().min;
        for (let i = 0; i < 3; i++) expect(min[i]).toBeCloseTo(reference.bboxMin[i]!, 4);
      }
      if (reference.bboxMax !== undefined) {
        const max = shape.bounds().max;
        for (let i = 0; i < 3; i++) expect(max[i]).toBeCloseTo(reference.bboxMax[i]!, 4);
      }
      if (reference.centroid !== undefined) {
        const center = shape.centroid();
        for (let i = 0; i < 3; i++) {
          expect(center[i]).toBeCloseTo(reference.centroid[i]!, digits);
        }
      }
    });
  }
});
