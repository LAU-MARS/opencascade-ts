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
// Helix wire of `radius` around the axis through (ox, oy, oz) along
// (ax, ay, az): rises `pitch` per full turn, ending at `height`.
// `leftHanded` reverses the winding. Throws std::runtime_error on bad input.
OccShape makeHelixWire(double radius, double pitch, double height,
                       double ax, double ay, double az,
                       double ox, double oy, double oz,
                       bool leftHanded);
// Concatenate connected wires/edges into one wire, in order.
OccShape assembleWire(const std::vector<OccShape>& parts);
// Ellipse arc on (R1 ≥ R2, axis system) between ellipse parameters u1 < u2
// (radians, counterclockwise around the normal); span must be < 2π. The
// trimmed Geom_Ellipse stays analytic — no sampled-spline approximation.
OccShape makeEllipseArcWire(double radius1, double radius2,
                            double nx, double ny, double nz,
                            double ox, double oy, double oz,
                            double u1, double u2);
// Bézier wire from control points (flat coordinates, one polynomial segment,
// degree = poleCount - 1); optional positive weights (empty = non-rational).
// 2..25 poles.
OccShape makeBezierWire(const std::vector<double>& coordinates,
                        const std::vector<double>& weights);
// Planar face from an outer wire, with optional hole wires inside it (the
// face-with-holes section for extrude/revolve/loft).
OccShape makeFaceShape(const OccShape& outer, const std::vector<OccShape>& holes);

// 2D offset of a planar wire or face (BRepOffsetAPI_MakeOffset): grows the
// profile outwards for positive `distance` (hole wires shrink correspondingly
// when a face is given). join: 0 = arc (rounded corners), 1 = tangent,
// 2 = intersection (sharp). Throws std::runtime_error on failure.
OccShape offsetWireShape(const OccShape& profile, double distance, int join);

// Project a wire/edge onto a face or shell (BRepProj_Projection), planar
// along the given unit direction ("cylindrical" projection). Result: a wire
// or compound of wires on the target surface. Throws on failure.
OccShape projectShape(const OccShape& shape, const OccShape& target,
                      double dx, double dy, double dz);

// Booleans: op 0 = fuse, 1 = cut, 2 = common. With `clean` the result is
// passed through UnifySameDomain (coplanar faces merge, collinear edges join)
// — what build123d/CadQuery call "clean". Throws std::runtime_error on failure.
OccShape booleanOp(int op, const OccShape& a, const OccShape& b, bool clean);

// Explicit UnifySameDomain pass over any shape (imports, splits, patterns).
OccShape unifySameDomain(const OccShape& shape);

// Compound of one or more shapes — the multi-body container. Copies share the
// inputs' geometry. Throws on empty input.
OccShape makeCompoundShape(const std::vector<OccShape>& shapes);

// Outer boundary wire of a Face (the wire that contains all the others).
// Throws std::runtime_error for non-Face input.
OccShape outerWireOf(const OccShape& face);

// Transforms
OccShape translateShape(const OccShape& shape, double dx, double dy, double dz);
OccShape rotateShape(const OccShape& shape, double ax, double ay, double az, double angleRadians);
OccShape scaleShape(const OccShape& shape, double factor);
// Mirror through the plane through (ox, oy, oz) normal to (dx, dy, dz)
// (mode 0), or about the line through (ox, oy, oz) along (dx, dy, dz)
// (mode 1). Mirrors flip handedness, so the geometry is copied (unlike
// translate/rotate, which reuse it via a location).
OccShape mirrorShape(const OccShape& shape, int mode,
                     double ox, double oy, double oz,
                     double dx, double dy, double dz);

// Patterning: copies at (i·spacingX)·u + (j·spacingY)·v for i < countX,
// j < countY (rectangular) or rotated by k·sweep/count around the axis
// (circular). The original at (0, 0) / angle 0 is included. Results are
// compounds sharing the original's geometry — fuse them to merge. Throws on
// counts < 1 or zero spacing/sweep.
OccShape rectangularPattern(const OccShape& shape, int countX, int countY,
                            double spacingX, double spacingY,
                            double ux, double uy, double uz,
                            double vx, double vy, double vz);
OccShape circularPattern(const OccShape& shape, int count, double sweepRadians,
                         double ax, double ay, double az,
                         double ox, double oy, double oz);

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
// fillet rounds with `radius`; chamfer bevels `distance` on both sides, or
// `distance`/`distance2` legs (NaN distance2 = symmetric) where `distance` is
// measured on the first face adjacent to the edge (indexed-map order).
// Throws std::runtime_error on failure or bad indices.
OccShape filletShape(const OccShape& shape, double radius, const std::vector<int>& edgeIndices);
OccShape chamferShape(const OccShape& shape, double distance, double distance2,
                      const std::vector<int>& edgeIndices);
// Per-edge (and per-position) fillet radii: parallel arrays of 1-based edge
// indices, radii, and positions (NaN = constant radius on that edge; two
// finite positions on one edge blend linearly between them, in the edge's
// curve parameter). Throws std::runtime_error on failure or bad indices.
OccShape variableFilletShape(const OccShape& shape,
                             const std::vector<int>& edgeIndices,
                             const std::vector<double>& radii,
                             const std::vector<double>& positions);
// The same blends driven by edge handles (e.g. from subShapes) — no index
// round-trip, so handles from any extraction path work. Degenerated edges
// are skipped like the "every edge" index path.
OccShape filletEdges(const OccShape& shape, double radius, const std::vector<OccShape>& edges);
OccShape chamferEdges(const OccShape& shape, double distance, double distance2,
                      const std::vector<OccShape>& edges);
OccShape variableFilletEdges(const OccShape& shape,
                             const std::vector<OccShape>& edges,
                             const std::vector<double>& radii,
                             const std::vector<double>& positions);

// Sub-shape handles of one type, in the same deduplicated indexed-map order
// as describeGeometry / countSubShapes / the blend edge indices. Unknown type
// names throw std::runtime_error.
std::vector<OccShape> subShapes(const OccShape& shape, const std::string& typeName);

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
// PipeShell — the controllable sweep: trihedron mode 0 = corrected Frenet
// (default), 1 = Frenet, 2 = fixed binormal (bx, by, bz); transition 0 =
// transformed, 1 = round corner, 2 = right corner where the spine bends.
// `correction` re-orients the profile perpendicular to the spine start.
// Throws on failure.
OccShape pipeShellShape(const OccShape& profile, const OccShape& spine,
                        int mode, double bx, double by, double bz,
                        int transition, bool correction, bool solid);

// B-spline surfaces. `coordinates` is a flat row-major pole/point grid:
// (uCount × vCount) triples, rows running along u. makeBsplineSurfaceShape
// takes control points with clamped uniform knots (degrees per direction);
// interpolateBsplineSurfaceShape passes exactly through every point.
// setBsplineSurfacePolesShape copies the face's B-spline surface and swaps
// in a new pole grid (dimensions must match). All return Faces and throw
// std::runtime_error on bad input.
OccShape makeBsplineSurfaceShape(const std::vector<double>& coordinates,
                                 int uCount, int vCount, int uDegree, int vDegree);
OccShape interpolateBsplineSurfaceShape(const std::vector<double>& coordinates,
                                        int uCount, int vCount);
OccShape setBsplineSurfacePolesShape(const OccShape& face,
                                     const std::vector<double>& coordinates,
                                     int uCount, int vCount);

// Splitting keeps every piece (unlike cut): the result is a compound of the
// shape's fragments minus the tool volumes. offsetSolid grows (positive) or
// shrinks (negative) the whole solid by `distance`. Both throw on failure.
OccShape splitShape(const OccShape& shape, const std::vector<OccShape>& tools);
OccShape offsetSolid(const OccShape& shape, double distance);

// Healing: stitch coincident boundaries (sewing — several shapes assemble
// into one shell) and repair the result (ShapeFix: faces, wires, orientation,
// tolerances). Solids skip sewing — they are closed by construction, and
// sewing would degrade them to shells. Throws on empty input.
OccShape healShapes(const std::vector<OccShape>& shapes,
                    double tolerance, bool sew, bool fix);
