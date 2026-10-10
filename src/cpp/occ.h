// opencascade-ts — C++ glue between OCCT and TypeScript (via embind).
//
// Design: a small, curated, documented surface. Agents do not need 10,000
// embind classes; they need predictable, typed operations with clean errors.

#pragma once

#include <string>
#include <vector>

#include <TopoDS_Shape.hxx>

// Human-readable name for a TopAbs_ShapeEnum ("Solid", "Face", ...).
std::string shapeTypeName(const TopoDS_Shape& shape);

// Opaque shape handle exchanged with TypeScript. Cheap to copy (TopoDS_Shape
// is a handle); embind manages the lifetime of the JS-owned instance.
class OccShape {
public:
  OccShape() = default;
  explicit OccShape(const TopoDS_Shape& shape) : myShape(shape) {}

  const TopoDS_Shape& get() const { return myShape; }

  bool isNull() const { return myShape.IsNull(); }
  std::string shapeType() const { return shapeTypeName(myShape); }

  // Enclosed volume of solids (0 when the shape has no solids).
  double volume() const;
  // Total surface area (0 for empty shapes).
  double area() const;
  // [xmin, ymin, zmin, xmax, ymax, zmax].
  std::vector<double> bounds() const;
  // Center of mass: volume-weighted for solids, otherwise the surface/curve
  // integral (open shells, wires).
  std::vector<double> centroid() const;
  bool isValid() const;
  // Number of direct sub-shapes of the given type name
  // ("Solid", "Face", "Edge", "Vertex", "Shell", "Wire", "Compound").
  int countSubShapes(const std::string& typeName) const;
  // True when both handles wrap the same TShape at the same location
  // (TopoDS_Shape::IsSame — orientation is ignored).
  bool isSame(const OccShape& other) const;

private:
  TopoDS_Shape myShape;
};
