#include "interrogate.h"

#include "json.h"

#include <BRepAdaptor_Curve.hxx>
#include <BRepAdaptor_Surface.hxx>
#include <BRepAlgoAPI_Section.hxx>
#include <BRepClass3d_SolidClassifier.hxx>
#include <BRepExtrema_DistShapeShape.hxx>
#include <BRepGProp.hxx>
#include <BRep_Tool.hxx>
#include <GCPnts_QuasiUniformDeflection.hxx>
#include <Geom_BSplineCurve.hxx>
#include <Geom_BSplineSurface.hxx>
#include <GeomAbs_CurveType.hxx>
#include <GeomAbs_SurfaceType.hxx>
#include <GProp_GProps.hxx>
#include <Standard_Failure.hxx>
#include <TopAbs_State.hxx>
#include <TopExp.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <gp_Ax1.hxx>
#include <gp_Circ.hxx>
#include <gp_Cone.hxx>
#include <gp_Cylinder.hxx>
#include <gp_Dir.hxx>
#include <gp_Elips.hxx>
#include <gp_Lin.hxx>
#include <gp_Pln.hxx>
#include <gp_Pnt.hxx>
#include <gp_Sphere.hxx>
#include <gp_Torus.hxx>

#include <cmath>
#include <sstream>
#include <stdexcept>

namespace {

const double TWO_PI = 6.28318530717958647692;

const char* curveTypeName(GeomAbs_CurveType type) {
  switch (type) {
    case GeomAbs_Line: return "line";
    case GeomAbs_Circle: return "circle";
    case GeomAbs_Ellipse: return "ellipse";
    case GeomAbs_BSplineCurve: return "bspline";
    case GeomAbs_BezierCurve: return "bezier";
    case GeomAbs_OffsetCurve: return "offset";
    default: return "other";
  }
}

const char* surfaceTypeName(GeomAbs_SurfaceType type) {
  switch (type) {
    case GeomAbs_Plane: return "plane";
    case GeomAbs_Cylinder: return "cylinder";
    case GeomAbs_Cone: return "cone";
    case GeomAbs_Sphere: return "sphere";
    case GeomAbs_Torus: return "torus";
    case GeomAbs_BSplineSurface: return "bspline-surface";
    case GeomAbs_SurfaceOfRevolution: return "revolution";
    case GeomAbs_SurfaceOfExtrusion: return "extrusion";
    case GeomAbs_OffsetSurface: return "offset-surface";
    default: return "other";
  }
}

void putPoint(std::ostringstream& out, const gp_Pnt& point) {
  out << '[' << jsonNumber(point.X()) << ',' << jsonNumber(point.Y()) << ',' << jsonNumber(point.Z()) << ']';
}

void putDirection(std::ostringstream& out, const gp_Dir& direction) {
  out << '[' << jsonNumber(direction.X()) << ',' << jsonNumber(direction.Y()) << ',' << jsonNumber(direction.Z()) << ']';
}

double faceArea(const TopoDS_Face& face) {
  GProp_GProps props;
  BRepGProp::SurfaceProperties(face, props);
  return props.Mass();
}

// Analytic where cheap, discretized otherwise — avoids version-fragile
// GCPnts_AbscissaPoint overload sets.
double edgeLength(const BRepAdaptor_Curve& curve, GeomAbs_CurveType type) {
  const double u1 = curve.FirstParameter();
  const double u2 = curve.LastParameter();
  if (type == GeomAbs_Line) {
    return curve.Value(u1).Distance(curve.Value(u2));
  }
  if (type == GeomAbs_Circle) {
    const double span = u2 - u1;
    return curve.Circle().Radius() * (span > TWO_PI ? TWO_PI : span);
  }
  GCPnts_QuasiUniformDeflection discretizer(curve, 1e-3);
  if (!discretizer.IsDone() || discretizer.NbPoints() < 2) return 0.0;
  double length = 0.0;
  gp_Pnt previous = discretizer.Value(1);
  for (int i = 2; i <= discretizer.NbPoints(); ++i) {
    const gp_Pnt current = discretizer.Value(i);
    length += previous.Distance(current);
    previous = current;
  }
  return length;
}

void emitEdge(std::ostringstream& out, const TopoDS_Edge& edge, int index) {
  BRepAdaptor_Curve curve(edge);
  const GeomAbs_CurveType type = curve.GetType();
  const double u1 = curve.FirstParameter();
  const double u2 = curve.LastParameter();

  out << "{\"index\":" << index << ",\"curve\":\"" << curveTypeName(type)
      << "\",\"length\":" << jsonNumber(edgeLength(curve, type));

  switch (type) {
    case GeomAbs_Line: {
      const gp_Lin line = curve.Line();
      out << ",\"start\":";
      putPoint(out, curve.Value(u1));
      out << ",\"end\":";
      putPoint(out, curve.Value(u2));
      out << ",\"direction\":";
      putDirection(out, line.Direction());
      break;
    }
    case GeomAbs_Circle: {
      const gp_Circ circle = curve.Circle();
      out << ",\"center\":";
      putPoint(out, circle.Location());
      out << ",\"axis\":";
      putDirection(out, circle.Axis().Direction());
      out << ",\"radius\":" << jsonNumber(circle.Radius());
      out << ",\"uRange\":[" << jsonNumber(u1) << ',' << jsonNumber(u2) << ']';
      out << ",\"closed\":" << ((u2 - u1) >= TWO_PI - 1e-6 ? "true" : "false");
      break;
    }
    case GeomAbs_Ellipse: {
      const gp_Elips ellipse = curve.Ellipse();
      out << ",\"center\":";
      putPoint(out, ellipse.Location());
      out << ",\"axis\":";
      putDirection(out, ellipse.Axis().Direction());
      out << ",\"majorRadius\":" << jsonNumber(ellipse.MajorRadius());
      out << ",\"minorRadius\":" << jsonNumber(ellipse.MinorRadius());
      break;
    }
    case GeomAbs_BSplineCurve: {
      const Handle(Geom_BSplineCurve) spline = curve.BSpline();
      if (!spline.IsNull()) {
        out << ",\"degree\":" << spline->Degree() << ",\"poles\":" << spline->NbPoles();
      }
      break;
    }
    default:
      break;
  }
  out << '}';
}

void emitFace(std::ostringstream& out, const TopoDS_Face& face, int index) {
  BRepAdaptor_Surface surface(face);
  const GeomAbs_SurfaceType type = surface.GetType();

  out << "{\"index\":" << index << ",\"surface\":\"" << surfaceTypeName(type)
      << "\",\"area\":" << jsonNumber(faceArea(face));

  switch (type) {
    case GeomAbs_Plane: {
      const gp_Pln plane = surface.Plane();
      out << ",\"origin\":";
      putPoint(out, plane.Location());
      out << ",\"normal\":";
      putDirection(out, plane.Axis().Direction());
      break;
    }
    case GeomAbs_Cylinder: {
      const gp_Cylinder cylinder = surface.Cylinder();
      out << ",\"axisPoint\":";
      putPoint(out, cylinder.Axis().Location());
      out << ",\"axis\":";
      putDirection(out, cylinder.Axis().Direction());
      out << ",\"radius\":" << jsonNumber(cylinder.Radius());
      break;
    }
    case GeomAbs_Cone: {
      const gp_Cone cone = surface.Cone();
      out << ",\"axisPoint\":";
      putPoint(out, cone.Axis().Location());
      out << ",\"axis\":";
      putDirection(out, cone.Axis().Direction());
      out << ",\"refRadius\":" << jsonNumber(cone.RefRadius());
      out << ",\"semiAngle\":" << jsonNumber(cone.SemiAngle() * 180.0 / 3.14159265358979323846);
      break;
    }
    case GeomAbs_Sphere: {
      const gp_Sphere sphere = surface.Sphere();
      out << ",\"center\":";
      putPoint(out, sphere.Location());
      out << ",\"radius\":" << jsonNumber(sphere.Radius());
      break;
    }
    case GeomAbs_Torus: {
      const gp_Torus torus = surface.Torus();
      out << ",\"center\":";
      putPoint(out, torus.Location());
      out << ",\"axis\":";
      putDirection(out, torus.Axis().Direction());
      out << ",\"majorRadius\":" << jsonNumber(torus.MajorRadius());
      out << ",\"minorRadius\":" << jsonNumber(torus.MinorRadius());
      break;
    }
    default:
      break;
  }
  out << '}';
}

} // namespace

std::string describeGeometry(const OccShape& shape) {
  if (shape.get().IsNull()) {
    throw std::runtime_error("describe: null shape");
  }

  std::ostringstream out;
  out << "{\"shapeType\":\"" << shapeTypeName(shape.get()) << "\",\"faces\":[";

  TopTools_IndexedMapOfShape faceMap;
  TopExp::MapShapes(shape.get(), TopAbs_FACE, faceMap);
  for (int i = 1; i <= faceMap.Extent(); ++i) {
    if (i > 1) out << ',';
    emitFace(out, TopoDS::Face(faceMap(i)), i);
  }
  out << "],\"edges\":[";

  TopTools_IndexedMapOfShape edgeMap;
  TopExp::MapShapes(shape.get(), TopAbs_EDGE, edgeMap);
  int emitted = 0;
  for (int i = 1; i <= edgeMap.Extent(); ++i) {
    const TopoDS_Edge edge = TopoDS::Edge(edgeMap(i));
    if (BRep_Tool::Degenerated(edge)) continue;
    if (emitted++ > 0) out << ',';
    emitEdge(out, edge, i);
  }
  out << "]}";
  return out.str();
}

std::string distanceBetween(const OccShape& a, const OccShape& b) {
  BRepExtrema_DistShapeShape extrema(a.get(), b.get());
  if (!extrema.IsDone()) {
    throw std::runtime_error("distance: computation failed");
  }
  std::ostringstream out;
  out << "{\"distance\":" << jsonNumber(extrema.Value()) << ",\"points\":[";
  const int solutions = extrema.NbSolution() < 8 ? extrema.NbSolution() : 8;
  for (int i = 1; i <= solutions; ++i) {
    if (i > 1) out << ',';
    out << '[';
    putPoint(out, extrema.PointOnShape1(i));
    out << ',';
    putPoint(out, extrema.PointOnShape2(i));
    out << ']';
  }
  out << "]}";
  return out.str();
}

OccShape sectionOf(const OccShape& a, const OccShape& b) {
  BRepAlgoAPI_Section section(a.get(), b.get(), false);
  section.SetRunParallel(false);
  section.Build();
  if (!section.IsDone()) {
    throw std::runtime_error("section: computation failed");
  }
  if (section.Shape().IsNull()) {
    throw std::runtime_error("section: empty result");
  }
  return OccShape(section.Shape());
}

std::string classifyPointIn(const OccShape& shape, double x, double y, double z) {
  TopTools_IndexedMapOfShape solidMap;
  TopExp::MapShapes(shape.get(), TopAbs_SOLID, solidMap);
  if (solidMap.Extent() == 0) {
    return "unknown";
  }

  bool anyIn = false;
  bool anyOn = false;
  for (int i = 1; i <= solidMap.Extent(); ++i) {
    BRepClass3d_SolidClassifier classifier(solidMap(i));
    classifier.Perform(gp_Pnt(x, y, z), 1e-7);
    const TopAbs_State state = classifier.State();
    if (state == TopAbs_IN) {
      anyIn = true;
    } else if (state == TopAbs_ON) {
      anyOn = true;
    }
  }
  if (anyIn) return "in";
  if (anyOn) return "on";
  return "out";
}

std::string describeBsplineSurface(const OccShape& face) {
  if (face.get().IsNull() || face.get().ShapeType() != TopAbs_FACE) {
    throw std::runtime_error(
        "describeSurface: shape must be a Face (e.g. makeBsplineSurface output)");
  }
  Handle(Geom_BSplineSurface) surface =
      Handle(Geom_BSplineSurface)::DownCast(BRep_Tool::Surface(TopoDS::Face(face.get())));
  if (surface.IsNull()) {
    BRepAdaptor_Surface adaptor(TopoDS::Face(face.get()));
    std::ostringstream message;
    message << "describeSurface: the face's surface is a \""
            << surfaceTypeName(adaptor.GetType()) << "\", not a B-spline";
    throw std::runtime_error(message.str());
  }
  // Same row-major layout setBsplineSurfacePolesShape consumes: rows of
  // constant v, each running along u.
  std::ostringstream out;
  out << "{\"surface\":\"bspline\""
      << ",\"uDegree\":" << surface->UDegree()
      << ",\"vDegree\":" << surface->VDegree()
      << ",\"uPoles\":" << surface->NbUPoles()
      << ",\"vPoles\":" << surface->NbVPoles()
      << ",\"uKnots\":[";
  for (int i = 1; i <= surface->NbUKnots(); ++i) {
    if (i > 1) out << ',';
    out << jsonNumber(surface->UKnot(i));
  }
  out << "],\"uMultiplicities\":[";
  const TColStd_Array1OfInteger& uMultiplicities = surface->UMultiplicities();
  for (int i = 1; i <= surface->NbUKnots(); ++i) {
    if (i > 1) out << ',';
    out << uMultiplicities(i);
  }
  out << "],\"vKnots\":[";
  for (int i = 1; i <= surface->NbVKnots(); ++i) {
    if (i > 1) out << ',';
    out << jsonNumber(surface->VKnot(i));
  }
  out << "],\"vMultiplicities\":[";
  const TColStd_Array1OfInteger& vMultiplicities = surface->VMultiplicities();
  for (int i = 1; i <= surface->NbVKnots(); ++i) {
    if (i > 1) out << ',';
    out << vMultiplicities(i);
  }
  out << "],\"poles\":[";
  for (int v = 1; v <= surface->NbVPoles(); ++v) {
    if (v > 1) out << ',';
    out << '[';
    for (int u = 1; u <= surface->NbUPoles(); ++u) {
      if (u > 1) out << ',';
      putPoint(out, surface->Pole(u, v));
    }
    out << ']';
  }
  const bool rational = surface->IsURational() || surface->IsVRational();
  out << "],\"rational\":" << (rational ? "true" : "false");
  if (rational) {
    out << ",\"weights\":[";
    for (int v = 1; v <= surface->NbVPoles(); ++v) {
      if (v > 1) out << ',';
      out << '[';
      for (int u = 1; u <= surface->NbUPoles(); ++u) {
        if (u > 1) out << ',';
        out << jsonNumber(surface->Weight(u, v));
      }
      out << ']';
    }
    out << ']';
  }
  out << "}";
  return out.str();
}
