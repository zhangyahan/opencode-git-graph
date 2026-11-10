# OpenCode Git Graph

面向 OpenCode Desktop 的 Git 侧边栏插件：仓库切换、工作区变更、提交拓扑图、内联 Commit 文件树、整页只读 Unified Diff，以及经确认的本地 Git 写操作。它是受 [mhutchie.git-graph](https://github.com/mhutchie/vscode-git-graph) 启发的**独立实现**，不是该扩展的移植版，也不是完整功能复刻。

`0.2.0` 是本地可用功能版：**生产读操作 + 确认式本地 mutation**（checkout / create / rename / delete merged branch / create / delete lightweight & annotated tag）。不提供网络、stash、rebase/reset/cherry-pick/revert 等能力。

## 当前状态

- `0.2.0` 最终 release UI 验收为 **93/93 PASS，0 failed**：在 FR 只读真实仓库环境与隔离 TEMP mutation fixture 两个环境中，以真实浏览器、真实生产面板和真实 RepositoryManager / RPC 路径执行（非 mock 数据）。结果记录在 [`dev/UI-ACCEPTANCE.md`](dev/UI-ACCEPTANCE.md)。
- 自动化验证：**390 tests passed，1 platform-specific skip**（Windows 专用路径用例在其他平台跳过）；`npm run typecheck`、`npm run build`、`git diff --check` 均通过。
- 93/93 是本 harness 交互矩阵的最终结论，**不等于原生 Desktop 全链路 E2E**。真实 Desktop 的会话/scope 切换、窗口与面板 chrome、`MenuItem` 注册、宿主主题/事件总线、真实 Desktop 面板 resize 未被该 harness 覆盖，需要用户在实际 Desktop 中 `/reload` 后人工确认。
- 本版本不是 mhutchie.git-graph 的完整功能复刻：网络、stash、merge/rebase/reset/cherry-pick/revert 等仍未实现（见“明确未实现”）。能力边界详见 [`docs/FEATURE-PARITY.md`](docs/FEATURE-PARITY.md)。

## 功能概览

### 历史与筛选

- 仓库下拉选择、手动 **Refresh**；当前分支按钮打开顶部 **Branches** 对话框。
- Branches 对话框包含两个相互独立的部分：
  - **History filter**：`All` 或本地分支 / 远程分支 / tag 的多选；提供 ref 搜索以及 Include remotes / Include tags 开关。应用 filter 只重新加载历史，不改变 HEAD，也不是 checkout 入口。
  - **Checkout**：仅列本地分支；每个 checkout 都走独立确认对话框，绝不因为 filter 选中某个 ref 而改变 HEAD。
- 工具栏提供 Remotes / Tags / First parent 开关，以及 `Date` / `Topo` 历史顺序。显式选中的 ref 优先于 show 开关；First parent 只影响图与历史遍历，merge commit 的详情仍保留全部 parent。
- ref badge 支持单击与右键打开类型化菜单；超出显示数量的 ref 汇总为 `+N` 菜单。菜单动作包括 View history（仅设置 filter）、Copy、Create branch here，以及适用时的 Checkout / Rename branch / Delete branch / Delete tag。
- “View history”与“Checkout”严格分离：前者只改 filter，后者必须经过确认对话框。

### Graph 与列布局

- **Graph 固定 240px，不可拖动、没有 resize handle、没有 Graph 列内横向滚动。**
- 窄面板下 Graph 只做**被动宽度适配**：在列预算不足时按硬下限收缩（最低 96px），不会挤压 Description 到不可读；加宽面板后恢复 240px。
- 轨道默认 14px 步进；密集历史会保留**所有 parent 边**，只压缩 lane spacing，并显示 dense graph 提示，引导用户用 Branches filter 降低密度，而不是隐藏边或增加横向滚动。
- Description / Date / Author / Commit 四列可拖动改宽，偏好持久化到 `localStorage`；存储不可用或数据损坏时安全回退默认值。窄侧边栏（默认 520px）自动隐藏 Date / Author，但保存的宽屏偏好不被破坏。
- 固定 28px 行高、SVG 提交图、自实现虚拟滚动；滚动接近底部自动加载下一页，同时保留手动 **Load more** 与失败后的 **Retry**。自动加载有单次触发守卫，失败后不会在底部无限自动重试。
- 搜索只针对**已加载**的 commit：高亮匹配行、淡化其余行，不改变拓扑或行数；`Enter` 跳到首匹配，`Esc` 清空。`Ctrl/Cmd+F` 聚焦搜索，`Ctrl/Cmd+H` 或 **HEAD** 按钮跳到 HEAD，`Ctrl/Cmd+R` 刷新，`Shift+F10` 打开 commit 菜单，`Esc` 依次关闭菜单 / Branches / 比较 / 整页 diff。没有实现 Ctrl/Cmd+S stash、上下提交导航或整库搜索。

### Date 与排序

- Date 列显示 **authorDate 的本地时区时间**，格式固定为 `YYYY-MM-DD HH:mm:ss`；原始 ISO 时间保留在单元格 title 中。date-only 与无效输入有安全回退，不使用宿主 locale 改写格式。
- 历史排序使用 **git commit date**：默认 `--date-order`（保证父提交晚于子提交，同时减少 merge-heavy 历史的轨道膨胀），可选 `--topo-order`。这与 Date 列展示的 authorDate 不是同一个时间字段；当前没有 author-date-order 选项。

### Commit 详情、整页 diff 与比较

- 点击 commit 在同行下方展开文件树，再次点击折叠；点击文件后侧栏内容替换为整页只读 commit diff，`Back` 返回历史并恢复滚动位置与展开状态。
- Merge commit 在整页 diff 中提供 parent selector（默认第一父提交）；切换后重新加载文件树与 diff。Root commit 使用空树，不请求不存在的父提交。
- 整页 diff 只比较所选 commit 与其所选 parent，不读取工作区/索引。最多渲染 **4000** 行；超出时提示只显示前 4000 行。Binary 与服务端截断（truncated）有明确提示。
- 两个 commit 比较：先选一个 commit 作为 base，再 `Ctrl/Cmd` 点击另一个 commit，或通过 commit 右键菜单选择比较；进入独立只读比较页。比较只生成 **commit-pair** 的 `getComparisonFiles` / `getComparisonDiff`，目标为 `base..head`，不混入工作区或索引，返回不改变 HEAD。
- Commit 右键菜单为只读动作与安全创建动作：View changes、Copy hash、Copy subject、Select for comparison、Create branch here、Create tag here。没有 cherry-pick、revert、drop、merge、rebase、reset 等入口。
- working tree 的 Staged / Unstaged / Untracked / Conflicted 分组和单文件 diff 仍使用原有 index / working-tree 数据源，与 commit diff、commit-pair diff 不混用。

### 确认式本地写操作

所有写操作都先展示仓库、expected HEAD、目标 ref/commit 和动作类型；取消时不发送写 RPC。请求携带 `confirmed: true` 与打开对话框时捕获的完整 40/64 位 expected HEAD。

- **Checkout local branch**：只接受已存在的本地分支；同分支是 no-op。tracked 变更、冲突、其他 worktree 占用、ignored/untracked 碰撞、活动外部 filter 会导致拒绝；不自动 stash、不 force。
- **Create branch**：从所选 commit 创建本地分支；不配置 upstream，不 fetch/push。RPC 支持可选 checkout，UI 当前以创建并刷新 refs/history 为主。
- **Rename branch**：`git branch -m` 语义，不 force；新名称冲突、跨 worktree 占用会拒绝。
- **Delete branch**：只允许删除**已完全合并**的本地分支（`git branch -d`）；当前分支、其他 worktree 占用、未合并分支都会被拒绝。没有 force delete。
- **Create tag**：无 message 时创建 lightweight tag，有 message 时创建 annotated tag；固定 `--no-sign`，不 push。
- **Delete tag**：`git tag -d`，不 force、不 push。

写操作成功后刷新 status / refs / history；部分失败会明确提示仓库状态可能未知，要求用户先 Refresh，绝不自动重试。

### 数据与请求

- RPC 使用当前会话所在 server 的 `server.client`，不会固定使用 desktop sidecar。
- 请求按 workspace（server id + directory）隔离并在切换时中止旧请求；迟到的响应会被丢弃。
- 刷新期间禁用仓库下拉、commit、状态文件、commit 文件、parent 和 Load more 交互；若刷新期间仍发生新选择，旧刷新快照按 generation 丢弃。
- 切换目录/仓库/commit 时清理失效选择；同一窗口内用有界缓存保留最近的仓库/commit/文件选择。
- refs 独立加载，refs 失败不会阻塞 history；比较请求、commit 文件请求与 diff 请求各自隔离并可取消。

## 明确未实现

以下能力当前**没有**实现，也没有可验收入口；详细逐项边界见 [`docs/FEATURE-PARITY.md`](docs/FEATURE-PARITY.md)：

- 网络与 remote 管理：fetch / pull / push、remote add/edit/delete/fetch/prune、创建 PR。
- Stash：创建 / apply / pop / drop，stash 行展示。
- Merge / Rebase / Reset / Cherry-pick / Revert / Drop。
- 强制删除分支、`reset --hard`、`clean -fd`、discard、autostash 等破坏性快捷方式。
- Review 标记、Repository Settings / 设置入口与设置导入/导出、签名状态、avatars、`.mailmap`、emoji、issue/PR 链接、顶点 tooltip。
- 自定义 glob 历史过滤、author-date-order、整库/服务端全历史搜索、Desktop 菜单与窗口/主题/事件总线的完整宿主集成。

本项目不承诺 mhutchie.git-graph 的完整交互、设置项、写操作或全部 Git 边界行为；任何子集都不等同于上游全量能力。

## SDK 与 Diff 归属

本仓库使用 `@opencode/plugin` **2.2.6**。该版本的 GUI 插件 API 仍是 experimental，`Panel.region`、props 响应式和 RPC 行为在后续版本可能变化。该版本 UI 导出中没有可直接复用的历史 Diff 组件；Review/Changes API 面向当前会话的未提交变更，不接受 commit/parent 输入。因此：

- 历史 commit diff 与两 commit 比较都由本项目**独立实现**的只读 patch viewer 渲染，不声称使用宿主原生 Diff。
- 面板内 diff 是侧栏内容替换，不是宿主全窗口主页面。
- 4000 行上限、binary 与 truncated 提示属于独立实现限制。

## 安全与信任边界

- **仓库 allowlist**：仓库列表来自 Server 端在会话目录及其子目录中的发现结果；RPC 只接受仓库 id、commit oid、相对路径、ref 名和分页/筛选参数，不接受任意仓库路径或命令行参数，也不会扫描任意磁盘路径。
- **防误触不是授权**：`confirmed: true`、完整 expected HEAD 校验、GUI 确认对话框用于降低误操作和 stale write 风险，**不是身份认证或权限授权**。任何能调用该 RPC 的客户端仍应被视为受信调用方。
- **写入绑定与串行化**：写前重新解析 realpath、`--show-toplevel` 与 `--git-common-dir`，仓库根不符即拒绝；同一 real common dir 使用串行写锁，worktree 共享同一锁。缓存路径、`core.worktree` 重定向或 symlink 替换会被重新校验。
- **禁止破坏性行为**：不提供 force、`reset --hard`、`clean -fd`、discard、autostash。Delete branch 只使用 `git branch -d`（已合并）；Delete tag 不 push。
- **不执行 hooks / 签名 / 外部 filters**：写操作固定 `core.hooksPath` 到不存在的临时目录、`core.useReplaceRefs=false`、`gc.auto=0`、`maintenance.auto=false`、`submodule.recurse=false`、`commit.gpgsign=false`、`tag.gpgsign=false`。checkout 目标树中若实际选中 clean/smudge/process filter driver，会拒绝切换；**metadata-only 操作**（create/rename/delete branch 与 tag）不因配置了 filter 而被一概拒绝。全局安装了 Git LFS 但文件未实际选择该 driver 时，不会仅因 driver 存在而阻断。
- **读 diff/status 的 filter override 语义保留**：工作区 diff/status 会枚举生效的 `filter.*.clean/process/required` 并用命令行空命令覆盖，禁止 `.gitattributes` filter 执行外部程序；因此工作区内容按原始字节比较，可能显示与 `git status` 默认过滤视图不同的差异。无法安全枚举或 driver 名称无法安全表达时明确失败。
- **工作区保护**：checkout 前拒绝 tracked 变更、冲突、其他 worktree 占用；ignored paths 与目标树路径按路径段检测碰撞，untracked 覆盖/删除风险由 git 错误映射为明确拒绝。
- **保守路径解码**：路径枚举遇到 UTF-8 replacement（U+FFFD）或无法无损 round-trip 的字符串时保守拒绝，避免对错误路径执行 checkout filter。
- **超时与未知状态**：写命令超时会被标记为“仓库状态未知”，要求 Refresh 后由用户决定，**绝不自动 retry**。
- **残余 TOCTOU**：校验与 git 写命令之间仍存在外部 Git 进程或文件系统变更的竞态窗口；本插件不持有仓库全局锁，也不防御恶意 git 二进制、系统级 config 注入的内置命令或操作系统层面竞态。
- **dev harness 不是生产认证**：FR 模式固定 `127.0.0.1:5178`，只暴露读方法，六个 mutation 方法始终返回 403；TEMP 模式固定 `127.0.0.1:5179`，只有带 marker、位于批准 TEMP 子树下的临时 fixture，且仅两个临时仓库允许真实 mutation。该 bridge 只是开发验收工具，不能被当作生产认证或通用 Git 服务。

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
│  ├─ branch-selector.tsx  Branches history filter + checkout 入口
│  ├─ confirm-dialog.tsx   写操作确认与名称输入
│  ├─ ref-menu.tsx         类型化 ref / commit 菜单
│  ├─ compare-view.tsx     commit-pair 只读比较页
│  ├─ ref-utils.ts         ref 菜单动作、filter、mutation 契约与能力探测
│  ├─ requests.ts          LatestRequest：abort + generation 丢弃过期响应
│  ├─ graph.ts / graph-geometry.ts / graph-view.ts  提交图布局与几何
│  ├─ tree.ts              变更文件 -> 可折叠目录树（纯函数）
│  ├─ diff.ts / commit-diff-lines.ts  Unified Diff 行分类与行号
│  ├─ virtual.ts / row-layout.ts      固定行高虚拟窗口与内联槽
│  ├─ column-layout.ts     可拖宽列布局、预算收缩与偏好持久化
│  ├─ history-columns.ts   窄屏列可见性与详情布局
│  ├─ commit-diff-view.tsx 整页只读 commit diff 视图
│  ├─ pagination.ts        commit 分页去重合并与自动加载守卫
│  ├─ changes.ts / selection.ts / errors.ts / format.ts / search.ts
│  └─ styles.ts            自包含样式
└─ server/
   ├─ repository/manager.ts    allowlist、写绑定、common dir 锁、RPC handlers
   └─ git/                    log / status / diff / compare / mutations / safety / executor
```

## 本地开发与 dev 环境

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

真实浏览器验收使用独立 dev harness。它渲染真实 `src/gui/panel.tsx`，通过 loopback bridge 调用真实 RepositoryManager / RPC 路径；只用于本地验收，不能发布或复用为通用生产服务。启动方式与完整选择器见 [`dev/README.md`](dev/README.md)，本节不重复其敏感路径。

两个固定入口：

- **FR 只读**：默认 `npm run dev:ui`，`127.0.0.1:5178`，根为用户指定的 `D:\Workspace\FR`；无任何写路由，六个 mutation 方法返回 403。
- **TEMP 写测试**：`GG_UI_MODE=mutation-fixture`、`GG_UI_PORT=5179` 与批准 TEMP 子树下的 marker fixture（`%LOCALAPPDATA%\Temp\opencode\...`）；仅该 fixture 的两个临时仓库允许真实 mutation。

在 OpenCode 全局配置（`opencode.jsonc`）中加载本地插件：

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["<path-to-opencode-git-graph>"]
}
```

## 测试与验收

- 自动化测试：`npm test` 为 **390 passed / 1 platform-specific skip**；覆盖文件树、Unified Diff、虚拟滚动/行布局、分页与自动加载守卫、列布局与偏好回退、commit diff 行号、ref 交互、日期格式化、比较、写操作安全、manager 写绑定/锁、dev harness 安全等。
- 静态检查：`npm run typecheck`、`npm run build`、`git diff --check` 在本轮冻结源码上通过。
- 最终 release UI 验收：真实浏览器 **93/93 PASS**（FR 只读 + 隔离 TEMP mutation fixture），记录在 [`dev/UI-ACCEPTANCE.md`](dev/UI-ACCEPTANCE.md)。此前 70/70 仅保留为历史基线，不是本版回归结论。
- 该验收覆盖真实面板、真实 Git 数据路径、真实指针/键盘输入、对比与 mutation 路径；不覆盖原生 Desktop 宿主集成（见“当前状态”）。
- 验收脚本与运行方式见 [`dev/ui-test/README.md`](dev/ui-test/README.md)。截图、`result.json` 等证据默认写入批准的 TEMP 目录（如 `%LOCALAPPDATA%\Temp\opencode\...`），可能包含私有仓库路径、提交信息或 diff 片段，**不得提交到版本库**，也不应写入公开文档。

## 许可说明

上游 `mhutchie/vscode-git-graph` 当前**不是 MIT 许可**。本项目没有复制或移植其源码，只做独立的 UI/布局/交互实现；使用或分发前请自行确认上游及本项目的许可条件。
