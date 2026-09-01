/**
 * `opencascade-ts` CLI — CAD operations straight from the shell, made for
 * agent harnesses (dsh / pi / codex) that work through a terminal.
 *
 *   opencascade-ts info part.step [--json]
 *   opencascade-ts convert part.step part.stl [--deflection 0.1]
 *   opencascade-ts convert part.step drawing.svg [--view 0,0,1] [--hidden]
 *   opencascade-ts hlr part.step drawing.svg [--view 1,1,1] [--hidden]
 *
 * Inputs: .step/.stp/.brep   Outputs: .step/.stp/.brep/.stl/.obj/.svg
 */

import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import path from "node:path";

import { hiddenLinesToSvg, meshToAsciiStl, meshToObj } from "./exporters.js";
import type { DocumentNode } from "./interrogate.js";
import { OccSession, type OccShape } from "./occ.js";
import type { UnitOption, Vec3 } from "./types.js";

const USAGE = `occt.ts — Open CASCADE for the agent era

Usage:
  occt-ts info <input> [--json]
      Report shape type, validity, bounds, volume, area, sub-shape counts.
  occt-ts describe <input> [--json]
      Analytic description: every face/edge (planes, cylinders, circles,
      radii, centers...) plus heuristic hole detection.
  occt-ts tree <input>
      STEP assembly tree with names, colors and instance transforms.
  occt-ts convert <input> <output> [--deflection 0.1]
      Convert between STEP / BRep / IGES / STL / OBJ / SVG / glTF.
  occt-ts hlr <input> <output.svg> [--view x,y,z] [--up x,y,z] [--hidden]
      Hidden-line-removal drawing (SVG). Default view: top (0,0,1).

Input formats: .step .stp .brep .igs .iges
Output formats: .step .stp .brep .igs .iges .stl .obj .svg .glb

Options:
  --deflection <mm>   Tessellation chord deflection (default 0.1)
  --view x,y,z        Viewing direction for SVG/HLR (default 0,0,1)
  --up x,y,z          Drawing "up" hint for SVG/HLR (default 0,0,1)
  --unit <u>          STEP unit for this call: mm cm m km in inch ft mi um
  --hidden            Include hidden edges (dashed) in SVG
  --json              Machine-readable output (info / describe)
`;

function parseVec3(text: string | undefined, fallback: Vec3, name: string): Vec3 {
  if (text === undefined) return fallback;
  const parts = text.split(",").map((value) => Number(value));
  if (parts.length !== 3 || parts.some((value) => Number.isNaN(value))) {
    throw new Error(`--${name} expects "x,y,z" (got "${text}")`);
  }
  return [parts[0]!, parts[1]!, parts[2]!];
}

const UNITS = new Set(["mm", "cm", "m", "km", "in", "inch", "ft", "mi", "um"]);

function unitOption(value: string | undefined): UnitOption | undefined {
  if (value === undefined) return undefined;
  if (!UNITS.has(value)) {
    throw new Error(`--unit expects one of mm cm m km in inch ft mi um (got "${value}")`);
  }
  return value as UnitOption;
}

async function readModel(occ: OccSession, file: string, unit?: string): Promise<OccShape> {
  const bytes = await readFile(file);
  const ext = path.extname(file).toLowerCase();
  if (ext === ".step" || ext === ".stp") return occ.readStep(bytes, { unit: unitOption(unit) });
  if (ext === ".brep" || ext === ".brp") return occ.readBrep(bytes);
  if (ext === ".igs" || ext === ".iges") return occ.readIges(bytes);
  throw new Error(`unsupported input format "${ext}" — expected .step/.stp/.brep/.igs/.iges`);
}

function infoOf(shape: OccShape) {
  const bounds = shape.bounds();
  return {
    shapeType: shape.shapeType(),
    isValid: shape.isValid(),
    volume: round(shape.volume()),
    area: round(shape.area()),
    bounds: {
      min: bounds.min.map(round),
      max: bounds.max.map(round),
      size: [round(bounds.max[0] - bounds.min[0]), round(bounds.max[1] - bounds.min[1]), round(bounds.max[2] - bounds.min[2])],
    },
    counts: {
      solids: shape.count("Solid"),
      shells: shape.count("Shell"),
      faces: shape.count("Face"),
      wires: shape.count("Wire"),
      edges: shape.count("Edge"),
      vertices: shape.count("Vertex"),
    },
  };
}

function round(value: number): number {
  return Math.abs(value) >= 1e-9 ? Number(value.toPrecision(10)) : 0;
}

async function commandInfo(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    options: { json: { type: "boolean" }, unit: { type: "string" } },
    allowPositionals: true,
  });
  const file = positionals[0];
  if (!file) throw new Error("info: missing <input> file");

  const occ = await OccSession.create();
  const shape = await readModel(occ, file, values.unit);
  const info = infoOf(shape);
  if (values.json) {
    console.log(JSON.stringify({ file: path.resolve(file), ...info }, null, 2));
  } else {
    console.log(`${file}`);
    console.log(`  type:     ${info.shapeType}  valid: ${info.isValid}`);
    console.log(`  volume:   ${info.volume}`);
    console.log(`  area:     ${info.area}`);
    console.log(`  size:     ${info.bounds.size.join(" × ")}`);
    console.log(`  bounds:   min [${info.bounds.min}] max [${info.bounds.max}]`);
    console.log(
      `  counts:   ${info.counts.solids} solids, ${info.counts.faces} faces, ${info.counts.edges} edges, ${info.counts.vertices} vertices`,
    );
  }
  occ.dispose();
  return 0;
}

async function commandDescribe(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    options: { json: { type: "boolean" } },
    allowPositionals: true,
  });
  const file = positionals[0];
  if (!file) throw new Error("describe: missing <input> file");

  const occ = await OccSession.create();
  const shape = await readModel(occ, file);
  const description = occ.describe(shape);
  if (values.json) {
    console.log(JSON.stringify({ file: path.resolve(file), ...description }, null, 2));
  } else {
    console.log(`${file}: ${description.shapeType}`);
    console.log(
      `  faces: ${description.faces.length} (${tally(description.faces.map((f) => f.surface))})`,
    );
    console.log(
      `  edges: ${description.edges.length} (${tally(description.edges.map((e) => e.curve))})`,
    );
    if (description.holes.length > 0) {
      console.log(`  holes:`);
      for (const hole of description.holes) {
        console.log(
          `    r=${round(hole.radius)}  depth=${round(hole.length ?? 0)}  axis=[${hole.axis.map(round)}]  center=[${hole.center.map(round)}]`,
        );
      }
    } else {
      console.log(`  holes: (none detected)`);
    }
  }
  occ.dispose();
  return 0;
}

function tally(names: string[]): string {
  const counts = new Map<string, number>();
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  return [...counts.entries()].map(([name, count]) => `${count} ${name}`).join(", ");
}

async function commandTree(args: string[]): Promise<number> {
  const { positionals } = parseArgs({ args, options: {}, allowPositionals: true });
  const file = positionals[0];
  if (!file) throw new Error("tree: missing <input> file");

  const occ = await OccSession.create();
  const bytes = await readFile(file);
  const ext = path.extname(file).toLowerCase();
  if (ext !== ".step" && ext !== ".stp") {
    throw new Error("tree: assembly trees are read from STEP files only");
  }
  const document = occ.readStepDocument(bytes);

  const printNode = (node: DocumentNode, prefix: string, last: boolean): void => {
    const connector = prefix === "" ? "" : last ? "└─ " : "├─ ";
    const parts = [node.name ?? "(unnamed)"];
    if (node.color) parts.push(node.color);
    if (node.transform) parts.push("transformed");
    if (node.shape !== undefined) {
      const shape = occ.documentShape(node.shape);
      parts.push(`#${node.shape} ${shape.shapeType()} vol=${round(shape.volume())}`);
    }
    console.log(`${prefix}${connector}${parts.join(" · ")}`);
    const children = node.children ?? [];
    children.forEach((child, index) => {
      printNode(child, prefix === "" ? "  " : `${prefix}${last ? "  " : "│ "}`, index === children.length - 1);
    });
  };

  console.log(`${file}: ${document.shapeCount} shape(s)`);
  document.tree.forEach((node, index) => {
    printNode(node, "", index === document.tree.length - 1);
  });
  occ.dispose();
  return 0;
}

async function convertOrHlr(command: "convert" | "hlr", args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      deflection: { type: "string" },
      view: { type: "string" },
      up: { type: "string" },
      unit: { type: "string" },
      hidden: { type: "boolean" },
    },
    allowPositionals: true,
  });
  const [input, output] = positionals;
  if (!input || (!output && command === "convert")) {
    throw new Error(`${command}: expected <input> and <output> paths`);
  }
  const outFile = output ?? (command === "hlr" ? `${path.basename(input, path.extname(input))}.svg` : undefined);

  const deflection = values.deflection !== undefined ? Number(values.deflection) : 0.1;
  if (Number.isNaN(deflection) || deflection <= 0) throw new Error("--deflection expects a positive number");
  const direction = parseVec3(values.view, [0, 0, 1], "view");
  const up = parseVec3(values.up, [0, 0, 1], "up");
  const unit = values.unit as UnitOption | undefined;

  const occ = await OccSession.create();
  const shape = await readModel(occ, input, unit);
  const outExt = path.extname(outFile!).toLowerCase();

  let bytes: Uint8Array | string;
  switch (outExt) {
    case ".step":
    case ".stp":
      bytes = occ.writeStep(shape, { unit });
      break;
    case ".brep":
      bytes = occ.writeBrep(shape, true);
      break;
    case ".igs":
    case ".iges":
      bytes = occ.writeIges(shape);
      break;
    case ".glb":
      bytes = occ.writeGltf(shape);
      break;
    case ".stl":
      bytes = meshToAsciiStl(occ.tessellate(shape, { linearDeflection: deflection }));
      break;
    case ".obj":
      bytes = meshToObj(occ.tessellate(shape, { linearDeflection: deflection }));
      break;
    case ".svg": {
      const lines = occ.hiddenLines(shape, { direction, up, deflection });
      bytes = hiddenLinesToSvg(lines, { showHidden: values.hidden ?? false });
      break;
    }
    default:
      throw new Error(`unsupported output format "${outExt}" — expected .step/.stp/.brep/.igs/.stl/.obj/.svg/.glb`);
  }
  await writeFile(outFile!, bytes);
  console.log(`wrote ${outFile}`);
  occ.dispose();
  return 0;
}

export async function main(argv: string[] = []): Promise<number> {
  const [command, ...rest] = argv;
  switch (command) {
    case "info":
      return commandInfo(rest);
    case "describe":
      return commandDescribe(rest);
    case "tree":
      return commandTree(rest);
    case "convert":
      return convertOrHlr("convert", rest);
    case "hlr":
      return convertOrHlr("hlr", rest);
    case "help":
    case "--help":
    case "-h":
    case undefined:
      console.log(USAGE);
      return 0;
    default:
      throw new Error(`unknown command "${command}"\n\n${USAGE}`);
  }
}
