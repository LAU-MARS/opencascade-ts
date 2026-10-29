#include "io.h"

#include "json.h"

#include <BRepTools.hxx>
#include <BRep_Builder.hxx>
#include <IFSelect_ReturnStatus.hxx>
#include <IGESControl_Reader.hxx>
#include <IGESControl_Writer.hxx>
#include <Interface_Static.hxx>
#include <STEPCAFControl_Writer.hxx>
#include <STEPControl_Reader.hxx>
#include <STEPControl_StepModelType.hxx>
#include <STEPControl_Writer.hxx>
#include <STEPCAFControl_Reader.hxx>
#include <TCollection_AsciiString.hxx>
#include <TDataStd_Name.hxx>
#include <TDataStd_UAttribute.hxx>
#include <TDF_Label.hxx>
#include <TDF_LabelSequence.hxx>
#include <TDocStd_Document.hxx>
#include <TopLoc_Location.hxx>
#include <TopTools_FormatVersion.hxx>
#include <TopExp_Explorer.hxx>
#include <TopoDS_Shape.hxx>
#include <XCAFDoc.hxx>
#include <XCAFDoc_ColorTool.hxx>
#include <XCAFDoc_ColorType.hxx>
#include <XCAFDoc_DocumentTool.hxx>
#include <XCAFDoc_ShapeTool.hxx>
#include <gp_Trsf.hxx>
#include <Quantity_Color.hxx>

#include <cctype>
#include <cmath>
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
    // STEP colors travel as sRGB components; Quantity_Color stores linear RGB
    // internally, so ask for the sRGB view explicitly (same on the write side).
    double r = 0, g = 0, b = 0;
    color.Values(r, g, b, Quantity_TOC_sRGB);
    std::snprintf(hex, sizeof(hex), "#%02X%02X%02X",
                  (int)(r * 255.0 + 0.5), (int)(g * 255.0 + 0.5), (int)(b * 255.0 + 0.5));
    return std::string(hex);
  }
  return "";
}

// STEP product names OCCT synthesizes from shape types when a label carries no
// name of its own ("SOLID" for a wrapped solid). They carry no user intent, so
// the placement-wrapper collapse below treats them as absent.
bool isAutoShapeName(const std::string& name) {
  static const char* const names[] = {
      "", "SOLID", "COMPOUND", "SHELL", "OPEN_SHELL", "CLOSED_SHELL",
      "WIRE", "EDGE", "FACE", "VERTEX",
  };
  for (const char* candidate : names) {
    if (name == candidate) return true;
  }
  return false;
}

// Emits one tree node. `chain` is the composed placement of the node's
// ancestors, EXCLUDING the node itself; the node's own placement (reference
// locations, plus any location stored on the shape itself — the reader keeps
// located roots directly on the label's shape) is resolved here and reported
// parent-relative, mirroring writeStepDocument's input.
void walkLabel(std::ostringstream& out,
               const Handle(XCAFDoc_ShapeTool)& shapeTool,
               const Handle(XCAFDoc_ColorTool)& colorTool,
               const TDF_Label& label,
               const gp_Trsf& chain,
               int depth) {
  if (depth > 32) {
    out << "{\"name\":null}";
    return;
  }

  // Resolve the reference chain into the node's own placement.
  gp_Trsf own;
  TDF_Label content = label;
  while (shapeTool->IsReference(content)) {
    const TopLoc_Location location = shapeTool->GetLocation(content);
    if (!location.IsIdentity()) {
      own = own.Multiplied(location.Transformation());
    }
    TDF_Label referred;
    if (!shapeTool->GetReferredShape(content, referred)) {
      break;
    }
    content = referred;
  }
  if (!shapeTool->IsReference(content)) {
    const TopoDS_Shape stored = shapeTool->GetShape(content);
    if (!stored.IsNull() && !stored.Location().IsIdentity()) {
      own = own.Multiplied(stored.Location().Transformation());
    }
  }

  std::string name = labelName(content);
  if (name.empty()) name = labelName(label);
  std::string color = labelColor(colorTool, content);
  if (color.empty()) color = labelColor(colorTool, label);

  // A single component over an unnamed, uncolored shape is a placement
  // wrapper (writeStepDocument emits one for every located root; other CAD
  // systems do the same for placed products). Collapse it so the tree shows
  // one node carrying a transform instead of a phantom layer.
  gp_Trsf placement = own;
  TDF_Label childrenOf;
  TDF_Label leafContent;
  if (shapeTool->IsAssembly(content)) {
    TDF_LabelSequence components;
    shapeTool->GetComponents(content, components);
    bool collapsed = false;
    if (components.Length() == 1) {
      const TDF_Label component = components.Value(1);
      TDF_Label referred;
      if (shapeTool->GetReferredShape(component, referred) &&
          isAutoShapeName(labelName(referred))) {
        const TopLoc_Location componentLoc = shapeTool->GetLocation(component);
        if (!componentLoc.IsIdentity()) {
          placement = placement.Multiplied(componentLoc.Transformation());
        }
        const TopoDS_Shape stored = shapeTool->GetShape(referred);
        if (!stored.IsNull() && !stored.Location().IsIdentity()) {
          placement = placement.Multiplied(stored.Location().Transformation());
        }
        if (shapeTool->IsAssembly(referred)) {
          childrenOf = referred;
        } else {
          leafContent = referred;
        }
        if (color.empty()) color = labelColor(colorTool, referred);
        if (color.empty()) color = labelColor(colorTool, component);
        collapsed = true;
      }
    }
    if (!collapsed) childrenOf = content;
  } else {
    leafContent = content;
  }

  out << "{\"name\":";
  if (name.empty()) {
    out << "null";
  } else {
    jsonString(out, name);
  }

  if (!color.empty()) {
    out << ",\"color\":\"" << color << '"';
  }

  if (placement.Form() != gp_Identity) {
    out << ",\"transform\":[";
    for (int row = 1; row <= 3; ++row) {
      for (int col = 1; col <= 4; ++col) {
        if (row > 1 || col > 1) out << ',';
        out << jsonNumber(placement.Value(row, col));
      }
    }
    out << ']';
  }

  if (!leafContent.IsNull()) {
    TopoDS_Shape shp = shapeTool->GetShape(leafContent);
    if (!shp.IsNull()) {
      // `placement` already carries the shape's own location — strip it, then
      // attach the full world chain once (documentShape stays world-positioned).
      shp.Location(TopLoc_Location());
      const gp_Trsf world = chain.Multiplied(placement);
      if (world.Form() != gp_Identity) {
        shp.Move(TopLoc_Location(world));
      }
      out << ",\"shape\":" << (int)g_documentShapes.size();
      g_documentShapes.push_back(shp);
    }
  } else {
    out << ",\"children\":[";
    const gp_Trsf childChain = chain.Multiplied(placement);
    TDF_LabelSequence components;
    shapeTool->GetComponents(childrenOf, components);
    for (int i = 1; i <= components.Length(); ++i) {
      if (i > 1) out << ',';
      walkLabel(out, shapeTool, colorTool, components.Value(i), childChain, depth + 1);
    }
    out << ']';
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

// --- MEMFS bridge ----------------------------------------------------------------

void memWriteFileBytes(const std::string& path, unsigned int ptr, int length) {
  ensureMemFs();
  writeTemp(path.c_str(), (const char*)(uintptr_t)ptr, length);
}

std::string memReadFileBytes(const std::string& path) {
  ensureMemFs();
  return readTemp(path.c_str());
}

// --- XCAF document writing ------------------------------------------------------

namespace {

int hexDigit(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return -1;
}

// "#RRGGBB" (case-insensitive) → Quantity_Color; empty string → no color.
// sRGB components — the STEP convention (mirrors labelColor).
Quantity_Color parseColor(const std::string& hex) {
  const int r = hexDigit(hex[1]) * 16 + hexDigit(hex[2]);
  const int g = hexDigit(hex[3]) * 16 + hexDigit(hex[4]);
  const int b = hexDigit(hex[5]) * 16 + hexDigit(hex[6]);
  if (hex.length() != 7 || hex[0] != '#' || r < 0 || g < 0 || b < 0) {
    throw std::runtime_error("color \"" + hex + "\" is not #RRGGBB");
  }
  return Quantity_Color(r / 255.0, g / 255.0, b / 255.0, Quantity_TOC_sRGB);
}

} // namespace

std::string writeStepDocument(const std::vector<OccShape>& shapes,
                              const std::vector<int>& parents,
                              const std::vector<int>& shapeIndices,
                              const std::vector<std::string>& names,
                              const std::vector<std::string>& colors,
                              const std::vector<double>& transforms,
                              const std::string& unit) {
  ensureMemFs();
  applyWriteUnit(unit);

  const int nodeCount = (int)parents.size();
  if (nodeCount == 0) throw std::runtime_error("the document tree is empty");
  if ((int)shapeIndices.size() != nodeCount || (int)names.size() != nodeCount ||
      (int)colors.size() != nodeCount || (int)transforms.size() != 12 * nodeCount) {
    throw std::runtime_error("malformed document tree arrays");
  }

  Handle(TDocStd_Document) doc = new TDocStd_Document("MDTV-XCAF");
  Handle(XCAFDoc_ShapeTool) shapeTool = XCAFDoc_DocumentTool::ShapeTool(doc->Main());
  Handle(XCAFDoc_ColorTool) colorTool = XCAFDoc_DocumentTool::ColorTool(doc->Main());

  auto nodeTrsf = [&](int i) {
    gp_Trsf trsf;
    const double* values = &transforms[12 * (size_t)i];
    if (!std::isnan(values[0])) {
      // Row-major 3×4, the same 12 numbers readStepDocument emits.
      trsf.SetValues(values[0], values[1], values[2], values[3],
                     values[4], values[5], values[6], values[7],
                     values[8], values[9], values[10], values[11]);
    }
    return trsf;
  };

  // Pass 1 (pre-order): content labels for leaves, stored with their location
  // stripped. XCAFDoc_ShapeTool::AddShape splits ANY located shape into a base
  // label plus reference — that reference is what leaks a phantom "SOLID"
  // child into the written tree. The stripped location composes under the
  // node transform instead: world = parent chain ∘ node transform ∘ own
  // TopLoc. Parents precede children, so anything needed later exists.
  std::vector<TDF_Label> labels(nodeCount);
  std::vector<bool> assemblyNodes(nodeCount, false);
  std::vector<TopoDS_Shape> assembled(nodeCount);
  std::vector<gp_Trsf> total(nodeCount);
  for (int i = 0; i < nodeCount; ++i) {
    if (parents[i] < -1 || parents[i] >= i) {
      throw std::runtime_error("document tree nodes must list parents before children");
    }
    gp_Trsf placement = nodeTrsf(i);
    if (shapeIndices[i] >= 0) {
      if (shapeIndices[i] >= (int)shapes.size()) {
        throw std::runtime_error("document tree shape index out of range");
      }
      TopoDS_Shape shape = shapes[shapeIndices[i]].get();
      if (!shape.Location().IsIdentity()) {
        placement = placement.Multiplied(shape.Location().Transformation());
        shape.Location(TopLoc_Location());
      }
      labels[i] = shapeTool->AddShape(shape, false);
      assembled[i] = shape;
    } else {
      assemblyNodes[i] = true;
    }
    total[i] = placement;
  }

  // Pass 2 (post-order): give every assembly node a real compound of its
  // (positioned) children. STEPCAFControl_Writer only writes assemblies whose
  // label carries the assembled shape — the same form the reader builds.
  BRep_Builder builder;
  for (int i = nodeCount - 1; i >= 0; --i) {
    if (!assemblyNodes[i]) continue;
    TopoDS_Compound compound;
    builder.MakeCompound(compound);
    for (int j = i + 1; j < nodeCount; ++j) {
      if (parents[j] != i) continue;
      TopoDS_Shape child = assembled[j];
      if (total[j].Form() != gp_Identity) {
        child = child.Moved(TopLoc_Location(total[j]));
      }
      builder.Add(compound, child);
    }
    assembled[i] = compound;
  }

  // Pass 3: labels for assemblies, then placement wrappers for located roots.
  // XCAF locations exist only on references, so a root whose total placement
  // is not identity becomes: free wrapper label (assembly) → single component
  // carrying the placement → the node's content label. readStepDocument
  // collapses that wrapper back into one node with a transform, keeping
  // read(write(x)) the identity on the tree.
  for (int i = 0; i < nodeCount; ++i) {
    if (!assemblyNodes[i]) continue;
    labels[i] = shapeTool->AddShape(assembled[i], false);
    TDataStd_UAttribute::Set(labels[i], XCAFDoc::AssemblyGUID());
  }
  std::vector<TDF_Label> rootLabels(labels);
  for (int i = 0; i < nodeCount; ++i) {
    if (parents[i] >= 0 || total[i].Form() == gp_Identity) continue;
    TopoDS_Compound wrapper;
    builder.MakeCompound(wrapper);
    builder.Add(wrapper, assembled[i].Moved(TopLoc_Location(total[i])));
    const TDF_Label wrapperLabel = shapeTool->AddShape(wrapper, false);
    TDataStd_UAttribute::Set(wrapperLabel, XCAFDoc::AssemblyGUID());
    shapeTool->AddComponent(wrapperLabel, labels[i], TopLoc_Location(total[i]));
    rootLabels[i] = wrapperLabel;
  }

  // Pass 4: names on the node's primary label (the wrapper for placed roots),
  // colors on the CONTENT label — STEPCAFControl_Writer only turns colors on
  // geometry-bearing labels into STEP styles (assembly-level colors are
  // rejected on the TS side instead of being silently dropped), then the
  // instance components.
  for (int i = 0; i < nodeCount; ++i) {
    if (!names[i].empty()) {
      TDataStd_Name::Set(rootLabels[i], names[i].c_str());
    }
    if (!colors[i].empty()) {
      colorTool->SetColor(labels[i], parseColor(colors[i]), XCAFDoc_ColorSurf);
    }
  }
  for (int i = 0; i < nodeCount; ++i) {
    if (parents[i] < 0) continue;
    shapeTool->AddComponent(labels[parents[i]], labels[i], TopLoc_Location(total[i]));
  }

  // Static parameters are snapshotted when the writer is constructed — set
  // the assembly mode first (0 = off flattens to plain compounds; 2 = force).
  Interface_Static::SetIVal("write.step.assembly", 2);
  STEPCAFControl_Writer writer;
  writer.SetNameMode(true);
  writer.SetColorMode(true);
  writer.SetLayerMode(false);
  // STEPCAFControl_Writer::Transfer returns a bool (unlike STEPControl_Writer).
  if (!writer.Transfer(doc, STEPControl_AsIs)) {
    throw std::runtime_error("transfer failed");
  }
  IFSelect_ReturnStatus status = writer.Write("/mem/occt_out.step");
  if (status != IFSelect_RetDone) {
    throw std::runtime_error("write failed (status " + std::to_string((int)status) + ")");
  }
  return readTemp("/mem/occt_out.step");
}
