import { describe, expect, it } from "vitest";

import { detectHoles, type CircleEdgeInfo, type CylinderFaceInfo } from "../src/ts/interrogate.js";

function cylinderFace(radius: number, axisPoint: [number, number, number] = [0, 0, 0]): CylinderFaceInfo {
  return { index: 1, surface: "cylinder", area: 1, axisPoint, axis: [0, 0, 1], radius };
}

function circleEdge(
  radius: number,
  center: [number, number, number],
  axis: [number, number, number] = [0, 0, 1],
  index = 1,
): CircleEdgeInfo {
  return {
    index,
    curve: "circle",
    length: 2 * Math.PI * radius,
    center,
    axis,
    radius,
    uRange: [0, 2 * Math.PI],
    closed: true,
  };
}

describe("detectHoles", () => {
  it("finds a through bore from a cylinder face and its two boundary circles", () => {
    const holes = detectHoles(
      [cylinderFace(2)],
      [circleEdge(2, [0, 0, 0], [0, 0, 1], 1), circleEdge(2, [0, 0, 5], [0, 0, 1], 2)],
    );
    expect(holes).toHaveLength(1);
    expect(holes[0]!.radius).toBeCloseTo(2, 9);
    expect(holes[0]!.center).toEqual([0, 0, 2.5]);
    expect(holes[0]!.length).toBeCloseTo(5, 9);
  });

  it("requires exactly two coaxial circles — blind or partial cylinders are rejected", () => {
    // only one boundary circle (blind hole)
    expect(detectHoles([cylinderFace(2)], [circleEdge(2, [0, 0, 0])])).toHaveLength(0);
    // three circles
    expect(
      detectHoles(
        [cylinderFace(2)],
        [circleEdge(2, [0, 0, 0], [0, 0, 1], 1), circleEdge(2, [0, 0, 5], [0, 0, 1], 2), circleEdge(2, [0, 0, 8], [0, 0, 1], 3)],
      ),
    ).toHaveLength(0);
    // radius mismatch
    expect(
      detectHoles([cylinderFace(2)], [circleEdge(2, [0, 0, 0], [0, 0, 1], 1), circleEdge(2.5, [0, 0, 5], [0, 0, 1], 2)]),
    ).toHaveLength(0);
    // circle axis not parallel to face axis (off-axis bore)
    expect(
      detectHoles([cylinderFace(2)], [circleEdge(2, [0, 0, 0], [0, 0, 1], 1), circleEdge(2, [0, 5, 0], [0, 1, 0], 2)]),
    ).toHaveLength(0);
    // circle center off the cylinder's axis line
    expect(
      detectHoles([cylinderFace(2)], [circleEdge(2, [1, 0, 0], [0, 0, 1], 1), circleEdge(2, [1, 0, 5], [0, 0, 1], 2)]),
    ).toHaveLength(0);
  });

  it("accepts reversed circle orientation (axis sign flips between circles)", () => {
    const holes = detectHoles(
      [cylinderFace(2)],
      [circleEdge(2, [0, 0, 0], [0, 0, 1], 1), circleEdge(2, [0, 0, 5], [0, 0, -1], 2)],
    );
    expect(holes).toHaveLength(1);
  });

  it("deduplicates identical faces from fused bores", () => {
    const edges = [circleEdge(2, [0, 0, 0], [0, 0, 1], 1), circleEdge(2, [0, 0, 5], [0, 0, 1], 2)];
    expect(detectHoles([cylinderFace(2), { ...cylinderFace(2), index: 2 }], edges)).toHaveLength(1);
  });

  it("ignores non-cylindrical faces and non-closed circles", () => {
    const openCircle = { ...circleEdge(2, [0, 0, 0]), closed: false };
    expect(
      detectHoles([cylinderFace(2)], [openCircle, circleEdge(2, [0, 0, 5])]),
    ).toHaveLength(0);
  });
});
