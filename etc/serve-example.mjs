// Tiny static file server for examples/ — zero dependencies.
// Serves the repo root at http://localhost:8787 so the browser example can
// import the compiled library from ../../dist/.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT ?? 8787);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".md": "text/markdown; charset=utf-8",
};

createServer(async (request, response) => {
  try {
    const urlPath = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
    const relative = urlPath === "/" ? "examples/browser-viewer/index.html" : urlPath.slice(1);
    const file = path.resolve(
      root,
      relative.endsWith("/") ? `${relative}index.html` : relative,
    );
    if (!file.startsWith(root)) throw new Error("path traversal rejected");

    const body = await readFile(file);
    response.writeHead(200, {
      "content-type": MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream",
    });
    response.end(body);
  } catch (error) {
    response.writeHead(404, { "content-type": "text/plain" });
    response.end(`not found: ${request.url}`);
  }
}).listen(port, () => {
  console.log(`opencascade-ts example: http://localhost:${port}/examples/browser-viewer/`);
});
