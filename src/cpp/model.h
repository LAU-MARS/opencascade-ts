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
