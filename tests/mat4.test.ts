import { describe, expect, it } from "vitest";

import {
  mat4Create,
  mat4LookAt,
  mat4Multiply,
  mat4Perspective,
  mat4TransformPoint,
} from "../src/ts/viewer/mat4.js";

describe("mat4", () => {
  it("multiplies by the identity without change", () => {
    const a = mat4Perspective(mat4Create(), Math.PI / 2, 2, 1, 101);
    const identity = mat4Create();
    const out = mat4Create();
    mat4Multiply(out, a, identity);
    for (let i = 0; i < 16; i++) {
      expect(out[i]).toBeCloseTo(a[i]!, 6);
    }
  });

  it("computes a 90° perspective projection", () => {
    const m = mat4Perspective(mat4Create(), Math.PI / 2, 1, 1, 101);
    // f = 1/tan(45°) = 1
    expect(m[0]).toBeCloseTo(1, 6);
    expect(m[5]).toBeCloseTo(1, 6);
    expect(m[10]).toBeCloseTo(-1.02, 6);
    expect(m[14]).toBeCloseTo(-2.02, 6);
    expect(m[11]).toBe(-1);
  });

  it("maps the look-at center to the view origin axis", () => {
    const view = mat4LookAt(mat4Create(), [0, 0, 5], [0, 0, 0], [0, 1, 0]);
    const center = mat4TransformPoint(view, [0, 0, 0]);
    expect(center[0]).toBeCloseTo(0, 6);
    expect(center[1]).toBeCloseTo(0, 6);
    expect(center[2]).toBeCloseTo(-5, 6);

    // +Y world maps to +Y view with this camera
    const up = mat4TransformPoint(view, [0, 1, 0]);
    expect(up[1]).toBeGreaterThan(0.9);
  });

  it("maps the eye itself to the view-space origin", () => {
    const view = mat4LookAt(mat4Create(), [3, 4, 5], [0, 0, 0], [0, 0, 1]);
    const eye = mat4TransformPoint(view, [3, 4, 5]);
    expect(eye[0]).toBeCloseTo(0, 6);
    expect(eye[1]).toBeCloseTo(0, 6);
    expect(eye[2]).toBeCloseTo(0, 6);
  });
});
