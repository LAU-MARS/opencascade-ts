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
// Leaf shapes are world-positioned (instance transforms applied) and fetched
// afterwards via getDocumentShape(index). Registered shapes live until the
// next readStepDocumentBytes call.
std::string readStepDocumentBytes(unsigned int ptr, int length, const std::string& unit);
OccShape getDocumentShape(int index);
int documentShapeCount();
