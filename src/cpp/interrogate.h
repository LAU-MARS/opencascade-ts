#pragma once

#include <string>

#include "occ.h"

// Geometry interrogation: the "agent eyes" — analytic parameters of every
// face/edge, shape distances, section curves, point-in-solid classification.
// All structured answers are JSON strings; TypeScript parses and types them
// (src/ts/interrogate.ts) and adds pure-TS heuristics (hole detection).

struct OccShape;

// Full analytic description of a shape's faces and edges.
// Faces: {surface, area, ...params}; edges: {curve, length, ...params}.
std::string describeGeometry(const OccShape& shape);

// {"distance": d, "points": [[[x,y,z],[x,y,z]], ...]} — up to 8 solutions.
std::string distanceBetween(const OccShape& a, const OccShape& b);

// Intersection curve(s) of the two shapes' surfaces (BRepAlgoAPI_Section).
OccShape sectionOf(const OccShape& a, const OccShape& b);

// "in" | "out" | "on" | "unknown" — against all solids (union semantics).
std::string classifyPointIn(const OccShape& shape, double x, double y, double z);

// B-spline surface description of a Face: degrees, knots, multiplicities and
// the row-major pole grid (rows of constant v) that setBsplinePoles consumes.
// Throws std::runtime_error for non-Face input or non-B-spline surfaces.
std::string describeBsplineSurface(const OccShape& face);
