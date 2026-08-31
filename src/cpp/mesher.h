#pragma once

#include <cstdint>
#include <vector>

#include <TopoDS_Edge.hxx>

#include "occ.h"

// Tessellation buffers. TypeScript copies these straight out of the wasm heap
// (ptr + count) and then deletes the object, so no vector<->JS array crossing.
struct MeshData {
  std::vector<float>    positions;  // xyz per vertex
  std::vector<uint32_t> indices;    // triangles, ccw on outward normals
  std::vector<float>    edges;      // wireframe segments, consecutive pairs

  unsigned int positionsPtr() const { return (unsigned int)(uintptr_t)positions.data(); }
  int positionCount() const { return (int)(positions.size() / 3); }

  unsigned int indicesPtr() const { return (unsigned int)(uintptr_t)indices.data(); }
  int indexCount() const { return (int)indices.size(); }

  unsigned int edgesPtr() const { return (unsigned int)(uintptr_t)edges.data(); }
  int edgePointCount() const { return (int)(edges.size() / 3); }
};

// Angular deflection is in degrees here (friendlier for TS callers); radians
// for OCCT. relative=true interprets linearDeflection relative to edge length.
MeshData tessellateShape(const OccShape& shape,
                         double linearDeflection,
                         double angularDeflectionDegrees,
                         bool relative);

// Shared by wireframe and HLR output: discretize an edge into a polyline.
void addEdgePolyline(const TopoDS_Edge& edge, double deflection, std::vector<float>& out);
