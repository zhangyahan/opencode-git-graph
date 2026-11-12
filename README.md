# OpenCode Git Graph

面向 OpenCode Desktop 的 Git 侧边栏插件：仓库切换、提交拓扑图、History 顶部未提交变更行、内联 Commit 三栏（提交信息 / 文件列表 / 视图切换）、可调高的内联展开槽、整页只读 Unified Diff、仓库元数据变更自动刷新、窗口级面板状态缓存，以及经确认的本地 Git 写操作与 **Fetch**。它是受 [mhutchie.git-graph](https://github.com/mhutchie/vscode-git-graph) 启发的**独立实现**，不是该扩展的移植版，也不是完整功能复刻。

`0.2.1` 是已发布基线：**生产读操作 + 确认式本地 mutation**（checkout / create / rename / delete merged branch / create / delete lightweight & annotated tag），并包含可拖宽 Graph 列、内联三栏提交详情与 commit 版本文件内容查看。`0.2.2` 在此基础上新增**未提交变更顶部行、内联展开高度拖拽、确认式 Fetch（下载远程更新）**与统一 branch 图标，并移除 First parent 控件、Jump HEAD 按钮与 `Ctrl/Cmd+H` 绑定；最终 UI 验收见 [`dev/UI-ACCEPTANCE.md`](dev/UI-ACCEPTANCE.md)。`0.2.3` 进一步细化 UI：Graph 裁剪不再显示 dense 提示；列宽改为拖拽表头常显分割线上的 5px 命中区，没有独立把手；Date 精确到 `YYYY-MM-DD HH:mm`（16 字符，ISO 原值保留在 tooltip）；分支与 ref 名称完整显示不省略；内联三栏的信息列约占 40%（最小 200px）并可通过分割线拖动，比例在本面板会话内记忆；内联槽高度改为拖拽整条底边横线。仍不提供 pull/push、stash、rebase/reset/cherry-pick/revert 等能力。

`0.2.4` 在 `0.2.3` 基础上增加四项能力：Server 端基于 **`fs.watch`（非轮询）** 的仓库元数据监听与 typed RPC `graphChanged` 自动静默刷新；GUI **窗口级 LRU(8) 面板缓存**，切 tab / 打开文件重挂后立即恢复；侧栏 tab 改为 **`branch` 图标 + “Git Graph” 文字**；历史行按 ref 换行**动态增高**，所有分支/ref 名称完整显示（`+N` 与 refs 横向滚动已移除），Uncommitted 展开槽与 commit 内联槽共用整条底边拖高。最终 UI 验收为 220/220 PASS，结论见 [`dev/UI-ACCEPTANCE.md`](dev/UI-ACCEPTANCE.md)。

## 当前状态

- `0.2.4` 的 release UI 验收为 **220/220 PASS，0 failed**：在 FR 只读真实仓库环境与隔离 TEMP mutation/content fixture 两个环境中，以真实浏览器、真实生产面板和真实 RepositoryManager / RPC 路径执行（非 mock 数据）。220 项由历史 188 项回归基线加 32 项冻结扩展断言组成（watcher 自动刷新、缓存重挂、7-ref 动态行高、Uncommitted 槽拖高、tab label 源码检查等）；FR 仓库数量按环境动态读取（本轮为 12 个仓库 / 0 worktree，worktree 标签记为 `notPresent`），不硬编码旧 fixture 形状。证据为 `gg-ui-release-final-20261112-104617`（仅保存在批准的 TEMP 目录，不提交）。
- `0.2.3` 的历史 release UI 基线为 **188/188 PASS，0 failed**（历史 172 项回归基线加 16 项细化断言），证据为 `gg-ui-release-refined-20261111-201722`（仅保存在批准的 TEMP 目录，不提交）。
- `0.2.2` 的历史 release UI 验收为 **172/172 PASS，0 failed**：历史 131 项中有 128 项仍然适用并通过，3 项 First parent / Jump HEAD 断言由“控件不存在 + `Ctrl+H` 不发请求”的断言替代；新增 Uncommitted 顶部行、内联槽高度拖拽、index/working-tree diff 与 Fetch 确认/本地 bare remote 流程。证据为 `gg-ui-release-extended-20261110-195711`（仅保存在批准的 TEMP 目录，不提交）。
- `0.2.1` 的 release UI 验收为 **131/131 PASS，0 failed**：在 FR 只读真实仓库环境与隔离 TEMP mutation/content fixture 两个环境中，以真实浏览器、真实生产面板和真实 RepositoryManager / RPC 路径执行（非 mock 数据）。这是已发布基线的历史结论，记录在 [`dev/UI-ACCEPTANCE.md`](dev/UI-ACCEPTANCE.md)。
- 自动化验证：**514 tests passed，1 platform-specific skip**（Windows 专用路径用例在其他平台跳过）；`npm run typecheck`、`npm run build`、`git diff --check` 均通过。本轮新增 watcher、`graphChanged` 过滤/合并、panel cache、动态行高与 tab label 覆盖。`0.2.3` 的 459 passed / 1 skip、`0.2.2` 的 446 passed / 1 skip 与 `0.2.1` 的 418 passed / 1 skip 仅作历史参照。
- 220/220（以及历史 188/188、172/172、131/131）只代表该 harness 交互矩阵，**不等于原生 Desktop 全链路 E2E**。真实 Desktop 的会话/scope 切换、窗口与面板 chrome、`MenuItem` 注册、宿主主题/事件总线、真实 Desktop 面板 resize 与 tab 图标渲染未被该 harness 覆盖，需要用户在实际 Desktop 中 `/reload` 后人工确认。
- 本版本不是 mhutchie.git-graph 的完整功能复刻：网络目前只有 Fetch（下载远程更新，已在本地 bare remote 自动化验收；真实网络与认证需人工确认），pull/push、remote 管理、stash、merge/rebase/reset/cherry-pick/revert 等仍未实现（见“明确未实现”）。能力边界详见 [`docs/FEATURE-PARITY.md`](docs/FEATURE-PARITY.md)。

## 功能概览

### 历史与筛选

- 仓库下拉选择、手动 **Refresh**；外部 `git` 操作（commit / checkout / update-ref / fetch 等）引起的 HEAD、refs 或 index 变化会由仓库监听自动静默刷新。当前分支按钮打开顶部 **Branches** 对话框；工具栏 **Fetch** 打开独立的确认对话框。
- Branches 对话框包含两个相互独立的部分：
  - **History filter**：`All` 或本地分支 / 远程分支 / tag 的多选；提供 ref 搜索以及 Include remotes / Include tags 开关。应用 filter 只重新加载历史，不改变 HEAD，也不是 checkout 入口。
  - **Checkout**：仅列本地分支；每个 checkout 都走独立确认对话框，绝不因为 filter 选中某个 ref 而改变 HEAD。
- 工具栏提供 Remotes / Tags 开关、`Date` / `Topo` 历史顺序，以及 **Fetch** 按钮。显式选中的 ref 优先于 show 开关；merge commit 的详情仍保留全部 parent。
- **First parent 控件与 Jump HEAD 按钮已移除**，`Ctrl/Cmd+H` 不再绑定跳转 HEAD；`Ctrl/Cmd+F` 搜索、`Ctrl/Cmd+R` 刷新仍然保留。
- ref badge 支持单击与右键打开类型化菜单。当前分支标签与**所有可见 ref 名称完整显示、不省略**：不再有 `+N` 聚合，refs 容器也不横向滚动；badge 使用 `flex-wrap` 换行，历史行按内容动态增高。菜单动作包括 View history（仅设置 filter）、Copy、Create branch here，以及适用时的 Checkout / Rename branch / Delete branch / Delete tag。
- “View history”与“Checkout”严格分离：前者只改 filter，后者必须经过确认对话框。

### 未提交变更（History 顶部行）

- History 列表顶部固定一行 **Uncommitted changes**。它不是 commit，不占 commit 索引，也不参与图遍历；Graph 列使用空心虚线圆标记，不伪造提交节点。
- 行内显示总文件数 `(N)` 与 **staged / unstaged / untracked / conflicted** 计数 badge；计数为 0 的分组不显示 badge。仓库干净时该行仍显示 `(0)`，展开后显示 “No changes”。
- 单击或 `Enter` 展开内联面板，按 Staged / Unstaged / Untracked / Conflicted 分组；点击分组标题折叠或展开。展开工作区行会收起 commit 内联槽，展开 commit 也会收起工作区行，同一时间只保留一个内联槽。
- 点击分组内文件，在整页只读 diff 中打开该文件的 **index** 或 **working-tree** target；它仍使用原有工作区数据源，不与 commit diff、commit-pair diff 混用。
- 旧的独立 Changes 区块已移除，工作区变更只通过该顶部行进入。

### Graph 与列布局

- **Graph 列默认 240px，可拖动 96–400px**，宽度偏好持久化到 `localStorage`；存储不可用或数据损坏时安全回退默认值。
- 轨道间距**恒为 14px**，不会因列变窄而压缩。列宽不足时右侧分支被**裁剪隐藏**，但 SVG 仍按完整内容宽度渲染；历史列表**绝不出现横向滚动条**，也**不再显示 dense graph 提示**或提供“Filter branches”引导条。
- Description / Date / Author / Commit 四列同样可拖动改宽并持久化；窄侧边栏（默认 520px）自动隐藏 Date / Author，但保存的宽屏偏好不被破坏。列头使用 Title Case（Graph / Description / Date / Author / Commit）。拖拽命中区就是表头**常显竖分割线**上的 5px 透明条（分割线本身就是拖动 affordance），没有独立把手或 hover 装饰；拖动时表头与数据行宽度保持同步。
- 提交行以 **28px 为最小高度**，有 ref badge 换行时按实际内容增高；SVG 提交图、自实现虚拟滚动使用每行高度前缀和与二分查找定位，并由 `ResizeObserver` 把测量值写回。极多 ref 的行可能很高，虚拟滚动仍保持一致。滚动接近底部自动加载下一页，同时保留手动 **Load more** 与失败后的 **Retry**。自动加载有单次触发守卫，失败后不会在底部无限自动重试。
- ref 换行会改变行高：面板或列宽变化时先记录首个可见 commit 锚点，再按新的前缀和恢复滚动位置；异步测量到达时按锚点行顶部差值校正，避免阅读位置跳动。后台冻结 tab 中 `ResizeObserver` 可能不回调，此时使用按列宽与 badge 文本估算的行高作为 fallback，tab 恢复后再由真实测量替换。
- 搜索只针对**已加载**的 commit：高亮匹配行、淡化其余行，不改变拓扑或行数；`Enter` 跳到首匹配，`Esc` 清空。`Ctrl/Cmd+F` 聚焦搜索，`Ctrl/Cmd+R` 刷新，`Shift+F10` 打开 commit 菜单，`Esc` 依次关闭菜单 / Branches / Fetch / 比较 / 整页 diff。没有 First parent 控件、Jump HEAD 按钮或 `Ctrl/Cmd+H` 绑定；也没有实现 Ctrl/Cmd+S stash、上下提交导航或整库搜索。

### Date 与排序

- Date 列显示 **authorDate 的本地时区时间**，格式固定为 `YYYY-MM-DD HH:mm`（**16 字符、不含秒**，列宽内完整显示）；原始 ISO 时间保留在单元格 title 中，内联详情行同样使用 16 字符值与 ISO tooltip。date-only 与无效输入有安全回退，不使用宿主 locale 改写格式。
- 历史排序使用 **git commit date**：默认 `--date-order`（保证父提交晚于子提交，同时减少 merge-heavy 历史的轨道膨胀），可选 `--topo-order`。这与 Date 列展示的 authorDate 不是同一个时间字段；当前没有 author-date-order 选项。

### Commit 详情、整页 diff 与比较

- 点击 commit 在同行下方展开**内联三栏**：左列显示提交信息（subject、author、date、hash、parents，Full details 展开完整值），信息列默认约占槽体的 **40%**（优先最小宽度 200px，窄面板时让位给文件列），长 subject 与值**完整换行、不省略、不裁切**；中列是文件列表/目录树，内部独立滚动且比信息列更窄；右列是固定 28px 的 list / tree 视图切换。左中之间是可拖拽分割线（命中区 5px，即常显分割线本身），比例限制在 **25%–60%**，不写 `localStorage`，窗口内面板重挂可随快照恢复；文件列始终保留最小宽度，三栏不会横向溢出。再次点击 commit 折叠。
- 文件行显示 status、文件名，以及 git numstat 的 `+N -M`；binary 或没有 numstat 的条目显示 `-`。点击文件名仍打开整页只读 commit diff，`Back` 返回历史并恢复滚动位置与展开状态。
- 行尾 eye 通过 `getCommitFileContent` 查看该 commit 版本的单个文件：text 直接展示；binary、symlink、submodule（`missing`）分别提示；文本超过 1 MiB 会截断并提示，超过 20 MiB 只显示大小。deleted 条目不提供该版本视图。
- 行尾 open current 打开工作区当前文件：优先使用公开的 `ctx.layout.open` 与 `file:` 目标；宿主不支持时退到系统默认应用；再失败则复制仓库相对路径并提示。图标点击会 `stopPropagation`，不会误选或展开 commit。
- Merge commit 在整页 diff 中提供 parent selector（默认第一父提交）；切换后重新加载文件树与 diff。Root commit 使用空树，不请求不存在的父提交。
- 整页 diff 只比较所选 commit 与其所选 parent，不读取工作区/索引。最多渲染 **4000** 行；超出时提示只显示前 4000 行。Binary 与服务端截断（truncated）有明确提示。
- 两个 commit 比较：先选一个 commit 作为 base，再 `Ctrl/Cmd` 点击另一个 commit，或通过 commit 右键菜单选择比较；进入独立只读比较页。比较只生成 **commit-pair** 的 `getComparisonFiles` / `getComparisonDiff`，目标为 `base..head`，不混入工作区或索引，返回不改变 HEAD。
- Commit 右键菜单为只读动作与安全创建动作：View changes、Copy hash、Copy subject、Select for comparison、Create branch here、Create tag here。没有 cherry-pick、revert、drop、merge、rebase、reset 等入口。
- working tree 的 Staged / Unstaged / Untracked / Conflicted 分组和单文件 diff 已整合到 History 顶部 **Uncommitted changes** 行，仍使用原有 index / working-tree 数据源，与 commit diff、commit-pair diff 不混用。

### 内联展开高度

- commit 内联槽与 Uncommitted 槽的**整条底边横线本身就是拖拽区**（5px 高、全宽，无独立小把手或装饰），可上下调整槽高；硬范围为 **96px 到 `max(96, min(560, 历史视口高度 - 80))`**，短视口不会产生小于 96px 的上限。
- 调整后的高度不写入 `localStorage`；折叠后重新展开同一 commit 或 Uncommitted 行会恢复本次会话的高度，窗口内面板重挂也会随快照恢复；插件或窗口 reload 后不保留。
- 未手动调整时按内容行数自动取高，默认封顶 260px；内容超出时槽内滚动，不把历史列表推走。

### 确认式本地写操作

所有写操作都先展示仓库、expected HEAD、目标 ref/commit（Fetch 为 remote）和动作类型；取消时不发送写 RPC。请求携带 `confirmed: true` 与打开对话框时捕获的完整 40/64 位 expected HEAD。

- **Checkout local branch**：只接受已存在的本地分支；同分支是 no-op。tracked 变更、冲突、其他 worktree 占用、ignored/untracked 碰撞、活动外部 filter 会导致拒绝；不自动 stash、不 force。
- **Create branch**：从所选 commit 创建本地分支；不配置 upstream，不 fetch/push。RPC 支持可选 checkout，UI 当前以创建并刷新 refs/history 为主。
- **Rename branch**：`git branch -m` 语义，不 force；新名称冲突、跨 worktree 占用会拒绝。
- **Delete branch**：只允许删除**已完全合并**的本地分支（`git branch -d`）；当前分支、其他 worktree 占用、未合并分支都会被拒绝。没有 force delete。
- **Create tag**：无 message 时创建 lightweight tag，有 message 时创建 annotated tag；固定 `--no-sign`，不 push。
- **Delete tag**：`git tag -d`，不 force、不 push。

写操作成功后刷新 status / refs / history；部分失败会明确提示仓库状态可能未知，要求用户先 Refresh，绝不自动重试。

### Fetch（网络写操作）

- 工具栏 **Fetch** 打开独立确认对话框：remote 可选 **All remotes** 或列表中的单个 remote，并可勾选 **Prune deleted remote-tracking branches**（`git fetch --prune`）。对话框显示仓库与打开时捕获的 **expected HEAD**；取消不发送任何 RPC。
- remote 列表当前由**已加载的 remote refs** 推导（`origin/main` → `origin`），没有 remote-tracking ref 的 remote 不会出现在列表中；这类 remote 需要先在外部完成配置和首次 fetch。列表为空时 Fetch 按钮禁用并提示没有可用 remote。
- 成功返回 `refsUpdated`（新建或移动的 remote-tracking / tag ref 数）与 `changed`，随后刷新 refs 和 history 首页。没有更新也是成功结果（`refsUpdated: 0`、`changed: false`）；`--prune` 删除的 ref 计入 `changed`，不计入 `refsUpdated`。
- 失败在对话框内显示有界原因（如 `auth_failed`、`network_failed`、`remote_not_found`、`fetch_timeout`、`head_mismatch`、`fetch_failed`），不泄露仓库外路径。
- Fetch 只更新 remote-tracking refs / tags，不 merge、不 rebase、不修改工作区或 HEAD；`expectedHead` 在 fetch 前后各校验一次。
- Fetch 是网络操作：认证必须在启动 OpenCode 前通过 credential helper / SSH agent 等预先配置，`GIT_TERMINAL_PROMPT=0` 不会弹出交互式用户名/密码；一旦开始就不会被 UI 取消中断，超时为 **300 秒**，超时后按“状态可能未知”处理并要求 Refresh。

### 入口图标与 tab 文案

- 侧栏 tab 使用宿主提供的 `branch` 图标，并在图标旁**并排显示 “Git Graph” 文字**（不是 icon-only）；`MenuItem` 与 mobile tab 继续使用 `branch` 图标与 “Git Graph” 标题。不新增自有图标资源，也不改变面板标题。

### 数据与请求

- RPC 使用当前会话所在 server 的 `server.client`，不会固定使用 desktop sidecar。
- 请求按 workspace（server id + directory）隔离并在切换时中止旧请求；迟到的响应会被丢弃。
- 刷新期间禁用仓库下拉、commit、状态文件、commit 文件、parent 和 Load more 交互；若刷新期间仍发生新选择，旧刷新快照按 generation 丢弃。
- 切换目录/仓库/commit 时清理失效选择；同一窗口内用有界缓存保留最近的仓库/commit/文件选择，并由下节的面板快照缓存负责重挂恢复。
- refs 独立加载，refs 失败不会阻塞 history；比较请求、commit 文件请求、commit 文件内容请求与 diff 请求各自隔离并可取消。
- `getCommitFiles` / `getComparisonFiles` 在 numstat 可用时附带可选 `added` / `deleted`；binary 不伪造 `0`，numstat 失败时文件列表仍可用。

### 仓库监听与自动刷新

- 监听使用 Node **`fs.watch`，不是轮询**：只观察 allowlist 仓库的 Git 元数据，不观察工作区文件。控制文件为 `HEAD` / `index` / `packed-refs`，refs 为 `refs/` 子树；每个仓库使用 **250ms trailing debounce** 合并一次 `git commit` / `checkout` / `update-ref` 产生的突发事件。`.lock` 文件和 `objects/` 子树被忽略。
- linked worktree 的私有 `gitDir` 只含自身 HEAD/index；watcher 通过 `rev-parse --git-common-dir` 额外观察共享 common dir 的 refs。common dir 首次解析失败时退化为只观察私有 gitDir，后续周期同步会重试补上。
- control 与 refs 使用**独立 slot**，任一 slot 监听失败只影响自身：按指数退避重建（约 500ms 起，上限 30s），不会拖垮另一个 slot，也不会停止整个 watcher。`refs/` 尚不存在时先观察 gitDir 作为 fallback，目录出现/删除后自动切换到递归 refs 监听或退回 fallback。
- 已知限制：reftable 仓库的 refs 不在 `refs/` 下，watcher 不覆盖；极旧平台若不支持递归 `fs.watch`，refs slot 会退避重试，HEAD/index 监听仍可工作。
- 变化通过 typed RPC **`events.graphChanged`** 发送，payload 仅含 `repositoryId`（可选 `kind`）；host 附加 session `location`。GUI 只处理**当前 session directory**：事件命中当前选中仓库时，**400ms 合并**后静默执行 `getStatus` / `getLog` / `getRefs`；同目录的其他仓库只重新拉取仓库列表；其他 location 或畸形 payload 直接忽略。
- 静默刷新不显示加载骨架，保留当前 **scroll / selection / expanded / filters**，`getLog` 的 limit 使用**当前已加载行数**而不是回到 100；只有新仓库出现时才刷新仓库下拉。若被展开的 commit 因外部变化消失，只收起该展开。

### 面板状态缓存（窗口级）

- 面板在切 tab 或打开文件时可能被卸载。GUI 维护一个**窗口级 LRU（最多 8 个目录）**快照，按 server id + directory 隔离；重挂时在首屏绘制前立即恢复 repositories、status、已加载 history、refs、选中仓库/commit、展开的 commit 与文件树、inline 文件列表与目录展开、搜索词、内联比例/槽高和 scroll 位置，不出现仓库或历史加载骨架。
- 快照节流 250ms 写入，并在卸载或切换目录时立即落盘。恢复后后台校验只调用 **`getStatus` + `getRefs`**，用 HEAD 与 refs 指纹校验；**HEAD / refs 未变时不发 `getLog`**，变了才按当前已加载行数静默刷新。inline 文件列表若快照中缺失会单独加载，但不会重载历史。工作区 status 变化会即时显示，但不强制重载历史。
- 缓存只在当前窗口/插件实例内有效：**插件 reload 或窗口 reload 后清空**，回到正常加载流程。列宽偏好仍由既有 `localStorage` 负责，不进入该快照。
- **不恢复全屏 diff 或 compare 页**：重挂后回到历史列表，已展开行的 inline 文件树会恢复；全屏 diff 需要重新打开。

## 明确未实现

以下能力当前**没有**实现，也没有可验收入口；详细逐项边界见 [`docs/FEATURE-PARITY.md`](docs/FEATURE-PARITY.md)：

- 网络与 remote 管理：pull / push、remote add/edit/delete、fetch into local branch、创建 PR；目前只实现了 Fetch（下载 remote 更新，可选 prune），没有 pull/push 或远程配置界面。Fetch 已在 TEMP 本地 bare remote 上自动化验收；真实网络、代理、凭据与 SSH/HTTPS 认证未自动化，需要人工确认。
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
- **仓库监听边界**：watcher 只对 allowlist 中的仓库安装 `fs.watch`，且只观察 Git 元数据（`HEAD` / `index` / `packed-refs` / `refs/`；worktree 另含 common dir 的共享 refs），不轮询、不观察工作区文件。事件 payload 仅含 `repositoryId`，location 由 host 附加；GUI 只接受与当前 session directory 匹配的事件，不能用它读取任意路径。单 slot 监听失败仅按自身退避重建，不会扩大扫描范围。
- **防误触不是授权**：`confirmed: true`、完整 expected HEAD 校验、GUI 确认对话框用于降低误操作和 stale write 风险，**不是身份认证或权限授权**。任何能调用该 RPC 的客户端仍应被视为受信调用方。
- **写入绑定与串行化**：写前重新解析 realpath、`--show-toplevel` 与 `--git-common-dir`，仓库根不符即拒绝；同一 real common dir 使用串行写锁，worktree 共享同一锁。缓存路径、`core.worktree` 重定向或 symlink 替换会被重新校验。
- **禁止破坏性行为**：不提供 force、`reset --hard`、`clean -fd`、discard、autostash。Delete branch 只使用 `git branch -d`（已合并）；Delete tag 不 push。
- **不执行 hooks / 签名 / 外部 filters**：所有写操作（含 Fetch）使用同一 hardened `gitWrite` 配置，固定 `core.hooksPath` 到不存在的临时目录、`core.fsmonitor=false`、`core.useReplaceRefs=false`、`gc.auto=0`、`maintenance.auto=false`、`submodule.recurse=false`、`commit.gpgsign=false`、`tag.gpgsign=false`。checkout 目标树中若实际选中 clean/smudge/process filter driver，会拒绝切换；**metadata-only 操作**（create/rename/delete branch 与 tag）不因配置了 filter 而被一概拒绝。全局安装了 Git LFS 但文件未实际选择该 driver 时，不会仅因 driver 存在而阻断。
- **Fetch 网络边界**：只执行 `git fetch [--prune] <remote>` 参数数组；remote 名先通过 refname 语法与 `git check-ref-format` 校验，All 模式逐个校验配置中的 remote。认证必须在启动前配置（credential helper / SSH agent）；`GIT_TERMINAL_PROMPT=0` 不会交互式索取凭据。fetch 进程不接收 AbortSignal，开始后不会因取消/关闭面板而中断，只有 300 秒超时；超时或中途失败时 remote-tracking refs 可能已部分更新，必须 Refresh 后由用户决定，不自动 retry。`expectedHead` 在 fetch 前后校验；fetch 本身不改变 HEAD 或工作区。
- **读 diff/status 的 filter override 语义保留**：工作区 diff/status 会枚举生效的 `filter.*.clean/process/required` 并用命令行空命令覆盖，禁止 `.gitattributes` filter 执行外部程序；因此工作区内容按原始字节比较，可能显示与 `git status` 默认过滤视图不同的差异。无法安全枚举或 driver 名称无法安全表达时明确失败。
- **工作区保护**：checkout 前拒绝 tracked 变更、冲突、其他 worktree 占用；ignored paths 与目标树路径按路径段检测碰撞，untracked 覆盖/删除风险由 git 错误映射为明确拒绝。
- **保守路径解码**：路径枚举遇到 UTF-8 replacement（U+FFFD）或无法无损 round-trip 的字符串时保守拒绝，避免对错误路径执行 checkout filter。
- **超时与未知状态**：写命令（含 Fetch）超时会被标记为“仓库状态未知”，要求 Refresh 后由用户决定，**绝不自动 retry**。
- **残余 TOCTOU**：校验与 git 写命令之间仍存在外部 Git 进程或文件系统变更的竞态窗口；本插件不持有仓库全局锁，也不防御恶意 git 二进制、系统级 config 注入的内置命令或操作系统层面竞态。
- **dev harness 不是生产认证**：FR 模式固定 `127.0.0.1:5178`，只暴露读方法，七个 mutation 方法（含 `fetchRemote`）始终返回 403；TEMP 模式固定 `127.0.0.1:5179`，只有带 marker、位于批准 TEMP 子树下的临时 fixture，且仅两个临时仓库允许真实 mutation。该 bridge 只是开发验收工具，不能被当作生产认证或通用 Git 服务。

## 技术栈

- OpenCode V2 插件 SDK（Server + GUI + RPC）
- SolidJS + TypeScript + Vite
- 原生 Git CLI（Server 端 `git -C <repo>`，参数数组传递）
- Node `fs.watch`（仓库元数据监听，非轮询；typed RPC 事件推送）

## 目录结构

```text
src/
├─ gui.tsx                 GUI 入口：Panel / MenuItem 注册、tab 图标与文案
├─ gui/
│  ├─ panel.tsx            侧边栏面板、状态与请求编排、重挂恢复与事件刷新
│  ├─ label.ts             tab 标题、branch 图标与图标+文字样式
│  ├─ panel-cache.ts       窗口级 LRU(8) 面板快照与序列化校验
│  ├─ graph-events.ts      graphChanged 过滤、400ms 合并、HEAD/refs 指纹
│  ├─ branch-selector.tsx  Branches history filter + checkout 入口
│  ├─ confirm-dialog.tsx   写操作确认与名称输入
│  ├─ fetch-dialog.tsx     Fetch 确认（remote / prune / expected HEAD）
│  ├─ ref-menu.tsx         类型化 ref / commit 菜单
│  ├─ compare-view.tsx     commit-pair 只读比较页
│  ├─ ref-utils.ts         ref 菜单动作、filter、mutation/fetch 契约与能力探测
│  ├─ requests.ts          LatestRequest：abort + generation 丢弃过期响应
│  ├─ graph.ts / graph-geometry.ts / graph-view.ts  提交图布局与几何
│  ├─ tree.ts              变更文件 -> 可折叠目录树（纯函数）
│  ├─ diff.ts / commit-diff-lines.ts  Unified Diff 行分类与行号
│  ├─ virtual.ts / row-layout.ts      可变行高虚拟窗口（前缀和/二分）、顶部特殊行与内联槽
│  ├─ row-heights.ts       ref badge 换行估算与行高缓存键
│  ├─ slot-size.ts         内联槽高度边界、默认高度与视口夹取
│  ├─ inline-split.ts     内联三栏信息/文件分割比例与宽度约束
│  ├─ column-layout.ts     可拖宽列布局、预算收缩与偏好持久化
│  ├─ history-columns.ts   窄屏列可见性与详情布局
│  ├─ commit-diff-view.tsx 整页只读 commit diff 视图
│  ├─ pagination.ts        commit 分页去重合并与自动加载守卫
│  ├─ changes.ts / selection.ts / errors.ts / format.ts / search.ts
│  └─ styles.ts            自包含样式
└─ server/
   ├─ repository/manager.ts    allowlist、写绑定、common dir 锁、RPC handlers
   ├─ repository/watcher.ts    fs.watch 监听、去抖、退避重建、worktree common refs
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

- **FR 只读**：默认 `npm run dev:ui`，`127.0.0.1:5178`，根为用户指定的只读 fixture 目录；无任何写路由，七个 mutation 方法（含 `fetchRemote`）返回 403。
- **TEMP 写测试**：`GG_UI_MODE=mutation-fixture`、`GG_UI_PORT=5179` 与批准 TEMP 子树下的 marker fixture（`%LOCALAPPDATA%\Temp\opencode\...`）；仅该 fixture 的两个临时仓库允许真实 mutation。Fetch 的真实流程也只在 TEMP 的本地 bare remote 上运行，不访问 FR。

在 OpenCode 全局配置（`opencode.jsonc`）中加载本地插件：

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["<path-to-opencode-git-graph>"]
}
```

## 测试与验收

- 自动化测试：**514 passed / 1 platform-specific skip**，本轮新增 `fs.watch` watcher（trailing debounce、slot 退避重建、worktree common refs、refs 缺失 fallback）、`graphChanged` 过滤/400ms 合并、窗口级 LRU(8) 面板缓存、动态行高（前缀和/二分/测量键）与 tab label 覆盖；覆盖范围还包括 fetch、slot 高度、Uncommitted 行与顶部特殊行布局、文件树、Unified Diff、虚拟滚动/行布局、分页与自动加载守卫、列布局与偏好回退、Graph 列拖拽与固定 lane 间距、内联三栏、commit 文件内容、commit diff 行号、ref 交互、日期格式化、比较、写操作安全、manager 写绑定/锁、dev harness 安全等。`0.2.3` 的 459 passed / 1 skip、`0.2.2` 的 446 passed / 1 skip 与 `0.2.1` 的 418 passed / 1 skip 仅作历史参照。
- 静态检查：`npm run typecheck`、`npm run build`、`git diff --check` 在本轮工作区通过。
- release UI 验收基线：`0.2.4` 为真实浏览器 **220/220 PASS，0 failed**（FR 只读 + 隔离 TEMP mutation/content fixture），记录在 [`dev/UI-ACCEPTANCE.md`](dev/UI-ACCEPTANCE.md)。220 项 = 历史 188 项回归基线 + 32 项冻结扩展断言；历史 `0.2.3` 的 188/188、`0.2.2` 的 172/172、`0.2.1` 的 131/131、`0.2.0` 的 93/93 与更早的 70/70 仅保留为历史基线。
- 220/220 覆盖真实面板、真实 Git 数据路径、真实指针/键盘输入、对比、Fetch 与 mutation 路径，以及本轮 watcher 自动刷新、缓存重挂、外部 commit + remount、动态 multi-ref 行、Uncommitted 槽拖高与 tab label 源码检查；FR 仓库数按环境动态读取（本轮为 12 个仓库 / 0 worktree），worktree 标签在为零时记为 `notPresent`；不覆盖原生 Desktop 宿主集成（见“当前状态”）。
- 本轮新增场景已随冻结构建运行并通过并记录在 [`dev/UI-ACCEPTANCE.md`](dev/UI-ACCEPTANCE.md)；其中 tab 图标+文字在真实 Desktop tab 的渲染仍标记为人工确认，未计为 UI PASS。
- 验收脚本与运行方式见 [`dev/ui-test/README.md`](dev/ui-test/README.md)。截图、`result.json` 等证据默认写入批准的 TEMP 目录（如 `%LOCALAPPDATA%\Temp\opencode\...`），可能包含私有仓库路径、提交信息或 diff 片段，**不得提交到版本库**，也不应写入公开文档。

## 许可说明

上游 `mhutchie/vscode-git-graph` 当前**不是 MIT 许可**。本项目没有复制或移植其源码，只做独立的 UI/布局/交互实现；使用或分发前请自行确认上游及本项目的许可条件。
