#include "model.h"

#include "occ.h"

#include <BRepAdaptor_Surface.hxx>
#include <BRepAlgoAPI_Common.hxx>
#include <BRepAlgoAPI_Cut.hxx>
#include <BRepAlgoAPI_Fuse.hxx>
#include <BRepBndLib.hxx>
#include <BRepBuilderAPI_Transform.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepGProp.hxx>
#include <BRepOffsetAPI_DraftAngle.hxx>
#include <BRepOffsetAPI_MakeThickSolid.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakeCone.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRepPrimAPI_MakeSphere.hxx>
#include <BRepPrimAPI_MakeTorus.hxx>
#include <Bnd_Box.hxx>
#include <GProp_GProps.hxx>
#include <GeomAbs_SurfaceType.hxx>
#include <Standard_Version.hxx>
#include <TopAbs_ShapeEnum.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Face.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopTools_ListOfShape.hxx>
#include <gp_Ax1.hxx>
#include <gp_Ax2.hxx>
#include <gp_Dir.hxx>
#include <gp_Pln.hxx>
#include <gp_Pnt.hxx>
#include <gp_Trsf.hxx>
#include <gp_Vec.hxx>

#include <cmath>
#include <sstream>
#include <stdexcept>

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
  BRepBndLib::Add(myShape, box);
  std::vector<double> out(6, 0.0);
  if (!box.IsVoid()) {
    box.Get(out[0], out[1], out[2], out[3], out[4], out[5]);
  }
  return out;
}

bool OccShape::isValid() const {
  if (myShape.IsNull()) return false;
  return BRepCheck_Analyzer(myShape).IsValid();
}

int OccShape::countSubShapes(const std::string& typeName) const {
  TopAbs_ShapeEnum type;
  if      (typeName == "Compound")  type = TopAbs_COMPOUND;
  else if (typeName == "CompSolid") type = TopAbs_COMPSOLID;
  else if (typeName == "Solid")     type = TopAbs_SOLID;
  else if (typeName == "Shell")     type = TopAbs_SHELL;
    else if (typeName == "Face")   type = TopAbs_FACE;
  else if (typeName == "Wire")      type = TopAbs_WIRE;
  else if (typeName == "Edge")      type = TopAbs_EDGE;
  else if (typeName == "Vertex")    type = TopAbs_VERTEX;
  else return 0;

  // TopExp_Explorer visits shared edges/vertices once per adjacent parent;
  // the indexed map deduplicates (the 12-edges-of-a-box test).
  TopTools_IndexedMapOfShape map;
  TopExp::MapShapes(myShape, type, map);
  return map.Extent();
}

// --- primitives -------------------------------------------------------------

namespace {

gp_Ax2 makeAxis(double ox, double oy, double oz,
                double dx, double dy, double dz) {
  return gp_Ax2(gp_Pnt(ox, oy, oz), gp_Dir(dx, dy, dz));
}

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

// --- booleans ---------------------------------------------------------------

OccShape booleanOp(int op, const OccShape& a, const OccShape& b) {
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
  return OccShape(result);
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
