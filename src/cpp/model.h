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
