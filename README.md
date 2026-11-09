# OpenCode Git Graph

面向 OpenCode Desktop 的只读 Git 侧边栏插件：仓库切换、工作区变更、提交拓扑图、Commit 文件树和 Unified Diff。它是受 [mhutchie.git-graph](https://github.com/mhutchie/vscode-git-graph) 启发的**独立实现**，不是该扩展的移植版，也不是完整功能复刻。

## 当前状态

只读 MVP 已实现。真实生产组件已用本地 dev harness 对 FR 真数据完成首轮浏览器交互验收；Desktop 宿主集成仍有未覆盖项，详见下文。

- 紧凑历史表格：固定表头 `Graph / Description / Date / Author / Commit`，提交行固定 28px 高
- 固定 **14px** 轨道步进；Graph 列宽可在 **96–260px** 间拖动（默认 152px），Graph 列内独立横向滚动，宽轨道不会挤占 Description
- 窄侧边栏（默认 520px）自动隐藏 Date / Author，优先保证提交描述与 Commit 列；面板加宽后逐级显示
- working tree clean 时 Changes 区域压缩为一行
- commit 详情响应式布局：窄宽度文件树与 diff 上下排列，宽宽度改为左右分栏
- 搜索只针对**已加载**的 commit：高亮匹配行、淡化其余行，不改变提交拓扑、不裁剪行；`Enter` 跳到第一条匹配，`Esc` 清空
- 后端默认使用 `--date-order`：父提交始终排在子提交之后（拓扑合法），同时避免 merge-heavy 历史中 side parent 被推远造成的轨道膨胀
- 仓库下拉选择 + 手动 **Refresh** 按钮
- Staged / Unstaged / Untracked / Conflicted 分组，点击文件查看 index 或 working-tree diff
- 固定行高 SVG 提交图 + 自实现虚拟滚动；支持 **Load more** 分页追加、按 hash 去重后重新布局
- Commit subject / 短 hash / refs；点击 commit 显示可折叠文件目录树
- Merge commit 可选择 `parentIndex`（默认第一父提交）；切换父提交后重新加载文件与 diff
- Unified Diff 逐行安全渲染（文本节点，不使用 `innerHTML`），高亮 `+` / `-` / `@@`
- Binary、服务端截断（truncated）有明显提示
- 无仓库、加载中、请求失败均有状态反馈
- RPC 使用当前会话所在 server 的 `server.client`，不会固定使用 desktop sidecar
- 请求按 workspace（server id + directory）隔离并在切换时中止旧请求；迟到的响应会被丢弃
- 刷新期间禁用仓库下拉、commit、状态文件、commit 文件、parent 和 Load more 交互；若刷新期间仍发生新选择，旧刷新快照按 generation 丢弃
- 切换目录/仓库/commit 时清理失效选择；同一窗口内用有界缓存保留最近的仓库/commit/文件选择

## 明确限制

- **只读**：不提供 stage、unstage、commit、checkout、pull、push 等写操作。
- **手动刷新**：暂未接入文件 watcher，外部修改 Git 状态后需要点击 Refresh。
- **仅侧边栏**：`Panel.region` 只有 `"side"`，面板默认宽度为 520px；没有使用 `wide` 作为主页面替换。窄宽度隐藏 Date / Author，Graph 列可拖动 96–260px，但这些响应式行为不改变“仅侧边栏”的定位。
- **宿主版本**：本仓库使用 `@opencode/plugin` **2.2.6**。GUI 插件 API 仍是 experimental，`Panel.region`、props 响应式和 RPC 行为在后续版本可能变化。**真实验收范围**：真实生产面板组件（`GitGraphPanel`）与真实只读 Git 引擎已通过本地 dev harness 对 `D:\Workspace\FR` 真数据完成浏览器交互验收；**未覆盖** Desktop 菜单注册（`MenuItem` / `session.panel`）、Desktop 窗口与面板 chrome、拖拽/缩放、会话切换、宿主主题注入与宿主事件总线。首轮验收为 67 PASS / 2 FAIL（Graph 列横向滚动视口相关），这两项失败已修复；最终浏览器验收 **79/79 PASS**，结果记录在 `dev/UI-ACCEPTANCE.md`。
- **仓库范围**：仓库列表来自 Server 端在会话目录及其子目录中的发现结果；不会扫描任意磁盘路径。
- **非完整复刻**：不承诺 mhutchie.git-graph 的完整交互、设置项、写操作或全部 Git 边界行为。

## 许可说明

上游 `mhutchie/vscode-git-graph` 当前**不是 MIT 许可**。本项目没有复制或移植其源码，只做独立的 UI/布局/交互实现；使用或分发前请自行确认上游及本项目的许可条件。

## 技术栈

- OpenCode V2 插件 SDK（Server + GUI + RPC）
- SolidJS + TypeScript + Vite
- 原生 Git CLI（Server 端 `git -C <repo>`，参数数组传递）

## 目录结构

```text
src/
├─ gui.tsx                 GUI 入口：Panel / MenuItem 注册
├─ gui/
│  ├─ panel.tsx            侧边栏面板、状态与请求编排
│  ├─ requests.ts          LatestRequest：abort + generation 丢弃过期响应
│  ├─ graph.ts             layoutGraph 的安全包装
│  ├─ tree.ts              变更文件 -> 可折叠目录树（纯函数）
│  ├─ diff.ts              Unified Diff 行分类（纯函数）
│  ├─ virtual.ts           固定行高虚拟窗口计算（纯函数）
│  ├─ pagination.ts        commit 分页去重合并（纯函数）
│  ├─ changes.ts           状态分组 / target 选择
│  ├─ selection.ts         server+directory 选择快照与有界缓存
│  ├─ errors.ts            错误展示文本
│  └─ styles.ts            自包含样式
└─ server/                 只读 Git 引擎与 RPC 实现
```

## 本地开发

```bash
npm install
npm run typecheck
npm test
npm run build   # 构建 dist/gui-experimental.cjs
```

开发 GUI 时可使用：

```bash
npm run build -- --watch
```

真实浏览器验收使用独立的 dev harness：

```bash
npm run dev:ui   # 仅监听 127.0.0.1:5178，仓库根固定为 D:\Workspace\FR
```

该 harness 渲染真实 `src/gui/panel.tsx` 并通过 loopback bridge 调用真实只读 Git 引擎；没有任何写路由，不会 stage / commit / checkout / pull / push，也不会写入 `D:\Workspace\FR`。它绑定固定回环地址与固定 fixture 根，**只用于本地只读验收，不能发布或复用为通用生产服务**。运行与验收细节见 [`dev/README.md`](dev/README.md) 和 [`dev/ui-test/README.md`](dev/ui-test/README.md)。

在 OpenCode 全局配置（`opencode.jsonc`）中加载本地插件：

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["D:\\Workspace\\opencode-plugins\\opencode-git-graph"]
}
```

## 测试覆盖

纯函数与异步控制器测试位于 `tests/gui*.test.ts`：

- 文件目录树：嵌套、排序、文件计数、去重
- Unified Diff：文件头 / hunk / add / remove / context / 空行分类
- 虚拟滚动：overscan、边界钳制、空列表与超高视口
- 分页：跨页按 hash 去重、顺序保持、对象引用稳定
- 请求控制器：新请求中止旧请求、迟到响应丢弃、cancel/dispose
- RPC routing：每次请求读取当前 session 的 server client，server 切换/重启替换 client 不复用旧引用
- 刷新 generation：刷新期间发生新选择后，旧快照被判定为过期
- 选择缓存：server + directory key、LRU 上限

真实浏览器验收独立于上述单元测试：先 `npm run dev:ui` 启动 harness，再运行 `node dev/ui-test/acceptance.mjs`。脚本驱动真实生产面板与真实只读 Git 引擎，对 FR fixture 做截图和交互校验，运行说明见 [`dev/ui-test/README.md`](dev/ui-test/README.md)。截图与 `result.json` 默认写入批准的 TEMP 目录（如 `%LOCALAPPDATA%\Temp\opencode\gg-ui-artifacts`）；截图可能包含私有仓库路径、提交信息和 diff 片段，**不得提交到版本库**。该验收不覆盖 Desktop 宿主集成（见“明确限制”），因此不能据此宣称整个插件已端到端通过。

## 安全与信任边界

- **只读信任模型**：Server 端只执行只读 git 命令；仓库路径由 Server 发现流程提供，RPC 只接受仓库 id、commit oid、相对路径和分页参数，不接受任意命令行参数。
- **revision / path 校验**：commit oid 仅允许 4–64 位十六进制；路径必须是仓库内相对路径，拒绝绝对路径、Windows drive/UNC、NUL 和 `..`；git pathspec 使用 `:(literal)`，不做通配解释。
- **配置加固**：executor 固定 `-c core.fsmonitor=false`，并清理继承的 `GIT_DIR`、`GIT_WORK_TREE`、`GIT_INDEX_FILE`、`GIT_OBJECT_DIRECTORY`、`GIT_ALTERNATE_OBJECT_DIRECTORIES`、`GIT_CONFIG_COUNT/KEY_*/VALUE_*` 等重定向/注入环境变量；保留用户正常 git 配置，但安全相关的命令行 override 优先。
- **外部程序禁用**：diff 固定 `--no-color`、`--no-ext-diff`、`--no-textconv`；log 固定 `-c log.showSignature=false`。工作区 diff/status 会枚举生效的 `filter.*.clean/process/required` 并用命令行空命令覆盖，禁止 `.gitattributes` filter 执行外部程序。
- **filter 限制**：启用 clean/process filter 的仓库（例如 LFS）不会执行其过滤程序，工作区内容按原始字节比较，因此可能显示与 `git status` 默认过滤视图不同的差异；若无法安全枚举 filter 配置，或 driver 名称无法用 `git -c` 安全表达，相关 diff/status 会明确失败而不是执行外部命令。
- **未跟踪文件**：读取前用 `lstat`/`realpath` 校验仓库边界；最终 symlink 只读取 link text，不跟随到目标；父目录 symlink 越界会被拒绝。
- **信任边界**：该加固假设 git 可执行文件本身可信、仓库路径由受信流程给出；它不防御恶意 git 二进制、系统级 config 注入的内置命令或操作系统层面的竞态。
