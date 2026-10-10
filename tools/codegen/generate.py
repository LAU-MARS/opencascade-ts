#!/usr/bin/env python3
"""Generate the raw OCCT binding layer for occt.ts.

Parses the whitelisted OCCT headers with libclang and emits three artifacts
(all deterministic, checked in, diff-reviewable):

  raw_bindings.cpp  — one EMSCRIPTEN_BINDINGS block registering every class,
                      verbatim OCCT names (OCP style: BRepPrimAPI_MakeBox)
  raw.generated.ts  — TypeScript declarations for the generated surface
  SKIPPED.md        — every member NOT bound, with the reason (nothing is
                      dropped silently)

Binding rules (the raw layer shares the curated layer's contracts):

  * every method body runs inside occ_ts::guarded() — failures land in
    hasError()/lastError() exactly like the curated API;
  * handle<C> arguments accept C* (the handle adopts the pointee), handle<C>
    results return a JS-owned Handle_C wrapper (delete() drops the refcount);
  * enums cross as int; their enumerators are exported as module constants
    (constant("IFSelect_RetDone", ...));
  * default arguments become truncated overloads (embind has no native
    defaults), registered alongside the full signature.

Run inside the docker image — see etc/codegen.sh. The host needs nothing.
"""

import argparse
import glob
import json
import os
import re
import sys

import clang.cindex as ci

# ---------------------------------------------------------------------------
# libclang bootstrap: prefer LIBCLANG_SO, else the pip `libclang` wheel's
# bundled native library, else whatever cindex finds on its own.
def load_libclang():
    override = os.environ.get("LIBCLANG_SO")
    candidates = []
    if override:
        candidates.append(override)
    import clang

    root = os.path.dirname(clang.__file__)
    candidates += glob.glob(os.path.join(root, "native", "libclang.so"))
    candidates += glob.glob(os.path.join(root, "native", "libclang.dylib"))
    for lib in candidates:
        if os.path.exists(lib):
            ci.Config.set_library_file(lib)
            return


# ---------------------------------------------------------------------------
# Type mapping

PRIMITIVES = {
    "bool": "bool",
    "Standard_Boolean": "bool",
    "int": "int",
    "Standard_Integer": "int",
    "unsigned int": "int",
    "long": "int",
    "unsigned long": "int",
    "short": "int",
    "unsigned short": "int",
    "char": "int",
    "double": "double",
    "Standard_Real": "double",
    "float": "double",
}

STRINGS = {"std::string"}

HANDLE_RE = re.compile(
    r"^(?:const )?(?:opencascade::handle<|Handle\()\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:>|\))"
)


def base_type_name(type_: ci.Type) -> str:
    """Spelling with const/ref/pointer decoration removed, OCCT typedefs kept."""
    name = type_.get_canonical().spelling
    name = name.replace("const ", "").strip()
    name = name.rstrip("&*").strip()
    name = name.replace("const ", "").strip()
    return name


def classify(type_: ci.Type, role="arg"):
    """Map a clang type to one of the mappable kinds, or None.

    Kinds:
      ("prim", cpp)     bool/int/double
      ("string", cpp)   const char* / std::string
      ("class", C)      whitelisted class C by value or const reference;
                        non-const C& out-parameters bind as ("ref", C) — the
                        caller news a default C(), passes it, reads the result
      ("pointer", C)    whitelisted class C*
      ("handle", C)     opencascade::handle<C>
      ("enum", E)       whitelisted enum E (crosses as int)
      ("void", None)    return only

    Function-pointer typedefs (some embed handle<...> in their spelling) and
    non-const primitive/handle references are rejected — v1 has no story for
    them. `role` distinguishes returns (references copy out by value) from
    arguments (non-const references stay mutable).
    """
    canonical = type_.get_canonical().spelling
    if "(*)" in canonical or "(&" in canonical:
        return None

    handle = HANDLE_RE.match(canonical) or HANDLE_RE.match(type_.spelling)
    if handle:
        payload = handle.group(1)
        if payload not in WHITELIST_CLASSES:
            return None  # nothing registered to pass it as
        if role == "arg" and "&" in canonical and not canonical.startswith("const"):
            return None  # handle<C>& out-params: no adapter story in v1
        return ("handle", payload)

    is_pointer = canonical.endswith("*")
    is_ref = canonical.endswith("&")
    is_const = canonical.lstrip().startswith("const ")

    if is_pointer:
        pointee = base_type_name(type_.get_pointee())
        if pointee in ("char", "unsigned char") and is_const:
            return ("string", "const char*")
        if pointee in WHITELIST_CLASSES:
            return ("pointer", pointee)
        return None

    name = base_type_name(type_)
    if name == "void":
        return ("void", None)
    if name in PRIMITIVES:
        if is_ref and not is_const and role == "arg":
            return None  # double&/int& out-params: no v1 story
        return ("prim", PRIMITIVES[name])
    if name in STRINGS:
        if is_ref and not is_const and role == "arg":
            return None
        return ("string", name)
    if name == "char":
        return ("prim", "int")
    if name in WHITELIST_ENUMS:
        return ("enum", name)
    if name in WHITELIST_CLASSES:
        if is_ref and not is_const and role == "arg":
            return ("ref", name)
        return ("class", name)
    return None


# TS names for kinds
def ts_type(kind, payload) -> str:
    if kind in ("prim", "enum"):
        return "number"
    if kind == "string":
        return "string"
    if kind in ("class", "ref", "pointer", "handle"):
        return f"Raw_{payload}"
    return "void"


# ---------------------------------------------------------------------------


class Member:
    """One bindable overload (a cursor + its mapped signature)."""

    def __init__(self, cursor, args, ret):
        self.cursor = cursor
        self.args = args  # list of (kind, payload, name) or None for unmappable
        self.ret = ret  # (kind, payload) or None

    def cpp_sig(self, cls):
        parts = []
        for i, arg in enumerate(self.args):
            parts.append(param_cpp(arg, f"a{i}"))
        return ", ".join(parts)


def param_cpp(arg, name):
    kind, payload = arg
    if kind == "prim":
        return f"{payload} {name}"
    if kind == "string":
        return f"std::string {name}"
    if kind == "class":
        return f"const {payload}& {name}"
    if kind == "ref":
        return f"{payload}& {name}"
    if kind == "pointer":
        return f"{payload}* {name}"
    if kind == "handle":
        return f"{payload}* {name}"  # adopts the pointee into a handle
    if kind == "enum":
        return f"int {name}"
    raise AssertionError(kind)


def call_arg(i, arg):
    kind, payload = arg
    if kind == "prim":
        return f"a{i}"
    if kind == "string":
        return f"a{i}.c_str()" if payload == "const char*" else f"a{i}"
    if kind in ("class", "ref", "pointer"):
        return f"a{i}"
    if kind == "handle":
        return f"opencascade::handle<{payload}>(a{i})"
    if kind == "enum":
        return f"static_cast<{payload}>(a{i})"
    raise AssertionError(kind)


def ret_cpp(ret):
    kind, payload = ret
    if kind == "prim":
        return payload
    if kind == "string":
        return "std::string"
    if kind == "class":
        return payload
    if kind == "pointer":
        return f"{payload}*"
    if kind == "handle":
        return f"opencascade::handle<{payload}>*"
    if kind == "enum":
        return "int"
    if kind == "void":
        return "void"
    raise AssertionError(kind)


def default_error_value(ret):
    kind, payload = ret
    if kind == "prim":
        return "0" if payload != "bool" else "false"
    if kind == "string":
        return "std::string()"
    if kind == "class":
        return f"{payload}()"
    if kind == "pointer":
        return "nullptr"
    if kind == "handle":
        return "nullptr"
    if kind == "enum":
        return "0"
    raise AssertionError(kind)


SKIPPED = []
EXCLUSIONS = {}


def skip(where, reason):
    SKIPPED.append(f"{where} — {reason}")


def has_default_arg(param_cursor) -> bool:
    try:
        tokens = list(param_cursor.get_tokens())
    except Exception:
        return False
    return any(t.spelling == "=" for t in tokens)


def parse_header(index, occt_include, name, clang_include=""):
    header = os.path.join(occt_include, f"{name}.hxx")
    if not os.path.exists(header):
        header = os.path.join(occt_include, "..", "include", "opencascade", f"{name}.hxx")
    if not os.path.exists(header):
        return None, None
    parse_args = ["-std=c++17", "-x", "c++", f"-I{occt_include}", f"-I{os.path.dirname(occt_include)}"]
    if clang_include:
        parse_args.append(f"-I{clang_include}")
    tu = index.parse(header, args=parse_args)
    errors = [d for d in tu.diagnostics if d.severity >= ci.Diagnostic.Error]
    if errors:
        for d in errors[:3]:
            print(f"  [clang] {d}", file=sys.stderr)
    target = None
    for cursor in tu.cursor.get_children():
        if cursor.spelling == name and cursor.location.file and cursor.location.file.name == header:
            if cursor.is_definition():
                target = cursor
                break
    return tu, target


def collect_namespace_functions(ns_cursor):
    """Functions declared in a whitelist namespace (TopoDS in OCCT 7.9)."""
    functions = []
    for child in ns_cursor.get_children():
        if child.kind != ci.CursorKind.FUNCTION_DECL:
            continue
        if child.spelling.startswith("operator"):
            continue
        params = [p for p in child.get_children() if p.kind == ci.CursorKind.PARM_DECL]
        args, ok = [], True
        for p in params:
            mapped = classify(p.type)
            if mapped is None or mapped[0] == "void":
                ok = False
                break
            args.append((mapped[0], mapped[1], p.spelling, has_default_arg(p)))
        ret = (
            classify(child.result_type, role="ret")
            if child.result_type.kind != ci.TypeKind.VOID
            else ("void", None)
        )
        if not ok or ret is None:
            skip(f"{ns_cursor.spelling}::{child.spelling}", "unmappable parameter/return")
            continue
        functions.append((child, args, ret))
    return functions


def collect_members(class_cursor, class_name, _depth=0):
    """Walk the class body; return (ctors, methods, statics, enums, bases).

    Inherited methods are pulled from the base chain too — OCCT keeps the
    load-bearing API (Build/IsDone/Shape) in intermediate bases that are not
    worth whitelisting on their own. Calls dispatch virtually, so binding the
    base declaration against the derived instance is correct.
    """
    ctors, methods, statics, enums, bases = [], [], [], [], []
    seen_names = set()
    for child in class_cursor.get_children():
        if child.access_specifier not in (ci.AccessSpecifier.PUBLIC, ci.AccessSpecifier.INVALID):
            continue
        kind = child.kind
        if kind == ci.CursorKind.CXX_METHOD:
            if child.spelling.startswith("operator") or child.spelling.startswith("~"):
                continue
            name = child.spelling
            if name in EXCLUSIONS.get(class_name, set()):
                skip(f"{class_name}.{name}", "excluded via classes.json (not defined in the libs)")
                continue
            params = [p for p in child.get_children() if p.kind == ci.CursorKind.PARM_DECL]
            args, ok = [], True
            for p in params:
                mapped = classify(p.type)
                if mapped is None or mapped[0] == "void":
                    ok = False
                    break
                args.append((mapped[0], mapped[1], p.spelling, has_default_arg(p)))
            ret = (
                classify(child.result_type, role="ret")
                if child.result_type.kind != ci.TypeKind.VOID
                else ("void", None)
            )
            if ret is None or (ret[0] == "handle" and ret[1] not in WHITELIST_CLASSES):
                skip(f"{class_name}.{name}", f"unmappable return type {child.result_type.spelling}")
                continue
            if not ok:
                skip(f"{class_name}.{name}", "unmappable parameter type")
                continue
            entry = (child, args, ret)
            if child.is_static_method():
                statics.append(entry)
            else:
                methods.append(entry)
        elif kind == ci.CursorKind.CONSTRUCTOR:
            params = [p for p in child.get_children() if p.kind == ci.CursorKind.PARM_DECL]
            args, ok = [], True
            for p in params:
                mapped = classify(p.type)
                if mapped is None or mapped[0] in ("void", "handle", "enum"):
                    ok = False
                    break
                args.append((mapped[0], mapped[1], p.spelling, has_default_arg(p)))
            if not ok:
                skip(f"{class_name}::ctor", "unmappable constructor parameter")
                continue
            ctors.append((child, args))
        elif kind == ci.CursorKind.ENUM_DECL and child.spelling:
            enums.append(child)
        elif kind == ci.CursorKind.CXX_BASE_SPECIFIER:
            base_name = base_type_name(child.type)
            base_cursor = child.type.get_declaration()
            if _depth < 8 and base_cursor.is_definition():
                (b_ctors, b_methods, b_statics, b_enums, _b_bases) = collect_members(
                    base_cursor, class_name, _depth + 1
                )
                # only non-overridden members of the base survive into the
                # derived binding; C++ already resolved overrides for us
                for cursor, args, ret in b_methods + b_statics:
                    if not any(cursor.spelling == m[0].spelling for m in methods):
                        (methods if not cursor.is_static_method() else statics).append(
                            (cursor, args, ret)
                        )
            if base_name in WHITELIST_CLASSES:
                bases.append(base_name)
    return ctors, methods, statics, enums, bases


# ---------------------------------------------------------------------------
# Emission


def method_wrapper_cpp(cls, cursor, args, ret, suffix, static=False):
    """Emit the guarded wrapper function for one overload."""
    name = cursor.spelling
    label = f"{cls}.{name}"
    is_const = cursor.is_const_method()
    self_ref = f"const {cls}& self" if is_const else f"{cls}& self"
    sig_parts = [] if static else [self_ref]
    sig_parts += [param_cpp((a[0], a[1]), f"a{i}") for i, a in enumerate(args)]
    rtype = ret_cpp(ret)
    body_args = ", ".join(call_arg(i, (a[0], a[1])) for i, a in enumerate(args))
    if static:
        call = f"{cls}::{name}({body_args})"
    else:
        call = f"self.{name}({body_args})"
    lines = []
    if ret[0] == "handle":
        payload = ret[1]
        lines.append(
            f"static opencascade::handle<{payload}>* {cls}_{name}{suffix}_wrap({', '.join(sig_parts)}) {{\n"
            f"  return occ_ts::guarded(\"{label}\", [&]() -> opencascade::handle<{payload}>* {{\n"
            f"    return new opencascade::handle<{payload}>({call});\n"
            f"  }}, (opencascade::handle<{payload}>*)nullptr);\n"
            f"}}"
        )
    elif rtype == "void":
        lines.append(
            f"static void {cls}_{name}{suffix}_wrap({', '.join(sig_parts)}) {{\n"
            f"  occ_ts::guarded(\"{label}\", [&]() -> int {{\n"
            f"    {call};\n"
            f"    return 0;\n"
            f"  }}, 0);\n"
            f"}}"
        )
    elif ret[0] == "class" and not DEFAULT_CTOR.get(ret[1], True):
        # no default instance for the error value: bind without the guard
        lines.append(
            f"static {rtype} {cls}_{name}{suffix}_wrap({', '.join(sig_parts)}) {{\n"
            f"  return {call};\n"
            f"}}"
        )
    else:
        err = default_error_value(ret)
        lines.append(
            f"static {rtype} {cls}_{name}{suffix}_wrap({', '.join(sig_parts)}) {{\n"
            f"  return occ_ts::guarded(\"{label}\", [&]() -> {rtype} {{\n"
            f"    return {call};\n"
            f"  }}, {err});\n"
            f"}}"
        )
    return "\n".join(lines)


def registration_cpp(cls, cursor, args, suffix, is_static, needs_raw_pointers):
    name = cursor.spelling
    fn = f"&{cls}_{name}{suffix}_wrap"
    policy = ", allow_raw_pointers()" if needs_raw_pointers else ""
    kind = "class_function" if is_static else "function"
    return f'      .{kind}("{name}", {fn}{policy})'


def needs_raw_pointers(args, ret):
    for a in args:
        if a[0] in ("pointer", "handle"):
            return True
    return ret[0] in ("pointer", "handle")


def emit_cpp(classes, enums_global, handle_classes, class_data, enum_values, namespaces):
    out = []
    out.append(
        "// GENERATED by tools/codegen/generate.py — DO NOT EDIT.\n"
        "// The raw OCCT escape hatch: whitelisted classes bound verbatim (OCP\n"
        "// naming) with the guarded() error contract. Unmapped members are\n"
        "// listed in tools/codegen/SKIPPED.md — nothing is dropped silently.\n"
        "// Regenerate with `npm run codegen` (see etc/codegen.sh).\n"
    )
    out.append("#include <emscripten/bind.h>\n")
    out.append("#include <Standard_Handle.hxx>\n")
    for name in sorted(set(list(classes) + list(handle_classes) + list(namespaces))):
        out.append(f"#include <{name}.hxx>\n")
    out.append("\n" + '#include "../error.h"\n')
    out.append("\nusing namespace emscripten;\n\nnamespace {\n\n")

    for cls in classes:
        ctors, methods, statics, enums, bases = class_data[cls]
        reg = []
        seen_mcounts = set()
        for oi, (cursor, args, ret) in enumerate(methods + statics):
            variants = [args]
            # default arguments → truncated overloads, longest first
            first_default = next(
                (i for i, a in enumerate(args) if a[3]), None
            )
            if first_default is not None:
                i = first_default
                while i < len(args):
                    if not args[i][3]:
                        break
                    i += 1
                # every arg from first_default..i-1 has a default
                for cut in range(i - 1, first_default - 1, -1):
                    variants.append(args[:cut])
            # embind resolves same-name overloads by parameter count only —
            # one registration per (name, count)
            unique_variants = []
            for variant in variants:
                key = (cursor.spelling, len(variant))
                if key in seen_mcounts:
                    continue
                seen_mcounts.add(key)
                unique_variants.append(variant)
            variants = unique_variants
            for vi, variant in enumerate(variants):
                suffix = "" if (oi == 0 and vi == 0) else f"_o{oi}v{vi}"
                out.append(
                    method_wrapper_cpp(
                        cls, cursor, variant, ret, suffix, static=cursor.is_static_method()
                    )
                )
                out.append("\n")
                reg.append(
                    registration_cpp(
                        cls, cursor, variant, suffix,
                        cursor.is_static_method(),
                        needs_raw_pointers(variant, ret),
                    )
                )
        # handle wrapper classes for handle<C> returns of this class
        class_data[cls] = (ctors, methods, statics, enums, bases, reg)

    # handle<C> wrapper classes
    for cls in sorted(handle_classes):
        out.append(
            f"static {cls}* Handle_{cls}_Get_wrap(const opencascade::handle<{cls}>& self) {{\n"
            f'  return occ_ts::guarded("Handle_{cls}.Get", [&]() -> {cls}* {{\n'
            f"    return const_cast<{cls}*>(self.get());\n"
            f"  }}, ({cls}*)nullptr);\n"
            f"}}\n\n"
            f"static bool Handle_{cls}_IsNull_wrap(const opencascade::handle<{cls}>& self) {{\n"
            f'  return occ_ts::guarded("Handle_{cls}.IsNull", [&]() -> bool {{\n'
            f"    return self.IsNull();\n"
            f"  }}, true);\n"
            f"}}\n\n"
            f"// embind has no raw-pointer constructors — adopting a pointee into a\n"
            f"// handle goes through this factory instead.\n"
            f"static opencascade::handle<{cls}>* Handle_{cls}_adopt({cls}* pointee) {{\n"
            f'  return occ_ts::guarded("Handle_{cls}.adopt", [&]() -> opencascade::handle<{cls}>* {{\n'
            f"    return new opencascade::handle<{cls}>(pointee);\n"
            f"  }}, (opencascade::handle<{cls}>*)nullptr);\n"
            f"}}\n\n"
        )

    # namespace-level functions (TopoDS in OCCT 7.9) — bound as module
    # functions named Namespace_function, OCP-recognizable either way.
    ns_reg = []
    for ns, functions in namespaces.items():
        seen_counts = set()
        for oi, (cursor, args, ret) in enumerate(functions):
            variants = [args]
            first_default = next((i for i, a in enumerate(args) if a[3]), None)
            if first_default is not None:
                i = first_default
                while i < len(args) and args[i][3]:
                    i += 1
                for cut in range(i - 1, first_default - 1, -1):
                    variants.append(args[:cut])
            unique_variants = []
            for variant in variants:
                key = (cursor.spelling, len(variant))
                if key in seen_counts:
                    continue
                seen_counts.add(key)
                unique_variants.append(variant)
            variants = unique_variants
            for vi, variant in enumerate(variants):
                suffix = "" if (oi == 0 and vi == 0) else f"_o{oi}v{vi}"
                name = cursor.spelling
                # TopoDS::Vertex collides with the class TopoDS_Vertex — borrow
                # OCP's _s cast suffix for colliding namespace functions.
                js_name = f"{ns}_{name}"
                if js_name in classes:
                    js_name = f"{js_name}_s"
                label = f"{ns}.{name}"
                sig_parts = [param_cpp((a[0], a[1]), f"a{i}") for i, a in enumerate(variant)]
                rtype = ret_cpp(ret)
                body_args = ", ".join(call_arg(i, (a[0], a[1])) for i, a in enumerate(variant))
                call = f"{ns}::{name}({body_args})"
                if rtype == "void":
                    out.append(
                        f"static void {ns}_{name}{suffix}_wrap({', '.join(sig_parts)}) {{\n"
                        f'  occ_ts::guarded("{label}", [&]() -> int {{\n'
                        f"    {call};\n"
                        f"    return 0;\n"
                        f"  }}, 0);\n"
                        f"}}\n\n"
                    )
                else:
                    err = default_error_value(ret)
                    out.append(
                        f"static {rtype} {ns}_{name}{suffix}_wrap({', '.join(sig_parts)}) {{\n"
                        f'  return occ_ts::guarded("{label}", [&]() -> {rtype} {{\n'
                        f"    return {call};\n"
                        f"  }}, {err});\n"
                        f"}}\n\n"
                    )
                policy = ", allow_raw_pointers()" if needs_raw_pointers(variant, ret) else ""
                ns_reg.append(f'  function("{js_name}", &{ns}_{name}{suffix}_wrap{policy});\n')

    out.append("} // namespace\n\n")
    out.append("EMSCRIPTEN_BINDINGS(occt_ts_raw) {\n")

    for cls in classes:
        ctors, methods, statics, enums, bases, reg = class_data[cls]
        tmpl = f"{cls}, base<{bases[0]}>" if bases else cls
        out.append(f'  class_<{tmpl}>("{cls}")\n')
        # embind resolves constructor overloads by PARAMETER COUNT ONLY —
        # keep the first declaration of each count, report the rest.
        seen_ctor_counts = set()
        for cursor, args in ctors:
            variants = [args]
            first_default = next((i for i, a in enumerate(args) if a[3]), None)
            if first_default is not None:
                i = first_default
                while i < len(args) and args[i][3]:
                    i += 1
                for cut in range(i - 1, first_default - 1, -1):
                    variants.append(args[:cut])
            for variant in variants:
                if len(variant) in seen_ctor_counts:
                    skip(
                        f"{cls}::ctor({', '.join(a[2] or '?' for a in variant)})",
                        "a constructor with this parameter count is already bound (embind picks by count)",
                    )
                    continue
                seen_ctor_counts.add(len(variant))
                tmpl = ", ".join(
                    t for t in [
                        {"prim": lambda p: p, "string": lambda p: "std::string",
                         "class": lambda p: f"const {p}&", "pointer": lambda p: f"{p}*",
                         "enum": lambda p: "int"}.get(variant[j][0], lambda p: None)(variant[j][1])
                        for j in range(len(variant))
                    ] if t is not None
                )
                policy = ", allow_raw_pointers()" if any(a[0] == "pointer" for a in variant) else ""
                out.append(f"      .constructor<{tmpl}>(){policy}\n")
        for line in reg:
            out.append(line + "\n")
        for enum in enums:
            out.append(f'      .enum_<{enum.spelling}>("{enum.spelling}")\n')
            for value in enum.get_children():
                if value.kind == ci.CursorKind.ENUM_CONSTANT_DECL:
                    out.append(f'          .value("{value.spelling}", {enum.spelling}::{value.spelling})\n')
            out.append("      ;\n")
        out.append("  ;\n\n")

    for cls in sorted(handle_classes):
        out.append(
            f'  class_<opencascade::handle<{cls}>>("Handle_{cls}")\n'
            f"      .constructor<>()\n"
            f'      .function("Get", &Handle_{cls}_Get_wrap, allow_raw_pointers())\n'
            f'      .function("IsNull", &Handle_{cls}_IsNull_wrap)\n'
            f"  ;\n"
            f'  function("Handle_{cls}_adopt", &Handle_{cls}_adopt, allow_raw_pointers());\n'
            f"\n"
        )

    for enum_name in enum_values:
        out.append(f'  enum_<{enum_name}>("{enum_name}")\n')
        for value_name, cpp in enum_values[enum_name]:
            out.append(f'      .value("{value_name}", {cpp})\n')
        out.append("  ;\n")

    for const_name, cpp in CONSTANT_EXPORTS:
        out.append(f'  constant("{const_name}", {cpp});\n')

    out.extend(ns_reg)
    out.append("}\n")
    return "".join(out)


# ---------------------------------------------------------------------------
# TS emission


def ts_method_sig(args, ret, is_static=False):
    params = [f"a{i}: {ts_type(a[0], a[1])}" for i, a in enumerate(args)]
    return f"({', '.join(params)}): {ts_type(ret[0], ret[1])}"


def emit_ts(classes, enums_global, handle_classes, class_data, enum_values, namespaces):
    out = [
        "// GENERATED by tools/codegen/generate.py — DO NOT EDIT.\n"
        "// Declarations for the raw OCCT escape hatch. Manual memory discipline:\n"
        "// every object you construct (or that a function hands back by value\n"
        "// or pointer) owns a C++ instance — call .delete() when done, or leak.\n"
        "// The curated OccSession API remains the recommended surface.\n\n",
    ]
    for cls in classes:
        ctors, methods, statics, enums, bases, reg = class_data[cls]
        out.append(f"/** Raw {cls} (see tools/codegen/SKIPPED.md for unmapped members). */\n")
        out.append(f"export interface Raw_{cls} {{\n  delete(): void;\n")
        by_name = {}
        for cursor, args, ret in methods:
            by_name.setdefault(cursor.spelling, []).append((args, ret))
        for name, overloads in by_name.items():
            for args, ret in overloads:
                out.append(f"  {name}{ts_method_sig(args, ret)};\n")
        out.append("}\n\n")
        ctor_lines = []
        for cursor, args in ctors:
            params = [f"a{i}: {ts_type(a[0], a[1])}" for i, a in enumerate(args)]
            ctor_lines.append(f"  new ({', '.join(params)}): Raw_{cls};\n")
        static_lines = []
        by_name_static = {}
        for cursor, args, ret in statics:
            by_name_static.setdefault(cursor.spelling, []).append((args, ret))
        for name, overloads in by_name_static.items():
            for args, ret in overloads:
                static_lines.append(f"  {name}{ts_method_sig(args, ret)};\n")
        if ctor_lines or static_lines:
            out.append(f"export interface Ctor_{cls} {{\n")
            out.extend(ctor_lines)
            out.extend(static_lines)
            out.append("}\n\n")

    for cls in sorted(handle_classes):
        out.append(
            f"/** JS-owned wrapper around opencascade::handle<{cls}> — delete() drops the refcount. */\n"
            f"export interface Raw_Handle_{cls} {{\n"
            f"  /** Borrowed pointee (the handle must outlive it). */\n"
            f"  Get(): Raw_{cls};\n"
            f"  IsNull(): boolean;\n"
            f"  delete(): void;\n"
            f"}}\n\n"
        )

    out.append("/** The generated raw surface, mixed into the wasm module. */\n")
    out.append("export interface RawBindings {\n")
    for cls in classes:
        ctors, methods, statics, enums, bases, reg = class_data[cls]
        if len(ctors) > 0 or len(statics) > 0:
            out.append(f"  {cls}: Ctor_{cls};\n")
        else:
            out.append(f"  {cls}: Record<string, never>;\n")
    for cls in sorted(handle_classes):
        out.append(
            f"  Handle_{cls}: new () => Raw_Handle_{cls};\n"
            f"  Handle_{cls}_adopt(pointee: Raw_{cls}): Raw_Handle_{cls};\n"
        )
    for ns, functions in namespaces.items():
        by_name = {}
        for cursor, args, ret in functions:
            by_name.setdefault(cursor.spelling, []).append((args, ret))
        for fn_name, overloads in by_name.items():
            js_name = f"{ns}_{fn_name}"
            if js_name in classes:
                js_name = f"{js_name}_s"
            for args, ret in overloads:
                out.append(f"  {js_name}{ts_method_sig(args, ret)};\n")
    for enum_name in enum_values:
        out.append(f"  {enum_name}: {{ [value: string]: number }};\n")
    for const_name, _ in CONSTANT_EXPORTS:
        out.append(f"  {const_name}: number;\n")
    out.append("}\n")
    return "".join(out)


# ---------------------------------------------------------------------------


def main():
    global WHITELIST_CLASSES, WHITELIST_ENUMS, DEFAULT_CTOR, CONSTANT_EXPORTS
    ap = argparse.ArgumentParser()
    ap.add_argument("--classes", required=True, help="classes.json whitelist")
    ap.add_argument("--occt-include", required=True)
    ap.add_argument("--clang-include", default="", help="extra include dir (clang builtins)")
    ap.add_argument("--out-dir", required=True)
    args = ap.parse_args()

    with open(args.classes, encoding="utf-8") as fh:
        config = json.load(fh)
    whitelist = config["classes"]
    global EXCLUSIONS
    EXCLUSIONS = {k: set(v) for k, v in config.get("exclude", {}).items()}

    clang_include = args.clang_include
    if not clang_include:
        # inside the build image emsdk's clang builtin headers ship here
        for candidate in sorted(glob.glob("/emsdk/upstream/lib/clang/*/include")):
            if os.path.isdir(candidate):
                clang_include = candidate
                break

    load_libclang()
    index = ci.Index.create()

    # First pass: which whitelist entries resolve to classes, enums or
    # namespaces (the whitelist does not distinguish; the headers do).
    WHITELIST_CLASSES, WHITELIST_ENUMS, enums_global = [], [], []
    namespaces = {}
    parsed = {}
    for name in whitelist:
        tu, cursor = parse_header(index, args.occt_include, name, clang_include)
        if cursor is None:
            print(f"warning: {name}.hxx not found or declares nothing — skipped", file=sys.stderr)
            skip(name, "header not found / no definition")
            continue
        if cursor.kind == ci.CursorKind.ENUM_DECL:
            WHITELIST_ENUMS.append(name)
            enums_global.append(cursor)
        elif cursor.kind == ci.CursorKind.NAMESPACE:
            namespaces[name] = collect_namespace_functions(cursor)
        else:
            WHITELIST_CLASSES.append(name)
        parsed[name] = cursor

    # registration order: every class referenced (as a base, argument, return
    # or handle payload) must be registered before its user — embind resolves
    # types at registration time.
    raw_data = {}
    for cls in WHITELIST_CLASSES:
        raw_data[cls] = collect_members(parsed[cls], cls)

    def referenced(cls):
        ctors, methods, statics, enums, bases = raw_data[cls]
        deps = set(bases)
        for cursor, args, ret in methods + statics:
            for a in args:
                if a[0] in ("class", "pointer", "handle") and a[1] in raw_data:
                    deps.add(a[1])
            if ret[0] in ("class", "pointer", "handle") and ret[1] in raw_data:
                deps.add(ret[1])
        for cursor, args in ctors:
            for a in args:
                if a[0] in ("class", "pointer", "handle") and a[1] in raw_data:
                    deps.add(a[1])
        deps.discard(cls)
        return deps

    ordered, emitted = [], set()
    pending = list(WHITELIST_CLASSES)
    while pending:
        progressed = False
        for cls in list(pending):
            if referenced(cls) <= emitted:
                ordered.append(cls)
                emitted.add(cls)
                pending.remove(cls)
                progressed = True
        if not progressed:
            # dependency cycle (e.g. mutually-referencing handles) — fall back
            # to declaration order for the remainder
            ordered += pending
            break

    # classes that appear in handle<> signatures need wrapper classes; every
    # whitelisted class gets one lazily below
    handle_classes = set()

    def scan_handles():
        for cls in ordered:
            ctors, methods, statics, enums, bases = raw_data[cls]
            for cursor, args, ret in methods + statics:
                if ret[0] == "handle" and ret[1] in WHITELIST_CLASSES:
                    handle_classes.add(ret[1])
                for a in args:
                    if a[0] == "handle" and a[1] in WHITELIST_CLASSES:
                        handle_classes.add(a[1])

    scan_handles()

    DEFAULT_CTOR = {}
    for cls in ordered:
        ctors = raw_data[cls][0]
        DEFAULT_CTOR[cls] = len(ctors) == 0 or any(len(args) == 0 for _, args in ctors)

    # enum constants exported as module-level constants (enums cross as int)
    CONSTANT_EXPORTS = []
    enum_values = {}
    for cursor in enums_global:
        values = []
        for value in cursor.get_children():
            if value.kind == ci.CursorKind.ENUM_CONSTANT_DECL:
                values.append((value.spelling, f"{cursor.spelling}::{value.spelling}"))
        enum_values[cursor.spelling] = values
    for enum_name, values in enum_values.items():
        for value_name, cpp in values:
            CONSTANT_EXPORTS.append((value_name, cpp))

    # stash for the emitters (they read the globals this module manages)
    globals()["WHITELIST_CLASSES"] = WHITELIST_CLASSES
    globals()["WHITELIST_ENUMS"] = WHITELIST_ENUMS
    globals()["DEFAULT_CTOR"] = DEFAULT_CTOR
    globals()["CONSTANT_EXPORTS"] = CONSTANT_EXPORTS

    # class_data maps cls -> (ctors, methods, statics, enums, bases, registrations)
    class_data = {cls: raw_data[cls] for cls in ordered}

    cpp = emit_cpp(ordered, enums_global, handle_classes, class_data, enum_values, namespaces)
    ts = emit_ts(ordered, enums_global, handle_classes, class_data, enum_values, namespaces)

    os.makedirs(args.out_dir, exist_ok=True)
    with open(os.path.join(args.out_dir, "raw_bindings.cpp"), "w", encoding="utf-8", newline="\n") as fh:
        fh.write(cpp)
    with open(os.path.join(args.out_dir, "raw.generated.ts"), "w", encoding="utf-8", newline="\n") as fh:
        fh.write(ts)

    report = [
        "# Raw bindings — skipped members",
        "",
        "Every whitelist member that is NOT bound, with the reason. Regenerated",
        "by `npm run codegen`. Nothing is dropped silently: if something you",
        "need is here, either extend generate.py's type mapping or curate the",
        "operation into the OccSession API instead.",
        "",
    ]
    report += sorted(set(SKIPPED))
    with open(os.path.join(args.out_dir, "SKIPPED.md"), "w", encoding="utf-8", newline="\n") as fh:
        fh.write("\n".join(report) + "\n")

    bound = sum(len(raw_data[c][1]) + len(raw_data[c][2]) for c in ordered)
    print(
        f"raw bindings: {len(ordered)} classes, {bound} methods, "
        f"{len(handle_classes)} handle wrappers, {len(enums_global)} enums, "
        f"{len(set(SKIPPED))} skipped members"
    )


if __name__ == "__main__":
    main()
