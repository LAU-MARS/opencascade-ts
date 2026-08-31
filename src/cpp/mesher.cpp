#include "mesher.h"

#include <BRepAdaptor_Curve.hxx>
#include <BRepMesh_IncrementalMesh.hxx>
#include <BRep_Tool.hxx>
#include <GCPnts_QuasiUniformDeflection.hxx>
#include <Poly_Triangulation.hxx>
#include <TopAbs_Orientation.hxx>
#include <TopExp.hxx>
#include <TopExp_Explorer.hxx>
#include <TopLoc_Location.hxx>
#include <TopTools_IndexedMapOfShape.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <gp_Pnt.hxx>

#include <utility>

// Emits each edge as independent segment pairs (p0 p1, p1 p2, ...) so callers
// can treat consecutive point pairs as standalone GL_LINES / SVG segments
// without needing edge-boundary markers.
void addEdgePolyline(const TopoDS_Edge& edge, double deflection, std::vector<float>& out) {
  if (BRep_Tool::Degenerated(edge)) {
    return;
  }
  double defl = deflection > 1e-6 ? deflection : 1e-3;
  BRepAdaptor_Curve curve(edge);
  GCPnts_QuasiUniformDeflection discretizer(curve, defl);
  if (!discretizer.IsDone() || discretizer.NbPoints() < 2) {
    return;
  }
  gp_Pnt previous = discretizer.Value(1);
  for (int i = 2; i <= discretizer.NbPoints(); ++i) {
    gp_Pnt current = discretizer.Value(i);
    out.push_back((float)previous.X());
    out.push_back((float)previous.Y());
    out.push_back((float)previous.Z());
    out.push_back((float)current.X());
    out.push_back((float)current.Y());
    out.push_back((float)current.Z());
    previous = current;
  }
}

MeshData tessellateShape(const OccShape& shape,
                         double linearDeflection,
                         double angularDeflectionDegrees,
                         bool relative) {
  const double angularDeflection =
      angularDeflectionDegrees * 3.14159265358979323846 / 180.0;
  double linDefl = linearDeflection > 1e-9 ? linearDeflection : 0.1;

  TopoDS_Shape shp = shape.get();
  // ctor order: (shape, linearDeflection, isRelative, angularDeflection, inParallel)
  BRepMesh_IncrementalMesh mesher(shp, linDefl, relative, angularDeflection, false);
  (void)mesher;  // the constructor performs the meshing

  MeshData data;

  // Faces -> triangles
  for (TopExp_Explorer exp(shp, TopAbs_FACE); exp.More(); exp.Next()) {
    TopoDS_Face face = TopoDS::Face(exp.Current());
    TopLoc_Location location;
    Handle(Poly_Triangulation) tri = BRep_Tool::Triangulation(face, location);
    if (tri.IsNull() || tri->NbTriangles() == 0) {
      continue;
    }
    const gp_Trsf& transform = location.Transformation();
    const uint32_t base = (uint32_t)(data.positions.size() / 3);

    for (int i = 1; i <= tri->NbNodes(); ++i) {
      gp_Pnt p = tri->Node(i);
      p.Transform(transform);
      data.positions.push_back((float)p.X());
      data.positions.push_back((float)p.Y());
      data.positions.push_back((float)p.Z());
    }

    for (int i = 1; i <= tri->NbTriangles(); ++i) {
      int a = 0, b = 0, c = 0;
      tri->Triangle(i).Get(a, b, c);
      if (face.Orientation() == TopAbs_REVERSED) {
        std::swap(b, c);
      }
      data.indices.push_back(base + (uint32_t)(a - 1));
      data.indices.push_back(base + (uint32_t)(b - 1));
      data.indices.push_back(base + (uint32_t)(c - 1));
    }
  }

  // Edges -> exact-geometry wireframe (independent of the triangulation).
  // MapShapes deduplicates edges shared by adjacent faces.
  TopTools_IndexedMapOfShape edgeMap;
  TopExp::MapShapes(shp, TopAbs_EDGE, edgeMap);
  for (int i = 1; i <= edgeMap.Extent(); ++i) {
    addEdgePolyline(TopoDS::Edge(edgeMap(i)), linDefl, data.edges);
  }

  return data;
}
