#pragma once

#include <string>

#include "occ.h"

// STEP / BREP import and export.
//
// Byte payloads cross the boundary as raw wasm-heap pointers (see glue.cpp):
// TypeScript writes the file bytes into the heap, passes (ptr, len), and gets
// an OccShape back. Export returns ASCII text (STEP and BRep are both ASCII
// formats), which TypeScript re-encodes into a Uint8Array.
//
// Files are staged through the wasm in-memory filesystem (MEMFS) — no host
// filesystem access happens inside the module.

OccShape readStepBytes(unsigned int ptr, int length);
OccShape readBrepBytes(unsigned int ptr, int length);

std::string writeStep(const OccShape& shape);
std::string writeBrep(const OccShape& shape, bool withTriangles);
