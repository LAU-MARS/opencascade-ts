#include "io.h"

#include <BRepTools.hxx>
#include <BRep_Builder.hxx>
#include <IFSelect_ReturnStatus.hxx>
#include <STEPControl_Reader.hxx>
#include <STEPControl_StepModelType.hxx>
#include <STEPControl_Writer.hxx>
#include <TopoDS_Shape.hxx>

#include <filesystem>
#include <fstream>
#include <sstream>
#include <stdexcept>

namespace {

void ensureMemFs() {
  static const bool ready = [] {
    std::error_code ec;
    std::filesystem::create_directories("/mem", ec);
    return true;
  }();
  (void)ready;
}

void writeTemp(const char* path, const char* data, int length) {
  std::ofstream out(path, std::ios::binary);
  out.write(data, (std::streamsize)length);
  out.flush();
  if (!out) {
    throw std::runtime_error(std::string("could not stage ") + path + " in MEMFS");
  }
}

std::string readTemp(const char* path) {
  std::ifstream in(path, std::ios::binary);
  std::ostringstream buffer;
  buffer << in.rdbuf();
  if (!in && !in.eof()) {
    throw std::runtime_error(std::string("could not read ") + path + " from MEMFS");
  }
  return buffer.str();
}

} // namespace

OccShape readStepBytes(unsigned int ptr, int length) {
  ensureMemFs();
  writeTemp("/mem/occt_in.step", (const char*)(uintptr_t)ptr, length);

  STEPControl_Reader reader;
  IFSelect_ReturnStatus status = reader.ReadFile("/mem/occt_in.step");
  if (status != IFSelect_RetDone) {
    throw std::runtime_error("STEP import failed: could not parse the file (status " +
                             std::to_string((int)status) + ")");
  }
  if (reader.TransferRoots() == 0) {
    throw std::runtime_error("STEP import failed: no transferable roots found");
  }
  return OccShape(reader.OneShape());
}

OccShape readBrepBytes(unsigned int ptr, int length) {
  ensureMemFs();
  writeTemp("/mem/occt_in.brep", (const char*)(uintptr_t)ptr, length);

  TopoDS_Shape shape;
  BRep_Builder builder;
  std::ifstream in("/mem/occt_in.brep", std::ios::binary);
  BRepTools::Read(shape, in, builder);
  if (shape.IsNull()) {
    throw std::runtime_error("BREP import failed: not a valid BRep file");
  }
  return OccShape(shape);
}

std::string writeStep(const OccShape& shape) {
  ensureMemFs();
  STEPControl_Writer writer;
  IFSelect_ReturnStatus status = writer.Transfer(shape.get(), STEPControl_AsIs);
  if (status != IFSelect_RetDone) {
    throw std::runtime_error("STEP export failed during transfer (status " +
                             std::to_string((int)status) + ")");
  }
  status = writer.Write("/mem/occt_out.step");
  if (status != IFSelect_RetDone) {
    throw std::runtime_error("STEP export failed during write (status " +
                             std::to_string((int)status) + ")");
  }
  return readTemp("/mem/occt_out.step");
}

std::string writeBrep(const OccShape& shape, bool withTriangles) {
  ensureMemFs();
  std::ofstream out("/mem/occt_out.brep", std::ios::binary);
  BRepTools::Write(shape.get(), out, withTriangles, false, TopTools_FormatVersion_VERSION_3);
  out.flush();
  if (!out) {
    throw std::runtime_error("BREP export failed");
  }
  return readTemp("/mem/occt_out.brep");
}
