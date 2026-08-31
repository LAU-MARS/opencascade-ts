#pragma once

#include <cstdint>
#include <vector>

#include "occ.h"

// Hidden-line removal output, as flat segment lists in 3D. Points already lie
// in the projection frame: x = right, y = up (per the caller's direction/up),
// z = depth. Consecutive point pairs are independent segments.
struct LineSet {
  std::vector<float> points;

  unsigned int ptr() const { return (unsigned int)(uintptr_t)points.data(); }
  int pointCount() const { return (int)(points.size() / 3); }
};

struct HlrData {
  LineSet visible;  // edges visible from the viewing direction
  LineSet hidden;   // edges hidden behind the model

  unsigned int visiblePtr() const { return visible.ptr(); }
  int visiblePointCount() const { return visible.pointCount(); }
  unsigned int hiddenPtr() const { return hidden.ptr(); }
  int hiddenPointCount() const { return hidden.pointCount(); }
};

HlrData computeHiddenLines(const OccShape& shape,
                           double dirX, double dirY, double dirZ,
                           double upX, double upY, double upZ,
                           double deflection);
