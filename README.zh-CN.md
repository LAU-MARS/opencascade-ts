# opencascade-ts

[English](README.md) | **[简体中文](README.zh-CN.md)**

> **面向 Agent 时代的 Open CASCADE。** 将最新的 OCCT 内核编译为 WebAssembly，配一等公民的
> TypeScript 绑定、STEP/BRep 模型导入、隐藏线消除（HLR）与零依赖 WebGL2 查看器。
> Node 端完全无头运行，浏览器端开箱即用。不依赖 Qt，不需要本地工具链。

OCCT **7.9.3** · Emscripten · TypeScript · LGPL-2.1

## 为什么做这个项目

现有的 OCCT WebAssembly 构建已经停滞了大约五年：没有隐藏线消除，默认产物里没有可用的
STEP/BRep 导入，没有 TypeScript 绑定，也不带渲染（或者强行拖上 Qt 窗口栈）。本项目为当下的
软件生产方式——**人 AND Agent 协作**——重建了整套技术栈：

| 能力 | 状态 |
|---|---|
| 最新 OCCT（7.9.3；版本是构建参数，可实验性切换 8.0） | ✅ |
| TypeScript 绑定——手写类型、ESM、strict 模式 | ✅ |
| STEP（AP203/AP214/AP242）与 BRep **导入** | ✅ |
| STEP 与 BRep 导出（含带网格的 BRep） | ✅ |
| 建模：图元、布尔（fuse/cut/common）、变换、缩放 | ✅ |
| 测量：体积、表面积、包围盒、有效性、子形状计数 | ✅ |
| **HLR**——隐藏线消除 → 可见/隐藏边线段 → SVG 工程图 | ✅ |
| WebGL2 查看器——零依赖、轨道/平移/缩放、线框、虚线隐藏边 | ✅ |
| Node 18+ 无头运行（无需 GPU、无需浏览器） | ✅ |
| CLI（`info` / `convert` / `hlr`），支持 JSON 输出 | ✅ |
| 输出格式：STEP、BRep、STL、OBJ、SVG | ✅ |
| XCAF（名称/颜色/装配体）、IGES、圆角/倒角、MCP server | 🚧 路线图 |

## 安装

```bash
npm install opencascade-ts
```

npm 包内置预构建的 wasm 产物。自行构建需要 Docker，首次约 1–2 小时
（见 [docs/BUILDING.md](docs/BUILDING.md)）；之后改 C++ 只需重链，约 1 分钟。

## 快速上手 —— Node（无头，Agent 友好）

```ts
import { OccSession, hiddenLinesToSvg, meshToAsciiStl } from "opencascade-ts";
import { readFile, writeFile } from "node:fs/promises";

const occ = await OccSession.create();

// 建模：一块带中心孔的板
const plate = occ.makeBox(80, 50, 10);
const bore = occ.makeCylinder(14, 30, { origin: [40, 25, -10] });
const part = occ.cut(plate, bore);

console.log(part.volume());      // 33842.48...
console.log(part.bounds());      // { min: [0,0,0], max: [80,50,10] }
console.log(part.isValid());     // true

// 导入 STEP 文件（Uint8Array 进，几何出）
const imported = occ.readStep(await readFile("bracket.step"));

// 工程图：俯视方向的隐藏线消除，直接出 SVG
const drawing = occ.hiddenLines(part, { direction: [0, 0, 1] });
await writeFile("drawing.svg", hiddenLinesToSvg(drawing, { showHidden: true }));

// 网格导出
await writeFile("part.stl", meshToAsciiStl(occ.tessellate(part, { linearDeflection: 0.2 })));
```

## 快速上手 —— 浏览器（WebGL2，零依赖）

```ts
import { OccSession } from "opencascade-ts";
import { WebGLViewer } from "opencascade-ts/viewer";

const occ = await OccSession.create();
const viewer = new WebGLViewer(canvas);

const part = occ.cut(occ.makeBox(80, 50, 10), occ.makeCylinder(14, 30, { origin: [40, 25, -10] }));
viewer.addMesh(part.tessellate());
viewer.addHiddenLines(part.hiddenLines({ direction: [0, 0, 1] }), { showHidden: true });
viewer.fit();
```

完整示例（STEP 拖拽导入、线框/HLR 开关、SVG 导出）：
`npm run build && npm run example` → http://localhost:8787/examples/browser-viewer/

## CLI —— 在终端里做 CAD

专为活在终端里的 agent 工具设计：

```console
$ opencascade-ts info bracket.step --json
{
  "file": "/work/bracket.step",
  "shapeType": "Solid",
  "isValid": true,
  "volume": 33842.4784,
  "area": 10248.14162,
  "bounds": { "min": [0,0,0], "max": [80,50,10], "size": [80,50,10] },
  "counts": { "solids": 1, "shells": 1, "faces": 7, "wires": 7, "edges": 15, "vertices": 10 }
}

$ opencascade-ts convert bracket.step drawing.svg --view 1,1,2 --hidden
$ opencascade-ts convert bracket.step mesh.stl --deflection 0.05
$ opencascade-ts hlr bracket.step top.svg
```

## 为 Agent 工具而生

本仓库从第一天起就按"被 coding agent 操作"来设计。

- **dsh** —— 首要支持的 harness。
- **[pi](https://pi.dev/)**（earendil-works/pi）—— 已支持。
- **[codex](https://github.com/openai/codex)**（OpenAI Codex CLI）—— 已支持。

三者都会读取仓库根目录的 **[AGENTS.md](AGENTS.md)**：构建/测试命令、仓库地图、以及添加新 OCCT
绑定的分步配方。Agent 友好性体现在设计里：

- **无头优先** —— 整个内核跑在 Node 里，不需要 GPU 或浏览器。
- **确定性 CLI + `--json`** —— agent 不写代码也能自验成果。
- **会教人的报错** —— 例如 wasm 产物缺失时，错误信息会列出所有搜索路径*以及*修复用的一行命令。
- **小而精的类型化 API** —— 精心策划的接口面，而不是一万个裸 embind 类。
- **自动跳过的集成测试** —— wasm 产物（可选）构建之前，全新克隆 `npm test` 照样能跑；CI 会先
  构建产物再跑完整套件。

## 从源码构建

```bash
git clone <this repo> && cd opencascade-ts
npm install
npm run build:wasm     # 需要 Docker；默认 OCCT_VERSION=7.9.3，首次 1–2 小时
npm run build          # TypeScript
npm test
```

工具链版本与故障排查详见 [docs/BUILDING.md](docs/BUILDING.md)（英文）；
API 参考见 [docs/API.md](docs/API.md)（英文）。

## 架构

```
┌──────────────────────────────────────────────────────────┐
│  你的应用 / agent harness（Node 或浏览器）                │
├──────────────────────────┬───────────────────────────────┤
│  opencascade-ts (TS)     │  查看器（TS, WebGL2, 零依赖）  │
│  OccSession · 类型       │  轨道相机 · 网格+线框          │
│  导出器: STL/OBJ/SVG     │  着色器 · 虚线隐藏边           │
├──────────────────────────┴───────────────────────────────┤
│  embind 胶水层（C++，精心策划的接口面）                   │
├──────────────────────────────────────────────────────────┤
│  OCCT 7.9.3 → wasm 静态库                                │
│  建模 · STEP/BRep 数据交换 · 网格化 · HLR                 │
│  （不含 Visualization / Qt / Tcl —— 渲染交给 WebGL）      │
└──────────────────────────────────────────────────────────┘
```

## 致谢

- **[Open CASCADE SAS 与 OCCT 社区](https://github.com/Open-Cascade-SAS/OCCT)** —— 本项目立足的
  几何内核。
- **[donalffions/opencascade.js](https://github.com/donalffons/opencascade.js)** —— 开创了
  OCCT→WebAssembly + embind 的路线。我们的构建管线与绑定策略沿袭了它趟出的路；本项目之所以
  存在，正是因为那条路线已停滞多年。
- **[tpaviot/oce](https://github.com/tpaviot/oce)** —— OpenCASCADE 社区版在上游难以触及的岁月里，
  让 OCCT 在开源世界保持可用。
- **[tpaviot/pythonocc-core](https://github.com/tpaviot/pythonocc-core)** —— 用高级语言封装 OCCT
  的标杆；我们的 API 约定大量借鉴于此。

## 许可证

LGPL-2.1 —— 与 OCCT 本体相同。见 [LICENSE](LICENSE)。
