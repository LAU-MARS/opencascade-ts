import { describe, expect, it } from "vitest";

import { OrbitCamera } from "../src/ts/viewer/camera.js";
import { mat4Create, mat4TransformPoint } from "../src/ts/viewer/mat4.js";

describe("OrbitCamera", () => {
  it("keeps the eye at `distance` from the target", () => {
    const camera = new OrbitCamera();
    camera.target = [1, 2, 3];
    camera.azimuth = 0.7;
    camera.elevation = -0.4;
    camera.distance = 42;
    const eye = camera.eye();
    const distance = Math.hypot(eye[0] - 1, eye[1] - 2, eye[2] - 3);
    expect(distance).toBeCloseTo(42, 6);
  });

  it("clamps elevation just under ±90°", () => {
    const camera = new OrbitCamera();
    camera.orbit(0, 10);
    expect(camera.elevation).toBeLessThanOrEqual(1.5533);
    camera.orbit(0, -100);
    expect(camera.elevation).toBeGreaterThanOrEqual(-1.5533);
  });

  it("frames a box at its center with a sane distance", () => {
    const camera = new OrbitCamera();
    camera.fit([0, 0, 0], [10, 20, 30]);
    expect(camera.target).toEqual([5, 10, 15]);
    expect(camera.radius).toBeCloseTo(Math.hypot(5, 10, 15), 6);
    // must see the whole bounding sphere
    expect(camera.distance).toBeGreaterThanOrEqual(camera.radius);
  });

  it("pans the target in the view plane", () => {
    const camera = new OrbitCamera();
    camera.target = [0, 0, 0];
    camera.distance = 100;
    camera.azimuth = 0; // eye along +X, right vector = -Y... computed below
    const right = camera.rightVector();
    const worldPerPixel = (2 * camera.distance * Math.tan(camera.fovY / 2)) / 500;
    camera.panByPixels(10, 0, 500);
    // target should move by -right * 10 * worldPerPixel
    expect(camera.target[0]).toBeCloseTo(-right[0] * 10 * worldPerPixel, 6);
    expect(camera.target[1]).toBeCloseTo(-right[1] * 10 * worldPerPixel, 6);
    expect(camera.target[2]).toBeCloseTo(-right[2] * 10 * worldPerPixel, 6);
  });

  it("produces a view matrix that places the target at -distance", () => {
    const camera = new OrbitCamera();
    camera.target = [0, 0, 0];
    camera.distance = 50;
    const view = camera.viewMatrix(mat4Create());
    const center = mat4TransformPoint(view, [0, 0, 0]);
    expect(center[2]).toBeCloseTo(-50, 4);
  });

  it("keeps right/up/view vectors orthonormal", () => {
    const camera = new OrbitCamera();
    camera.azimuth = 1.234;
    camera.elevation = 0.456;
    const dot = (a: readonly number[], b: readonly number[]): number =>
      a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;

    expect(dot(camera.rightVector(), camera.upVector())).toBeCloseTo(0, 6);
    expect(dot(camera.rightVector(), camera.viewDirection())).toBeCloseTo(0, 6);
    expect(dot(camera.upVector(), camera.viewDirection())).toBeCloseTo(0, 6);
    expect(Math.hypot(...camera.upVector())).toBeCloseTo(1, 6);
  });
});
