/** GLSL ES 3.00 shaders. Lighting happens in world space with fixed lights. */

export const MESH_VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;

uniform mat4 uMvp;

out vec3 vWorldPosition;
out vec3 vNormal;

void main() {
  gl_Position = uMvp * vec4(aPosition, 1.0);
  vWorldPosition = aPosition;  // no model transform: geometry is already in world space
  vNormal = aNormal;
}
`;

export const MESH_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec3 vWorldPosition;
in vec3 vNormal;

uniform vec3 uColor;
uniform float uOpacity;
uniform vec3 uEye;

out vec4 outColor;

void main() {
  vec3 n = normalize(vNormal);
  vec3 viewDir = normalize(uEye - vWorldPosition);

  // Fallback for zero normals (degenerate fans): flat normal from derivatives.
  if (length(n) < 0.5) {
    vec3 derived = cross(dFdx(vWorldPosition), dFdy(vWorldPosition));
    float len = length(derived);
    if (len > 1e-12) {
      n = derived / len;
    } else {
      n = viewDir;
    }
  }
  if (dot(n, viewDir) < 0.0) n = -n;  // double-sided shading

  const vec3 LIGHT1 = normalize(vec3(0.35, 0.25, 0.9));
  const vec3 LIGHT2 = normalize(vec3(-0.6, -0.4, 0.25));

  float diffuse = max(dot(n, LIGHT1), 0.0) * 0.75 + max(dot(n, LIGHT2), 0.0) * 0.35;
  vec3 halfway = normalize(LIGHT1 + viewDir);
  float specular = pow(max(dot(n, halfway), 0.0), 32.0) * 0.25;

  vec3 color = uColor * (0.28 + diffuse) + vec3(specular);
  outColor = vec4(color, uOpacity);
}
`;

export const LINE_VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec3 aPosition;
layout(location = 1) in float aDistance;

uniform mat4 uMvp;

out float vDistance;

void main() {
  gl_Position = uMvp * vec4(aPosition, 1.0);
  vDistance = aDistance;
}
`;

export const LINE_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in float vDistance;

uniform vec4 uColor;
// uDash: total dash period in world units; uDashOn: visible part of it.
// uDash <= 0 draws solid lines.
uniform float uDash;
uniform float uDashOn;

out vec4 outColor;

void main() {
  if (uDash > 0.0 && mod(vDistance, uDash) > uDashOn) {
    discard;
  }
  outColor = uColor;
}
`;
