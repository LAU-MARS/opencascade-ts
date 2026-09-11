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
// back to the first point. Both throw std::runtime_error on failure.
OccShape makeCircleWire(double radius,
                        double nx, double ny, double nz,
                        double ox, double oy, double oz);
OccShape makePolygonWire(const std::vector<double>& coordinates, bool close);

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
