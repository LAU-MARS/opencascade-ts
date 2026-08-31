import { existsSync } from "node:fs";
import path from "node:path";
import { describe } from "vitest";

/**
 * Integration tests need the wasm artifact (`npm run build:wasm`, Docker).
 * They skip automatically when it has not been built yet, so `npm test` works
 * on a fresh clone — CI builds the artifact first and runs them for real.
 */
export const wasmAvailable: boolean = existsSync(
  path.resolve(process.cwd(), "dist", "wasm", "occtjs.wasm"),
);

export const describeWasm = wasmAvailable ? describe : describe.skip;
