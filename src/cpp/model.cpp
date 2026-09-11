#include "model.h"

#include "occ.h"

#include <BRepAdaptor_Surface.hxx>
#include <BRepAlgoAPI_Common.hxx>
#include <BRepAlgoAPI_Cut.hxx>
#include <BRepAlgoAPI_Fuse.hxx>
#include <BRepBndLib.hxx>
#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <BRepBuilderAPI_MakeWire.hxx>
#include <BRepBuilderAPI_Transform.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepFilletAPI_MakeChamfer.hxx>
#include <BRepFilletAPI_MakeFillet.hxx>
#include <BRepGProp.hxx>
#include <BRepOffsetAPI_DraftAngle.hxx>
#include <BRepOffsetAPI_MakePipe.hxx>
#include <BRepOffsetAPI_MakeThickSolid.hxx>
#include <BRepOffsetAPI_ThruSections.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakeCone.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRepPrimAPI_MakePrism.hxx>
#include <BRepPrimAPI_MakeRevol.hxx>
#include <BRepPrimAPI_MakeSphere.hxx>
#include <BRepPrimAPI_MakeTorus.hxx>
#include <BRepTools.hxx>
#include <BRep_Tool.hxx>
#include <Bnd_Box.hxx>
#include <GProp_GProps.hxx>
#include <GeomAbs_SurfaceType.hxx>
#include <Standard_Version.hxx>
#include <TopAbs_ShapeEnum.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Wire.hxx>
#include <gp_Circ.hxx>
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

} // namespace

OccShape filletShape(const OccShape& shape, double radius, const std::vector<int>& edgeIndices) {
  BRepFilletAPI_MakeFillet maker(shape.get());
  for (const TopoDS_Edge& edge : selectEdges(shape.get(), edgeIndices)) {
    maker.Add(radius, edge);
  }
  maker.Build();
  if (!maker.IsDone() || maker.Shape().IsNull()) {
    throw std::runtime_error("fillet failed (try a smaller radius or fewer edges)");
  }
  return OccShape(maker.Shape());
}

OccShape chamferShape(const OccShape& shape, double distance, const std::vector<int>& edgeIndices) {
  BRepFilletAPI_MakeChamfer maker(shape.get());
  for (const TopoDS_Edge& edge : selectEdges(shape.get(), edgeIndices)) {
    maker.Add(distance, edge);
  }
  maker.Build();
  if (!maker.IsDone() || maker.Shape().IsNull()) {
    throw std::runtime_error("chamfer failed (try a smaller distance or fewer edges)");
  }
  return OccShape(maker.Shape());
}

// --- sketch → solid: extrude / revolve / loft / sweep ---------------------------

namespace {

// Solid sweep ops need a face; the profile constructors hand out wires, so by
// default planar wires are capped into faces first. Faces pass through
// untouched; `solid = false` sweeps the bare wire and yields a shell.
TopoDS_Shape prepareProfile(const TopoDS_Shape& profile, bool solid, const char* operation) {
  if (profile.ShapeType() == TopAbs_FACE) return profile;
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

OccShape sweepShape(const OccShape& profile, const OccShape& spine, bool solid) {
  TopoDS_Wire spineWire;
  if (spine.get().ShapeType() == TopAbs_WIRE) {
    spineWire = TopoDS::Wire(spine.get());
  } else if (spine.get().ShapeType() == TopAbs_EDGE) {
    spineWire = BRepBuilderAPI_MakeWire(TopoDS::Edge(spine.get())).Wire();
  } else {
    throw std::runtime_error(
        "sweep: spine must be a Wire or Edge (e.g. makePolygon / makeCircle output)");
  }
  // MakePipe transports the profile along the spine starting from its start
  // vertex — callers place the profile there, perpendicular to the tangent.
  BRepOffsetAPI_MakePipe pipe(spineWire, prepareProfile(profile.get(), solid, "sweep"));
  if (!pipe.IsDone() || pipe.Shape().IsNull()) {
    throw std::runtime_error("sweep failed (profile not planar, or not near the spine start?)");
  }
  return OccShape(pipe.Shape());
}
