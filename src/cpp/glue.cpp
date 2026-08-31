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

OccShape readStepWrap(unsigned int ptr, int length) {
  return guarded("readStep: STEP import failed", [&] { return readStepBytes(ptr, length); }, OccShape());
}

OccShape readBrepWrap(unsigned int ptr, int length) {
  return guarded("readBrep: BREP import failed", [&] { return readBrepBytes(ptr, length); }, OccShape());
}

std::string writeStepWrap(const OccShape& shape) {
  return guarded("writeStep", [&] { return writeStep(shape); }, std::string());
}

std::string writeBrepWrap(const OccShape& shape, bool withTriangles) {
  return guarded("writeBrep", [&] { return writeBrep(shape, withTriangles); }, std::string());
}

} // namespace

EMSCRIPTEN_BINDINGS(opencascade_ts) {
  register_vector<double>("VectorDouble");

  function("hasError", &hasError);
  function("lastError", &lastError);

  class_<OccShape>("Shape")
      .constructor()
      .function("isNull", &OccShape::isNull)
      .function("shapeType", &OccShape::shapeType)
      .function("volume", &OccShape::volume)
      .function("area", &OccShape::area)
      .function("bounds", &OccShape::bounds)
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

  function("fuse", &fuseWrap);
  function("cut", &cutWrap);
  function("common", &commonWrap);

  function("translate", &translateWrap);
  function("rotate", &rotateWrap);
  function("scale", &scaleWrap);

  function("tessellate", &tessellateWrap);
  function("hiddenLines", &hiddenLinesWrap);

  function("readStep", &readStepWrap);
  function("readBrep", &readBrepWrap);
  function("writeStep", &writeStepWrap);
  function("writeBrep", &writeBrepWrap);
}
