/**
 * WebGLViewer — a zero-dependency WebGL2 viewer for tessellated OCCT shapes.
 *
 * ```ts
 * const viewer = new WebGLViewer(canvas);
 * viewer.addMesh(part.tessellate());
 * viewer.addHiddenLines(part.hiddenLines({ direction: [0, 0, 1] }));
 * viewer.fit();
 * ```
 *
 * Rendering model: triangles (Phong-ish, double-sided) first with polygon
 * offset, then line segments on top with a depth test — wireframe and
 * hidden-line overlays read correctly against the surfaces.
 */

import { computeVertexNormals, type MeshWithNormals } from "../mesh-utils.js";
import type { HiddenLineResult, MeshData } from "../types.js";
import { OrbitCamera } from "./camera.js";
import { mat4Create, type Mat4 } from "./mat4.js";
import {
  LINE_FRAGMENT_SHADER,
  LINE_VERTEX_SHADER,
  MESH_FRAGMENT_SHADER,
  MESH_VERTEX_SHADER,
} from "./shaders.js";

export type Rgb = readonly [number, number, number];

export interface MeshModelOptions {
  /** Linear RGB, 0..1. Default `[0.72, 0.75, 0.8]`. */
  color?: Rgb;
  /** 1 = opaque. Values < 1 render blended. Default `1`. */
  opacity?: number;
}

export interface LineModelOptions {
  /** Linear RGB, 0..1. Default `[0.08, 0.08, 0.1]`. */
  color?: Rgb;
  opacity?: number;
  /** Dashed lines (hidden edges). Default `false`. */
  dashed?: boolean;
}

export interface HiddenLineOverlayOptions {
  visibleColor?: Rgb;
  hiddenColor?: Rgb;
  /** Draw hidden edges too (dashed). Default `false`. */
  showHidden?: boolean;
}

export interface ViewerOptions {
  /** Linear RGB clear color. Default `[0.96, 0.96, 0.97]`. */
  background?: Rgb;
  /** MSAA on the drawing buffer. Default `true`. */
  antialias?: boolean;
}

interface MeshGpu {
  vao: WebGLVertexArrayObject;
  positionBuffer: WebGLBuffer;
  normalBuffer: WebGLBuffer;
  indexBuffer: WebGLBuffer;
  indexCount: number;
}

interface LineGpu {
  vao: WebGLVertexArrayObject;
  positionBuffer: WebGLBuffer;
  distanceBuffer: WebGLBuffer;
  vertexCount: number;
}

interface MeshModel {
  kind: "mesh";
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  color: Rgb;
  opacity: number;
  gpu?: MeshGpu;
}

interface LineModel {
  kind: "lines";
  points: Float32Array;
  distances: Float32Array;
  color: Rgb;
  opacity: number;
  dashed: boolean;
  gpu?: LineGpu;
}

type Model = MeshModel | LineModel;

const DEFAULT_MESH_COLOR: Rgb = [0.72, 0.75, 0.8];
const DEFAULT_LINE_COLOR: Rgb = [0.08, 0.08, 0.1];
const HIDDEN_LINE_COLOR: Rgb = [0.5, 0.5, 0.56];

interface MeshProgram {
  program: WebGLProgram;
  uMvp: WebGLUniformLocation | null;
  uColor: WebGLUniformLocation | null;
  uOpacity: WebGLUniformLocation | null;
  uEye: WebGLUniformLocation | null;
}

interface LineProgram {
  program: WebGLProgram;
  uMvp: WebGLUniformLocation | null;
  uColor: WebGLUniformLocation | null;
  uDash: WebGLUniformLocation | null;
  uDashOn: WebGLUniformLocation | null;
}

export class WebGLViewer {
  readonly camera = new OrbitCamera();

  readonly #canvas: HTMLCanvasElement;
  #gl: WebGL2RenderingContext;
  #meshProgram: MeshProgram | null = null;
  #lineProgram: LineProgram | null = null;
  #models = new Map<number, Model>();
  #nextHandle = 1;
  #sceneMin: [number, number, number] = [Infinity, Infinity, Infinity];
  #sceneMax: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  #resizeObserver: ResizeObserver | null = null;
  #renderScheduled = false;
  #disposed = false;
  #background: Rgb;
  #pointers = new Map<number, { x: number; y: number }>();
  #dragMode: "none" | "orbit" | "pan" = "none";
  #lastPoint: { x: number; y: number } | null = null;
  #pinchDistance = 0;

  constructor(canvas: HTMLCanvasElement, options: ViewerOptions = {}) {
    this.#canvas = canvas;
    this.#background = options.background ?? [0.96, 0.96, 0.97];

    const gl = canvas.getContext("webgl2", {
      antialias: options.antialias ?? true,
      alpha: false,
    });
    if (!gl) {
      throw new Error(
        "WebGL2 is not available. The opencascade-ts kernel runs headless in Node; " +
          "rendering needs a browser (or headless-GL) context.",
      );
    }
    this.#gl = gl;

    this.#initGl();
    this.#attachEvents();

    if (typeof ResizeObserver !== "undefined") {
      this.#resizeObserver = new ResizeObserver(() => {
        this.#resize();
        this.requestRender();
      });
      this.#resizeObserver.observe(canvas);
    }
    this.#resize();
    this.render();
  }

  // --- scene ------------------------------------------------------------------

  /** Add a tessellated mesh; returns a handle for `remove()`. */
  addMesh(mesh: MeshData | MeshWithNormals, options: MeshModelOptions = {}): number {
    const normals = "normals" in mesh ? mesh.normals : computeVertexNormals(mesh.positions, mesh.indices);
    const model: MeshModel = {
      kind: "mesh",
      positions: mesh.positions,
      normals,
      indices: mesh.indices,
      color: options.color ?? DEFAULT_MESH_COLOR,
      opacity: options.opacity ?? 1,
    };
    return this.#addModel(model);
  }

  /** Add 3D line segments (consecutive point pairs); returns a handle. */
  addLineSegments(points: Float32Array, options: LineModelOptions = {}): number {
    const pointCount = Math.floor(points.length / 3);
    const distances = new Float32Array(pointCount);
    for (let i = 0; i + 1 < pointCount; i += 2) {
      const a = i * 3;
      const b = (i + 1) * 3;
      distances[i + 1] = Math.hypot(
        points[b]! - points[a]!,
        points[b + 1]! - points[a + 1]!,
        points[b + 2]! - points[a + 2]!,
      );
    }
    const model: LineModel = {
      kind: "lines",
      points,
      distances,
      color: options.color ?? DEFAULT_LINE_COLOR,
      opacity: options.opacity ?? 1,
      dashed: options.dashed ?? false,
    };
    return this.#addModel(model);
  }

  /**
   * Add a hidden-line-removal result as an overlay: visible edges solid,
   * hidden edges dashed (when `showHidden`). Returns the created handles.
   */
  addHiddenLines(
    result: HiddenLineResult,
    options: HiddenLineOverlayOptions = {},
  ): number[] {
    const handles: number[] = [];
    if (result.visible.length > 0) {
      handles.push(this.addLineSegments(result.visible, { color: options.visibleColor ?? DEFAULT_LINE_COLOR }));
    }
    if (options.showHidden && result.hidden.length > 0) {
      handles.push(
        this.addLineSegments(result.hidden, { color: options.hiddenColor ?? HIDDEN_LINE_COLOR, dashed: true }),
      );
    }
    return handles;
  }

  remove(handle: number): void {
    const model = this.#models.get(handle);
    if (!model) return;
    this.#deleteGpuResources(model);
    this.#models.delete(handle);
    this.#recomputeSceneBounds();
    this.requestRender();
  }

  clear(): void {
    for (const model of this.#models.values()) {
      this.#deleteGpuResources(model);
    }
    this.#models.clear();
    this.#recomputeSceneBounds();
    this.requestRender();
  }

  /** Frame the whole scene (or explicit bounds) in the view. */
  fit(min?: readonly number[], max?: readonly number[]): void {
    const lo = min ?? this.#sceneMin;
    const hi = max ?? this.#sceneMax;
    if (Number.isFinite(lo[0]) && Number.isFinite(hi[0])) {
      this.camera.fit(lo, hi);
    }
    this.requestRender();
  }

  /** Draw now (rendering is otherwise on-demand). */
  render(): void {
    const gl = this.#gl;
    if (this.#disposed) return;
    if (!this.#meshProgram || !this.#lineProgram) this.#initGl();
    if (!this.#meshProgram || !this.#lineProgram) return;

    this.#resize();

    const [br, bg, bb] = this.#background;
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.clearColor(br, bg, bb, 1);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const aspect = gl.drawingBufferWidth / Math.max(gl.drawingBufferHeight, 1);
    const mvp = mat4Create() as Mat4;
    this.camera.combinedMatrix(mvp, aspect);

    const models = [...this.#models.values()];
    const meshes = models.filter((m): m is MeshModel => m.kind === "mesh");
    const opaque = meshes.filter((m) => m.opacity >= 1);
    const transparent = meshes.filter((m) => m.opacity < 1).reverse();

    // Triangle pass: push fills slightly back so lines land on top.
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(1, 1);
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    const meshProgram = this.#meshProgram;
    gl.useProgram(meshProgram.program);
    gl.uniformMatrix4fv(meshProgram.uMvp, false, mvp);
    gl.uniform3fv(meshProgram.uEye, this.camera.eye());
    for (const model of opaque) this.#drawMesh(model);
    gl.disable(gl.POLYGON_OFFSET_FILL);

    if (transparent.length > 0) {
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      for (const model of transparent) this.#drawMesh(model);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }

    // Line pass.
    const lineProgram = this.#lineProgram;
    gl.useProgram(lineProgram.program);
    gl.uniformMatrix4fv(lineProgram.uMvp, false, mvp);
    const dashPeriod = this.camera.radius * 0.035;
    gl.uniform1f(lineProgram.uDash, dashPeriod);
    gl.uniform1f(lineProgram.uDashOn, dashPeriod * 0.55);
    for (const model of models) {
      if (model.kind === "lines") this.#drawLines(model);
    }
  }

  /** Coalesce multiple requests into one animation frame. */
  requestRender(): void {
    if (this.#renderScheduled || this.#disposed) return;
    this.#renderScheduled = true;
    requestAnimationFrame(() => {
      this.#renderScheduled = false;
      this.render();
    });
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#resizeObserver?.disconnect();
    this.clear();
  }

  // --- internals ----------------------------------------------------------------

  #addModel(model: Model): number {
    const handle = this.#nextHandle++;
    this.#models.set(handle, model);
    this.#uploadModel(model);
    this.#extendSceneBounds(model);
    this.requestRender();
    return handle;
  }

  #uploadModel(model: Model): void {
    if (model.gpu) return;
    if (model.kind === "mesh") {
      if (model.positions.length === 0 || model.indices.length === 0) return;
      const gl = this.#gl;
      const vao = gl.createVertexArray();
      if (!vao) return;
      gl.bindVertexArray(vao);

      const positionBuffer = this.#buffer(gl.ARRAY_BUFFER, model.positions);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

      const normalBuffer = this.#buffer(gl.ARRAY_BUFFER, model.normals);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);

      const indexBuffer = this.#buffer(gl.ELEMENT_ARRAY_BUFFER, model.indices);

      gl.bindVertexArray(null);
      model.gpu = { vao, positionBuffer, normalBuffer, indexBuffer, indexCount: model.indices.length };
    } else {
      if (model.points.length === 0) return;
      const gl = this.#gl;
      const vao = gl.createVertexArray();
      if (!vao) return;
      gl.bindVertexArray(vao);

      const positionBuffer = this.#buffer(gl.ARRAY_BUFFER, model.points);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

      const distanceBuffer = this.#buffer(gl.ARRAY_BUFFER, model.distances);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 0, 0);

      gl.bindVertexArray(null);
      model.gpu = { vao, positionBuffer, distanceBuffer, vertexCount: model.distances.length };
    }
  }

  #buffer(target: number, data: Float32Array | Uint32Array): WebGLBuffer {
    const gl = this.#gl;
    const buffer = gl.createBuffer();
    gl.bindBuffer(target, buffer);
    gl.bufferData(target, data, gl.STATIC_DRAW);
    return buffer;
  }

  #drawMesh(model: MeshModel): void {
    if (!model.gpu) return;
    const gl = this.#gl;
    const program = this.#meshProgram!;
    gl.uniform3fv(program.uColor, model.color);
    gl.uniform1f(program.uOpacity, model.opacity);
    gl.bindVertexArray(model.gpu.vao);
    gl.drawElements(gl.TRIANGLES, model.gpu.indexCount, gl.UNSIGNED_INT, 0);
  }

  #drawLines(model: LineModel): void {
    if (!model.gpu) return;
    const gl = this.#gl;
    const program = this.#lineProgram!;
    gl.uniform4f(program.uColor, model.color[0], model.color[1], model.color[2], model.opacity);
    if (!model.dashed) {
      gl.uniform1f(program.uDash, 0);
      gl.uniform1f(program.uDashOn, 0);
    }
    gl.bindVertexArray(model.gpu.vao);
    gl.drawArrays(gl.LINES, 0, model.gpu.vertexCount);
    if (model.dashed) {
      gl.uniform1f(program.uDash, this.camera.radius * 0.035);
      gl.uniform1f(program.uDashOn, this.camera.radius * 0.035 * 0.55);
    }
  }

  #deleteGpuResources(model: Model): void {
    const gl = this.#gl;
    if (model.kind === "mesh" && model.gpu) {
      gl.deleteBuffer(model.gpu.positionBuffer);
      gl.deleteBuffer(model.gpu.normalBuffer);
      gl.deleteBuffer(model.gpu.indexBuffer);
      gl.deleteVertexArray(model.gpu.vao);
      model.gpu = undefined;
    } else if (model.kind === "lines" && model.gpu) {
      gl.deleteBuffer(model.gpu.positionBuffer);
      gl.deleteBuffer(model.gpu.distanceBuffer);
      gl.deleteVertexArray(model.gpu.vao);
      model.gpu = undefined;
    }
  }

  #extendSceneBounds(model: Model): void {
    const points = model.kind === "mesh" ? model.positions : model.points;
    for (let i = 0; i + 2 < points.length; i += 3) {
      this.#sceneMin[0] = Math.min(this.#sceneMin[0], points[i]!);
      this.#sceneMin[1] = Math.min(this.#sceneMin[1], points[i + 1]!);
      this.#sceneMin[2] = Math.min(this.#sceneMin[2], points[i + 2]!);
      this.#sceneMax[0] = Math.max(this.#sceneMax[0], points[i]!);
      this.#sceneMax[1] = Math.max(this.#sceneMax[1], points[i + 1]!);
      this.#sceneMax[2] = Math.max(this.#sceneMax[2], points[i + 2]!);
    }
  }

  #recomputeSceneBounds(): void {
    this.#sceneMin = [Infinity, Infinity, Infinity];
    this.#sceneMax = [-Infinity, -Infinity, -Infinity];
    for (const model of this.#models.values()) {
      this.#extendSceneBounds(model);
    }
  }

  #resize(): void {
    const dpr = Math.min(globalThis.devicePixelRatio ?? 1, 4);
    const width = Math.max(1, Math.round(this.#canvas.clientWidth * dpr));
    const height = Math.max(1, Math.round(this.#canvas.clientHeight * dpr));
    if (this.#canvas.width !== width || this.#canvas.height !== height) {
      this.#canvas.width = width;
      this.#canvas.height = height;
    }
  }

  #initGl(): void {
    const gl = this.#gl;
    const meshProgram = this.#compile(MESH_VERTEX_SHADER, MESH_FRAGMENT_SHADER);
    this.#meshProgram = {
      program: meshProgram,
      uMvp: gl.getUniformLocation(meshProgram, "uMvp"),
      uColor: gl.getUniformLocation(meshProgram, "uColor"),
      uOpacity: gl.getUniformLocation(meshProgram, "uOpacity"),
      uEye: gl.getUniformLocation(meshProgram, "uEye"),
    };

    const lineProgram = this.#compile(LINE_VERTEX_SHADER, LINE_FRAGMENT_SHADER);
    this.#lineProgram = {
      program: lineProgram,
      uMvp: gl.getUniformLocation(lineProgram, "uMvp"),
      uColor: gl.getUniformLocation(lineProgram, "uColor"),
      uDash: gl.getUniformLocation(lineProgram, "uDash"),
      uDashOn: gl.getUniformLocation(lineProgram, "uDashOn"),
    };

    // (Re)upload every model — also the context-restore path.
    for (const model of this.#models.values()) {
      this.#deleteGpuResources(model);
      this.#uploadModel(model);
    }
  }

  #compile(vertexSource: string, fragmentSource: string): WebGLProgram {
    const gl = this.#gl;
    const compileShader = (type: number, source: string): WebGLShader => {
      const shader = gl.createShader(type);
      if (!shader) throw new Error("could not allocate a WebGL shader");
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(shader) ?? "unknown error";
        gl.deleteShader(shader);
        throw new Error(`shader compile failed: ${log}`);
      }
      return shader;
    };

    const program = gl.createProgram();
    if (!program) throw new Error("could not allocate a WebGL program");
    gl.attachShader(program, compileShader(gl.VERTEX_SHADER, vertexSource));
    gl.attachShader(program, compileShader(gl.FRAGMENT_SHADER, fragmentSource));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program) ?? "unknown error";
      gl.deleteProgram(program);
      throw new Error(`program link failed: ${log}`);
    }
    return program;
  }

  // --- interaction ----------------------------------------------------------------

  #attachEvents(): void {
    const canvas = this.#canvas;

    canvas.addEventListener("pointerdown", (event) => {
      if (this.#pointers.size === 0) {
        this.#dragMode =
          event.button === 0 && !event.shiftKey && !event.ctrlKey && !event.metaKey
            ? "orbit"
            : "pan";
      }
      this.#pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this.#pointers.size === 2) {
        this.#pinchDistance = this.#currentPinchDistance();
      }
      canvas.setPointerCapture(event.pointerId);
    });

    canvas.addEventListener("pointermove", (event) => {
      const previous = this.#pointers.get(event.pointerId);
      if (!previous) return;
      const dx = event.clientX - previous.x;
      const dy = event.clientY - previous.y;
      this.#pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

      if (this.#pointers.size === 1) {
        const speed = 0.008;
        if (this.#dragMode === "orbit") {
          this.camera.orbit(-dx * speed, dy * speed);
        } else {
          this.camera.panByPixels(dx, dy, this.#canvas.clientHeight);
        }
        this.requestRender();
      } else if (this.#pointers.size === 2) {
        const distance = this.#currentPinchDistance();
        if (this.#pinchDistance > 0 && distance > 0) {
          this.camera.zoom(this.#pinchDistance / distance);
        }
        this.camera.panByPixels(dx / 2, dy / 2, this.#canvas.clientHeight);
        this.#pinchDistance = distance;
        this.requestRender();
      }
    });

    const endPointer = (event: PointerEvent): void => {
      this.#pointers.delete(event.pointerId);
      if (this.#pointers.size === 0) {
        this.#dragMode = "none";
      } else if (this.#pointers.size === 1) {
        this.#dragMode = "pan";
      }
    };
    canvas.addEventListener("pointerup", endPointer);
    canvas.addEventListener("pointercancel", endPointer);

    canvas.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        this.camera.zoom(Math.exp(event.deltaY * 0.0012));
        this.requestRender();
      },
      { passive: false },
    );

    canvas.addEventListener("contextmenu", (event) => event.preventDefault());

    canvas.addEventListener(
      "webglcontextlost",
      (event) => {
        event.preventDefault();
        this.#meshProgram = null;
        this.#lineProgram = null;
        for (const model of this.#models.values()) {
          if (model.kind === "mesh" || model.kind === "lines") model.gpu = undefined;
        }
      },
      false,
    );
    canvas.addEventListener(
      "webglcontextrestored",
      () => {
        this.#initGl();
        this.requestRender();
      },
      false,
    );
  }

  #currentPinchDistance(): number {
    const points = [...this.#pointers.values()];
    if (points.length < 2) return 0;
    return Math.hypot(points[0]!.x - points[1]!.x, points[0]!.y - points[1]!.y);
  }
}
