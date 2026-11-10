# Release 0.2.0

`0.2.0` 是 OpenCode Git Graph 的本地可用功能版本：只读历史浏览 + 确认式本地 Git 写操作。适用对象是 OpenCode Desktop 的侧边栏插件，不依赖网络。

## 新增能力

- **Branches history filter**：All 或多选本地分支 / 远程分支 / tag，支持 ref 搜索与 Include remotes / Include tags；filter 只影响历史加载，不改变 HEAD。
- **类型化 ref / commit 菜单**：View history、Copy、Create branch here；分支另有 Checkout / Rename / Delete，tag 另有 Delete；commit 菜单提供只读查看、复制与安全创建入口。
- **commit-pair 比较**：选中 base 后 Ctrl/Cmd+click 另一 commit，或从 commit 菜单进入独立只读 `base..head` 比较页。
- **确认式本地写操作**：checkout 本地分支、create / rename / delete（仅已合并）本地分支、create lightweight / annotated tag、delete tag。所有写操作需 GUI 确认并校验完整 expected HEAD。
- **安全边界**：无 force、`reset --hard`、`clean -fd`、discard、autostash；写命令禁用 hooks、签名、replace refs、auto gc/maintenance、submodule recurse；checkout 拒绝 tracked 变更、冲突、其他 worktree 占用与 ignored/untracked 碰撞。
- **日期与布局**：Date 列显示 `YYYY-MM-DD HH:mm:ss` 本地时间（原始 ISO 在 title）；Graph 固定 240px，窄面板仅被动收缩到下限 96px，无 drag、无 Graph 横向滚动；其余列可拖动并持久化。
- **历史加载**：固定行高虚拟滚动、自动分页加载、手动 Load more、失败 Retry 与单次触发守卫。

## 确认与保护

- 写操作对话框展示仓库、expected HEAD、目标 ref/commit 与动作类型；取消时不发写 RPC。
- `confirmed: true` 与 expected HEAD 仅用于防误触和 stale write，不是身份认证或权限授权。
- 仓库 allowlist、realpath / top-level / common dir 复核、同 common dir 串行写锁；写命令超时视为状态未知，必须 Refresh，不自动重试。
- 读 diff/status 保持 filter override，禁止执行外部 filter；无法安全枚举时明确失败。

## 测试范围

- 自动化：`npm test` 为 **390 passed / 1 platform-specific skip**；`npm run typecheck`、`npm run build`、`git diff --check` 通过。
- release UI：真实浏览器在 FR 只读环境与隔离 TEMP mutation fixture 两个环境执行 **93/93 PASS**，覆盖真实面板、真实 Git 数据路径、真实指针/键盘、比较、mutation 与错误/失败隔离。摘要见 `dev/UI-ACCEPTANCE.md`，详细证据只保留在批准 TEMP 目录，不进入版本库。
- 不覆盖原生 Desktop 宿主集成：会话/scope 切换、窗口/面板 chrome、`MenuItem` 注册、主题/事件总线、真实面板 resize。安装后需在实际 Desktop 中 `/reload` 并人工确认。

## 未实现（不承诺完整复刻）

- 网络与 remote 管理：fetch / pull / push、remote add/edit/delete/prune、PR。
- Stash 创建 / apply / pop / drop 与 stash 行。
- Merge / Rebase / Reset / Cherry-pick / Revert / Drop。
- 强制删除分支、`reset --hard`、`clean -fd`、discard、autostash。
- Review 标记、Repository Settings、签名状态、avatars、`.mailmap`、emoji、issue/PR 链接、顶点 tooltip、自定义 glob 过滤、author-date-order、整库搜索。

本项目是独立实现，不是 mhutchie.git-graph 的移植或完整功能复刻。逐项边界见 [`FEATURE-PARITY.md`](FEATURE-PARITY.md)。

## 升级 / 安装

- 版本号：`package.json` / `package-lock.json` 顶层为 `0.2.0`；运行时仅新增自身版本变化，依赖保持 `@opencode/plugin 2.2.6` 与 `zod ^4.6.7`。
- 本地开发：`npm install && npm run typecheck && npm test && npm run build`，产物为 `dist/gui-experimental.cjs`。
- 全局配置中以本地路径加载插件后，在 Desktop 执行 `/reload`。本版本未发布到 npm，也未创建 Git tag。
