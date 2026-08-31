/**
 * Orbit camera (Z-up, like CAD): left-drag orbits around `target`,
 * pan moves the target in the view plane, zoom is exponential.
 * Pure math — unit-tested headlessly in Node.
 */

import { mat4LookAt, mat4Multiply, mat4Perspective, type Mat4, type Vec3Tuple } from "./mat4.js";

const ELEVATION_LIMIT = 1.5533; // just under 90°, keeps lookAt non-degenerate
const MIN_DISTANCE_RATIO = 1e-4;

export class OrbitCamera {
  target: Vec3Tuple = [0, 0, 0];
  /** Azimuth around +Z from +X, radians. */
  azimuth = Math.PI / 4;
  /** Elevation above the XY plane, radians. */
  elevation = Math.PI / 5;
  distance = 100;
  /** Vertical field of view, radians. */
  fovY = (45 * Math.PI) / 180;
  /** Radius of the fitted scene; drives near/far planes. */
  radius = 50;

  /** Camera position in world space. */
  eye(): Vec3Tuple {
    const cosE = Math.cos(this.elevation);
    return [
      this.target[0] + this.distance * cosE * Math.cos(this.azimuth),
      this.target[1] + this.distance * cosE * Math.sin(this.azimuth),
      this.target[2] + this.distance * Math.sin(this.elevation),
    ];
  }

  /** Unit vector from target towards the eye. */
  viewDirection(): Vec3Tuple {
    const cosE = Math.cos(this.elevation);
    return normalize([cosE * Math.cos(this.azimuth), cosE * Math.sin(this.azimuth), Math.sin(this.elevation)]);
  }

  /** Unit right/up vectors of the camera frame. */
  rightVector(): Vec3Tuple {
    return normalize([-Math.sin(this.azimuth), Math.cos(this.azimuth), 0]);
  }

  upVector(): Vec3Tuple {
    return cross(this.viewDirection(), this.rightVector());
  }

  /** Drag to orbit: `dAzimuth`/`dElevation` in radians. */
  orbit(dAzimuth: number, dElevation: number): void {
    this.azimuth += dAzimuth;
    this.elevation = Math.max(-ELEVATION_LIMIT, Math.min(ELEVATION_LIMIT, this.elevation + dElevation));
  }

  /** Zoom: `factor` < 1 moves closer, > 1 moves away. */
  zoom(factor: number): void {
    const minDistance = Math.max(this.radius * MIN_DISTANCE_RATIO, 1e-6);
    this.distance = Math.max(minDistance, this.distance * factor);
  }

  /**
   * Pan in view-plane pixels. `viewportHeight` in device pixels converts the
   * pixel delta to world units at the target's depth.
   */
  panByPixels(dx: number, dy: number, viewportHeight: number): void {
    const worldPerPixel = (2 * this.distance * Math.tan(this.fovY / 2)) / Math.max(viewportHeight, 1);
    const right = this.rightVector();
    const up = this.upVector();
    this.target = [
      this.target[0] - right[0] * dx * worldPerPixel + up[0] * dy * worldPerPixel,
      this.target[1] - right[1] * dx * worldPerPixel + up[1] * dy * worldPerPixel,
      this.target[2] - right[2] * dx * worldPerPixel + up[2] * dy * worldPerPixel,
    ];
  }

  /** Frame the given bounds (min/max corners); keeps the current orientation. */
  fit(min: readonly number[], max: readonly number[]): void {
    const center: Vec3Tuple = [
      (min[0]! + max[0]!) / 2,
      (min[1]! + max[1]!) / 2,
      (min[2]! + max[2]!) / 2,
    ];
    const radius =
      Math.max(
        Math.hypot(max[0]! - center[0], max[1]! - center[1], max[2]! - center[2]),
        Math.hypot(min[0]! - center[0], min[1]! - center[1], min[2]! - center[2]),
      ) || 1;
    this.target = center;
    this.radius = radius;
    this.distance = Math.max((radius / Math.sin(this.fovY / 2)) * 1.1, radius * 1e-3);
  }

  nearPlane(): number {
    return Math.max(this.radius * 1e-4, 1e-6);
  }

  farPlane(): number {
    return this.distance + this.radius * 100;
  }

  viewMatrix(out: Mat4): Mat4 {
    const worldUp: Vec3Tuple = Math.abs(this.viewDirection()[2]) > 0.999 ? [0, 1, 0] : [0, 0, 1];
    return mat4LookAt(out, this.eye(), this.target, worldUp);
  }

  projectionMatrix(out: Mat4, aspect: number): Mat4 {
    return mat4Perspective(out, this.fovY, aspect, this.nearPlane(), this.farPlane());
  }

  combinedMatrix(out: Mat4, aspect: number): Mat4 {
    const view = mat4LookAt(new Float32Array(16), this.eye(), this.target, this.worldUp());
    const proj = mat4Perspective(new Float32Array(16), this.fovY, aspect, this.nearPlane(), this.farPlane());
    return mat4Multiply(out, proj, view);
  }

  private worldUp(): Vec3Tuple {
    return Math.abs(this.viewDirection()[2]) > 0.999 ? [0, 1, 0] : [0, 0, 1];
  }
}

function normalize(v: Vec3Tuple): Vec3Tuple {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

function cross(a: Vec3Tuple, b: Vec3Tuple): Vec3Tuple {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
