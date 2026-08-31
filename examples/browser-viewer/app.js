// Plain-ESM example: no bundler. Serve the repo root (npm run example) and
// open http://localhost:8787/examples/browser-viewer/.

import { OccSession, meshToAsciiStl, hiddenLinesToSvg } from "../../dist/index.js";
import { WebGLViewer } from "../../dist/viewer/index.js";

const occ = await OccSession.create();
const viewer = new WebGLViewer(document.getElementById("canvas"));

const status = document.getElementById("status");
const buttons = {
  fit: document.getElementById("fit"),
  wireframe: document.getElementById("wireframe"),
  hiddenLines: document.getElementById("hidden-lines"),
  exportSvg: document.getElementById("export-svg"),
  exportStl: document.getElementById("export-stl"),
};

let shape = demoPart();
let showWireframe = false;
let showHiddenLines = false;
let currentHlr = null;
let hlrHandles = [];

rebuildScene();
updateStatus();

// --- scene ---------------------------------------------------------------------

function demoPart() {
  // a plate with a center bore and four corner holes — holes are the point
  const plate = occ.makeBox(80, 50, 10);
  const bore = occ.makeCylinder(14, 30, { origin: [40, 25, -10] });
  let part = occ.cut(plate, bore);
  for (const [x, y] of [[10, 10], [70, 10], [10, 40], [70, 40]]) {
    part = occ.cut(part, occ.makeCylinder(4, 30, { origin: [x, y, -10] }));
  }
  return part;
}

function rebuildScene() {
  viewer.clear();
  hlrHandles = [];

  const mesh = occ.tessellate(shape, { linearDeflection: 0.4 });
  viewer.addMesh(mesh, { color: [0.72, 0.75, 0.8] });
  if (showWireframe) {
    viewer.addLineSegments(mesh.edges, { color: [0.16, 0.18, 0.22], opacity: 0.55 });
  }
  if (showHiddenLines) {
    currentHlr = occ.hiddenLines(shape, { direction: viewer.camera.viewDirection(), up: [0, 0, 1] });
    hlrHandles = viewer.addHiddenLines(currentHlr, { showHidden: true });
  } else {
    currentHlr = null;
  }
  viewer.fit();
}

function refreshHiddenLines() {
  if (!showHiddenLines) return;
  for (const handle of hlrHandles) viewer.remove(handle);
  currentHlr = occ.hiddenLines(shape, { direction: viewer.camera.viewDirection(), up: [0, 0, 1] });
  hlrHandles = viewer.addHiddenLines(currentHlr, { showHidden: true });
}

let refreshTimer = 0;
document.getElementById("canvas").addEventListener("pointerup", () => {
  // HLR is an OCCT computation, not a shader trick: recompute once the orbit ends
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refreshHiddenLines, 120);
});

// --- toolbar ---------------------------------------------------------------------

buttons.fit.addEventListener("click", () => {
  viewer.fit();
  refreshHiddenLines();
});

buttons.wireframe.addEventListener("click", () => {
  showWireframe = !showWireframe;
  buttons.wireframe.setAttribute("aria-pressed", String(showWireframe));
  rebuildScene();
});

buttons.hiddenLines.addEventListener("click", () => {
  showHiddenLines = !showHiddenLines;
  buttons.hiddenLines.setAttribute("aria-pressed", String(showHiddenLines));
  rebuildScene();
});

buttons.exportSvg.addEventListener("click", () => {
  const lines = currentHlr ?? occ.hiddenLines(shape, { direction: [0, 0, 1] });
  download("drawing.svg", hiddenLinesToSvg(lines, { showHidden: showHiddenLines }), "image/svg+xml");
});

buttons.exportStl.addEventListener("click", () => {
  download("mesh.stl", meshToAsciiStl(occ.tessellate(shape, { linearDeflection: 0.2 })), "model/stl");
});

// --- file loading ------------------------------------------------------------------

document.getElementById("file").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (file) await loadFile(file);
});

const overlay = document.getElementById("drop-overlay");
window.addEventListener("dragover", (event) => {
  event.preventDefault();
  overlay.classList.add("active");
});
window.addEventListener("dragleave", (event) => {
  if (event.relatedTarget === null) overlay.classList.remove("active");
});
window.addEventListener("drop", async (event) => {
  event.preventDefault();
  overlay.classList.remove("active");
  const file = event.dataTransfer.files[0];
  if (file) await loadFile(file);
});

async function loadFile(file) {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const lower = file.name.toLowerCase();
    shape = lower.endsWith(".brep") || lower.endsWith(".brp")
      ? occ.readBrep(bytes)
      : occ.readStep(bytes);
    if (!shape.isValid()) status.textContent = `${file.name}: imported with geometry warnings`;
    showWireframe = showWireframe; // keep toggles as-is
    rebuildScene();
    updateStatus(file.name);
  } catch (error) {
    status.textContent = `import failed: ${error.message ?? error}`;
  }
}

// --- helpers -------------------------------------------------------------------------

function updateStatus(fileName = "demo part") {
  const mesh = occ.tessellate(shape, { linearDeflection: 0.4 });
  const triangles = mesh.indices.length / 3;
  status.textContent =
    `${fileName} · ${shape.shapeType()} · volume ${shape.volume().toFixed(1)} mm³ · ` +
    `${shape.count("Face")} faces · ${triangles} triangles · OCCT ${occ.occtVersion}`;
}

function download(name, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}
