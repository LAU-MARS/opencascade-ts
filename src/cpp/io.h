#pragma once

#include <string>

#include "occ.h"

// STEP / BRep / IGES import and export, XCAF document reading (assembly
// tree, names, colors), binary glTF export, and unit selection.
//
// Byte payloads cross the boundary as raw wasm-heap pointers (see glue.cpp).
// Text outputs return std::string (STEP/BRep/IGES are ASCII); binary outputs
// (glTF .glb) use BytesData with heap accessors. Files are staged through the
// wasm in-memory filesystem (MEMFS) — no host filesystem access.

// Unit names accepted by the `unit` parameters ("", "mm", "cm", "m", "km",
// "in"/"inch", "ft", "mi", "um"); empty keeps OCCT defaults (mm).
OccShape readStepBytes(unsigned int ptr, int length, const std::string& unit);
OccShape readBrepBytes(unsigned int ptr, int length);

std::string writeStep(const OccShape& shape, const std::string& unit);
std::string writeBrep(const OccShape& shape, bool withTriangles);

// --- IGES (TKDEIGES) ----------------------------------------------------------

OccShape readIgesBytes(unsigned int ptr, int length);
std::string writeIges(const OccShape& shape);

// --- XCAF document reading (TKXCAF/TKLCAF/TKDESTEP) ---------------------------
//
// Returns a JSON tree: {"format":"step","shapeCount":N,"tree":[node...]}
// where node = {"name":string|null, "color":"#RRGGBB"|null,
//               "transform":[12 row-major r3x4+t]|null,
//               "shape":index for leaves | "children":[node...] for assemblies}.
// `transform` is the node's own, PARENT-RELATIVE placement (roots are
// relative to the world) — the same convention writeStepDocument accepts, so
// read(write(x)) preserves the tree. An assembly wrapping a single unnamed,
// uncolored shape is a placement wrapper (written for any located root); it
// collapses into one node carrying a transform. Leaf shapes are
// world-positioned (the full ancestor chain applied) and fetched afterwards
// via getDocumentShape(index). Registered shapes live until the next
// readStepDocumentBytes call.
std::string readStepDocumentBytes(unsigned int ptr, int length, const std::string& unit);
OccShape getDocumentShape(int index);
int documentShapeCount();

// XCAF document writing — the mirror of readStepDocumentBytes. The tree
// arrives flattened (parents must precede children): `parents[i]` is node i's
// parent index (-1 = root), `shapeIndices[i]` picks a leaf shape from
// `shapes` (-1 = an assembly node), `names`/`colors` are per node ("" = skip,
// colors as "#RRGGBB"), and `transforms` holds 12 row-major 3×4 values per
// node (NaN first value = identity). A node's transform is its placement in
// the PARENT's frame (roots: world frame) and composes under any location the
// shape itself carries: world = parent chain ∘ transform ∘ shape TopLoc.
// Located roots are written as an explicit single-component wrapper — never
// as XCAFDoc_ShapeTool's implicit reference split — so they read back as one
// node with a transform. Returns STEP text. Throws on malformed trees or
// kernel failures.
std::string writeStepDocument(const std::vector<OccShape>& shapes,
                              const std::vector<int>& parents,
                              const std::vector<int>& shapeIndices,
                              const std::vector<std::string>& names,
                              const std::vector<std::string>& colors,
                              const std::vector<double>& transforms,
                              const std::string& unit);

// Raw-layer file bridge: stage/read bytes on the wasm MEMFS so whitelisted
// OCCT classes with path-based APIs (STEPCAFControl_Reader/Writer, …) can
// work with byte payloads. Paths are absolute ("/mem/in.step"); nothing
// touches the host filesystem.
void memWriteFileBytes(const std::string& path, unsigned int ptr, int length);
std::string memReadFileBytes(const std::string& path);
