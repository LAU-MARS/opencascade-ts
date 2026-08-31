/**
 * Loads the opencascade-ts wasm module (dist/wasm/occtjs.js + occtjs.wasm)
 * in Node and in the browser.
 *
 * Resolution order (first hit wins):
 *   1. explicit `moduleUrl` / `wasmUrl` options
 *   2. `OCCT_WASM_DIR` environment variable (Node only)
 *   3. `<this module>/wasm/` — the installed-package layout
 *   4. `<repo>/dist/wasm/` — running from a git checkout (tests, examples)
 *   5. `<cwd>/node_modules/opencascade-ts/dist/wasm/`
 *
 * When the artifact has not been built yet the error lists every searched
 * location, plus the one-line build command — agents can self-recover.
 */

import type { OccModuleFactory, OccWasmModule } from "./wasm-module.js";

const MODULE_FILE = "occtjs.js";
const WASM_FILE = "occtjs.wasm";

export interface WasmLocationOptions {
  /** URL (browser) or path/URL (Node) of the embind factory `occtjs.js`. */
  moduleUrl?: string | URL;
  /** URL (browser) or path/URL (Node) of the binary `occtjs.wasm`. */
  wasmUrl?: string | URL;
}

function isNode(): boolean {
  return typeof process !== "undefined" && Boolean(process.versions?.node);
}

export async function loadOccModule(
  options: WasmLocationOptions = {},
): Promise<OccWasmModule> {
  return isNode() ? loadInNode(options) : loadInBrowser(options);
}

// --- Node ---------------------------------------------------------------------

async function loadInNode(options: WasmLocationOptions): Promise<OccWasmModule> {
  const [{ fileURLToPath, pathToFileURL }, fs, path] = await Promise.all([
    import("node:url"),
    import("node:fs"),
    import("node:path"),
  ]);

  const selfDir = path.dirname(fileURLToPath(import.meta.url));
  const searched: string[] = [];

  const moduleDirOf = (value: string | URL | undefined): string | null =>
    value == null
      ? null
      : path.dirname(String(value).startsWith("file:") ? fileURLToPath(value) : String(value));

  const dirs: (string | null)[] = [
    moduleDirOf(options.moduleUrl),
    process.env.OCCT_WASM_DIR ?? null,
    path.join(selfDir, "wasm"),
    path.resolve(selfDir, "..", "..", "dist", "wasm"),
    path.resolve(process.cwd(), "dist", "wasm"),
    path.resolve(process.cwd(), "node_modules", "opencascade-ts", "dist", "wasm"),
  ];

  const firstExisting = (file: string): string | null => {
    for (const dir of dirs) {
      if (!dir) continue;
      const candidate = path.join(dir, file);
      searched.push(candidate);
      if (fs.existsSync(candidate)) return candidate;
    }
    return null;
  };

  const toPath = (value: string | URL): string =>
    String(value).startsWith("file:") ? fileURLToPath(String(value)) : String(value);

  const modulePath = options.moduleUrl ? toPath(options.moduleUrl) : firstExisting(MODULE_FILE);
  const wasmPath = options.wasmUrl ? toPath(options.wasmUrl) : firstExisting(WASM_FILE);

  if (!modulePath || !wasmPath) {
    throw new Error(
      `opencascade-ts wasm artifact not found.\n` +
        `  searched:\n    ${searched.join("\n    ")}\n` +
        `  build it with:  npm run build:wasm   (requires Docker; first run compiles OCCT)`,
    );
  }

  const imported = (await import(pathToFileURL(modulePath).href)) as {
    default?: OccModuleFactory;
  };
  const factory = imported.default;
  if (typeof factory !== "function") {
    throw new Error(`${modulePath} does not export a module factory (expected MODULARIZE/EXPORT_ES6 build)`);
  }

  const wasmBinary = fs.readFileSync(wasmPath);
  return factory({ wasmBinary });
}

// --- Browser ------------------------------------------------------------------

async function loadInBrowser(options: WasmLocationOptions): Promise<OccWasmModule> {
  const moduleUrl = options.moduleUrl ?? new URL(`./wasm/${MODULE_FILE}`, import.meta.url);
  const wasmUrl = options.wasmUrl ?? new URL(`./wasm/${WASM_FILE}`, import.meta.url);

  const imported = (await import(/* @vite-ignore */ moduleUrl.toString())) as {
    default?: OccModuleFactory;
  };
  const factory = imported.default;
  if (typeof factory !== "function") {
    throw new Error(`${moduleUrl} does not export a module factory`);
  }

  const response = await fetch(wasmUrl);
  if (!response.ok) {
    throw new Error(
      `could not fetch ${wasmUrl} (HTTP ${response.status}). ` +
        `When bundling, copy dist/wasm/* to your public dir or pass explicit { moduleUrl, wasmUrl }.`,
    );
  }
  return factory({ wasmBinary: await response.arrayBuffer() });
}
