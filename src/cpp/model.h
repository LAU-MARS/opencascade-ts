#pragma once

#include "occ.h"

// Primitives
OccShape makeBox(double dx, double dy, double dz);
OccShape makeCylinder(double radius, double height,
                      double dx, double dy, double dz,
                      double ox, double oy, double oz);
OccShape makeSphere(double radius, double ox, double oy, double oz);
OccShape makeCone(double radius1, double radius2, double height,
                  double dx, double dy, double dz,
                  double ox, double oy, double oz);
OccShape makeTorus(double majorRadius, double minorRadius,
                   double dx, double dy, double dz,
                   double ox, double oy, double oz);

// Profile wires: the sections/spines for extrude/revolve/loft/sweep.
// makePolygonWire takes flat [x0,y0,z0, x1,y1,z1, …]; `close` loops the wire
// back to the first point. All throw std::runtime_error on failure.
OccShape makeCircleWire(double radius,
                        double nx, double ny, double nz,
                        double ox, double oy, double oz);
OccShape makePolygonWire(const std::vector<double>& coordinates, bool close);
OccShape makeLineWire(double x1, double y1, double z1, double x2, double y2, double z2);
// Arc on the circle (radius, center, plane normal) between circle parameters
// u1 < u2 (radians, counterclockwise around the normal); span must be < 2π.
OccShape makeArcWire(double radius,
                     double nx, double ny, double nz,
                     double ox, double oy, double oz,
                     double u1, double u2);
// Ellipse: major radius along the axis system's in-plane X, minor along Y.
OccShape makeEllipseWire(double majorRadius, double minorRadius,
                         double nx, double ny, double nz,
                         double ox, double oy, double oz);
// B-spline from control points (flat coordinates) with clamped uniform
// knots; degree must satisfy degree < poleCount.
OccShape makeBsplineWire(const std::vector<double>& coordinates, int degree);
// B-spline interpolated through every point (flat coordinates).
OccShape interpolateBsplineWire(const std::vector<double>& coordinates,
                                bool periodic, double tolerance);
// Concatenate connected wires/edges into one wire, in order.
OccShape assembleWire(const std::vector<OccShape>& parts);
// Planar face from an outer wire, with optional hole wires inside it (the
// face-with-holes section for extrude/revolve/loft).
OccShape makeFaceShape(const OccShape& outer, const std::vector<OccShape>& holes);

// Booleans: op 0 = fuse, 1 = cut, 2 = common. Throws std::runtime_error on failure.
OccShape booleanOp(int op, const OccShape& a, const OccShape& b);

// Transforms
OccShape translateShape(const OccShape& shape, double dx, double dy, double dz);
OccShape rotateShape(const OccShape& shape, double ax, double ay, double az, double angleRadians);
OccShape scaleShape(const OccShape& shape, double factor);

// Shelling: hollow the solid with an inward wall of `thickness`; the 1-based
// face indices (as emitted by describeGeometry) in `openFaces` are removed.
// Throws std::runtime_error on failure or bad indices.
OccShape shellShape(const OccShape& shape, double thickness, const std::vector<int>& openFaces);

// Drafting: tilt faces by `angleRadians` (signed) for mold release. Faces
// pivot about the neutral plane through (nx, ny, nz) normal to (dx, dy, dz).
// With autoSelectWalls the faces drafted are the ones running parallel to the
// direction; otherwise the 1-based `faceIndices` are used. Throws on failure.
OccShape draftShape(const OccShape& shape, double angleRadians,
                    double dx, double dy, double dz,
                    double nx, double ny, double nz,
                    const std::vector<int>& faceIndices, bool autoSelectWalls);

// Edge blends. With an empty `edgeIndices` every edge is blended; otherwise
// the 1-based indices (as emitted by describeGeometry) select the subset.
// fillet rounds with `radius`, chamfer bevels `distance` on both sides.
// Throws std::runtime_error on failure or bad indices.
OccShape filletShape(const OccShape& shape, double radius, const std::vector<int>& edgeIndices);
OccShape chamferShape(const OccShape& shape, double distance, const std::vector<int>& edgeIndices);
// Per-edge (and per-position) fillet radii: parallel arrays of 1-based edge
// indices, radii, and positions (NaN = constant radius on that edge; two
// finite positions on one edge blend linearly between them, in the edge's
// curve parameter). Throws std::runtime_error on failure or bad indices.
OccShape variableFilletShape(const OccShape& shape,
                             const std::vector<int>& edgeIndices,
                             const std::vector<double>& radii,
                             const std::vector<double>& positions);

// Sketch → solid. Profiles are planar wires (or faces); wires are capped into
// faces unless `solid` is false, which sweeps the bare wire into a shell.
// revolveShape's angle is radians (2π = full turn); the axis runs through
// (ox, oy, oz) along (ax, ay, az). loftSections blends ≥2 wires/faces; sweep
// transports the profile along the spine wire from its start. All throw on
// failure.
OccShape extrudeShape(const OccShape& profile, double dx, double dy, double dz, bool solid);
OccShape revolveShape(const OccShape& profile,
                      double ax, double ay, double az,
                      double ox, double oy, double oz,
                      double angleRadians, bool solid);
OccShape loftShapes(const std::vector<OccShape>& sections, bool ruled, bool solid);
OccShape sweepShape(const OccShape& profile, const OccShape& spine, bool solid);

// Splitting keeps every piece (unlike cut): the result is a compound of the
// shape's fragments minus the tool volumes. offsetSolid grows (positive) or
// shrinks (negative) the whole solid by `distance`. Both throw on failure.
OccShape splitShape(const OccShape& shape, const std::vector<OccShape>& tools);
OccShape offsetSolid(const OccShape& shape, double distance);
