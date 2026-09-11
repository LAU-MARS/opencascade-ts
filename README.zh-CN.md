# opencascade-ts

[English](README.md) | **[简体中文](README.zh-CN.md)**

npm 包名：**`occt.ts`** · 仓库名：`opencascade-ts`

> **面向 Agent 时代的 Open CASCADE。** 将最新的 OCCT 内核编译为 WebAssembly，配一等公民的
> TypeScript 绑定、STEP/BRep 模型导入、隐藏线消除（HLR）与零依赖 WebGL2 查看器。
> Node 端完全无头运行，浏览器端开箱即用。不依赖 Qt，不需要本地工具链。

OCCT **7.9.3** · Emscripten · TypeScript · LGPL-2.1

## 为什么做这个项目

现有的 OCCT WebAssembly 构建已经停滞——最后一个稳定版发布于 2020 年，内核停留在 2019 年：
没有隐藏线消除、没有渲染，TypeScript 侧只剩机器生成的类型声明盖在裸 embind 接口上（或者
强行拖上 Qt 窗口栈）。本项目为当下的软件生产方式——**人 AND Agent 协作**——重建了整套
技术栈：

| 能力 | 状态 |
|---|---|
| 最新 OCCT（7.9.3；版本是构建参数，可实验性切换 8.0） | ✅ |
| TypeScript 绑定——手写类型、ESM、strict 模式 | ✅ |
| STEP（AP203/AP214/AP242）与 BRep **导入** | ✅ |
| STEP 与 BRep 导出（含带网格的 BRep） | ✅ |
| IGES 导入 + 导出 | ✅ |
| XCAF 文档读取：装配**树、名称、颜色**、实例变换 | ✅ |
| STEP 读写单位制（`mm/cm/m/km/inch/ft/mi/um`） | ✅ |
| 建模：图元、布尔（fuse/cut/common）、变换、抽壳、拔模、圆角/倒角（含变半径）、草图成体（拉伸/旋转/放样/扫掠） | ✅ |
| 轮廓创作：直线、圆弧、椭圆、B 样条（控制点/过点插值）、线框拼装、质心 | ✅ |
| 测量：体积、表面积、包围盒、有效性、子形状计数 | ✅ |
| **几何查询**——面/边解析参数、最小距离+最近点、截面线、点在体内判断 | ✅ |
| **孔检测**——从描述结果启发式识别圆孔（半径/轴向/深度） | ✅ |
| **HLR**——隐藏线消除 → 可见/隐藏边线段 → SVG 工程图 | ✅ |
| WebGL2 查看器——零依赖、轨道/平移/缩放、线框、虚线隐藏边 | ✅ |
| Node 18+ 无头运行（无需 GPU、无需浏览器） | ✅ |
| CLI（`info` / `describe` / `tree` / `convert` / `hlr`），支持 JSON 输出 | ✅ |
| 输出格式：STEP、BRep、IGES、STL、OBJ、SVG、glTF (.glb) | ✅ |
| 线框布尔（2D 修剪/相交）、MCP server、XCAF 写回 | 🚧 路线图 |

## 与 opencascade.js 的对比

[opencascade.js](https://github.com/donalffons/opencascade.js) 开创了 OCCT→WebAssembly 的路线，
至今仍拥有最宽的 API 覆盖面。其稳定版（`1.1.1`，2020-09）绑定 OCCT **7.4.0p1**（2019），beta
（`2.0.0`，2023-03）为 **7.6.2**（2022），仓库自 2023-08 起沉寂。简版记分卡（✅/❌ 指一等公民、
有文档的 API）：

| | opencascade.js | occt.ts |
|---|---|---|
| OCCT 内核 | 7.4.0p1（2019）· 7.6.2（2022，beta） | **7.9.3（2025）**；可实验性切 8.0 |
| 维护状态 | 最后稳定版 2020 · 2023 起沉寂 | 活跃开发 |
| API 覆盖面 | 自动生成、几乎全量 OCCT——数千个类 | 约 50 个精选手写调用 |
| STEP · BRep · IGES 读写 | ✅ 裸 XCAF/XSControl 类 | ✅ 一等公民，带单位制选择 |
| 圆角 · 倒角 · 扫掠 · 2D | ✅ 裸类可用 | ✅ `fillet` / `chamfer` / `variableFillet` / `extrude` / `revolve` / `loft` / `sweep` + 直线/圆弧/椭圆/B 样条轮廓与线框拼装 |
| 抽壳 · 拔模 | ❌ 绑定为空壳类 | ✅ `shell` / `draft` |
| HLR 工程图 · WebGL 查看器 · JSON CLI · 几何查询 | ❌ | ✅ |
| 生态 | CascadeStudio · RepliCAD · BitByBit · ArchiYou | 起步阶段 |

逐维度对照、依据与补足计划详见 **[docs/COMPARISON.md](docs/COMPARISON.md)**（英文）。

## 安装

```bash
npm install occt.ts
```

npm 包内置预构建的 wasm 产物。自行构建需要 Docker，首次约 1–2 小时
（见 [docs/BUILDING.md](docs/BUILDING.md)）；之后改 C++ 只需重链，约 1 分钟。

## 快速上手 —— Node（无头，Agent 友好）

```ts
import { OccSession, hiddenLinesToSvg, meshToAsciiStl } from "occt.ts";
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
import { OccSession } from "occt.ts";
import { WebGLViewer } from "occt.ts/viewer";

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
$ occt-ts info bracket.step --json
{
  "file": "/work/bracket.step",
  "shapeType": "Solid",
  "isValid": true,
  "volume": 33842.4784,
  "area": 10248.14162,
  "bounds": { "min": [0,0,0], "max": [80,50,10], "size": [80,50,10] },
  "counts": { "solids": 1, "shells": 1, "faces": 7, "wires": 9, "edges": 15, "vertices": 10 }
}

$ occt-ts convert bracket.step drawing.svg --view 1,1,2 --hidden
$ occt-ts convert bracket.step mesh.stl --deflection 0.05
$ occt-ts convert bracket.step model.glb
$ occt-ts hlr bracket.step top.svg
```

零件查询——给 agent 装上"眼睛"（解析参数、孔识别）：

```console
$ occt-ts describe bracket.step
bracket.step: Solid
  faces: 7 (6 plane, 1 cylinder)
  edges: 15 (13 line, 2 circle)
  holes:
    r=14  depth=10  axis=[0,0,1]  center=[40,25,5]

$ occt-ts tree assembly.step
assembly.step: 3 shape(s)
└─ robot-arm · transformed
   ├─ base · #0 Solid vol=8421.4
   └─ gripper · #FF5500 · transformed · #2 Solid vol=315.8
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
│  occt.ts (TS)     │  查看器（TS, WebGL2, 零依赖）  │
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
