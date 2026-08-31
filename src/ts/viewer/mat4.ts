/** Minimal column-major 4×4 matrix math (WebGL layout). No dependencies. */

export type Mat4 = Float32Array;
export type Vec3Tuple = [number, number, number];

export function mat4Create(): Mat4 {
  const m = new Float32Array(16);
  m[0] = 1;
  m[5] = 1;
  m[10] = 1;
  m[15] = 1;
  return m;
}

export function mat4Identity(out: Mat4): Mat4 {
  out.fill(0);
  out[0] = 1;
  out[5] = 1;
  out[10] = 1;
  out[15] = 1;
  return out;
}

/** out = a · b (column-major; `out` may alias `a` or `b`). */
export function mat4Multiply(out: Mat4, a: Mat4, b: Mat4): Mat4 {
  const t = new Float32Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        sum += a[k * 4 + row]! * b[col * 4 + k]!;
      }
      t[col * 4 + row] = sum;
    }
  }
  out.set(t);
  return out;
}

export function mat4Perspective(
  out: Mat4,
  fovyRadians: number,
  aspect: number,
  near: number,
  far: number,
): Mat4 {
  const f = 1 / Math.tan(fovyRadians / 2);
  const nf = 1 / (near - far);
  out.fill(0);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) * nf;
  out[11] = -1;
  out[14] = 2 * far * near * nf;
  return out;
}

export function mat4LookAt(
  out: Mat4,
  eye: Vec3Tuple,
  center: Vec3Tuple,
  up: Vec3Tuple,
): Mat4 {
  let zx = eye[0] - center[0];
  let zy = eye[1] - center[1];
  let zz = eye[2] - center[2];
  let len = Math.hypot(zx, zy, zz) || 1;
  zx /= len;
  zy /= len;
  zz /= len;

  let xx = up[1] * zz - up[2] * zy;
  let xy = up[2] * zx - up[0] * zz;
  let xz = up[0] * zy - up[1] * zx;
  len = Math.hypot(xx, xy, xz);
  if (len < 1e-12) {
    // up collinear with view direction; nudge
    xx = 1; xy = 0; xz = 0;
    len = Math.hypot(up[1] * zz - up[2] * zy, up[2] * zx - up[0] * zz, up[0] * zy - up[1] * zx);
    if (len < 1e-12) { xx = 0; xy = 1; len = 1; }
  }
  xx /= len; xy /= len; xz /= len;

  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;

  out[0] = xx; out[1] = yx; out[2] = zx; out[3] = 0;
  out[4] = xy; out[5] = yy; out[6] = zy; out[7] = 0;
  out[8] = xz; out[9] = yz; out[10] = zz; out[11] = 0;
  out[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
  out[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
  out[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
  out[15] = 1;
  return out;
}

/** Transform a point (w = 1); useful in tests and pan math. */
export function mat4TransformPoint(m: Mat4, p: readonly number[]): Vec3Tuple {
  const x = p[0] ?? 0;
  const y = p[1] ?? 0;
  const z = p[2] ?? 0;
  const w = m[3]! * x + m[7]! * y + m[11]! * z + m[15]! || 1;
  return [
    (m[0]! * x + m[4]! * y + m[8]! * z + m[12]!) / w,
    (m[1]! * x + m[5]! * y + m[9]! * z + m[13]!) / w,
    (m[2]! * x + m[6]! * y + m[10]! * z + m[14]!) / w,
  ];
}
