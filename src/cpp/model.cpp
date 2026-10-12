#include "model.h"

#include "occ.h"

#include <BRepAdaptor_Curve.hxx>
#include <BRepAdaptor_Surface.hxx>
#include <BRepAlgoAPI_Common.hxx>
#include <BRepAlgoAPI_Cut.hxx>
#include <BRepAlgoAPI_Fuse.hxx>
#include <BRepAlgoAPI_Splitter.hxx>
#include <BRepBndLib.hxx>
#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepBuilderAPI_MakeWire.hxx>
#include <BRepBuilderAPI_Sewing.hxx>
#include <BRepBuilderAPI_Transform.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepFilletAPI_MakeChamfer.hxx>
#include <BRepFilletAPI_MakeFillet.hxx>
#include <BRepGProp.hxx>
#include <BRepOffsetAPI_DraftAngle.hxx>
#include <BRepOffsetAPI_MakeOffsetShape.hxx>
#include <BRepOffsetAPI_MakeOffset.hxx>
#include <BRepOffsetAPI_MakePipe.hxx>
#include <BRepOffsetAPI_MakePipeShell.hxx>
#include <BRepOffsetAPI_MakeThickSolid.hxx>
#include <BRepOffsetAPI_ThruSections.hxx>
#include <BRepOffset_Mode.hxx>
#include <GeomAbs_JoinType.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakeCone.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRepPrimAPI_MakePrism.hxx>
#include <BRepPrimAPI_MakeRevol.hxx>
#include <BRepPrimAPI_MakeSphere.hxx>
#include <BRepPrimAPI_MakeTorus.hxx>
#include <BRepLib_MakeWire.hxx>
#include <BRepLib.hxx>
#include <BRepTools.hxx>
#include <BRep_Builder.hxx>
#include <BRep_Tool.hxx>
#include <Bnd_Box.hxx>
#include <GCE2d_MakeSegment.hxx>
#include <GProp_GProps.hxx>
#include <Geom2d_TrimmedCurve.hxx>
#include <GeomAbs_SurfaceType.hxx>
#include <Geom_BezierCurve.hxx>
#include <Geom_BSplineCurve.hxx>
#include <Geom_BSplineSurface.hxx>
#include <Geom_Ellipse.hxx>
#include <Geom_TrimmedCurve.hxx>
#include <GeomAPI_Interpolate.hxx>
#include <GeomAPI_PointsToBSplineSurface.hxx>
#include <Geom_CylindricalSurface.hxx>
#include <BRepProj_Projection.hxx>
#include <ShapeFix_Shape.hxx>
#include <ShapeUpgrade_UnifySameDomain.hxx>
#include <Standard_Version.hxx>
#include <TColStd_Array1OfInteger.hxx>
#include <TColStd_Array1OfReal.hxx>
#include <TColgp_Array1OfPnt.hxx>
#include <TColgp_Array2OfPnt.hxx>
#include <TColgp_HArray1OfPnt.hxx>
#include <TopAbs_ShapeEnum.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Compound.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Wire.hxx>
#include <gp_Circ.hxx>
#include <TopTools_IndexedDataMapOfShapeListOfShape.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopTools_ListOfShape.hxx>
#include <gp_Ax1.hxx>
#include <gp_Ax2.hxx>
#include <gp_Dir.hxx>
#include <gp_Elips.hxx>
#include <gp_Pln.hxx>
#include <gp_Pnt2d.hxx>
#include <gp_Pnt.hxx>
#include <gp_Trsf.hxx>
#include <gp_Vec.hxx>

#include <cmath>
#include <algorithm>
#include <map>
#include <sstream>
#include <stdexcept>
#include <utility>

std::string shapeTypeName(const TopoDS_Shape& shape) {
  switch (shape.ShapeType()) {
    case TopAbs_COMPOUND:  return "Compound";
    case TopAbs_COMPSOLID: return "CompSolid";
    case TopAbs_SOLID:     return "Solid";
    case TopAbs_SHELL:     return "Shell";
    case TopAbs_FACE:      return "Face";
    case TopAbs_WIRE:      return "Wire";
    case TopAbs_EDGE:      return "Edge";
    case TopAbs_VERTEX:    return "Vertex";
    default:               return "Shape";
  }
}

double OccShape::volume() const {
  GProp_GProps props;
  BRepGProp::VolumeProperties(myShape, props);
  return props.Mass();
}

double OccShape::area() const {
  GProp_GProps props;
  BRepGProp::SurfaceProperties(myShape, props);
  return props.Mass();
}

std::vector<double> OccShape::bounds() const {
  Bnd_Box box;
  // AddOptimal measures the underlying geometry (Add would pad by the
  // control-point envelope: a torus (20, 5) would report ±27.06, not ±25).
  // Triangulations are ignored so bounds stay deterministic regardless of
  // tessellation history.
  BRepBndLib::AddOptimal(myShape, box, false, false);
  std::vector<double> out(6, 0.0);
  if (!box.IsVoid()) {
    box.Get(out[0], out[1], out[2], out[3], out[4], out[5]);
  }
  return out;
}

std::vector<double> OccShape::centroid() const {
  GProp_GProps props;
  // Volume-weighted for solids, the surface integral for shells, the curve
  // integral for bare wires (a circle's centroid is its center).
  if (countSubShapes("Solid") > 0) {
    BRepGProp::VolumeProperties(myShape, props);
  } else if (countSubShapes("Face") > 0) {
    BRepGProp::SurfaceProperties(myShape, props);
  } else {
    BRepGProp::LinearProperties(myShape, props);
  }
  const gp_Pnt& center = props.CentreOfMass();
  return {center.X(), center.Y(), center.Z()};
}

bool OccShape::isValid() const {
  if (myShape.IsNull()) return false;
  return BRepCheck_Analyzer(myShape).IsValid();
}

namespace {

// Shared name → enum mapping for countSubShapes / subShapes.
bool shapeEnumFromName(const std::string& typeName, TopAbs_ShapeEnum& type) {
  if      (typeName == "Compound")  { type = TopAbs_COMPOUND;  return true; }
  else if (typeName == "CompSolid") { type = TopAbs_COMPSOLID; return true; }
  else if (typeName == "Solid")     { type = TopAbs_SOLID;     return true; }
  else if (typeName == "Shell")     { type = TopAbs_SHELL;     return true; }
  else if (typeName == "Face")      { type = TopAbs_FACE;      return true; }
  else if (typeName == "Wire")      { type = TopAbs_WIRE;      return true; }
  else if (typeName == "Edge")      { type = TopAbs_EDGE;      return true; }
  else if (typeName == "Vertex")    { type = TopAbs_VERTEX;    return true; }
  return false;
}

} // namespace

int OccShape::countSubShapes(const std::string& typeName) const {
  TopAbs_ShapeEnum type;
  if (!shapeEnumFromName(typeName, type)) return 0;

  // TopExp_Explorer visits shared edges/vertices once per adjacent parent;
  // the indexed map deduplicates (the 12-edges-of-a-box test).
  TopTools_IndexedMapOfShape map;
  TopExp::MapShapes(myShape, type, map);
  return map.Extent();
}

bool OccShape::isSame(const OccShape& other) const {
  return myShape.IsSame(other.myShape);
}

std::vector<OccShape> subShapes(const OccShape& shape, const std::string& typeName) {
  TopAbs_ShapeEnum type;
  if (!shapeEnumFromName(typeName, type)) {
    throw std::runtime_error(
        "subShapes: unknown type \"" + typeName +
        "\" — expected Compound, CompSolid, Solid, Shell, Face, Wire, Edge or Vertex");
  }
  // The same indexed map countSubShapes uses, so the handles come out in the
  // exact order describeGeometry numbers them and the blend indices select
  // them — subShapes(box, "Edge")[i] IS edge i+1.
  TopTools_IndexedMapOfShape map;
  TopExp::MapShapes(shape.get(), type, map);
  std::vector<OccShape> out;
  out.reserve(map.Extent());
  for (int i = 1; i <= map.Extent(); ++i) {
    out.push_back(OccShape(map(i)));
  }
  return out;
}

// --- primitives -------------------------------------------------------------

namespace {

gp_Ax2 makeAxis(double ox, double oy, double oz,
                double dx, double dy, double dz) {
  return gp_Ax2(gp_Pnt(ox, oy, oz), gp_Dir(dx, dy, dz));
}

const double TWO_PI = 6.28318530717958647692;

} // namespace

OccShape makeBox(double dx, double dy, double dz) {
  return OccShape(BRepPrimAPI_MakeBox(dx, dy, dz).Shape());
}

OccShape makeCylinder(double radius, double height,
                      double dx, double dy, double dz,
                      double ox, double oy, double oz) {
  return OccShape(
      BRepPrimAPI_MakeCylinder(makeAxis(ox, oy, oz, dx, dy, dz), radius, height).Shape());
}

OccShape makeSphere(double radius, double ox, double oy, double oz) {
  return OccShape(BRepPrimAPI_MakeSphere(gp_Pnt(ox, oy, oz), radius).Shape());
}

OccShape makeCone(double radius1, double radius2, double height,
                  double dx, double dy, double dz,
                  double ox, double oy, double oz) {
  return OccShape(
      BRepPrimAPI_MakeCone(makeAxis(ox, oy, oz, dx, dy, dz), radius1, radius2, height).Shape());
}

OccShape makeTorus(double majorRadius, double minorRadius,
                   double dx, double dy, double dz,
                   double ox, double oy, double oz) {
  return OccShape(
      BRepPrimAPI_MakeTorus(makeAxis(ox, oy, oz, dx, dy, dz), majorRadius, minorRadius).Shape());
}

// --- profile wires -------------------------------------------------------------
//
// extrude/revolve/loft/sweep consume wires or faces; these constructors are
// the wire source. Everything stays a Wire here so the same circle can serve
// as a loft section, a sweep spine, or a solid cap (via the sweep ops).

OccShape makeCircleWire(double radius,
                        double nx, double ny, double nz,
                        double ox, double oy, double oz) {
  BRepBuilderAPI_MakeEdge edge(gp_Circ(makeAxis(ox, oy, oz, nx, ny, nz), radius));
  BRepBuilderAPI_MakeWire maker(edge.Edge());
  if (!edge.IsDone() || !maker.IsDone() || maker.Wire().IsNull()) {
    throw std::runtime_error("circle construction failed");
  }
  return OccShape(maker.Wire());
}

OccShape makePolygonWire(const std::vector<double>& coordinates, bool close) {
  // coordinates is flat [x0,y0,z0, x1,y1,z1, …].
  BRepBuilderAPI_MakePolygon maker;
  for (size_t i = 0; i + 2 < coordinates.size(); i += 3) {
    maker.Add(gp_Pnt(coordinates[i], coordinates[i + 1], coordinates[i + 2]));
  }
  if (close) maker.Close();
  if (!maker.IsDone() || maker.Wire().IsNull()) {
    throw std::runtime_error(
        "polygon construction failed (needs at least 2 distinct points, 3 when closed)");
  }
  return OccShape(maker.Wire());
}

OccShape makeLineWire(double x1, double y1, double z1, double x2, double y2, double z2) {
  BRepBuilderAPI_MakeEdge edge(gp_Pnt(x1, y1, z1), gp_Pnt(x2, y2, z2));
  BRepBuilderAPI_MakeWire maker(edge.Edge());
  if (!edge.IsDone() || !maker.IsDone() || maker.Wire().IsNull()) {
    throw std::runtime_error("line construction failed (points must be distinct)");
  }
  return OccShape(maker.Wire());
}

OccShape makeArcWire(double radius,
                     double nx, double ny, double nz,
                     double ox, double oy, double oz,
                     double u1, double u2) {
  // Circle parameters run counterclockwise around the axis (right-hand rule).
  BRepBuilderAPI_MakeEdge edge(gp_Circ(makeAxis(ox, oy, oz, nx, ny, nz), radius), u1, u2);
  BRepBuilderAPI_MakeWire maker(edge.Edge());
  if (!edge.IsDone() || !maker.IsDone() || maker.Wire().IsNull()) {
    throw std::runtime_error("arc construction failed (span must be under 360°)");
  }
  return OccShape(maker.Wire());
}

OccShape makeEllipseWire(double majorRadius, double minorRadius,
                         double nx, double ny, double nz,
                         double ox, double oy, double oz) {
  // gp_Elips puts the major radius along the axis system's X direction.
  gp_Elips ellipse(makeAxis(ox, oy, oz, nx, ny, nz), majorRadius, minorRadius);
  BRepBuilderAPI_MakeEdge edge(ellipse);
  BRepBuilderAPI_MakeWire maker(edge.Edge());
  if (!edge.IsDone() || !maker.IsDone() || maker.Wire().IsNull()) {
    throw std::runtime_error("ellipse construction failed");
  }
  return OccShape(maker.Wire());
}

OccShape makeBsplineWire(const std::vector<double>& coordinates, int degree) {
  const int poleCount = static_cast<int>(coordinates.size() / 3);
  if (poleCount < 2) throw std::runtime_error("bspline needs at least 2 poles");
  if (degree < 1) throw std::runtime_error("bspline degree must be at least 1");
  if (poleCount <= degree) {
    std::ostringstream message;
    message << "bspline needs at least degree + 1 poles (" << degree + 1 << ") — lower the degree";
    throw std::runtime_error(message.str());
  }
  TColgp_Array1OfPnt poles(1, poleCount);
  for (int i = 0; i < poleCount; ++i) {
    poles.SetValue(i + 1, gp_Pnt(coordinates[i * 3], coordinates[i * 3 + 1], coordinates[i * 3 + 2]));
  }
  // Clamped uniform knots [0, 1, …, n-d]: ends at multiplicity degree + 1 so
  // the curve passes through the first and last pole.
  const int knotCount = poleCount - degree + 1;
  TColStd_Array1OfReal knots(1, knotCount);
  TColStd_Array1OfInteger multiplicities(1, knotCount);
  for (int k = 1; k <= knotCount; ++k) {
    knots.SetValue(k, k - 1);
    multiplicities.SetValue(k, 1);
  }
  multiplicities.SetValue(1, degree + 1);
  multiplicities.SetValue(knotCount, degree + 1);
  Handle(Geom_BSplineCurve) curve =
      new Geom_BSplineCurve(poles, knots, multiplicities, degree, false);
  BRepBuilderAPI_MakeEdge edge(curve);
  BRepBuilderAPI_MakeWire maker(edge.Edge());
  if (!edge.IsDone() || !maker.IsDone() || maker.Wire().IsNull()) {
    throw std::runtime_error("bspline construction failed");
  }
  return OccShape(maker.Wire());
}

OccShape interpolateBsplineWire(const std::vector<double>& coordinates,
                                bool periodic, double tolerance) {
  const int pointCount = static_cast<int>(coordinates.size() / 3);
  if (pointCount < 2) throw std::runtime_error("interpolation needs at least 2 points");
  if (periodic && pointCount < 3) {
    throw std::runtime_error("periodic interpolation needs at least 3 points");
  }
  Handle(TColgp_HArray1OfPnt) points = new TColgp_HArray1OfPnt(1, pointCount);
  for (int i = 0; i < pointCount; ++i) {
    points->SetValue(i + 1, gp_Pnt(coordinates[i * 3], coordinates[i * 3 + 1], coordinates[i * 3 + 2]));
  }
  GeomAPI_Interpolate interpolator(points, periodic, tolerance);
  // The constructors only stage constraints; Perform computes the curve (and
  // Curve() before Perform throws an empty-message failure).
  interpolator.Perform();
  if (!interpolator.IsDone()) throw std::runtime_error("interpolation failed");
  Handle(Geom_BSplineCurve) curve = interpolator.Curve();
  if (curve.IsNull()) throw std::runtime_error("interpolation failed");
  BRepBuilderAPI_MakeEdge edge(curve);
  BRepBuilderAPI_MakeWire maker(edge.Edge());
  if (!edge.IsDone() || !maker.IsDone() || maker.Wire().IsNull()) {
    throw std::runtime_error("interpolation failed");
  }
  return OccShape(maker.Wire());
}

OccShape makeHelixWire(double radius, double pitch, double height,
                       double ax, double ay, double az,
                       double ox, double oy, double oz,
                       bool leftHanded) {
  if (!(radius > 0)) throw std::runtime_error("helix: radius must be positive");
  if (!(pitch > 0)) throw std::runtime_error("helix: pitch must be positive");
  if (!(height > 0)) throw std::runtime_error("helix: height must be positive");
  // There is no helix primitive in OCCT — the standard recipe is a straight
  // line in the cylinder's (u, v) parameter space: u advances 2π per turn,
  // v climbs one pitch per turn.
  Handle(Geom_CylindricalSurface) cylinder =
      new Geom_CylindricalSurface(makeAxis(ox, oy, oz, ax, ay, az), radius);
  const double turns = height / pitch;
  const double uEnd = (leftHanded ? -1.0 : 1.0) * turns * TWO_PI;
  GCE2d_MakeSegment segment(gp_Pnt2d(0.0, 0.0), gp_Pnt2d(uEnd, height));
  if (!segment.IsDone()) throw std::runtime_error("helix construction failed");
  // The (pcurve, surface) MakeEdge overload builds the 3D curve itself and
  // takes the trimmed curve's full range — exactly the segment above.
  BRepBuilderAPI_MakeEdge edge(segment.Value(), cylinder);
  BRepBuilderAPI_MakeWire maker(edge.Edge());
  if (!edge.IsDone() || !maker.IsDone() || maker.Wire().IsNull()) {
    throw std::runtime_error("helix construction failed");
  }
  // The pcurve edge carries no 3D curve the sweep algorithms can walk —
  // approximate one (a C1 B-spline well under model tolerances).
  if (!BRepLib::BuildCurves3d(maker.Wire(), 1e-6)) {
    throw std::runtime_error("helix construction failed (no 3D curve)");
  }
  return OccShape(maker.Wire());
}

OccShape assembleWire(const std::vector<OccShape>& parts) {
  if (parts.size() < 2) {
    throw std::runtime_error("wire assembly needs at least 2 parts");
  }
  // BRepLib (not BuilderAPI) MakeWire reports per-part connectivity: a
  // disconnected Add leaves the maker in the DisconnectedWire error state.
  BRepLib_MakeWire maker;
  for (size_t i = 0; i < parts.size(); ++i) {
    const TopoDS_Shape& part = parts[i].get();
    if (part.ShapeType() == TopAbs_WIRE) {
      maker.Add(TopoDS::Wire(part));
    } else if (part.ShapeType() == TopAbs_EDGE) {
      maker.Add(TopoDS::Edge(part));
    } else {
      throw std::runtime_error(
          "wire assembly: parts must be Wires or Edges (e.g. makeArc / makeLine output)");
    }
    if (!maker.IsDone()) {
      std::ostringstream message;
      message << "wire assembly: part " << (i + 1) << " does not connect to the chain";
      throw std::runtime_error(message.str());
    }
  }
  if (!maker.IsDone() || maker.Wire().IsNull()) {
    throw std::runtime_error("wire assembly failed");
  }
  return OccShape(maker.Wire());
}

OccShape makeEllipseArcWire(double radius1, double radius2,
                            double nx, double ny, double nz,
                            double ox, double oy, double oz,
                            double u1, double u2) {
  if (radius1 < radius2) {
    throw std::runtime_error("ellipse arc: major radius must be at least the minor radius (swap them?)");
  }
  if (!(u2 > u1)) {
    throw std::runtime_error("ellipse arc: u2 must be greater than u1");
  }
  if (u2 - u1 >= TWO_PI) {
    throw std::runtime_error("ellipse arc: span must be under 360° — use makeEllipse for the full ellipse");
  }
  // Trim the analytic Geom_Ellipse instead of approximating: the edge stays a
  // conic (describe reports "ellipse"), so edits and measurements are exact.
  Handle(Geom_Ellipse) ellipse =
      new Geom_Ellipse(gp_Elips(makeAxis(ox, oy, oz, nx, ny, nz), radius1, radius2));
  Handle(Geom_TrimmedCurve) trimmed = new Geom_TrimmedCurve(ellipse, u1, u2);
  BRepBuilderAPI_MakeEdge edge(trimmed);
  BRepBuilderAPI_MakeWire maker(edge.Edge());
  if (!edge.IsDone() || !maker.IsDone() || maker.Wire().IsNull()) {
    throw std::runtime_error("ellipse arc construction failed");
  }
  return OccShape(maker.Wire());
}

OccShape makeBezierWire(const std::vector<double>& coordinates,
                        const std::vector<double>& weights) {
  const int poleCount = static_cast<int>(coordinates.size() / 3);
  if (poleCount < 2) throw std::runtime_error("bezier needs at least 2 poles");
  // OCCT caps Bézier curves at degree 25
  if (poleCount > 26) {
    throw std::runtime_error("bezier supports at most 26 poles (degree 25)");
  }
  if (!weights.empty() && static_cast<int>(weights.size()) != poleCount) {
    throw std::runtime_error("bezier: weights must match the pole count");
  }
  TColgp_Array1OfPnt poles(1, poleCount);
  for (int i = 0; i < poleCount; ++i) {
    poles.SetValue(i + 1, gp_Pnt(coordinates[i * 3], coordinates[i * 3 + 1], coordinates[i * 3 + 2]));
  }
  Handle(Geom_BezierCurve) curve;
  if (weights.empty()) {
    curve = new Geom_BezierCurve(poles);
  } else {
    TColStd_Array1OfReal weightArray(1, poleCount);
    for (int i = 0; i < poleCount; ++i) {
      if (!(weights[i] > 0)) {
        throw std::runtime_error("bezier: weights must be positive");
      }
      weightArray.SetValue(i + 1, weights[i]);
    }
    curve = new Geom_BezierCurve(poles, weightArray);
  }
  BRepBuilderAPI_MakeEdge edge(curve);
  BRepBuilderAPI_MakeWire maker(edge.Edge());
  if (!edge.IsDone() || !maker.IsDone() || maker.Wire().IsNull()) {
    throw std::runtime_error("bezier construction failed");
  }
  return OccShape(maker.Wire());
}

OccShape offsetWireShape(const OccShape& profile, double distance, int join) {
  if (distance == 0) {
    throw std::runtime_error("offsetWire: distance must be non-zero");
  }
  const GeomAbs_JoinType joinType =
      join == 1 ? GeomAbs_Tangent : join == 2 ? GeomAbs_Intersection : GeomAbs_Arc;
  const TopoDS_Shape& shape = profile.get();
  // wires enter through the constructor (Init has no wire overload)
  TopoDS_Shape result;
  if (shape.ShapeType() == TopAbs_FACE) {
    // Face-based Perform() crashes inside OCCT for negative offsets on faces
    // with holes — offset each boundary wire instead. Holes are stored
    // reversed, so the SAME signed distance moves every boundary along the
    // material normal: positive grows the part, negative eats into it.
    const TopoDS_Face face = TopoDS::Face(shape);
    TopTools_IndexedMapOfShape wireMap;
    TopExp::MapShapes(face, TopAbs_WIRE, wireMap);
    TopoDS_Compound compound;
    BRep_Builder builder;
    builder.MakeCompound(compound);
    for (int i = 1; i <= wireMap.Extent(); ++i) {
      BRepOffsetAPI_MakeOffset maker(TopoDS::Wire(wireMap(i)), joinType);
      maker.Perform(distance);
      if (maker.Shape().IsNull()) {
        throw std::runtime_error("2D offset failed (distance too large for the profile?)");
      }
      builder.Add(compound, maker.Shape());
    }
    result = compound;
  } else if (shape.ShapeType() == TopAbs_WIRE) {
    BRepOffsetAPI_MakeOffset maker(TopoDS::Wire(shape), joinType);
    maker.Perform(distance);
    result = maker.Shape();
  } else {
    throw std::runtime_error("offsetWire: expected a Wire or Face profile (e.g. makeCircle / makeFace output)");
  }
  if (result.IsNull()) {
    throw std::runtime_error("2D offset failed (distance too large for the profile?)");
  }
  return OccShape(result);
}

// Project a wire/edge onto a face or shell (BRepProj_Projection), planar
// along the given unit direction ("cylindrical" projection). Throws on failure.
OccShape projectShape(const OccShape& shape, const OccShape& target,
                      double dx, double dy, double dz) {
  const TopoDS_Shape& wire = shape.get();
  const TopoDS_Shape& surface = target.get();
  if (wire.ShapeType() != TopAbs_WIRE && wire.ShapeType() != TopAbs_EDGE) {
    throw std::runtime_error("project: expected a Wire or Edge to project (e.g. makeCircle / makeWire output)");
  }
  if (surface.ShapeType() != TopAbs_FACE && surface.ShapeType() != TopAbs_SHELL) {
    throw std::runtime_error("project: target must be a Face or Shell (e.g. faces(shape) or makeFace output)");
  }
  BRepProj_Projection projection(wire, surface, gp_Dir(dx, dy, dz));
  if (!projection.IsDone()) {
    throw std::runtime_error("projection failed (curve does not land on the surface?)");
  }
  const TopoDS_Shape result = projection.Shape();
  if (result.IsNull()) {
    throw std::runtime_error("projection produced no result (curve does not land on the surface?)");
  }
  return OccShape(result);
}

OccShape makeFaceShape(const OccShape& outer, const std::vector<OccShape>& holes) {
  if (outer.get().ShapeType() != TopAbs_WIRE) {
    throw std::runtime_error(
        "makeFace: the outer boundary must be a Wire (e.g. makeCircle / makeWire output)");
  }
  BRepBuilderAPI_MakeFace maker(TopoDS::Wire(outer.get()));
  if (!maker.IsDone() || maker.Face().IsNull()) {
    throw std::runtime_error("makeFace: the outer wire is not planar");
  }
  for (size_t i = 0; i < holes.size(); ++i) {
    if (holes[i].get().ShapeType() != TopAbs_WIRE) {
      throw std::runtime_error("makeFace: holes must be Wires (e.g. makeCircle output)");
    }
    // Inner boundaries run opposite to the outer one — circle constructors are
    // all counterclockwise, so holes are reversed by default.
    TopoDS_Wire hole = TopoDS::Wire(holes[i].get());
    hole.Reverse();
    maker.Add(hole);
    if (!maker.IsDone()) {
      std::ostringstream message;
      message << "makeFace: hole " << (i + 1) << " could not be added (outside the boundary?)";
      throw std::runtime_error(message.str());
    }
  }
  return OccShape(maker.Face());
}

// --- booleans ---------------------------------------------------------------

namespace {

// Merge the coplanar faces and collinear edges booleans leave behind —
// what build123d/CadQuery call "clean". A null result falls back to the raw
// shape: unification must never lose geometry.
TopoDS_Shape unifyCleaned(const TopoDS_Shape& shape) {
  ShapeUpgrade_UnifySameDomain unifier(shape, true, true, false);
  unifier.Build();
  const TopoDS_Shape unified = unifier.Shape();
  return unified.IsNull() ? shape : unified;
}

} // namespace

OccShape booleanOp(int op, const OccShape& a, const OccShape& b, bool clean) {
  // op: 0 = fuse (union), 1 = cut (difference), 2 = common (intersection)
  TopoDS_Shape result;
  if (op == 0) {
    BRepAlgoAPI_Fuse algo(a.get(), b.get());
    algo.SetRunParallel(false);
    algo.Build();
    if (!algo.IsDone()) throw std::runtime_error("boolean fuse failed");
    result = algo.Shape();
  } else if (op == 1) {
    BRepAlgoAPI_Cut algo(a.get(), b.get());
    algo.SetRunParallel(false);
    algo.Build();
    if (!algo.IsDone()) throw std::runtime_error("boolean cut failed");
    result = algo.Shape();
  } else {
    BRepAlgoAPI_Common algo(a.get(), b.get());
    algo.SetRunParallel(false);
    algo.Build();
    if (!algo.IsDone()) throw std::runtime_error("boolean common failed");
    result = algo.Shape();
  }
  if (result.IsNull()) throw std::runtime_error("boolean operation produced an empty result");
  if (clean) result = unifyCleaned(result);
  return OccShape(result);
}

OccShape unifySameDomain(const OccShape& shape) {
  if (shape.get().IsNull()) throw std::runtime_error("unify: null shape");
  return OccShape(unifyCleaned(shape.get()));
}

// --- compound ------------------------------------------------------------------

OccShape makeCompoundShape(const std::vector<OccShape>& shapes) {
  if (shapes.empty()) {
    throw std::runtime_error("compound: needs at least one shape");
  }
  TopoDS_Compound compound;
  BRep_Builder builder;
  builder.MakeCompound(compound);
  for (const OccShape& shape : shapes) {
    builder.Add(compound, shape.get());
  }
  return OccShape(compound);
}

OccShape outerWireOf(const OccShape& face) {
  if (face.get().ShapeType() != TopAbs_FACE) {
    throw std::runtime_error(
        "faceWires: expected a Face (e.g. from faces(shape) or makeFace)");
  }
  return OccShape(BRepTools::OuterWire(TopoDS::Face(face.get())));
}

// --- transforms -------------------------------------------------------------

OccShape translateShape(const OccShape& shape, double dx, double dy, double dz) {
  gp_Trsf trsf;
  trsf.SetTranslation(gp_Vec(dx, dy, dz));
  return OccShape(BRepBuilderAPI_Transform(shape.get(), trsf, false).Shape());
}

OccShape rotateShape(const OccShape& shape,
                     double ax, double ay, double az, double angleRadians) {
  gp_Trsf trsf;
  trsf.SetRotation(gp_Ax1(gp_Pnt(0, 0, 0), gp_Dir(ax, ay, az)), angleRadians);
  return OccShape(BRepBuilderAPI_Transform(shape.get(), trsf, false).Shape());
}

OccShape scaleShape(const OccShape& shape, double factor) {
  gp_Trsf trsf;
  trsf.SetScaleFactor(factor);
  return OccShape(BRepBuilderAPI_Transform(shape.get(), trsf, true).Shape());
}

OccShape mirrorShape(const OccShape& shape, int mode,
                     double ox, double oy, double oz,
                     double dx, double dy, double dz) {
  gp_Trsf trsf;
  if (mode == 0) {
    trsf.SetMirror(gp_Ax2(gp_Pnt(ox, oy, oz), gp_Dir(dx, dy, dz)));
  } else {
    trsf.SetMirror(gp_Ax1(gp_Pnt(ox, oy, oz), gp_Dir(dx, dy, dz)));
  }
  return OccShape(BRepBuilderAPI_Transform(shape.get(), trsf, true).Shape());
}

// --- patterning -----------------------------------------------------------------

namespace {

// Copies share the original's geometry through locations (pure translations
// and rotations are direct isometries — nothing needs to be copied).
void addPatternCopies(TopoDS_Compound& compound, BRep_Builder& builder,
                      const TopoDS_Shape& original, const std::vector<gp_Trsf>& placements) {
  for (const gp_Trsf& placement : placements) {
    builder.Add(compound, original.Moved(placement));
  }
}

} // namespace

OccShape rectangularPattern(const OccShape& shape, int countX, int countY,
                            double spacingX, double spacingY,
                            double ux, double uy, double uz,
                            double vx, double vy, double vz) {
  if (countX < 1 || countY < 1) {
    throw std::runtime_error("pattern: counts must be at least 1");
  }
  if (spacingX == 0 || spacingY == 0) {
    throw std::runtime_error("pattern: spacing must be non-zero");
  }
  const gp_Vec directionU(ux, uy, uz), directionV(vx, vy, vz);
  std::vector<gp_Trsf> placements;
  for (int j = 0; j < countY; ++j) {
    for (int i = 0; i < countX; ++i) {
      gp_Trsf trsf;
      trsf.SetTranslation(directionU * (spacingX * i) + directionV * (spacingY * j));
      placements.push_back(trsf);
    }
  }
  TopoDS_Compound compound;
  BRep_Builder builder;
  builder.MakeCompound(compound);
  addPatternCopies(compound, builder, shape.get(), placements);
  return OccShape(compound);
}

OccShape circularPattern(const OccShape& shape, int count, double sweepRadians,
                         double ax, double ay, double az,
                         double ox, double oy, double oz) {
  if (count < 1) {
    throw std::runtime_error("pattern: count must be at least 1");
  }
  if (!(sweepRadians > 0)) {
    throw std::runtime_error("pattern: sweepDegrees must be positive");
  }
  const gp_Ax1 axis(gp_Pnt(ox, oy, oz), gp_Dir(ax, ay, az));
  std::vector<gp_Trsf> placements;
  for (int k = 0; k < count; ++k) {
    gp_Trsf trsf;
    trsf.SetRotation(axis, sweepRadians * k / count);
    placements.push_back(trsf);
  }
  TopoDS_Compound compound;
  BRep_Builder builder;
  builder.MakeCompound(compound);
  addPatternCopies(compound, builder, shape.get(), placements);
  return OccShape(compound);
}

// --- shelling & drafting ------------------------------------------------------

namespace {

// Face indices are 1-based and follow describeGeometry's numbering
// (TopExp::MapShapes over an indexed map), so `describe()` output feeds
// straight back into shell/draft.
TopoDS_Face faceByIndex(const TopoDS_Shape& shape, int index) {
  TopTools_IndexedMapOfShape faceMap;
  TopExp::MapShapes(shape, TopAbs_FACE, faceMap);
  if (index < 1 || index > faceMap.Extent()) {
    std::ostringstream message;
    message << "face index " << index << " out of range (1.." << faceMap.Extent() << ")";
    throw std::runtime_error(message.str());
  }
  return TopoDS::Face(faceMap(index));
}

// Walls worth drafting by default: planes parallel to the direction (normal
// perpendicular to it) and cylinders running along it. Cones and free-form
// surfaces are skipped — already drafted or ambiguous.
bool runsAlongDirection(const TopoDS_Face& face, const gp_Dir& direction) {
  BRepAdaptor_Surface surface(face);
  const GeomAbs_SurfaceType type = surface.GetType();
  if (type == GeomAbs_Plane) {
    return std::fabs(surface.Plane().Axis().Direction().Dot(direction)) < 1e-6;
  }
  if (type == GeomAbs_Cylinder) {
    return std::fabs(surface.Cylinder().Axis().Direction().Dot(direction)) > 1.0 - 1e-6;
  }
  return false;
}

} // namespace

OccShape shellShape(const OccShape& shape, double thickness, const std::vector<int>& openFaces) {
  TopTools_ListOfShape closingFaces;
  for (int index : openFaces) {
    closingFaces.Append(faceByIndex(shape.get(), index));
  }
  // Negative offset = hollow inward: the outer skin stays, the inner wall
  // sits `thickness` inside it (locked by the integration test).
  BRepOffsetAPI_MakeThickSolid maker;
  maker.MakeThickSolidByJoin(shape.get(), closingFaces, -thickness, 1e-3);
  if (!maker.IsDone() || maker.Shape().IsNull()) {
    throw std::runtime_error("thick solid failed (try a smaller thickness or fewer open faces)");
  }
  // With nothing opened, the kernel's thick solid degenerates to the inner
  // offset solid — the sealed hollow is that region cut out of the original.
  if (openFaces.empty()) {
    BRepAlgoAPI_Cut cut(shape.get(), maker.Shape());
    cut.SetRunParallel(false);
    cut.Build();
    if (!cut.IsDone() || cut.Shape().IsNull()) {
      throw std::runtime_error("sealed thick solid failed");
    }
    return OccShape(cut.Shape());
  }
  return OccShape(maker.Shape());
}

OccShape draftShape(const OccShape& shape, double angleRadians,
                    double dx, double dy, double dz,
                    double nx, double ny, double nz,
                    const std::vector<int>& faceIndices, bool autoSelectWalls) {
  const gp_Dir direction(dx, dy, dz);
  const gp_Pln neutralPlane(gp_Pnt(nx, ny, nz), direction);

  BRepOffsetAPI_DraftAngle maker(shape.get());
  if (autoSelectWalls) {
    TopTools_IndexedMapOfShape faceMap;
    TopExp::MapShapes(shape.get(), TopAbs_FACE, faceMap);
    bool any = false;
    for (int i = 1; i <= faceMap.Extent(); ++i) {
      const TopoDS_Face face = TopoDS::Face(faceMap(i));
      if (!runsAlongDirection(face, direction)) continue;
      maker.Add(face, direction, angleRadians, neutralPlane);
      if (!maker.AddDone()) {
        throw std::runtime_error("a wall could not be drafted — pass explicit face indices");
      }
      any = true;
    }
    if (!any) {
      throw std::runtime_error("no face runs parallel to the draft direction — pass explicit face indices");
    }
  } else {
    if (faceIndices.empty()) {
      throw std::runtime_error("faceIndices must not be empty (or set autoSelectWalls)");
    }
    for (int index : faceIndices) {
      const TopoDS_Face face = faceByIndex(shape.get(), index);
      maker.Add(face, direction, angleRadians, neutralPlane);
      if (!maker.AddDone()) {
        std::ostringstream message;
        message << "face " << index << " could not be drafted (perpendicular to the direction?)";
        throw std::runtime_error(message.str());
      }
    }
  }
  maker.Build();
  if (!maker.IsDone() || maker.Shape().IsNull()) {
    throw std::runtime_error("draft failed");
  }
  return OccShape(maker.Shape());
}

// --- edge blends: fillets & chamfers -------------------------------------------

namespace {

// Edge indices are 1-based and follow describeGeometry's numbering, exactly
// like the face indices shell/draft take (TopExp::MapShapes over an indexed
// map), so `describe()` output feeds straight into fillet/chamfer.
TopoDS_Edge edgeByIndex(const TopoDS_Shape& shape, int index) {
  TopTools_IndexedMapOfShape edgeMap;
  TopExp::MapShapes(shape, TopAbs_EDGE, edgeMap);
  if (index < 1 || index > edgeMap.Extent()) {
    std::ostringstream message;
    message << "edge index " << index << " out of range (1.." << edgeMap.Extent() << ")";
    throw std::runtime_error(message.str());
  }
  return TopoDS::Edge(edgeMap(index));
}

// Empty selection means "every edge"; degenerated edges (poles of a sphere)
// can never take a blend and are skipped.
std::vector<TopoDS_Edge> selectEdges(const TopoDS_Shape& shape,
                                     const std::vector<int>& edgeIndices) {
  std::vector<TopoDS_Edge> edges;
  if (edgeIndices.empty()) {
    TopTools_IndexedMapOfShape edgeMap;
    TopExp::MapShapes(shape, TopAbs_EDGE, edgeMap);
    for (int i = 1; i <= edgeMap.Extent(); ++i) {
      const TopoDS_Edge edge = TopoDS::Edge(edgeMap(i));
      if (!BRep_Tool::Degenerated(edge)) edges.push_back(edge);
    }
  } else {
    for (int index : edgeIndices) {
      edges.push_back(edgeByIndex(shape, index));
    }
  }
  if (edges.empty()) {
    throw std::runtime_error("shape has no edges to blend");
  }
  return edges;
}

// Handle-driven selection (subShapes edges): degenerated edges are skipped
// like the "every edge" path above; non-edge handles are rejected.
std::vector<TopoDS_Edge> edgesFromHandles(const std::vector<OccShape>& edges) {
  std::vector<TopoDS_Edge> out;
  for (const OccShape& handle : edges) {
    if (handle.get().ShapeType() != TopAbs_EDGE) {
      throw std::runtime_error("expected Edge handles from subShapes, got " +
                               shapeTypeName(handle.get()));
    }
    const TopoDS_Edge edge = TopoDS::Edge(handle.get());
    if (!BRep_Tool::Degenerated(edge)) out.push_back(edge);
  }
  if (out.empty()) {
    throw std::runtime_error("shape has no edges to blend");
  }
  return out;
}

OccShape buildFillet(const TopoDS_Shape& shape, double radius,
                     const std::vector<TopoDS_Edge>& edges) {
  BRepFilletAPI_MakeFillet maker(shape);
  for (const TopoDS_Edge& edge : edges) {
    maker.Add(radius, edge);
  }
  maker.Build();
  if (!maker.IsDone() || maker.Shape().IsNull()) {
    throw std::runtime_error("fillet failed (try a smaller radius or fewer edges)");
  }
  return OccShape(maker.Shape());
}

OccShape buildChamfer(const TopoDS_Shape& shape, double distance, double distance2,
                      const std::vector<TopoDS_Edge>& edges) {
  BRepFilletAPI_MakeChamfer maker(shape);
  // Asymmetric chamfers name the face `distance` is measured on (the other
  // leg gets distance2). The first adjacent face in indexed-map order plays
  // that role — deterministic, and it matches describe()'s face numbering.
  const bool asymmetric = !std::isnan(distance2);
  TopTools_IndexedDataMapOfShapeListOfShape ancestors;
  if (asymmetric) {
    TopExp::MapShapesAndAncestors(shape, TopAbs_EDGE, TopAbs_FACE, ancestors);
  }
  for (const TopoDS_Edge& edge : edges) {
    if (!asymmetric) {
      maker.Add(distance, edge);
      continue;
    }
    const TopTools_ListOfShape& faces = ancestors.FindFromKey(edge);
    if (faces.IsEmpty()) {
      throw std::runtime_error("chamfer: edge has no adjacent face to measure the legs on");
    }
    maker.Add(distance, distance2, edge, TopoDS::Face(faces.First()));
  }
  maker.Build();
  if (!maker.IsDone() || maker.Shape().IsNull()) {
    throw std::runtime_error("chamfer failed (try a smaller distance or fewer edges)");
  }
  return OccShape(maker.Shape());
}

} // namespace

OccShape filletShape(const OccShape& shape, double radius, const std::vector<int>& edgeIndices) {
  return buildFillet(shape.get(), radius, selectEdges(shape.get(), edgeIndices));
}

OccShape chamferShape(const OccShape& shape, double distance, double distance2,
                      const std::vector<int>& edgeIndices) {
  return buildChamfer(shape.get(), distance, distance2, selectEdges(shape.get(), edgeIndices));
}

OccShape filletEdges(const OccShape& shape, double radius, const std::vector<OccShape>& edges) {
  return buildFillet(shape.get(), radius, edgesFromHandles(edges));
}

OccShape chamferEdges(const OccShape& shape, double distance, double distance2,
                      const std::vector<OccShape>& edges) {
  return buildChamfer(shape.get(), distance, distance2, edgesFromHandles(edges));
}

namespace {

// Apply one edge's constraints to the maker. NaN positions mean a constant
// radius; positioned specs (finite `at`) form an explicit law — the OCCT
// two-radius overload maps a linear law between the edge's first and last
// vertex itself (hand-built Law_Function handles make ChFi3d fail the build,
// so they are deliberately not used; the Add(radius, u, edge) overload builds
// its law in a different parameter space and is not used either). `label`
// names the edge in error messages ("edge 3" or "spec 2").
void addVariableRadius(BRepFilletAPI_MakeFillet& maker, const TopoDS_Edge& edge,
                       const std::vector<std::pair<double, double>>& constraints,
                       const std::string& label) {
  bool anyPositioned = false;
  for (const auto& constraint : constraints) {
    anyPositioned = anyPositioned || !std::isnan(constraint.first);
  }
  if (!anyPositioned) {
    maker.Add(constraints.front().second, edge);
    return;
  }
  BRepAdaptor_Curve curve(edge);
  std::vector<std::pair<double, double>> law;
  for (const auto& constraint : constraints) {
    if (std::isnan(constraint.first)) {
      throw std::runtime_error(
          "variable fillet: " + label +
          " mixes positioned and constant specs — give every spec an `at`");
    }
    if (constraint.first < curve.FirstParameter() - 1e-9 ||
        constraint.first > curve.LastParameter() + 1e-9) {
      std::ostringstream message;
      message << "variable fillet: " << label << " position " << constraint.first
              << " is outside its parameter range [" << curve.FirstParameter() << ", "
              << curve.LastParameter() << "]";
      throw std::runtime_error(message.str());
    }
    law.push_back(constraint);
  }
  if (law.size() < 2) {
    throw std::runtime_error("variable fillet: " + label +
                             " needs at least two positioned specs to vary the radius");
  }
  std::sort(law.begin(), law.end());
  for (size_t i = 1; i < law.size(); ++i) {
    if (law[i].first - law[i - 1].first < 1e-9) {
      throw std::runtime_error("variable fillet: " + label + " has duplicate positions");
    }
  }
  if (law.size() > 2) {
    std::ostringstream message;
    message << "variable fillet: " << label << " has " << law.size()
            << " positioned specs — only two are supported (the radius blends linearly "
               "from the edge's start to its end)";
    throw std::runtime_error(message.str());
  }
  maker.Add(law.front().second, law.back().second, edge);
}

void validateRadii(const std::vector<double>& radii) {
  for (size_t i = 0; i < radii.size(); ++i) {
    if (!(radii[i] > 0)) {
      std::ostringstream message;
      message << "variable fillet: spec " << (i + 1) << " radius must be positive";
      throw std::runtime_error(message.str());
    }
  }
}

OccShape buildVariableFillet(const TopoDS_Shape& shape, BRepFilletAPI_MakeFillet& maker) {
  maker.Build();
  if (!maker.IsDone() || maker.Shape().IsNull()) {
    throw std::runtime_error("variable fillet failed (try smaller radii or fewer edges)");
  }
  return OccShape(maker.Shape());
}

} // namespace

// specs arrive as parallel arrays; positions[i] = NaN means "constant radius
// on that edge".
OccShape variableFilletShape(const OccShape& shape,
                             const std::vector<int>& edgeIndices,
                             const std::vector<double>& radii,
                             const std::vector<double>& positions) {
  if (edgeIndices.empty()) {
    throw std::runtime_error("variable fillet needs at least one {edge, radius} spec");
  }
  validateRadii(radii);
  std::map<int, std::vector<std::pair<double, double>>> byEdge;
  for (size_t i = 0; i < edgeIndices.size(); ++i) {
    byEdge[edgeIndices[i]].emplace_back(positions[i], radii[i]);
  }
  BRepFilletAPI_MakeFillet maker(shape.get());
  for (const auto& entry : byEdge) {
    addVariableRadius(maker, edgeByIndex(shape.get(), entry.first), entry.second,
                      "edge " + std::to_string(entry.first));
  }
  return buildVariableFillet(shape.get(), maker);
}

OccShape variableFilletEdges(const OccShape& shape,
                             const std::vector<OccShape>& edges,
                             const std::vector<double>& radii,
                             const std::vector<double>& positions) {
  if (edges.empty()) {
    throw std::runtime_error("variable fillet needs at least one {edge, radius} spec");
  }
  validateRadii(radii);
  // Specs group by TShape identity — the handle-path equivalent of grouping
  // by edge index, so two positioned specs on one handle blend.
  struct EdgeSpecs {
    TopoDS_Edge edge;
    std::vector<std::pair<double, double>> constraints;
    std::string label;
  };
  std::map<const void*, EdgeSpecs> byEdge;
  for (size_t i = 0; i < edges.size(); ++i) {
    if (edges[i].get().ShapeType() != TopAbs_EDGE) {
      throw std::runtime_error("variable fillet: spec " + std::to_string(i + 1) +
                               " must be an Edge handle, got " + shapeTypeName(edges[i].get()));
    }
    EdgeSpecs& entry = byEdge[edges[i].get().TShape().get()];
    if (entry.constraints.empty()) {
      entry.edge = TopoDS::Edge(edges[i].get());
      entry.label = "spec " + std::to_string(i + 1);
    }
    entry.constraints.emplace_back(positions[i], radii[i]);
  }
  BRepFilletAPI_MakeFillet maker(shape.get());
  for (const auto& entry : byEdge) {
    addVariableRadius(maker, entry.second.edge, entry.second.constraints, entry.second.label);
  }
  return buildVariableFillet(shape.get(), maker);
}

// --- sketch → solid: extrude / revolve / loft / sweep ---------------------------

namespace {

// Solid sweep ops need a face; the profile constructors hand out wires, so by
// default planar wires are capped into faces first. Faces pass through
// untouched; `solid = false` sweeps the bare wire and yields a shell.
// Compounds (e.g. boolean results) pass through for the sweep algorithms to
// process element by element.
TopoDS_Shape prepareProfile(const TopoDS_Shape& profile, bool solid, const char* operation) {
  if (profile.ShapeType() == TopAbs_FACE) return profile;
  if (profile.ShapeType() == TopAbs_COMPOUND) return profile;
  if (profile.ShapeType() == TopAbs_WIRE) {
    if (!solid) return profile;
    BRepBuilderAPI_MakeFace faceMaker(TopoDS::Wire(profile));
    if (!faceMaker.IsDone() || faceMaker.Face().IsNull()) {
      throw std::runtime_error(std::string(operation) +
                               ": profile wire is not planar — solids need a planar section "
                               "(pass solid: false to sweep the bare wire)");
    }
    return faceMaker.Face();
  }
  throw std::runtime_error(std::string(operation) +
                           ": profile must be a Wire or Face (e.g. makeCircle / makePolygon output)");
}

} // namespace

OccShape extrudeShape(const OccShape& profile, double dx, double dy, double dz, bool solid) {
  BRepPrimAPI_MakePrism prism(prepareProfile(profile.get(), solid, "extrude"), gp_Vec(dx, dy, dz));
  if (!prism.IsDone() || prism.Shape().IsNull()) {
    throw std::runtime_error("extrude failed");
  }
  return OccShape(prism.Shape());
}

OccShape revolveShape(const OccShape& profile,
                      double ax, double ay, double az,
                      double ox, double oy, double oz,
                      double angleRadians, bool solid) {
  BRepPrimAPI_MakeRevol revol(
      prepareProfile(profile.get(), solid, "revolve"),
      gp_Ax1(gp_Pnt(ox, oy, oz), gp_Dir(ax, ay, az)), angleRadians);
  if (!revol.IsDone() || revol.Shape().IsNull()) {
    throw std::runtime_error("revolve failed (profile crossing the axis?)");
  }
  return OccShape(revol.Shape());
}

OccShape loftShapes(const std::vector<OccShape>& sections, bool ruled, bool solid) {
  if (sections.size() < 2) {
    throw std::runtime_error("loft needs at least 2 sections");
  }
  BRepOffsetAPI_ThruSections maker(solid, ruled, 1e-6);
  for (const OccShape& section : sections) {
    const TopoDS_Shape& shape = section.get();
    if (shape.ShapeType() == TopAbs_WIRE) {
      maker.AddWire(TopoDS::Wire(shape));
    } else if (shape.ShapeType() == TopAbs_FACE) {
      // A face's outer boundary is its section; holes cannot pass through a loft.
      maker.AddWire(BRepTools::OuterWire(TopoDS::Face(shape)));
    } else {
      throw std::runtime_error(
          "loft: sections must be Wires or Faces (e.g. makeCircle / makePolygon output)");
    }
  }
  maker.Build();
  if (!maker.IsDone() || maker.Shape().IsNull()) {
    throw std::runtime_error("loft failed (sections too dissimilar?)");
  }
  return OccShape(maker.Shape());
}

namespace {

// Sweep spines arrive as wires (the profile constructors' output) or single
// edges (e.g. a helix).
TopoDS_Wire toSpineWire(const OccShape& spine, const char* operation) {
  if (spine.get().ShapeType() == TopAbs_WIRE) {
    return TopoDS::Wire(spine.get());
  }
  if (spine.get().ShapeType() == TopAbs_EDGE) {
    return BRepBuilderAPI_MakeWire(TopoDS::Edge(spine.get())).Wire();
  }
  throw std::runtime_error(std::string(operation) +
                           ": spine must be a Wire or Edge (e.g. makeCircle / helix output)");
}

} // namespace

OccShape sweepShape(const OccShape& profile, const OccShape& spine, bool solid) {
  const TopoDS_Wire spineWire = toSpineWire(spine, "sweep");
  // MakePipe transports the profile along the spine starting from its start
  // vertex — callers place the profile there, perpendicular to the tangent.
  BRepOffsetAPI_MakePipe pipe(spineWire, prepareProfile(profile.get(), solid, "sweep"));
  if (!pipe.IsDone() || pipe.Shape().IsNull()) {
    throw std::runtime_error("sweep failed (profile not planar, or not near the spine start?)");
  }
  return OccShape(pipe.Shape());
}

OccShape pipeShellShape(const OccShape& profile, const OccShape& spine,
                        int mode, double bx, double by, double bz,
                        int transition, bool correction, bool solid) {
  TopoDS_Wire profileWire;
  if (profile.get().ShapeType() == TopAbs_WIRE) {
    profileWire = TopoDS::Wire(profile.get());
  } else if (profile.get().ShapeType() == TopAbs_FACE) {
    profileWire = BRepTools::OuterWire(TopoDS::Face(profile.get()));
  } else {
    throw std::runtime_error(
        "pipeShell: profile must be a Wire or Face (e.g. makeCircle output)");
  }
  BRepOffsetAPI_MakePipeShell maker(toSpineWire(spine, "pipeShell"));
  switch (mode) {
    case 1: maker.SetMode(true); break;    // Frenet — spins in inflection areas
    case 2: maker.SetMode(gp_Dir(bx, by, bz)); break;  // fixed binormal
    default: maker.SetMode(false); break;  // corrected Frenet
  }
  switch (transition) {
    case 1: maker.SetTransitionMode(BRepBuilderAPI_RoundCorner); break;
    case 2: maker.SetTransitionMode(BRepBuilderAPI_RightCorner); break;
    default: maker.SetTransitionMode(BRepBuilderAPI_Transformed); break;
  }
  // WithCorrection re-orients the profile onto the spine's normal plane, so
  // callers need not place it exactly perpendicular by hand.
  maker.Add(profileWire, false, correction);
  maker.Build();
  if (!maker.IsDone() || maker.Shape().IsNull()) {
    throw std::runtime_error(
        "pipeShell failed (profile not near the spine start, or mode unsuitable?)");
  }
  if (solid && !maker.MakeSolid()) {
    throw std::runtime_error(
        "pipeShell: the profile is not closed — cannot cap it into a solid "
        "(pass solid: false for the shell)");
  }
  return OccShape(maker.Shape());
}

// --- splitting & offsetting ------------------------------------------------------

OccShape splitShape(const OccShape& shape, const std::vector<OccShape>& tools) {
  if (tools.empty()) {
    throw std::runtime_error("split needs at least one tool");
  }
  TopTools_ListOfShape arguments;
  arguments.Append(shape.get());
  TopTools_ListOfShape toolList;
  for (const OccShape& tool : tools) {
    toolList.Append(tool.get());
  }
  // Unlike cut, the splitter keeps every piece of the shape.
  BRepAlgoAPI_Splitter splitter;
  splitter.SetArguments(arguments);
  splitter.SetTools(toolList);
  splitter.SetRunParallel(false);
  splitter.Build();
  if (!splitter.IsDone() || splitter.Shape().IsNull()) {
    throw std::runtime_error("split failed (no tool intersects the shape?)");
  }
  return OccShape(splitter.Shape());
}

OccShape offsetSolid(const OccShape& shape, double distance) {
  if (distance == 0) {
    throw std::runtime_error("offsetSolid: distance must be non-zero");
  }
  // The classic skin-offset via join (no openings — unlike MakeThickSolid):
  // positive grows, negative shrinks. PerformBySimple only expands along some
  // shell normals and is deliberately not used.
  BRepOffsetAPI_MakeOffsetShape maker;
  maker.PerformByJoin(shape.get(), distance, 1e-6, BRepOffset_Skin, false, false,
                      GeomAbs_Intersection);
  if (!maker.IsDone() || maker.Shape().IsNull()) {
    throw std::runtime_error("offset failed (try a smaller |distance|)");
  }
  return OccShape(maker.Shape());
}

// --- healing -------------------------------------------------------------------

OccShape healShapes(const std::vector<OccShape>& shapes,
                    double tolerance, bool sew, bool fix) {
  if (shapes.empty()) throw std::runtime_error("heal: needs at least one shape");
  if (!(tolerance > 0)) throw std::runtime_error("heal: tolerance must be positive");

  TopoDS_Shape working;
  if (shapes.size() == 1) {
    working = shapes[0].get();
    // Solids are closed by construction — sewing them has nothing to stitch
    // and would degrade them to shells. Several shapes, or open geometry
    // (faces/shells/wires/compounds), is where stitching earns its keep.
    if (working.ShapeType() == TopAbs_SOLID || working.ShapeType() == TopAbs_COMPSOLID) {
      sew = false;
    }
  } else {
    TopoDS_Compound compound;
    BRep_Builder builder;
    builder.MakeCompound(compound);
    for (const OccShape& shape : shapes) {
      builder.Add(compound, shape.get());
    }
    working = compound;
  }

  if (sew) {
    BRepBuilderAPI_Sewing sewing(tolerance, true, true, false, false);
    sewing.Add(working);
    sewing.Perform();
    const TopoDS_Shape sewed = sewing.SewedShape();
    if (sewed.IsNull()) throw std::runtime_error("heal: sewing failed");
    working = sewed;
  }

  if (fix) {
    ShapeFix_Shape fixer(working);
    fixer.SetPrecision(tolerance);
    // Let the fixer relax tolerances up to 1.0 rather than drop geometry that
    // only misses by a hair — healing is the last stop before discarding.
    fixer.SetMaxTolerance(std::max(tolerance, 1.0));
    fixer.Perform();
    const TopoDS_Shape fixed = fixer.Shape();
    if (fixed.IsNull()) throw std::runtime_error("heal: shape fixing failed");
    working = fixed;
  }
  return OccShape(working);
}

// --- B-spline surfaces -----------------------------------------------------------

namespace {

void uniformSurfaceKnots(int poleCount, int degree,
                         TColStd_Array1OfReal& knots, TColStd_Array1OfInteger& mults) {
  // Clamped uniform knots [0, 1, …, n-d] — the 2D twin of makeBsplineWire's
  // knot layout: ends at multiplicity degree + 1 so the surface passes
  // through the border pole grid.
  const int knotCount = poleCount - degree + 1;
  for (int k = 1; k <= knotCount; ++k) {
    knots.SetValue(k, k - 1);
    mults.SetValue(k, 1);
  }
  mults.SetValue(1, degree + 1);
  mults.SetValue(knotCount, degree + 1);
}

TColgp_Array2OfPnt gridFromArray(const std::vector<double>& coordinates,
                                 int uCount, int vCount, const char* operation) {
  if (uCount < 2 || vCount < 2) {
    throw std::runtime_error(std::string(operation) +
                             ": the grid needs at least 2 × 2 points");
  }
  if (static_cast<int>(coordinates.size() / 3) != uCount * vCount) {
    std::ostringstream message;
    message << operation << ": expected " << uCount << " × " << vCount
            << " points (" << uCount * vCount * 3 << " numbers) — got "
            << coordinates.size();
    throw std::runtime_error(message.str());
  }
  // Row-major over rows of constant v, each running along u.
  TColgp_Array2OfPnt grid(1, uCount, 1, vCount);
  for (int v = 1; v <= vCount; ++v) {
    for (int u = 1; u <= uCount; ++u) {
      const size_t index = ((v - 1) * uCount + (u - 1)) * 3;
      grid.SetValue(u, v, gp_Pnt(coordinates[index], coordinates[index + 1],
                                 coordinates[index + 2]));
    }
  }
  return grid;
}

} // namespace

OccShape makeBsplineSurfaceShape(const std::vector<double>& coordinates,
                                 int uCount, int vCount, int uDegree, int vDegree) {
  if (uDegree < 1 || vDegree < 1) {
    throw std::runtime_error("bspline surface: degrees must be at least 1");
  }
  if (uCount <= uDegree || vCount <= vDegree) {
    std::ostringstream message;
    message << "bspline surface: a " << uCount << " × " << vCount
            << " pole grid cannot support degrees " << uDegree << " × " << vDegree
            << " — each needs at least degree + 1 poles";
    throw std::runtime_error(message.str());
  }
  const TColgp_Array2OfPnt poles = gridFromArray(coordinates, uCount, vCount, "bspline surface");

  TColStd_Array1OfReal uKnots(1, uCount - uDegree + 1);
  TColStd_Array1OfInteger uMults(1, uCount - uDegree + 1);
  uniformSurfaceKnots(uCount, uDegree, uKnots, uMults);
  TColStd_Array1OfReal vKnots(1, vCount - vDegree + 1);
  TColStd_Array1OfInteger vMults(1, vCount - vDegree + 1);
  uniformSurfaceKnots(vCount, vDegree, vKnots, vMults);

  Handle(Geom_BSplineSurface) surface =
      new Geom_BSplineSurface(poles, uKnots, vKnots, uMults, vMults, uDegree, vDegree);
  BRepBuilderAPI_MakeFace maker(surface, 1e-6);
  if (!maker.IsDone() || maker.Face().IsNull()) {
    throw std::runtime_error("bspline surface construction failed");
  }
  return OccShape(maker.Face());
}

OccShape interpolateBsplineSurfaceShape(const std::vector<double>& coordinates,
                                        int uCount, int vCount) {
  const TColgp_Array2OfPnt points = gridFromArray(coordinates, uCount, vCount, "surface through");
  GeomAPI_PointsToBSplineSurface fitter;
  fitter.Interpolate(points);
  if (fitter.Surface().IsNull()) {
    throw std::runtime_error("surface interpolation failed");
  }
  BRepBuilderAPI_MakeFace maker(fitter.Surface(), 1e-6);
  if (!maker.IsDone() || maker.Face().IsNull()) {
    throw std::runtime_error("surface interpolation failed");
  }
  return OccShape(maker.Face());
}

OccShape setBsplineSurfacePolesShape(const OccShape& face,
                                     const std::vector<double>& coordinates,
                                     int uCount, int vCount) {
  if (face.get().ShapeType() != TopAbs_FACE) {
    throw std::runtime_error(
        "setBsplinePoles: shape must be a Face (e.g. makeBsplineSurface output)");
  }
  // BRep_Tool::Surface hands out the face's stored handle — Copy() it before
  // editing, or the original face would warp underneath the caller.
  Handle(Geom_BSplineSurface) original =
      Handle(Geom_BSplineSurface)::DownCast(BRep_Tool::Surface(TopoDS::Face(face.get())));
  if (original.IsNull()) {
    throw std::runtime_error("setBsplinePoles: the face's surface is not a B-spline");
  }
  if (original->NbUPoles() != uCount || original->NbVPoles() != vCount) {
    std::ostringstream message;
    message << "setBsplinePoles: the surface has a " << original->NbUPoles() << " × "
            << original->NbVPoles() << " pole grid — got " << uCount << " × " << vCount;
    throw std::runtime_error(message.str());
  }
  const TColgp_Array2OfPnt poles = gridFromArray(coordinates, uCount, vCount, "setBsplinePoles");
  Handle(Geom_BSplineSurface) modified =
      Handle(Geom_BSplineSurface)::DownCast(original->Copy());
  for (int v = 1; v <= vCount; ++v) {
    for (int u = 1; u <= uCount; ++u) {
      modified->SetPole(u, v, poles.Value(u, v));
    }
  }
  BRepBuilderAPI_MakeFace maker(modified, 1e-6);
  if (!maker.IsDone() || maker.Face().IsNull()) {
    throw std::runtime_error("setBsplinePoles failed");
  }
  return OccShape(maker.Face());
}
