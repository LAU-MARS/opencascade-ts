#include "hlr.h"

#include "mesher.h"

#include <HLRAlgo_Projector.hxx>
#include <HLRBRep_Algo.hxx>
#include <HLRBRep_HLRToShape.hxx>
#include <Standard_Failure.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <gp_Ax2.hxx>
#include <gp_Dir.hxx>
#include <gp_Pnt.hxx>
#include <gp_Vec.hxx>

#include <cmath>
#include <stdexcept>

namespace {

void collectEdges(const TopoDS_Shape& compound, double deflection, std::vector<float>& out) {
  if (compound.IsNull()) {
    return;
  }
  for (TopExp_Explorer exp(compound, TopAbs_EDGE); exp.More(); exp.Next()) {
    addEdgePolyline(TopoDS::Edge(exp.Current()), deflection, out);
  }
}

// Build a valid gp_Ax2 even when `up` is (nearly) parallel to `dir`.
gp_Ax2 projectionAxes(double dx, double dy, double dz, double ux, double uy, double uz) {
  gp_Dir dir(dx, dy, dz);
  gp_Vec up(ux, uy, uz);
  gp_Vec xDir = up - gp_Vec(dx, dy, dz) * (up.Dot(gp_Vec(dx, dy, dz)));
  if (xDir.Magnitude() < 1e-9) {
    // up collinear with view direction: pick any perpendicular axis
    xDir = std::abs(dir.Z()) < 0.9 ? gp_Vec(0, 0, 1) : gp_Vec(1, 0, 0);
  }
  xDir.Normalize();
  return gp_Ax2(gp_Pnt(0, 0, 0), dir, gp_Dir(xDir));
}

} // namespace

HlrData computeHiddenLines(const OccShape& shape,
                           double dirX, double dirY, double dirZ,
                           double upX, double upY, double upZ,
                           double deflection) {
  const double defl = deflection > 1e-6 ? deflection : 0.1;

  Handle(HLRBRep_Algo) algo = new HLRBRep_Algo();
  algo->Add(shape.get());
  algo->Projector(HLRAlgo_Projector(projectionAxes(dirX, dirY, dirZ, upX, upY, upZ)));
  algo->Update();
  algo->Hide();

  HLRBRep_HLRToShape hlr(algo);

  HlrData data;
  // Visible: sharp edges, smooth (rg1) edges and silhouette outlines.
  collectEdges(hlr.VCompound(), defl, data.visible.points);
  collectEdges(hlr.Rg1LineVCompound(), defl, data.visible.points);
  collectEdges(hlr.OutLineVCompound(), defl, data.visible.points);
  // Hidden: same categories on the far side.
  collectEdges(hlr.HCompound(), defl, data.hidden.points);
  collectEdges(hlr.Rg1LineHCompound(), defl, data.hidden.points);
  collectEdges(hlr.OutLineHCompound(), defl, data.hidden.points);
  return data;
}
