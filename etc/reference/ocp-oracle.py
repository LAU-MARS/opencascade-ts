#!/usr/bin/env python3
"""OCP oracle: desktop-OCCT reference values for the wasm integration tests.

Each scenario below is a port of a tests/reference.test.ts case, built through
the local OCP bindings (conda-forge `ocp`) with the exact constructors and
parameters src/cpp/*.cpp uses. The measured volume/area/counts/bounds go into
tests/fixtures/ocp-reference.json; the TS side rebuilds every scenario through
the wasm kernel and asserts against these numbers, so expectations are
cross-checked against desktop OCCT instead of hand-derived formulas.

Regenerate after changing a scenario here or in tests/reference.test.ts:

    python etc/reference/ocp-oracle.py        # or: npm run reference

The OCP version is recorded in the fixture. Minor OCCT drift is fine for the
exact-analytic geometry below; loosen a case's `digits` only with evidence.
"""

import json
import math
from datetime import datetime, timezone
from pathlib import Path

import importlib.metadata

from OCP.BRep import BRep_Builder
from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.BRepAlgoAPI import (
    BRepAlgoAPI_Common,
    BRepAlgoAPI_Cut,
    BRepAlgoAPI_Fuse,
    BRepAlgoAPI_Splitter,
)
from OCP.BRepBndLib import BRepBndLib
from OCP.BRepBuilderAPI import (
    BRepBuilderAPI_MakeEdge,
    BRepBuilderAPI_MakeFace,
    BRepBuilderAPI_MakePolygon,
    BRepBuilderAPI_MakeWire,
    BRepBuilderAPI_Transform,
)
from OCP.BRepFilletAPI import BRepFilletAPI_MakeChamfer, BRepFilletAPI_MakeFillet
from OCP.BRepGProp import BRepGProp
from OCP.BRepOffset import BRepOffset_Skin
from OCP.BRepOffsetAPI import (
    BRepOffsetAPI_DraftAngle,
    BRepOffsetAPI_MakeOffsetShape,
    BRepOffsetAPI_MakePipe,
    BRepOffsetAPI_MakeThickSolid,
    BRepOffsetAPI_ThruSections,
)
from OCP.BRepPrimAPI import (
    BRepPrimAPI_MakeBox,
    BRepPrimAPI_MakeCylinder,
    BRepPrimAPI_MakePrism,
    BRepPrimAPI_MakeRevol,
    BRepPrimAPI_MakeSphere,
    BRepPrimAPI_MakeTorus,
)
from OCP.Bnd import Bnd_Box
from OCP.GeomAbs import GeomAbs_Intersection, GeomAbs_Plane
from OCP.GProp import GProp_GProps
from OCP.TopAbs import (
    TopAbs_COMPOUND,
    TopAbs_EDGE,
    TopAbs_FACE,
    TopAbs_SHELL,
    TopAbs_SOLID,
    TopAbs_VERTEX,
    TopAbs_WIRE,
)
from OCP.TopExp import TopExp
from OCP.TopTools import TopTools_IndexedMapOfShape, TopTools_ListOfShape
from OCP.TopoDS import TopoDS, TopoDS_Compound
from OCP.gp import (
    gp_Ax1,
    gp_Ax2,
    gp_Circ,
    gp_Dir,
    gp_Elips,
    gp_Pln,
    gp_Pnt,
    gp_Trsf,
    gp_Vec,
)

DEG = math.pi / 180.0

# --- shared helpers (ports of the src/cpp/*.cpp entry points) ----------------


def axis(origin=(0, 0, 0), direction=(0, 0, 1)):
    return gp_Ax2(gp_Pnt(*origin), gp_Dir(*direction))


def sub_shapes(shape, shape_type):
    """The indexed map countSubShapes/subShapes use — index i in the map is
    handle i+1, the numbering describe() and every blend/draft index follows."""
    map_ = TopTools_IndexedMapOfShape()
    TopExp.MapShapes_s(shape, shape_type, map_)
    return [map_.FindKey(i) for i in range(1, map_.Extent() + 1)]


def count(shape, shape_type):
    return len(sub_shapes(shape, shape_type))


def boolean(algo_cls, a, b):
    algo = algo_cls(a, b)
    algo.SetRunParallel(False)
    algo.Build()
    if not algo.IsDone() or algo.Shape().IsNull():
        raise RuntimeError("boolean failed")
    return algo.Shape()


def transform(shape, trsf, copy):
    return BRepBuilderAPI_Transform(shape, trsf, copy).Shape()


def translate(shape, vector):
    trsf = gp_Trsf()
    trsf.SetTranslation(gp_Vec(*vector))
    return transform(shape, trsf, False)


def edge_map(shape):
    return {i + 1: edge for i, edge in enumerate(sub_shapes(shape, TopAbs_EDGE))}


def selected_edges(shape, edge_numbers):
    """selectEdges: empty selection means every edge; degenerated edges are
    skipped (sphere poles can never take a blend)."""
    from OCP.BRep import BRep_Tool

    edges = edge_map(shape)
    if not edge_numbers:
        return [
            TopoDS.Edge_s(edge) for number, edge in edges.items()
            if not BRep_Tool.Degenerated_s(TopoDS.Edge_s(edge))
        ]
    return [TopoDS.Edge_s(edges[number]) for number in edge_numbers]


def fillet(shape, radius, edge_numbers):
    maker = BRepFilletAPI_MakeFillet(shape)
    for edge in selected_edges(shape, edge_numbers):
        maker.Add(radius, edge)
    maker.Build()
    if not maker.IsDone() or maker.Shape().IsNull():
        raise RuntimeError("fillet failed")
    return maker.Shape()


def chamfer(shape, distance, edge_numbers):
    maker = BRepFilletAPI_MakeChamfer(shape)
    for edge in selected_edges(shape, edge_numbers):
        maker.Add(distance, edge)
    maker.Build()
    if not maker.IsDone() or maker.Shape().IsNull():
        raise RuntimeError("chamfer failed")
    return maker.Shape()


def circle_wire(radius, origin=(0, 0, 0), normal=(0, 0, 1)):
    edge = BRepBuilderAPI_MakeEdge(gp_Circ(axis(origin, normal), radius))
    return BRepBuilderAPI_MakeWire(edge.Edge()).Wire()


def arc_wire(radius, start_deg, end_deg, origin=(0, 0, 0), normal=(0, 0, 1)):
    edge = BRepBuilderAPI_MakeEdge(
        gp_Circ(axis(origin, normal), radius), start_deg * DEG, end_deg * DEG
    )
    return BRepBuilderAPI_MakeWire(edge.Edge()).Wire()


def line_wire(p1, p2):
    edge = BRepBuilderAPI_MakeEdge(gp_Pnt(*p1), gp_Pnt(*p2))
    return BRepBuilderAPI_MakeWire(edge.Edge()).Wire()


def polygon_wire(points, close=True):
    maker = BRepBuilderAPI_MakePolygon()
    for point in points:
        maker.Add(gp_Pnt(*point))
    if close:
        maker.Close()
    return maker.Wire()


def face(outer, holes=()):
    maker = BRepBuilderAPI_MakeFace(outer)
    for hole in holes:
        # holes are reversed: circle constructors are all counterclockwise
        maker.Add(TopoDS.Wire_s(TopoDS.Wire_s(hole).Reversed()))
    if not maker.IsDone():
        raise RuntimeError("face failed")
    return maker.Face()


def extrude(profile, vector, solid=True):
    # prepareProfile caps planar wires into faces for solid sweeps
    section = face(profile) if solid and profile.ShapeType() == TopAbs_WIRE else profile
    return BRepPrimAPI_MakePrism(section, gp_Vec(*vector)).Shape()


def bbox_center(shape):
    box = Bnd_Box()
    BRepBndLib.Add_s(shape, box)
    xmin, ymin, zmin, xmax, ymax, zmax = box.Get()
    return ((xmin + xmax) / 2, (ymin + ymax) / 2, (zmin + zmax) / 2)


def draft(shape, angle_deg, direction=(0, 0, 1), neutral_point=None):
    direction = gp_Dir(*direction)
    neutral_point = neutral_point or bbox_center(shape)
    plane = gp_Pln(gp_Pnt(*neutral_point), direction)
    maker = BRepOffsetAPI_DraftAngle(shape)
    for sub in sub_shapes(shape, TopAbs_FACE):
        f = TopoDS.Face_s(sub)
        surface = BRepAdaptor_Surface(f)
        if surface.GetType() != GeomAbs_Plane:
            continue  # runsAlongDirection keeps planes and cylinders only
        if abs(surface.Plane().Axis().Direction().Dot(direction)) >= 1e-6:
            continue
        maker.Add(f, direction, angle_deg * DEG, plane)
        if not maker.AddDone():
            raise RuntimeError("draft add failed")
    maker.Build()
    if not maker.IsDone() or maker.Shape().IsNull():
        raise RuntimeError("draft failed")
    return maker.Shape()


def top_face_of(shape, z):
    """The +Z plane face at height z — how the tests pick shell's open face."""
    for sub in sub_shapes(shape, TopAbs_FACE):
        f = TopoDS.Face_s(sub)
        surface = BRepAdaptor_Surface(f)
        normal = surface.Plane().Axis().Direction()
        origin = surface.Plane().Location()
        if abs(normal.Z() - 1) < 1e-9 and abs(origin.Z() - z) < 1e-6:
            return f
    raise RuntimeError("top face not found")


def shell_open(shape, thickness, open_face):
    closing = TopTools_ListOfShape()
    closing.Append(open_face)
    maker = BRepOffsetAPI_MakeThickSolid()
    maker.MakeThickSolidByJoin(shape, closing, -thickness, 1e-3)
    if not maker.IsDone() or maker.Shape().IsNull():
        raise RuntimeError("thick solid failed")
    return maker.Shape()


def shell_sealed(shape, thickness):
    closing = TopTools_ListOfShape()
    maker = BRepOffsetAPI_MakeThickSolid()
    maker.MakeThickSolidByJoin(shape, closing, -thickness, 1e-3)
    if not maker.IsDone() or maker.Shape().IsNull():
        raise RuntimeError("thick solid failed")
    # sealed: the kernel's inner offset region cut out of the original
    return boolean(BRepAlgoAPI_Cut, shape, maker.Shape())


def offset_solid(shape, distance):
    maker = BRepOffsetAPI_MakeOffsetShape()
    maker.PerformByJoin(shape, distance, 1e-6, BRepOffset_Skin, False, False,
                        GeomAbs_Intersection)
    if not maker.IsDone() or maker.Shape().IsNull():
        raise RuntimeError("offset failed")
    return maker.Shape()


def compound_of(shape, placements):
    from OCP.TopLoc import TopLoc_Location

    compound = TopoDS_Compound()
    builder = BRep_Builder()
    builder.MakeCompound(compound)
    for trsf in placements:
        builder.Add(compound, shape.Moved(TopLoc_Location(trsf)))
    return compound


# --- measurement --------------------------------------------------------------


def measure(shape, digits=6, want_counts=True, want_bbox=False):
    props = GProp_GProps()
    BRepGProp.VolumeProperties_s(shape, props)
    entry = {"volume": props.Mass(), "digits": digits}
    BRepGProp.SurfaceProperties_s(shape, props)
    entry["area"] = props.Mass()
    if want_counts:
        entry["solids"] = count(shape, TopAbs_SOLID)
        entry["shells"] = count(shape, TopAbs_SHELL)
        entry["faces"] = count(shape, TopAbs_FACE)
        entry["edges"] = count(shape, TopAbs_EDGE)
        entry["vertices"] = count(shape, TopAbs_VERTEX)
    if want_bbox:
        box = Bnd_Box()
        BRepBndLib.Add_s(shape, box)
        xmin, ymin, zmin, xmax, ymax, zmax = box.Get()
        entry["bboxMin"] = [xmin, ymin, zmin]
        entry["bboxMax"] = [xmax, ymax, zmax]
    return entry


def measure_centroid(shape):
    # OccShape::centroid: volume-weighted for solids, surface for shells,
    # the curve integral for bare wires.
    props = GProp_GProps()
    if count(shape, TopAbs_SOLID) > 0:
        BRepGProp.VolumeProperties_s(shape, props)
    elif count(shape, TopAbs_FACE) > 0:
        BRepGProp.SurfaceProperties_s(shape, props)
    else:
        BRepGProp.LinearProperties_s(shape, props)
    center = props.CentreOfMass()
    return {"centroid": [center.X(), center.Y(), center.Z()]}


def box(dx, dy, dz):
    return BRepPrimAPI_MakeBox(dx, dy, dz).Shape()


def cylinder(radius, height, origin=(0, 0, 0), direction=(0, 0, 1)):
    return BRepPrimAPI_MakeCylinder(axis(origin, direction), radius, height).Shape()


def vertical_edges(shape):
    """The 4 edges the fillet tests select: lines running along Z."""
    from OCP.BRepAdaptor import BRepAdaptor_Curve
    from OCP.GeomAbs import GeomAbs_Line

    numbers = []
    for number, edge in edge_map(shape).items():
        curve = BRepAdaptor_Curve(TopoDS.Edge_s(edge))
        if curve.GetType() != GeomAbs_Line:
            continue
        if abs(curve.Line().Direction().Z()) > 0.999:
            numbers.append(number)
    return sorted(numbers)


def top_loop(shape, z):
    """The 4 edges at height z whose ends both sit there (the chamfer tests)."""
    from OCP.BRepAdaptor import BRepAdaptor_Curve

    numbers = []
    for number, edge in edge_map(shape).items():
        e = TopoDS.Edge_s(edge)
        curve = BRepAdaptor_Curve(e)
        p1 = curve.Value(curve.FirstParameter())
        p2 = curve.Value(curve.LastParameter())
        if abs(p1.Z() - z) < 1e-6 and abs(p2.Z() - z) < 1e-6:
            numbers.append(number)
    return sorted(numbers)


# --- scenarios (keep names in lockstep with tests/reference.test.ts) ---------


def scenarios():
    cases = []

    def add(name, shape, **kwargs):
        entry = {"name": name}
        entry.update(measure(shape, **kwargs))
        cases.append(entry)

    def add_centroid(name, shape):
        entry = {"name": name}
        entry.update(measure_centroid(shape))
        cases.append(entry)

    add("box_10_20_3", box(10, 20, 3), want_bbox=True)

    add("cylinder_r5_h10", cylinder(5, 10), want_bbox=True)

    sphere = BRepPrimAPI_MakeSphere(gp_Pnt(0, 0, 0), 10).Shape()
    add("sphere_r10", sphere)

    torus = BRepPrimAPI_MakeTorus(axis(), 20, 5).Shape()
    add("torus_20_5", torus)

    holed = boolean(
        BRepAlgoAPI_Cut,
        box(10, 10, 10),
        cylinder(2, 12, origin=(5, 5, -1)),
    )
    add("cut_box_cylinder", holed)

    fused = boolean(
        BRepAlgoAPI_Fuse, box(10, 10, 10), translate(box(10, 10, 10), (30, 0, 0))
    )
    add("fuse_disjoint", fused)

    common = boolean(
        BRepAlgoAPI_Common, box(10, 10, 10), translate(box(10, 10, 10), (5, 0, 0))
    )
    add("common_overlap", common)

    open_box = box(20, 20, 10)
    add("shell_open_top", shell_open(open_box, 2, top_face_of(open_box, 10)),
        want_bbox=True)
    add("shell_sealed", shell_sealed(box(20, 20, 10), 2))

    add("draft_symmetric", draft(box(20, 20, 50), 10))
    add("draft_floor_neutral", draft(box(20, 20, 50), 10, neutral_point=(10, 10, 0)),
        want_bbox=True)

    cube = box(10, 10, 10)
    add("fillet_all_r1", fillet(cube, 1, []))
    add("fillet_vertical_r1", fillet(cube, 1, vertical_edges(cube)))
    add("chamfer_all_d1", chamfer(cube, 1, []))

    cube2 = box(10, 10, 10)
    add("chamfer_top_d1", chamfer(cube2, 1, top_loop(cube2, 10)))

    # variable fillet as two equal positioned radii = the constant fillet
    edge = vertical_edges(cube)[0]
    maker = BRepFilletAPI_MakeFillet(cube)
    maker.Add(1.0, 1.0, TopoDS.Edge_s(edge_map(cube)[edge]))
    maker.Build()
    if not maker.IsDone():
        raise RuntimeError("variable fillet failed")
    add("variable_fillet_equal_radii", maker.Shape())

    add("extrude_circle_solid", extrude(circle_wire(5), (0, 0, 10)))
    add("extrude_polygon_solid", extrude(
        polygon_wire([(0, 0, 0), (10, 0, 0), (10, 10, 0), (0, 10, 0)]), (0, 0, 5)),
        want_bbox=True)
    add("extrude_wire_shell", extrude(circle_wire(5), (0, 0, 10), solid=False))

    profile = circle_wire(2, origin=(20, 0, 0), normal=(0, 1, 0))
    axis_z = gp_Ax1(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1))
    add("revolve_full_torus", BRepPrimAPI_MakeRevol(face(profile), axis_z, 2 * math.pi).Shape())
    add("revolve_half_torus", BRepPrimAPI_MakeRevol(face(profile), axis_z, math.pi).Shape())

    loft = BRepOffsetAPI_ThruSections(True, True, 1e-6)
    loft.AddWire(circle_wire(5))
    loft.AddWire(circle_wire(10, origin=(0, 0, 20)))
    loft.Build()
    if not loft.IsDone():
        raise RuntimeError("loft failed")
    add("loft_ruled_frustum", loft.Shape())

    spine = polygon_wire([(0, 0, 0), (0, 0, 20)], close=False)
    add("sweep_straight_pipe", BRepOffsetAPI_MakePipe(spine, face(circle_wire(3))).Shape())

    torus_spine = circle_wire(20)
    torus_profile = circle_wire(2, origin=(20, 0, 0), normal=(0, 1, 0))
    add("sweep_ring_torus", BRepOffsetAPI_MakePipe(torus_spine, face(torus_profile)).Shape())

    blade = translate(box(2, 30, 30), (4, -10, -10))
    splitter = BRepAlgoAPI_Splitter()
    arguments, tools = TopTools_ListOfShape(), TopTools_ListOfShape()
    arguments.Append(box(10, 10, 10))
    tools.Append(blade)
    splitter.SetArguments(arguments)
    splitter.SetTools(tools)
    splitter.SetRunParallel(False)
    splitter.Build()
    if not splitter.IsDone() or splitter.Shape().IsNull():
        raise RuntimeError("split failed")
    add("split_box_blade", splitter.Shape())

    add("offset_box_out", offset_solid(box(10, 10, 10), 1), want_bbox=True)
    add("offset_box_in", offset_solid(box(10, 10, 10), -1))
    add("offset_sphere_plus2", offset_solid(
        BRepPrimAPI_MakeSphere(gp_Pnt(0, 0, 0), 10).Shape(), 2))

    annulus = extrude(
        face(circle_wire(10), [circle_wire(4)]), (0, 0, 5))
    add("annulus_extrude", annulus)

    ellipse = BRepBuilderAPI_MakeEdge(gp_Elips(axis(), 10, 4)).Edge()
    ellipse_wire = BRepBuilderAPI_MakeWire(ellipse).Wire()
    add("extrude_ellipse_solid", extrude(ellipse_wire, (0, 0, 5)), want_bbox=True)

    from OCP.BRepLib import BRepLib_MakeWire

    # chain: left arc down, bottom line, right arc up, top line back
    left = arc_wire(5, 90, 270)
    bottom = line_wire((0, -5, 0), (20, -5, 0))
    right = arc_wire(5, -90, 90, origin=(20, 0, 0))
    top = line_wire((20, 5, 0), (0, 5, 0))
    chain = BRepLib_MakeWire()
    for part in (left, bottom, right, top):
        chain.Add(TopoDS.Wire_s(part))
        if not chain.IsDone():
            raise RuntimeError("slot chain broke")
    add("extrude_slot", extrude(chain.Wire(), (0, 0, 10)), want_bbox=True)

    sector = BRepLib_MakeWire()
    for part in (
        arc_wire(5, 0, 90),
        line_wire((0, 5, 0), (0, 0, 0)),
        line_wire((0, 0, 0), (5, 0, 0)),
    ):
        sector.Add(TopoDS.Wire_s(part))
    add("extrude_pie_sector", extrude(sector.Wire(), (0, 0, 2)))

    # patterns: compound of moved copies (locations shared, like addPatternCopies)
    def translation_trsf(vector):
        trsf = gp_Trsf()
        trsf.SetTranslation(gp_Vec(*vector))
        return trsf

    placements = [
        translation_trsf((2 * i, 3 * j, 0)) for j in range(2) for i in range(3)
    ]
    add("rectangular_pattern_3x2", compound_of(box(1, 1, 1), placements),
        want_bbox=True)

    spoke = translate(box(1, 1, 1), (1, 0, 0))
    spin = gp_Ax1(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1))
    ring = []
    for k in range(4):
        trsf = gp_Trsf()
        trsf.SetRotation(spin, 2 * math.pi * k / 4)
        ring.append(trsf)
    add("circular_pattern_4", compound_of(spoke, ring), want_bbox=True)

    # mirror through the z = 0 plane, like mirrorShape mode 0 (copy = true)
    trsf = gp_Trsf()
    trsf.SetMirror(gp_Ax2(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)))
    mirrored = transform(translate(box(2, 4, 6), (1, 0, 0)), trsf, True)
    add("mirror_plane", mirrored, want_bbox=True)

    plate = boolean(
        BRepAlgoAPI_Cut,
        box(20, 20, 5),
        cylinder(4, 20, origin=(10, 10, -5)),
    )

    add_centroid("centroid_box", box(10, 10, 10))
    add_centroid("centroid_plate_with_bore", plate)
    add_centroid("centroid_circle_wire", circle_wire(5, origin=(3, 4, 0)))

    return cases


def ocp_package_version():
    """conda-forge installs no dist-info, so fall back to conda's list."""
    try:
        return importlib.metadata.version("ocp")
    except importlib.metadata.PackageNotFoundError:
        pass
    try:
        import re
        import subprocess

        listing = subprocess.run(
            ["conda", "list", "ocp"], capture_output=True, text=True, timeout=30
        ).stdout
        match = re.search(r"^\s*ocp\s+(\S+)", listing, re.MULTILINE)
        if match:
            return match.group(1)
    except Exception:
        pass
    return "unknown"


def main():
    ocp_version = ocp_package_version()

    fixture = {
        "generator": "etc/reference/ocp-oracle.py",
        "ocpVersion": ocp_version,
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "cases": scenarios(),
    }
    target = Path(__file__).resolve().parents[2] / "tests" / "fixtures" / "ocp-reference.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(fixture, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {len(fixture['cases'])} cases to {target} (ocp {ocp_version})")


if __name__ == "__main__":
    main()
