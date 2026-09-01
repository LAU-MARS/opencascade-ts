#include "io.h"

#include "json.h"

#include <BRepTools.hxx>
#include <BRep_Builder.hxx>
#include <IFSelect_ReturnStatus.hxx>
#include <IGESControl_Reader.hxx>
#include <IGESControl_Writer.hxx>
#include <Interface_Static.hxx>
#include <STEPControl_Reader.hxx>
#include <STEPControl_StepModelType.hxx>
#include <STEPControl_Writer.hxx>
#include <STEPCAFControl_Reader.hxx>
#include <TCollection_AsciiString.hxx>
#include <TDataStd_Name.hxx>
#include <TDF_Label.hxx>
#include <TDF_LabelSequence.hxx>
#include <TDocStd_Document.hxx>
#include <TopLoc_Location.hxx>
#include <TopTools_FormatVersion.hxx>
#include <TopoDS_Shape.hxx>
#include <XCAFDoc_ColorTool.hxx>
#include <XCAFDoc_ColorType.hxx>
#include <XCAFDoc_DocumentTool.hxx>
#include <XCAFDoc_ShapeTool.hxx>
#include <gp_Trsf.hxx>
#include <Quantity_Color.hxx>

#include <cctype>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <stdexcept>
#include <vector>

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

// OCCT unit keywords ("MM", "INCH", ...); empty string keeps defaults.
std::string normalizeUnit(const std::string& unit) {
  std::string upper;
  for (char c : unit) {
    upper.push_back((char)std::toupper((unsigned char)c));
  }
  if (upper.empty()) return upper;
  if (upper == "IN") upper = "INCH";
  const bool valid = upper == "MM" || upper == "CM" || upper == "M" || upper == "KM" ||
                     upper == "INCH" || upper == "FT" || upper == "MI" || upper == "UM";
  if (!valid) {
    throw std::runtime_error("unknown unit \"" + unit + "\" — expected mm/cm/m/km/in(ch)/ft/mi/um");
  }
  return upper;
}

void applyReadUnit(const std::string& unit) {
  const std::string upper = normalizeUnit(unit);
  if (!upper.empty()) {
    Interface_Static::SetCVal("xstep.cascade.unit", upper.c_str());
  }
}

void applyWriteUnit(const std::string& unit) {
  const std::string upper = normalizeUnit(unit);
  if (!upper.empty()) {
    Interface_Static::SetCVal("write.step.unit", upper.c_str());
  }
}

// --- XCAF document state ------------------------------------------------------

Handle(TDocStd_Document) g_document;
std::vector<TopoDS_Shape> g_documentShapes;

std::string labelName(const TDF_Label& label) {
  Handle(TDataStd_Name) attribute;
  if (label.FindAttribute(TDataStd_Name::GetID(), attribute) && !attribute.IsNull()) {
    TCollection_AsciiString ascii(attribute->Get());
    const char* text = ascii.ToCString();
    if (text) return std::string(text);
  }
  return "";
}

std::string labelColor(const Handle(XCAFDoc_ColorTool)& colorTool, const TDF_Label& label) {
  Quantity_Color color;
  if (colorTool->GetColor(label, XCAFDoc_ColorGen, color) ||
      colorTool->GetColor(label, XCAFDoc_ColorSurf, color)) {
    char hex[10];
    std::snprintf(hex, sizeof(hex), "#%02X%02X%02X",
                  (int)(color.Red() * 255.0 + 0.5),
                  (int)(color.Green() * 255.0 + 0.5),
                  (int)(color.Blue() * 255.0 + 0.5));
    return std::string(hex);
  }
  return "";
}

void walkLabel(std::ostringstream& out,
               const Handle(XCAFDoc_ShapeTool)& shapeTool,
               const Handle(XCAFDoc_ColorTool)& colorTool,
               const TDF_Label& label,
               const gp_Trsf& parent,
               int depth) {
  if (depth > 32) {
    out << "{\"name\":null}";
    return;
  }

  std::string name = labelName(label);
  std::string color = labelColor(colorTool, label);

  out << "{\"name\":";
  if (name.empty()) {
    out << "null";
  } else {
    jsonString(out, name);
  }

  if (!color.empty()) {
    out << ",\"color\":\"" << color << '"';
  }

  if (parent.Form() != gp_Identity) {
    out << ",\"transform\":[";
    for (int row = 1; row <= 3; ++row) {
      for (int col = 1; col <= 4; ++col) {
        if (row > 1 || col > 1) out << ',';
        out << jsonNumber(parent.Value(row, col));
      }
    }
    out << ']';
  }

  if (shapeTool->IsAssembly(label)) {
    out << ",\"children\":[";
    TDF_LabelSequence components;
    shapeTool->GetComponents(label, components);
    for (int i = 1; i <= components.Length(); ++i) {
      const TDF_Label component = components.Value(i);
      gp_Trsf composed = parent;
      const TopLoc_Location location = shapeTool->GetLocation(component);
      if (!location.IsIdentity()) {
        composed = composed.Multiplied(location.Transformation());
      }
      TDF_Label referred;
      if (!shapeTool->GetReferredShape(component, referred)) {
        continue;
      }
      if (i > 1) out << ',';
      walkLabel(out, shapeTool, colorTool, referred, composed, depth + 1);
    }
    out << ']';
  } else {
    TopoDS_Shape shp = shapeTool->GetShape(label);
    if (!shp.IsNull()) {
      if (parent.Form() != gp_Identity) {
        shp.Move(TopLoc_Location(parent));
      }
      out << ",\"shape\":" << (int)g_documentShapes.size();
      g_documentShapes.push_back(shp);
    }
  }
  out << '}';
}

} // namespace

// --- STEP / BRep --------------------------------------------------------------

OccShape readStepBytes(unsigned int ptr, int length, const std::string& unit) {
  ensureMemFs();
  applyReadUnit(unit);
  writeTemp("/mem/occt_in.step", (const char*)(uintptr_t)ptr, length);

  STEPControl_Reader reader;
  IFSelect_ReturnStatus status = reader.ReadFile("/mem/occt_in.step");
  if (status != IFSelect_RetDone) {
    throw std::runtime_error("could not parse the file (status " +
                             std::to_string((int)status) + ")");
  }
  if (reader.TransferRoots() == 0) {
    throw std::runtime_error("no transferable roots found");
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
    throw std::runtime_error("not a valid BRep file");
  }
  return OccShape(shape);
}

std::string writeStep(const OccShape& shape, const std::string& unit) {
  ensureMemFs();
  applyWriteUnit(unit);
  STEPControl_Writer writer;
  IFSelect_ReturnStatus status = writer.Transfer(shape.get(), STEPControl_AsIs);
  if (status != IFSelect_RetDone) {
    throw std::runtime_error("transfer failed (status " + std::to_string((int)status) + ")");
  }
  status = writer.Write("/mem/occt_out.step");
  if (status != IFSelect_RetDone) {
    throw std::runtime_error("write failed (status " + std::to_string((int)status) + ")");
  }
  return readTemp("/mem/occt_out.step");
}

std::string writeBrep(const OccShape& shape, bool withTriangles) {
  ensureMemFs();
  std::ofstream out("/mem/occt_out.brep", std::ios::binary);
  BRepTools::Write(shape.get(), out, withTriangles, false, TopTools_FormatVersion_VERSION_3);
  out.flush();
  if (!out) {
    throw std::runtime_error("write failed");
  }
  return readTemp("/mem/occt_out.brep");
}

// --- IGES ----------------------------------------------------------------------

OccShape readIgesBytes(unsigned int ptr, int length) {
  ensureMemFs();
  writeTemp("/mem/occt_in.igs", (const char*)(uintptr_t)ptr, length);

  IGESControl_Reader reader;
  IFSelect_ReturnStatus status = reader.ReadFile("/mem/occt_in.igs");
  if (status != IFSelect_RetDone) {
    throw std::runtime_error("could not parse the file (status " +
                             std::to_string((int)status) + ")");
  }
  if (reader.TransferRoots() == 0) {
    throw std::runtime_error("no transferable roots found");
  }
  return OccShape(reader.OneShape());
}

std::string writeIges(const OccShape& shape) {
  ensureMemFs();
  IGESControl_Writer writer;
  writer.AddShape(shape.get());
  writer.ComputeModel();
  writer.Write("/mem/occt_out.igs");
  return readTemp("/mem/occt_out.igs");
}

// --- XCAF document -------------------------------------------------------------

std::string readStepDocumentBytes(unsigned int ptr, int length, const std::string& unit) {
  ensureMemFs();
  applyReadUnit(unit);
  writeTemp("/mem/occt_in.step", (const char*)(uintptr_t)ptr, length);

  STEPCAFControl_Reader reader;
  reader.SetNameMode(true);
  reader.SetColorMode(true);
  reader.SetLayerMode(false);
  IFSelect_ReturnStatus status = reader.ReadFile("/mem/occt_in.step");
  if (status != IFSelect_RetDone) {
    throw std::runtime_error("could not parse the file (status " +
                             std::to_string((int)status) + ")");
  }

  Handle(TDocStd_Document) doc = new TDocStd_Document("MDTV-XCAF");
  if (!reader.Transfer(doc)) {
    throw std::runtime_error("no transferable roots found");
  }
  g_document = doc;
  g_documentShapes.clear();

  Handle(XCAFDoc_ShapeTool) shapeTool = XCAFDoc_DocumentTool::ShapeTool(doc->Main());
  Handle(XCAFDoc_ColorTool) colorTool = XCAFDoc_DocumentTool::ColorTool(doc->Main());

  std::ostringstream out;
  out << "{\"format\":\"step\",\"tree\":[";
  TDF_LabelSequence roots;
  shapeTool->GetFreeShapes(roots);
  for (int i = 1; i <= roots.Length(); ++i) {
    if (i > 1) out << ',';
    walkLabel(out, shapeTool, colorTool, roots.Value(i), gp_Trsf(), 0);
  }
  out << "],\"shapeCount\":" << (int)g_documentShapes.size() << "}";
  return out.str();
}

OccShape getDocumentShape(int index) {
  if (index < 0 || index >= (int)g_documentShapes.size()) {
    throw std::runtime_error("document shape index out of range");
  }
  return OccShape(g_documentShapes[index]);
}

int documentShapeCount() {
  return (int)g_documentShapes.size();
}
