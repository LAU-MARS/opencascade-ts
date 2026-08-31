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
import { OccSession, type OccShape } from "./occ.js";
import type { Vec3 } from "./types.js";

const USAGE = `opencascade-ts — Open CASCADE for the agent era

Usage:
  opencascade-ts info <input> [--json]
      Report shape type, validity, bounds, volume, area, sub-shape counts.
  opencascade-ts convert <input> <output> [--deflection 0.1]
      Convert between STEP / BRep / STL / OBJ / SVG.
  opencascade-ts hlr <input> <output.svg> [--view x,y,z] [--up x,y,z] [--hidden]
      Hidden-line-removal drawing (SVG). Default view: top (0,0,1).

Input formats: .step .stp .brep
Output formats: .step .stp .brep .stl .obj .svg

Options:
  --deflection <mm>   Tessellation chord deflection (default 0.1)
  --view x,y,z        Viewing direction for SVG/HLR (default 0,0,1)
  --up x,y,z          Drawing "up" hint for SVG/HLR (default 0,0,1)
  --hidden            Include hidden edges (dashed) in SVG
  --json              Machine-readable output (info)
`;

function parseVec3(text: string | undefined, fallback: Vec3, name: string): Vec3 {
  if (text === undefined) return fallback;
  const parts = text.split(",").map((value) => Number(value));
  if (parts.length !== 3 || parts.some((value) => Number.isNaN(value))) {
    throw new Error(`--${name} expects "x,y,z" (got "${text}")`);
  }
  return [parts[0]!, parts[1]!, parts[2]!];
}

async function readModel(occ: OccSession, file: string): Promise<OccShape> {
  const bytes = await readFile(file);
  const ext = path.extname(file).toLowerCase();
  if (ext === ".step" || ext === ".stp") return occ.readStep(bytes);
  if (ext === ".brep" || ext === ".brp") return occ.readBrep(bytes);
  throw new Error(`unsupported input format "${ext}" — expected .step/.stp/.brep`);
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
    options: { json: { type: "boolean" } },
    allowPositionals: true,
  });
  const file = positionals[0];
  if (!file) throw new Error("info: missing <input> file");

  const occ = await OccSession.create();
  const shape = await readModel(occ, file);
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

async function convertOrHlr(command: "convert" | "hlr", args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      deflection: { type: "string" },
      view: { type: "string" },
      up: { type: "string" },
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

  const occ = await OccSession.create();
  const shape = await readModel(occ, input);
  const outExt = path.extname(outFile!).toLowerCase();

  let bytes: Uint8Array | string;
  switch (outExt) {
    case ".step":
    case ".stp":
      bytes = occ.writeStep(shape);
      break;
    case ".brep":
      bytes = occ.writeBrep(shape, true);
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
      throw new Error(`unsupported output format "${outExt}" — expected .step/.stp/.brep/.stl/.obj/.svg`);
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
