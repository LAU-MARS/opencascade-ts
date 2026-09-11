// embind registration: exposes the curated C++ surface to TypeScript.
// The TypeScript side (src/ts/wasm-module.ts) hand-writes clean declarations
// for everything registered here — keep both files in sync (see AGENTS.md).
//
// Error handling contract: C++ exceptions NEVER cross the wasm boundary
// (embind in pinned Emscripten versions does not translate them into JS
// Errors). Every entry point catches, records `lastError`, and returns a
// null/empty result. TypeScript checks hasError()/lastError() after each
// call and throws a proper JS Error — see OccSession#throwIfError.

#include <emscripten/bind.h>

#include <Standard_Failure.hxx>
#include <Standard_Version.hxx>

#include <string>
#include <type_traits>

#include "hlr.h"
#include "interrogate.h"
#include "io.h"
#include "mesher.h"
#include "model.h"
#include "occ.h"

using namespace emscripten;

namespace {

std::string g_lastError;

// Run `fn`, convert any exception into g_lastError and return `errorValue`.
template <typename T, typename Fn>
T guarded(const char* operation, Fn fn, T errorValue) {
  g_lastError.clear();
  try {
    return fn();
  } catch (const Standard_Failure& failure) {
    const char* what = failure.GetMessageString();
    g_lastError = std::string(operation) + ": " + (what ? what : "unknown OCCT error");
  } catch (const std::exception& error) {
    g_lastError = std::string(operation) + ": " + error.what();
  } catch (...) {
    g_lastError = std::string(operation) + ": unknown error";
  }
  return errorValue;
}

bool hasError() { return !g_lastError.empty(); }
std::string lastError() { return g_lastError; }

std::string occtVersionString() { return OCC_VERSION_COMPLETE; }

// Face-index lists cross the boundary as a heap buffer (mirrors how file
// payloads reach readStep): TypeScript mallocs, writes 32-bit indices, and
// passes pointer + count. Null pointer with count 0 means "empty".
std::vector<int> indicesFromHeap(unsigned int ptr, int count) {
  std::vector<int> indices;
  indices.reserve(count);
  const int* values = reinterpret_cast<const int*>(ptr);
  for (int i = 0; i < count; ++i) {
    indices.push_back(values[i]);
  }
  return indices;
}

// Polygon point lists cross the same way, as 64-bit coordinate triples.
std::vector<double> doublesFromHeap(unsigned int ptr, int count) {
  std::vector<double> values;
  values.reserve(count > 0 ? count : 0);
  const double* doubles = reinterpret_cast<const double*>(ptr);
  for (int i = 0; i < count; ++i) {
    values.push_back(doubles[i]);
  }
  return values;
}

// --- wrapped entry points ----------------------------------------------------

OccShape makeBoxWrap(double dx, double dy, double dz) {
  return guarded("makeBox", [&] { return makeBox(dx, dy, dz); }, OccShape());
}

OccShape makeCylinderWrap(double radius, double height,
                          double dx, double dy, double dz,
                          double ox, double oy, double oz) {
  return guarded(
      "makeCylinder", [&] { return makeCylinder(radius, height, dx, dy, dz, ox, oy, oz); },
      OccShape());
}

OccShape makeSphereWrap(double radius, double ox, double oy, double oz) {
  return guarded("makeSphere", [&] { return makeSphere(radius, ox, oy, oz); }, OccShape());
}

OccShape makeConeWrap(double radius1, double radius2, double height,
                      double dx, double dy, double dz,
                      double ox, double oy, double oz) {
  return guarded(
      "makeCone", [&] { return makeCone(radius1, radius2, height, dx, dy, dz, ox, oy, oz); },
      OccShape());
}

OccShape makeTorusWrap(double majorRadius, double minorRadius,
                       double dx, double dy, double dz,
                       double ox, double oy, double oz) {
  return guarded(
      "makeTorus", [&] { return makeTorus(majorRadius, minorRadius, dx, dy, dz, ox, oy, oz); },
      OccShape());
}

OccShape makeCircleWrap(double radius,
                        double nx, double ny, double nz,
                        double ox, double oy, double oz) {
  return guarded(
      "makeCircle", [&] { return makeCircleWire(radius, nx, ny, nz, ox, oy, oz); }, OccShape());
}

OccShape makePolygonWrap(unsigned int ptr, int pointCount, bool close) {
  return guarded(
      "makePolygon", [&] { return makePolygonWire(doublesFromHeap(ptr, pointCount * 3), close); },
      OccShape());
}

OccShape makeLineWrap(double x1, double y1, double z1, double x2, double y2, double z2) {
  return guarded("makeLine", [&] { return makeLineWire(x1, y1, z1, x2, y2, z2); }, OccShape());
}

OccShape makeArcWrap(double radius,
                     double nx, double ny, double nz,
                     double ox, double oy, double oz,
                     double u1, double u2) {
  return guarded(
      "makeArc", [&] { return makeArcWire(radius, nx, ny, nz, ox, oy, oz, u1, u2); }, OccShape());
}

OccShape makeEllipseWrap(double majorRadius, double minorRadius,
                         double nx, double ny, double nz,
                         double ox, double oy, double oz) {
  return guarded(
      "makeEllipse",
      [&] { return makeEllipseWire(majorRadius, minorRadius, nx, ny, nz, ox, oy, oz); },
      OccShape());
}

OccShape makeBsplineWrap(unsigned int ptr, int poleCount, int degree) {
  return guarded(
      "makeBspline", [&] { return makeBsplineWire(doublesFromHeap(ptr, poleCount * 3), degree); },
      OccShape());
}

OccShape makeBsplineThroughWrap(unsigned int ptr, int pointCount, bool periodic, double tolerance) {
  return guarded(
      "makeBsplineThrough",
      [&] { return interpolateBsplineWire(doublesFromHeap(ptr, pointCount * 3), periodic, tolerance); },
      OccShape());
}

OccShape makeWireWrap(const std::vector<OccShape>& parts) {
  return guarded("makeWire", [&] { return assembleWire(parts); }, OccShape());
}

OccShape fuseWrap(const OccShape& a, const OccShape& b) {
  return guarded("fuse", [&] { return booleanOp(0, a, b); }, OccShape());
}

OccShape cutWrap(const OccShape& a, const OccShape& b) {
  return guarded("cut", [&] { return booleanOp(1, a, b); }, OccShape());
}

OccShape commonWrap(const OccShape& a, const OccShape& b) {
  return guarded("common", [&] { return booleanOp(2, a, b); }, OccShape());
}

OccShape translateWrap(const OccShape& shape, double dx, double dy, double dz) {
  return guarded("translate", [&] { return translateShape(shape, dx, dy, dz); }, OccShape());
}

OccShape rotateWrap(const OccShape& shape, double ax, double ay, double az, double angle) {
  return guarded("rotate", [&] { return rotateShape(shape, ax, ay, az, angle); }, OccShape());
}

OccShape scaleWrap(const OccShape& shape, double factor) {
  return guarded("scale", [&] { return scaleShape(shape, factor); }, OccShape());
}

OccShape shellWrap(const OccShape& shape, double thickness, unsigned int facesPtr, int faceCount) {
  return guarded(
      "shell", [&] { return shellShape(shape, thickness, indicesFromHeap(facesPtr, faceCount)); },
      OccShape());
}

OccShape draftWrap(const OccShape& shape, double angleRadians,
                   double dx, double dy, double dz,
                   double nx, double ny, double nz,
                   unsigned int facesPtr, int faceCount, bool autoSelectWalls) {
  return guarded(
      "draft",
      [&] {
        return draftShape(shape, angleRadians, dx, dy, dz, nx, ny, nz,
                          indicesFromHeap(facesPtr, faceCount), autoSelectWalls);
      },
      OccShape());
}

OccShape filletWrap(const OccShape& shape, double radius, unsigned int edgesPtr, int edgeCount) {
  return guarded(
      "fillet", [&] { return filletShape(shape, radius, indicesFromHeap(edgesPtr, edgeCount)); },
      OccShape());
}

OccShape chamferWrap(const OccShape& shape, double distance, unsigned int edgesPtr, int edgeCount) {
  return guarded(
      "chamfer",
      [&] { return chamferShape(shape, distance, indicesFromHeap(edgesPtr, edgeCount)); },
      OccShape());
}

OccShape variableFilletWrap(const OccShape& shape,
                            unsigned int edgesPtr, int edgeCount,
                            unsigned int radiiPtr, unsigned int positionsPtr) {
  return guarded(
      "variableFillet",
      [&] {
        return variableFilletShape(shape, indicesFromHeap(edgesPtr, edgeCount),
                                   doublesFromHeap(radiiPtr, edgeCount),
                                   doublesFromHeap(positionsPtr, edgeCount));
      },
      OccShape());
}

OccShape extrudeWrap(const OccShape& profile, double dx, double dy, double dz, bool solid) {
  return guarded(
      "extrude", [&] { return extrudeShape(profile, dx, dy, dz, solid); }, OccShape());
}

OccShape revolveWrap(const OccShape& profile,
                     double ax, double ay, double az,
                     double ox, double oy, double oz,
                     double angleRadians, bool solid) {
  return guarded(
      "revolve",
      [&] { return revolveShape(profile, ax, ay, az, ox, oy, oz, angleRadians, solid); },
      OccShape());
}

OccShape loftWrap(const std::vector<OccShape>& sections, bool ruled, bool solid) {
  return guarded("loft", [&] { return loftShapes(sections, ruled, solid); }, OccShape());
}

OccShape sweepWrap(const OccShape& profile, const OccShape& spine, bool solid) {
  return guarded("sweep", [&] { return sweepShape(profile, spine, solid); }, OccShape());
}

MeshData tessellateWrap(const OccShape& shape, double linDefl, double angDeflDeg, bool relative) {
  return guarded(
      "tessellate", [&] { return tessellateShape(shape, linDefl, angDeflDeg, relative); },
      MeshData());
}

HlrData hiddenLinesWrap(const OccShape& shape,
                        double dirX, double dirY, double dirZ,
                        double upX, double upY, double upZ,
                        double deflection) {
  return guarded(
      "hiddenLines",
      [&] { return computeHiddenLines(shape, dirX, dirY, dirZ, upX, upY, upZ, deflection); },
      HlrData());
}

OccShape readStepWrap(unsigned int ptr, int length, const std::string& unit) {
  return guarded("readStep: STEP import failed", [&] { return readStepBytes(ptr, length, unit); }, OccShape());
}

OccShape readBrepWrap(unsigned int ptr, int length) {
  return guarded("readBrep: BREP import failed", [&] { return readBrepBytes(ptr, length); }, OccShape());
}

OccShape readIgesWrap(unsigned int ptr, int length) {
  return guarded("readIges: IGES import failed", [&] { return readIgesBytes(ptr, length); }, OccShape());
}

std::string readStepDocumentWrap(unsigned int ptr, int length, const std::string& unit) {
  return guarded("readStepDocument: STEP document import failed",
                 [&] { return readStepDocumentBytes(ptr, length, unit); }, std::string());
}

OccShape getDocumentShapeWrap(int index) {
  return guarded("documentShape", [&] { return getDocumentShape(index); }, OccShape());
}

std::string writeStepWrap(const OccShape& shape, const std::string& unit) {
  return guarded("writeStep", [&] { return writeStep(shape, unit); }, std::string());
}

std::string writeBrepWrap(const OccShape& shape, bool withTriangles) {
  return guarded("writeBrep", [&] { return writeBrep(shape, withTriangles); }, std::string());
}

std::string writeIgesWrap(const OccShape& shape) {
  return guarded("writeIges", [&] { return writeIges(shape); }, std::string());
}

// --- geometry interrogation ----------------------------------------------------

std::string describeWrap(const OccShape& shape) {
  return guarded("describe", [&] { return describeGeometry(shape); }, std::string());
}

std::string distanceWrap(const OccShape& a, const OccShape& b) {
  return guarded("distance", [&] { return distanceBetween(a, b); }, std::string());
}

OccShape sectionWrap(const OccShape& a, const OccShape& b) {
  return guarded("section", [&] { return sectionOf(a, b); }, OccShape());
}

std::string classifyPointWrap(const OccShape& shape, double x, double y, double z) {
  return guarded("classifyPoint", [&] { return classifyPointIn(shape, x, y, z); }, std::string("unknown"));
}

} // namespace

EMSCRIPTEN_BINDINGS(opencascade_ts) {
  register_vector<double>("VectorDouble");
  register_vector<OccShape>("VectorShape");

  function("hasError", &hasError);
  function("lastError", &lastError);

  class_<OccShape>("Shape")
      .constructor()
      .function("isNull", &OccShape::isNull)
      .function("shapeType", &OccShape::shapeType)
      .function("volume", &OccShape::volume)
      .function("area", &OccShape::area)
      .function("bounds", &OccShape::bounds)
      .function("centroid", &OccShape::centroid)
      .function("isValid", &OccShape::isValid)
      .function("countSubShapes", &OccShape::countSubShapes);

  class_<MeshData>("MeshData")
      .function("positionsPtr", &MeshData::positionsPtr)
      .function("positionCount", &MeshData::positionCount)
      .function("indicesPtr", &MeshData::indicesPtr)
      .function("indexCount", &MeshData::indexCount)
      .function("edgesPtr", &MeshData::edgesPtr)
      .function("edgePointCount", &MeshData::edgePointCount);

  class_<HlrData>("HlrData")
      .function("visiblePtr", &HlrData::visiblePtr)
      .function("visiblePointCount", &HlrData::visiblePointCount)
      .function("hiddenPtr", &HlrData::hiddenPtr)
      .function("hiddenPointCount", &HlrData::hiddenPointCount);

  function("occtVersion", &occtVersionString);

  function("makeBox", &makeBoxWrap);
  function("makeCylinder", &makeCylinderWrap);
  function("makeSphere", &makeSphereWrap);
  function("makeCone", &makeConeWrap);
  function("makeTorus", &makeTorusWrap);
  function("makeCircle", &makeCircleWrap);
  function("makePolygon", &makePolygonWrap);
  function("makeLine", &makeLineWrap);
  function("makeArc", &makeArcWrap);
  function("makeEllipse", &makeEllipseWrap);
  function("makeBspline", &makeBsplineWrap);
  function("makeBsplineThrough", &makeBsplineThroughWrap);
  function("makeWire", &makeWireWrap);

  function("fuse", &fuseWrap);
  function("cut", &cutWrap);
  function("common", &commonWrap);

  function("translate", &translateWrap);
  function("rotate", &rotateWrap);
  function("scale", &scaleWrap);

  function("shell", &shellWrap);
  function("draft", &draftWrap);
  function("fillet", &filletWrap);
  function("chamfer", &chamferWrap);
  function("variableFillet", &variableFilletWrap);

  function("extrude", &extrudeWrap);
  function("revolve", &revolveWrap);
  function("loft", &loftWrap);
  function("sweep", &sweepWrap);

  function("tessellate", &tessellateWrap);
  function("hiddenLines", &hiddenLinesWrap);

  function("readStep", &readStepWrap);
  function("readBrep", &readBrepWrap);
  function("readIges", &readIgesWrap);
  function("readStepDocument", &readStepDocumentWrap);
  function("documentShapeCount", &documentShapeCount);
  function("getDocumentShape", &getDocumentShapeWrap);
  function("writeStep", &writeStepWrap);
  function("writeBrep", &writeBrepWrap);
  function("writeIges", &writeIgesWrap);

  function("describe", &describeWrap);
  function("distance", &distanceWrap);
  function("section", &sectionWrap);
  function("classifyPoint", &classifyPointWrap);
}
