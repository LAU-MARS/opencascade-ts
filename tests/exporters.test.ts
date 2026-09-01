import { describe, expect, it } from "vitest";

import {
  hiddenLinesToSvg,
  lineSegmentsToSvg,
  meshToAsciiStl,
  meshToGlb,
  meshToObj,
} from "../src/ts/exporters.js";
import type { MeshData } from "../src/ts/types.js";

const triangleMesh: MeshData = {
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
  indices: new Uint32Array([0, 1, 2]),
  edges: new Float32Array([0, 0, 0, 1, 1, 1]),
};

describe("meshToAsciiStl", () => {
  it("emits one facet with the +Z normal", () => {
    const stl = meshToAsciiStl(triangleMesh, "test");
    expect(stl.startsWith("solid test")).toBe(true);
    expect(stl.trimEnd().endsWith("endsolid test")).toBe(true);
    expect(stl.match(/facet normal/g)).toHaveLength(1);
    expect(stl).toContain("facet normal 0 0 1");
    expect(stl.match(/vertex/g)).toHaveLength(3);
  });
});

describe("meshToObj", () => {
  it("writes v/f and wireframe l entries", () => {
    const obj = meshToObj(triangleMesh);
    expect(obj.match(/^v /gm)).toHaveLength(5); // 3 triangle verts + 2 edge verts
    expect(obj).toContain("f 1 2 3");
    expect(obj).toContain("l 4 5");
  });
});

describe("hiddenLinesToSvg", () => {
  const square = new Float32Array([
    0, 0, 0, 10, 0, 0,
    10, 0, 0, 10, 10, 0,
    10, 10, 0, 0, 10, 0,
    0, 10, 0, 0, 0, 0,
  ]);

  it("draws a 10×10 square at 1:1 plus margins", () => {
    const svg = hiddenLinesToSvg({
      visible: square,
      hidden: new Float32Array(0),
      xAxis: [1, 0, 0],
      yAxis: [0, 1, 0],
    });
    expect(svg).toContain("<svg");
    expect(svg).toMatch(/width="30" height="30"/);
    expect(svg.match(/M/g)).toHaveLength(4); // four segments
    // top edge (y=10) maps to the smallest SVG y (flipped axis)
    expect(svg).toContain("M20.00 10.00L10.00 10.00");
    // bottom edge (y=0) maps to the largest SVG y
    expect(svg).toContain("M10.00 20.00L20.00 20.00");
  });

  it("renders hidden edges dashed only when requested", () => {
    const base = {
      visible: square,
      hidden: new Float32Array([0, 0, 0, 1, 0, 0]),
      xAxis: [1, 0, 0] as const,
      yAxis: [0, 1, 0] as const,
    };
    expect(hiddenLinesToSvg(base)).not.toContain("stroke-dasharray");
    expect(hiddenLinesToSvg(base, { showHidden: true })).toContain("stroke-dasharray");
  });

  it("handles empty input", () => {
    const svg = hiddenLinesToSvg({
      visible: new Float32Array(0),
      hidden: new Float32Array(0),
      xAxis: [1, 0, 0],
      yAxis: [0, 1, 0],
    });
    expect(svg).toContain("no edges");
  });
});

describe("meshToGlb", () => {
  it("produces a valid .glb container that parses back", () => {
    const glb = meshToGlb(triangleMesh);
    expect(glb[0]).toBe(0x67); // "glTF" magic
    expect(glb[1]).toBe(0x6c);
    expect(glb[2]).toBe(0x54);
    expect(glb[3]).toBe(0x46);

    const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
    expect(view.getUint32(4, true)).toBe(2); // container version
    expect(view.getUint32(8, true)).toBe(glb.length); // declared length

    const jsonLength = view.getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(glb.slice(20, 20 + jsonLength)));
    expect(json.asset.generator).toBe("opencascade-ts");
    expect(json.accessors[0].count).toBe(3); // POSITION
    expect(json.accessors[0].min).toEqual([0, 0, 0]);
    expect(json.accessors[0].max).toEqual([1, 1, 0]);
    expect(json.meshes[0].primitives[0].mode).toBe(4); // triangles
    expect(json.meshes[0].primitives[1].mode).toBe(1); // wireframe lines
    expect(json.buffers[0].byteLength % 4).toBe(0);
  });

  it("rejects empty meshes", () => {
    expect(() => meshToGlb({ positions: new Float32Array(0), indices: new Uint32Array(0), edges: new Float32Array(0) })).toThrow();
  });
});

describe("lineSegmentsToSvg", () => {
  it("projects along the view direction", () => {
    // a segment along +X, viewed from +Z: full length; viewed from +X it collapses
    const segment = new Float32Array([0, 0, 0, 10, 0, 0]);
    const fromTop = lineSegmentsToSvg(segment, [0, 0, 1]);
    expect(fromTop).toMatch(/width="30" height="21"/); // 10 units + 2×10 margin
    expect(fromTop).toContain("M10.00 10.00L20.00 10.00");

    // from the side the segment collapses to a point: margins only
    const fromSide = lineSegmentsToSvg(segment, [1, 0, 0]);
    expect(fromSide).toMatch(/width="21" height="21"/);
  });
});
