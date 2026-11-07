# 象棋 AI 桥接控制台 (xiangqi-bridge)

自动读取 [game.hullqin.cn/xq/](https://game.hullqin.cn/xq/) 的棋谱与局面，交给 [xiangqiai.com](https://xiangqiai.com/) 的 Pikafish 引擎分析，再自动回写落子。

**v2.0 起提供一个本地 Web 控制台（GUI）**：一条命令启动，浏览器里点按钮即可控制对弈、查看实时棋盘与引擎日志，不再需要记命令行参数。

**v2.2 提供免安装 exe**：`dist\XiangqiBridge.exe` 双击即用，无需装 Node.js。

> **已验证：打包后的 exe 实测连续对弈 25+ 步，每步分析约 870ms，无错误。**

## 方式一：直接用 exe（推荐普通用户）

```bash
npm install && npm run build:exe     # 开发者构建一次
```

产物在 `dist/`：

```
dist/
├── XiangqiBridge.exe      # 双击运行（约 89 MB，已内嵌 Node 运行时）
├── public/                # Web GUI 静态资源（必须与 exe 同目录）
├── runtime/node_modules/  # playwright（必须与 exe 同目录）
└── 使用说明.txt
```

双击 `XiangqiBridge.exe` → 自动打开浏览器 → 在界面里选模式点「启动桥接」。

- 程序会占用一个命令行窗口，**关闭窗口即退出程序**
- 换端口：命令行执行 `XiangqiBridge.exe --port 3090 --no-open`
- **浏览器复用**：优先调用系统已装的 Chrome → Edge → playwright Chromium，因此 exe 不必附带 90MB 浏览器

> 分发时请把 `dist/` 整个目录打包成 zip，只发 exe 会因缺少 `public/` 和 `runtime/` 而无法运行。

## 方式二：从源码运行（开发者）

```bash
cd E:\xiangqi
npm install
npm start
```

浏览器会打开 `http://127.0.0.1:3080`（端口可用 `--port` 修改）。在「配置」区选择模式，点「启动桥接」即可。

> **首次运行**会自动下载 Playwright Chromium 并让 xiangqiai.com 下载 Pikafish WASM 引擎（约 10~20 秒），请保持网络畅通。

## GUI 使用说明

控制台提供三种对弈模式：

| 模式 | 说明 | 需要填写 |
|------|------|---------|
| **AI 自弈** | 自动创建新房间，红黑双方都由 AI 控制，全程无需人工 | 无 |
| **加入房间** | 加入你已有的房间，AI 执一方，你执另一方 | 房间号或完整 URL |
| **只分析** | 只分析推荐着法、不自动落子（观战学习用） | 房间号或完整 URL |

控制台顶部实时显示状态（未启动 / 启动中 / 运行中 / 已停止 / 对局结束），中央棋盘随局面自动刷新，右侧显示回合、走子数、推荐着法、引擎评分，底部为完整运行日志。

### 无浏览器窗口（服务器 / 后台场景）

```bash
npm run start:no-open      # 启动但不自动打开浏览器
```

## 工作原理

```
┌──────────────────┐       ┌──────────────────┐       ┌──────────────────┐
│ game.hullqin.cn  │──FEN──►│   bridge (Node)  │──FEN──►│  xiangqiai.com   │
│  SVG 棋盘        │       │  Playwright 编排  │       │  Pikafish WASM   │
│  9×10 格         │◄─UCI──│  事件驱动核心     │◄─PV───│  引擎分析面板     │
└──────────────────┘  落子  └──────────────────┘  着法  └──────────────────┘
         ▲                            │
         └────────  Web GUI (SSE) ────┘
```

1. **读局面** — 注入 `window.__XQ_BRIDGE__`，从 SVG DOM 解析 32 个棋子，还原成标准 FEN
2. **分析** — 带时间戳参数整页加载 `https://xiangqiai.com/?t=<ts>/#/<FEN>`，点「开始分析」，读取引擎面板最新分析块
3. **落子** — 解析 PV 首着（中文着法），结合局面转成 UCI 坐标，在 SVG 棋盘上模拟 pointer/mouse 点击

## 项目结构

```
E:\xiangqi\
├── server.js                 # GUI 服务端：HTTP + SSE + REST API
├── package.json
├── DESIGN.md                 # 设计规范（design-brief 产物）
├── README.md
├── src/
│   ├── bridge.js             # 核心：事件驱动的桥接逻辑（启动/分析/落子/循环）
│   ├── fen-utils.js          # 棋盘 / FEN / UCI / 中文着法转换
│   └── game-hook.js          # 注入 game.hullqin.cn 的钩子（读局面 + 落子）
├── public/                   # GUI 前端（纯静态，零依赖）
│   ├── index.html
│   ├── style.css
│   ├── app.js                # SSE 接收事件 + REST 控制
│   └── board.js              # FEN → SVG 棋盘渲染器
├── test/
│   └── fen-utils.test.mjs    # 单元测试（19/19 通过）
└── docs/
    └── brief-preview.html    # 设计系统可视化预览
```

## 命令行 / 高级参数

GUI 底层映射到这些参数（也可通过 REST API 直接调用）：

| 参数 | 说明 | 默认 |
|------|------|------|
| `mode` | `selfplay` / `join` / `analyze` | `join` |
| `room` | 房间号（join/analyze） | — |
| `url` | 完整对局 URL | — |
| `side` | `red` / `black` / `auto` | `auto` |
| `depth` | 引擎分析深度 | `20` |
| `headless` | 无头浏览器 | `false` |
| `pollMs` | 局面轮询间隔 | `2000` |
| `analysisTimeout` | 单次分析超时 | `45000` |

### REST API

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/state` | 当前状态 |
| `POST` | `/api/start` | 启动桥接（JSON body 传上述参数） |
| `POST` | `/api/stop` | 停止桥接 |
| `POST` | `/api/analyze` | 单步分析（不落子） |
| `GET` | `/api/events` | SSE 事件流（log/status/fen/analysis/move/gameover） |

## 运行测试

```bash
npm test              # 纯逻辑单测 (40 项)
npm run test:e2e      # 真实站点回归 (需要网络)
```

```
=== 测试结果: 40 通过, 0 失败 ===
```

## v2.1 关键修复：着法错配（"优化失败"的根因）

早期版本有一个**致命缺陷**：红方回合却下出黑方着法。日志表现：

```
--- 红方回合 ---
[分析] 0s: 面板块数=6
[分析] ✓ 最佳着法: 马８进７ (红分 9, D16)   ← 这是黑方着法！
[落子] ✓ h9g7 (第 1 步)                      ← 把黑马挪了，红方回合直接错乱
```

**三个独立缺陷叠加导致：**

1. **`page.evaluate` 传了 3 个参数** → Playwright 只接受 1 个，快速路径每次抛
   `Too many arguments`，被迫走慢速整页加载。
2. **面板残留未过滤** → 整页加载后面板仍有上一局面的分析块，`blocks[0]` 被直接采信。
3. **中文着法按错误方解析** → `cnMoveToUciFull(board, '马８进７', true)` 把黑方着法
   用**红方**规则解读，恰好凑出"看似合法"的 `h0g2`，绕过所有校验。

**修复后的四道防线：**

| 防线 | 位置 | 作用 |
|------|------|------|
| 参数打包 | `analyzePosition` | `evaluate(fn, {fen, movetime, depth})`，快速路径恢复可用 |
| 局面一致性 | `analyzePosition` | 校验分析页实际加载的 FEN == 请求的 FEN，不等则放弃 |
| 双重视角解析 | `cnMoveToUciFull` | 红/黑各解析一次，只接受**唯一**合法解；歧义则拒绝 |
| 归属 + 时序校验 | `validateUciMove` + `playOneMove` | 起点必须是当前走棋方棋子；落子前重读局面确认未变 |

修复效果（实测 55 步自弈）：**0 错误、0 丢弃、每步 2~3 秒**，全部走快速路径。

## 关键实现要点（踩过的坑）

| 问题 | 解决方案 |
|------|----------|
| 棋盘 SVG 坐标 | 9 列 × 10 行，**步长 10**（不是 8）；`x=col*10`, `y=(9-row)*10` |
| 棋盘翻转（执黑） | 检测红帅 `帥` 的 y 坐标：`y<45` = 翻转。翻转时 **x、y 都要镜像** |
| 棋子颜色 | 读 `<use href="#piece-red|black">`，不是 text 的 fill |
| 回合判断 | 入座视角显示「**等你下棋**」；结合翻转推断红黑 |
| 房间开局 | 必须**两个座位都有人**才能点「开始游戏」，故自弈模式用两个独立浏览器上下文 |
| 中文着法转换 | 引擎输出「马８进７」（全角数字）；**马走日 = 2 行**，`马8进7` = `h9g7` |
| 分析面板残留 | 同 URL 的 hash 导航会滞留旧分析块 → `?t=<timestamp>` 刷新 + 归属校验双保险 |
| 引导弹窗 | xiangqiai.com 有 4 步引导遮罩，**每次导航后**都要点「跳过引导」 |
| 点击落空 | 棋盘可能超出视口 → 落子前 `scrollIntoView`，并校验点击坐标在视口内 |

## exe 打包原理

用 Node 24 的 **SEA（Single Executable Application）** 把 bundle 注入 node 二进制：

```
server.js + src/*.js
      │  esbuild 打成单个 CJS（70 KB）
      ▼
   app.cjs ──► node --experimental-sea-config ──► sea-prep.blob
                                                      │
node.exe ──► 复制 ──► XiangqiBridge.exe ──► postject 注入 blob
```

三个关键设计：

| 难点 | 处理方式 |
|------|----------|
| SEA 只支持 CJS 入口 | esbuild `format: 'cjs'`，并把 ESM 的 `import.meta.url` 换成运行时判断 |
| hook 脚本靠 `readFileSync` 加载，打包后磁盘没有 | `scripts/gen-hooks.mjs` 把两个 hook 转成字符串常量内联进 bundle |
| playwright 含原生文件无法内嵌 | esbuild `external`，运行时从 exe 同级 `runtime/node_modules` 解析 |

浏览器策略：优先系统 Chrome → Edge → playwright Chromium，所以 exe 是 89MB 而非 180MB。

重新打包：

```bash
npm run build:exe
```

## 站点协议摘要

### game.hullqin.cn/xq/
- React SPA，WebSocket `wss://game.hullqin.cn/xq/{roomId}?v=1` + protobuf
- 消息类型（module 5982）：`PlayerUpdateGameData(0)`, `OwnerStartGame(4)`, `VisitorJoinGame(1)` …
- 棋盘：SVG `viewBox="-6,-6,92,102"`，`<use xlink:href="#piece-red">` + `<text class="xq-piece-text">`
- 开局条件：两个座位都有玩家，房主才能点「开始游戏」

### xiangqiai.com
- Vue 3 SPA，Pikafish WASM 在 Web Worker 内跑 UCI
- 分析面板 `.thinking-panel`：每块格式 `红分 <score>\nD<depth>\n<time>s\n<nodes>K\n<PV 着法...>`
- **最新分析块在最前面**，URL 支持 `#/<encodeURIComponent(FEN)>`

## 设计规范

本项目遵循 [`DESIGN.md`](./DESIGN.md)（professional_minimal · light_clean · Inter），可视化预览见 [`docs/brief-preview.html`](./docs/brief-preview.html)。

## 免责声明

仅供学习研究。请遵守目标网站使用条款，不要用于破坏公平对弈。
