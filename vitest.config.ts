import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Integration tests link a multi-megabyte wasm module; give them room.
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});
