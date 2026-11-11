# Git Graph 功能对齐矩阵

本文回答三个问题：上游 VS Code Git Graph 有哪些主要公开能力、本插件当前做到哪里、哪些仍未实现。它是功能边界说明，不是发布说明，也不表示本插件已经全量复刻上游。

## 1. 状态口径

| 标记 | 含义 |
| --- | --- |
| ✅ 已实现 | 当前基线已有能力，真实 UI/读写路径已验收；括号内注明子集或范围限制。 |
| ⬜ 未实现 | 当前没有对应能力，也没有可验收路径；不得打勾。 |

`0.2.3` 的最终 release UI 验收为 **188/188 PASS**（FR 只读 + 隔离 TEMP mutation/content fixture，真实浏览器与真实生产路径），记录在 `dev/UI-ACCEPTANCE.md`。188 项由历史 172 项回归基线加 16 项细化断言组成。FR 仓库数量按环境动态读取（本次 12 个仓库 / 0 worktree，零 worktree 记录为 `notPresent`），旧 16/4 fixture 形状不再是硬编码前提。历史 172/172、131/131 与 0.2.0 的 93/93 仅作为历史基线。“完成度”不按上游功能数量折算；同一组里可能只实现了子集，不能把子集等同于上游全量能力。188/188 不覆盖原生 Desktop 宿主集成（会话/scope 切换、窗口 chrome、MenuItem、主题/事件总线、真实面板 resize）。

## 2. 公开来源与许可

本矩阵只依据以下公开页面（读取日期：2026-11-10）：

- Marketplace Features：<https://marketplace.visualstudio.com/items?itemName=mhutchie.git-graph>
- Wiki Context Menus：<https://github.com/mhutchie/vscode-git-graph/wiki/Context-Menus>
- Wiki Extension Settings：<https://github.com/mhutchie/vscode-git-graph/wiki/Extension-Settings>

Marketplace 页面当前列出的上游版本为 1.30.0。上游后续更新不自动等于本矩阵仍然等价。

本项目没有读取、复制或移植上游源码，只依据上述公开文档做独立实现。上游当前**不是 MIT 许可**；使用或分发前请自行确认上游及本项目的许可条件。

## 3. 顶部 Branches 与 Checkout 的区别

- **顶部 Branches 是 history filter**：可选择 All、一个或多个本地分支 / 远程分支 / tag；只改变图中加载/显示哪些历史。它不改变 HEAD，不写工作区，不是 checkout 入口。当前没有自定义 glob 过滤。
- **Checkout 是写操作**：只对本地分支执行 checkout，会改变 HEAD 和工作区；必须从 Branches 对话框的 Checkout 区或 ref 菜单明确触发，并先经过 GUI 确认。
- 因此，“在 Branches 筛选器里选中某分支”和“checkout 到该分支”是两件事，不能共用一个状态或一个成功提示。
- “View history”动作只设置 filter；即使当前 filter 选中某分支，也不会因此改变 HEAD。

## 4. 功能矩阵

### A. 只读展示与导航

| 功能组 | 上游公开能力（摘要） | 状态 | 本插件边界 / 本轮范围 | 来源 | 可验收标准 |
| --- | --- | --- | --- | --- | --- |
| 图 / refs / 未提交 | 提交图；本地与远程分支；heads/tags/remotes；未提交变更；顶点 tooltip | ✅ 已实现（UI 验收通过） | 已有提交 DAG、commit ref badge。未提交变更现在是 History 列表顶部的特殊行：空心虚线圆、总文件数 `(N)` 与 staged/unstaged/untracked/conflicted 计数 badge；不占 commit 索引、不是图节点。单击展开 Staged/Unstaged/Untracked/Conflicted 分组，点击文件打开 index 或 working-tree 整页 diff；clean 仓库显示 `(0)` / “No changes”。旧独立 Changes 区块已移除。没有顶点 tooltip（HEAD 包含关系、分支归属等）；没有 stash 行。 | [Features](https://marketplace.visualstudio.com/items?itemName=mhutchie.git-graph) | 加载含 merge/tag/remote 的 fixture：图行与 ref 对齐；顶部 Uncommitted 行无 commit index/hash，clean 时显示 0；展开后四组可用，staged 文件请求 `target.type="index"`、unstaged/untracked 请求 working-tree；旧 Changes 区块不存在；不得宣称图中存在未提交节点。 |
| Branches 历史过滤（All / 多选） | 顶部 Branches 下拉：Show All、单选或多选分支、自定义 glob 模式 | ✅ 已实现（UI 验收通过） | 已实现 All、多选本地/远程/tag ref、ref 搜索以及 Include remotes / Include tags；显式 ref 优先于 show 开关。自定义 glob 输入未实现。131/131 最终验收覆盖 All/Selected/单 ref 流程。 | [Features](https://marketplace.visualstudio.com/items?itemName=mhutchie.git-graph) / [Extension Settings](https://github.com/mhutchie/vscode-git-graph/wiki/Extension-Settings) | 选择分支只改变历史加载/显示，不改 HEAD、不写仓库；切回 All 恢复完整已加载历史；过滤后 checkout 仍需独立确认。 |
| Show remote / tags 等开关 | 独立控制是否显示远程分支、远程 HEAD、标签、stash、未提交变更等 | ✅ 已实现（UI 验收通过） | 已实现 All 模式下的 Remotes / Tags 工具栏开关和 Branches 对话框内同名开关；显式 ref 选择优先。没有 stash、未提交变更、远程 HEAD 的独立显示开关。 | [Extension Settings](https://github.com/mhutchie/vscode-git-graph/wiki/Extension-Settings) | 开关切换后对应历史/ref 显示变化；同一次会话内 Refresh 后保持，跨宿主会话持久化未实现；不改变 HEAD；本轮无 stash/未提交显示开关的验收路径。 |
| Order / first-parent | date、author-date、topo 三种顺序；only follow first parent | ✅ 已实现（UI 验收通过） | 已实现 `Date`（`--date-order`）与 `Topo`（`--topo-order`）顺序。**First parent 切换控件已从工具栏移除**，first-parent 遍历不再作为可切换 UI 能力；未实现 author-date-order 和 UI 上的自定义排序组合。 | [Extension Settings](https://github.com/mhutchie/vscode-git-graph/wiki/Extension-Settings) | 切换 order 后首批与后续分页顺序一致；UI 中不存在 first-parent 控件；merge 详情仍保留完整 parent 列表。 |
| 提交搜索（Find） | Find Widget；在 message/date/author/hash/branch/tag 中查找 | ✅ 已实现（只读子集） | 仅搜索已经加载的 commit：subject、hash、author、refs；高亮匹配、淡化其余，Enter 跳到首匹配，Esc 清空。不是服务端全历史搜索。 | [Features](https://marketplace.visualstudio.com/items?itemName=mhutchie.git-graph) | 输入查询只影响已加载行的高亮，不改变拓扑或行数；Enter 滚动到首匹配；Esc 清空；界面不得暗示已搜索未加载历史。 |
| HEAD 跳转 / 键盘快捷键 | Ctrl/Cmd+F、H、R、S；提交详情 Up/Down；Enter/Esc | ✅ 已实现（UI 验收通过） | 已实现 Ctrl/Cmd+F 搜索、Ctrl/Cmd+R 刷新、Shift+F10 打开 commit 菜单、Esc 关闭活动层；commit 行支持 Enter/Space 展开和 Ctrl/Cmd+click 比较。**Jump HEAD 按钮与 Ctrl/Cmd+H 绑定已移除**；未实现 Ctrl/Cmd+S stash 跳转、提交详情 Up/Down 或父子提交导航。 | [Features](https://marketplace.visualstudio.com/items?itemName=mhutchie.git-graph) / [Extension Settings](https://github.com/mhutchie/vscode-git-graph/wiki/Extension-Settings) | 快捷键不抢占宿主冲突键；Ctrl/Cmd+H 不发历史请求、UI 无 jump-head；Esc 关闭菜单/Branches/Fetch/比较/整页 diff；未实现项无入口。 |
| Commit details：文件树 / diff / root / merge | 文件树或文件列表；VS Code Diff；打开当前文件；复制路径；root 与 merge 处理 | ✅ 已实现（独立 diff 子集） | 已有同行内联三栏：左提交信息（author/date/hash/parents；默认约占槽体 **40%**、优先最小 200px，长文本完整换行不省略）、中文件列表（内部滚动且比信息列窄）、右固定 28px 的 list/tree 切换；左中分割线可拖拽（命中区 5px，比例限制 **25%–60%**，会话内记忆，文件列保留最小宽度不溢出）；文件行 status + 文件名 + `+N -M`，binary 或无 numstat 显示 `-`。eye 通过 `getCommitFileContent` 查看该 commit 版本（text/binary/symlink/submodule missing；1 MiB 截断；>20 MiB 仅显示大小）；open current 优先 `ctx.layout.open` 的 `file:` 目标，失败走系统默认应用，再失败复制仓库相对路径。没有宿主原生 diff，没有独立复制路径菜单；有 4000 行渲染上限以及 binary/truncated 提示。 | [Features](https://marketplace.visualstudio.com/items?itemName=mhutchie.git-graph) / [Context Menus](https://github.com/mhutchie/vscode-git-graph/wiki/Context-Menus) | 点击 commit 展开三栏且文件区内部滚动；点击文件名只显示该 commit 与其所选 parent 的 patch；eye 不改变选中并按 kind 正确提示；open current 按三层回退；merge 切换 parent 后重载；root 不请求不存在的父提交；Back 恢复滚动和展开状态。 |
| 内联展开高度 | 上游没有独立的内联槽高度手柄 | ✅ 已实现（UI 验收通过） | commit 内联槽与 Uncommitted 槽的**整条底边横线本身就是拖拽区**（5px 高、全宽，无独立小把手或装饰）；范围为 **96 .. max(96, min(560, viewport - 80))**，短视口不会低于 96；高度只在当前面板会话内记忆（不写 `localStorage`）；未调整时按内容取高并以 260px 为默认上限。 | 本项目独立实现 | 拖拽可把槽缩到 96、增长到动态上限；折叠/重开同一槽恢复会话高度；滚动位置在非底部拖拽时保持稳定；重载后不保留。 |
| 两个 commit 比较 | 选一个 commit 后 Ctrl/Cmd 点击另一个 commit，进入比较视图 | ✅ 已实现（UI 验收通过） | 已实现 commit-pair 只读比较页：context menu 选择 base 后 Ctrl/Cmd+click 另一行，或从 commit 菜单比较。`getComparisonFiles` / `getComparisonDiff` 只比较 `base..head`，不读取索引或工作区；文件列表在 numstat 可用时附带可选 `added` / `deleted`，binary 不伪造计数。131/131 最终验收覆盖 context-menu 与 Ctrl/Cmd+click 比较路径。 | [Features](https://marketplace.visualstudio.com/items?itemName=mhutchie.git-graph) | 选中 A 后 Ctrl/Cmd 点击 B 进入 compare；文件列表和 patch 的目标为 A..B；取消/返回不改变 HEAD；不包含 working tree。 |
| ref 类型化菜单 | 分支、远程分支、标签等右键菜单 | ✅ 已实现（UI 验收通过） | 已实现 branch / remote / tag / synthetic HEAD 的类型化菜单与安全动作：View history、Copy、Create branch here；branch 另有 Checkout / Rename / Delete；tag 另有 Delete。完整上游菜单动作（archive、PR、push 等）不在本轮范围。 | [Context Menus](https://github.com/mhutchie/vscode-git-graph/wiki/Context-Menus) | 单击/右键各类型 ref 时菜单标题和动作匹配类型；写动作先确认；当前分支不显示 checkout/delete；未实现动作无入口。 |
| commit 菜单 | Add Tag、Create Branch、Checkout、Cherry Pick、Revert、Drop、Merge、Rebase、Reset、Copy 等 | ✅ 已实现（UI 验收通过） | 已实现只读与安全创建子集：View changes、Copy hash、Copy subject、Select for comparison、Create branch here、Create tag here。没有 Checkout commit、Cherry Pick、Revert、Drop、Merge、Rebase、Reset。 | [Context Menus](https://github.com/mhutchie/vscode-git-graph/wiki/Context-Menus) | 右键 commit 出现上述只读/创建动作；写动作先确认；破坏性或未实现动作无入口。 |

### B. 写操作

| 功能组 | 上游公开能力（摘要） | 状态 | 本插件边界 / 本轮范围 | 来源 | 可验收标准 |
| --- | --- | --- | --- | --- | --- |
| 本地分支 checkout / create | Checkout 本地分支；从 commit/branch/ref 创建分支 | ✅ 已实现（UI 验收通过） | 已实现确认式 checkout 本地分支，以及从 commit / ref 创建本地分支。不自动 stash；dirty/conflicted、其他 worktree 占用、ignored/untracked 碰撞、活动 filter 会拒绝 checkout。RPC 的 createBranch 支持可选 checkout，UI 当前以创建并刷新为主。 | [Features](https://marketplace.visualstudio.com/items?itemName=mhutchie.git-graph) / [Context Menus](https://github.com/mhutchie/vscode-git-graph/wiki/Context-Menus) | 取消确认时不发写 RPC；确认后只在 temp fixture 执行；checkout 后 HEAD/工作区状态正确；无 force、无 autostash。 |
| 本地分支 rename / delete | Rename Branch、Delete Branch（含 force delete 选项） | ✅ 已实现（UI 验收通过） | 已实现 `git branch -m` 重命名（不 force），以及 `git branch -d` 删除已完全合并的本地分支。当前分支、其他 worktree 占用、未合并分支会被拒绝。**没有 force delete / `-D`。** | [Context Menus](https://github.com/mhutchie/vscode-git-graph/wiki/Context-Menus) | 取消确认时不发写 RPC；rename 只接受新名称并保持当前分支绑定正确；delete 只删除已合并分支；未合并/当前/占用分支返回明确拒绝且 refs 不变。 |
| 创建 tag | Add Tag：annotated / lightweight，可选 push | ✅ 已实现（UI 验收通过） | 已实现确认式 create tag：无 message 为 lightweight，有 message 为 annotated；固定 `--no-sign`；不 push。 | [Features](https://marketplace.visualstudio.com/items?itemName=mhutchie.git-graph) / [Context Menus](https://github.com/mhutchie/vscode-git-graph/wiki/Context-Menus) | 取消时不发写 RPC；确认后 temp fixture 出现指向目标 commit 的 tag；annotated 携带 message；不默认 push；不签名。 |
| 删除 tag | Delete Tag、Push Tag | ✅ 已实现（UI 验收通过） | 已实现 `git tag -d` 删除 tag；不 force、不 push。上游的 Push Tag 未实现。 | [Context Menus](https://github.com/mhutchie/vscode-git-graph/wiki/Context-Menus) | 取消时不发写 RPC；确认后 tag 从 refs 消失；不存在/失败返回明确错误；不 push。 |
| Fetch（下载 remote 更新） | Fetch、fetch --prune；fetch into local branch | ✅ 已实现（UI 验收通过） | 已实现确认式 `fetchRemote`：All remotes 或单个 remote、可选 `--prune`、打开时捕获的 expected HEAD；成功返回 `refsUpdated` 并刷新 refs/history；失败返回有界 reason；取消零 RPC。remote 列表由已加载的 remote refs 推导，尚无 remote-tracking ref 的 remote 需先在外部配置/首次 fetch；列表为空时按钮禁用。fetch 不 merge、不 rebase、不改工作区/HEAD；不实现 fetch into local branch。 | [Features](https://marketplace.visualstudio.com/items?itemName=mhutchie.git-graph) / [Context Menus](https://github.com/mhutchie/vscode-git-graph/wiki/Context-Menus) | 取消不发 fetch RPC；确认后 TEMP bare remote 的 remote-tracking/tag refs 按预期更新/删除，`refsUpdated` 与 `changed` 正确；认证/网络失败显示有界 reason；FR 始终 403，不向 FR 写入。 |
| Pull / Push / remote 管理与 PR | Pull、Push；remote add/edit/delete；fetch into local branch；创建 PR | ⬜ 未实现 | pull/push、remote add/edit/delete、fetch into local branch 与 PR 均未实现；没有 Repository Settings Widget。Fetch 已单独列在上方。 | [Features](https://marketplace.visualstudio.com/items?itemName=mhutchie.git-graph) / [Context Menus](https://github.com/mhutchie/vscode-git-graph/wiki/Context-Menus) | 未来网络动作必须确认、明确 remote/ref，并给出可恢复错误；本轮无验收路径。 |
| Stash | Stash uncommitted changes；apply/pop/drop；从 stash 创建分支 | ⬜ 未实现 | 未提交变更已在 History 顶部行只读展示；不创建/应用/删除 stash，也不在图中显示 stash 行。 | [Features](https://marketplace.visualstudio.com/items?itemName=mhutchie.git-graph) / [Context Menus](https://github.com/mhutchie/vscode-git-graph/wiki/Context-Menus) | 未来 stash 动作确认后执行；include untracked、reinstate index（恢复索引）等选项按后续结论；本轮无验收路径。 |
| Merge / Rebase / Reset / Cherry-pick / Revert | 分支与提交的 merge、rebase、reset、cherry-pick、revert、drop | ⬜ 未实现 | 未实现。安全策略明确禁止 force、reset --hard、clean -fd、discard、autostash；未来也不提供破坏性默认值。 | [Context Menus](https://github.com/mhutchie/vscode-git-graph/wiki/Context-Menus) | 未来只在 temp fixture、确认后验收；不得默认 force 或 hard reset；本轮无验收路径。 |

### C. 集成与配置

| 功能组 | 上游公开能力（摘要） | 状态 | 本插件边界 / 本轮范围 | 来源 | 可验收标准 |
| --- | --- | --- | --- | --- | --- |
| Review 标记 | 标记已审阅文件；未审阅加粗；跨会话保留，90 天不活跃后关闭 | ⬜ 未实现 | 没有 review 状态、持久化或过期清理。 | [Features](https://marketplace.visualstudio.com/items?itemName=mhutchie.git-graph) | 未来标记文件取消加粗、跨会话保留、90 天过期；本轮无验收路径。 |
| 签名 / avatars / mailmap / emoji / issue 与 PR link | 签名状态；作者头像；`.mailmap`；emoji shortcode；issue/PR 链接 | ⬜ 未实现 | 均未实现。当前 log 关闭签名显示以避免触发外部 GPG 程序，写操作也固定关闭签名，这是安全设置，不是签名状态 UI；没有 avatar、mailmap、emoji、issue 或 PR 链接。 | [Features](https://marketplace.visualstudio.com/items?itemName=mhutchie.git-graph) / [Extension Settings](https://github.com/mhutchie/vscode-git-graph/wiki/Extension-Settings) | 未来逐项可关闭；avatar 发送邮箱前需显式同意；签名失败不得阻塞日志；本轮无验收路径。 |
| 设置入口 / 导入 / 导出 | Repository Settings / 导出/导入 repository configuration 文件，供团队复用 | ⬜ 未实现 | 没有 Repository Settings 入口，只有列宽偏好存在 `localStorage`；没有仓库配置文件的导入/导出。 | [Features](https://marketplace.visualstudio.com/items?itemName=mhutchie.git-graph) | 未来导出文件可审阅，导入不得执行任意命令；本轮无验收路径。 |
| 入口图标 | 宿主菜单/标签图标 | ✅ 已实现（UI 验收通过） | `MenuItem`、侧栏 tab label 与 mobile tab 统一使用宿主 `branch` 图标；不新增自有图标资源。 | 本项目独立实现 | 菜单项、侧栏 tab 与 mobile tab 都显示 `branch` 图标；面板标题不变。 |

### D. 本轮布局与日期

| 功能组 | 上游公开能力（摘要） | 状态 | 本插件边界 / 本轮范围 | 来源 | 可验收标准 |
| --- | --- | --- | --- | --- | --- |
| 日期显示到分钟 | Date format/type 可配置；默认日期与时间 | ✅ 已实现（UI 验收通过） | 已实现 Date 列显示 **authorDate 的本地时区时间**，格式固定为 `YYYY-MM-DD HH:mm`（**16 字符、不含秒**，列宽内完整显示），原始 ISO 在 title，内联详情行同样使用 16 字符值 + ISO tooltip。date-only 与无效输入安全回退。排序仍使用 git commit date（默认 `--date-order`，可选 `--topo-order`），与 authorDate 不是同一字段；没有 author-date-order。 | [Extension Settings](https://github.com/mhutchie/vscode-git-graph/wiki/Extension-Settings) | 所有行匹配 `^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$` 且长度为 16；title 保留 ISO 原值；跨时区/午夜不串日；无效输入不崩溃；切换 Date/Topo 不改变显示字段语义。 |
| Graph 列拖拽与列布局 | 列宽可调整；Date/Author/Commit 可隐藏 | ✅ 已实现（UI 验收通过） | 已实现 Graph 列默认 240px、可拖动 **96–400px** 并持久化；lane 间距**恒为 14px**，不随列宽压缩。列宽不足时右侧分支被裁剪隐藏，SVG 仍按完整内容渲染，历史列表**没有横向滚动条**，且**不再显示 dense graph 提示**或 Filter branches 引导条。列头为 Title Case（Graph / Description / Date / Author / Commit）；拖拽命中区就是表头**常显竖分割线**上的 5px 透明条（无独立把手或 hover 装饰），拖动时表头与数据行宽度同步。Description/Date/Author/Commit 同样可拖并持久化，偏好损坏回退默认。 | [Features](https://marketplace.visualstudio.com/items?itemName=mhutchie.git-graph) / [Extension Settings](https://github.com/mhutchie/vscode-git-graph/wiki/Extension-Settings) | Graph 列可在 96–400px 内拖动且刷新后保持；任意宽度下 lane 中心仍为 15/29/43…（14px 步进），内容宽于列时右侧裁剪且无横向溢出、无 dense 提示；表头文案与常显竖分割线；5px 分割线命中区可拖且无独立装饰；表头/行宽同步；其余列可拖；偏好损坏回退默认。 |
| 分支 / ref 名称完整显示 | 分支与 ref 标签 | ✅ 已实现（UI 验收通过） | 当前分支标签与可见 ref badge **不省略、不裁切**：当前分支可换行，refs 组在自身区域内横向滚动（隐藏滚动条）而不裁切单个名称；`+N` 聚合保留；520px 窄面板无页面横向溢出。 | 本项目独立实现 | 1100px 与 520px 下 current-branch 和可见 ref badge 完整可见；长分支名（66 字符 TEMP）完整显示并在清理后恢复原分支；`+N` 行为不变；没有 document / body / panel 横向溢出。 |

## 5. 本轮实现与验收口径

`0.2.3` 已落地的实现包括；`0.2.1` / `0.2.2` 已验收项沿用历史结论，本轮变更项均已完成新的 UI 验收：

- Branches history filter（All / 多选 local、remote、tag；无自定义 glob）
- Show remotes / tags、Date/Topo 顺序；First parent 控件已移除
- 两个 commit 比较（context menu + Ctrl/Cmd+click）
- 类型化 ref 菜单与 commit 菜单的安全子集
- 本地分支 checkout / create / rename / delete（delete 仅已合并，无 force）
- lightweight / annotated tag create 与 tag delete（无 push）
- 日期显示到分钟（`YYYY-MM-DD HH:mm`，16 字符、无秒，ISO 保留在 tooltip）
- Graph 列 96–400px 可拖且持久化，14px lane 间距不压缩；窄列裁剪右侧分支、无横向滚动，且不再显示 dense 提示
- Title Case 列头；列宽从常显竖分割线上的 5px 命中区拖拽（无独立把手/装饰），表头与行宽同步，其余列可拖并持久化
- 分支与 ref 名称完整显示不省略（current-branch 可换行，refs 组内部滚动不裁单名）
- 内联三栏（提交信息 / 文件列表 / list·tree 切换）与文件行 `+N -M`；信息列默认约 40%、优先最小 200px，长文本换行不裁切；左中 5px 分割线可拖，比例 25%–60% 并在会话内记忆
- commit 版本文件查看（`getCommitFileContent`）与打开工作区当前文件
- Uncommitted 顶部特殊行（无 commit 索引、空心虚线圆、四类计数 badge、clean 0、内联分组与 index/working-tree 整页 diff）；旧独立 Changes 区块已移除
- 内联槽整条底边横线为拖拽区，96 .. `max(96, min(560, viewport - 80))`，会话内记忆
- 确认式 Fetch（All/单 remote、`--prune`、expected HEAD、`refsUpdated`、有界失败 reason、取消零 RPC）
- MenuItem / tab label / mobile tab 统一 branch 图标
- 移除 Jump HEAD 按钮与 `Ctrl/Cmd+H` 绑定

验收口径：

1. `0.2.3` 的最终 release UI 验收为 **188/188 PASS，0 failed**（FR 只读 + 隔离 TEMP mutation/content fixture，真实浏览器、真实生产路径）。188 项 = 历史 172 项回归基线 + 16 项细化断言；历史 `0.2.2` 的 172/172、`0.2.1` 的 131/131、0.2.0 的 93/93 与更早的 70/70 仅保留为历史基线。FR 仓库数按环境动态读取（本次 12 个仓库 / 0 worktree，零 worktree 记为 `notPresent`），不硬编码旧 fixture 形状。
2. 本轮细化场景（Graph 无 dense 提示、5px 表头分割线拖拽、16 字符 Date、分支/ref 完整名称、内联信息列 40% / 200px 下限与 25%–60% 会话比例、slot 整条底边拖拽）已冻结并完整运行，结论记录在 `dev/UI-ACCEPTANCE.md`。
3. 写操作（含 Fetch）只在批准 TEMP fixture 中通过真实 mutation 验收；FR 环境始终只读，七个 mutation 请求（含 `fetchRemote`）返回 403。
4. 188/188（以及历史 172/172、131/131）只代表该 harness 矩阵；原生 Desktop 宿主集成（会话/scope 切换、窗口/面板 chrome、`MenuItem` 注册、主题/事件总线、真实面板 resize）未覆盖，需用户在实际 Desktop 中 `/reload` 后确认。
5. 未实现项保持 ⬜，不给未实现功能打勾；未完成 UI 验收的实现不得写成 ✅。

## 6. 安全与写操作策略

- **真实仓库只读**：所有真实功能调研和真实数据验收只读；本文件的任务本身也不修改真实仓库内容。
- **allowlist 与防误触**：Server 只在会话目录发现仓库并维护 allowlist；RPC 不接受任意仓库路径。`confirmed: true` + expected HEAD 校验用于防误触和 stale write，**不是认证或授权**。
- **写入绑定与串行化**：写前重新校验 realpath、top-level 与 git common dir；同一 common dir 串行写入（worktree 共享锁）。缓存路径或 symlink 替换会拒绝。
- **写操作仅 temp fixtures**：checkout、create/rename/delete branch、create/delete tag 以及 Fetch 只在临时 fixture 中执行真实写验收；真实仓库不执行写操作，Fetch 只指向 TEMP 的本地 bare remote。
- **GUI 确认后才调用**：写动作必须先展示目标 ref/commit、remote 与动作类型，用户明确确认后才发 RPC；取消时不发写请求，取消 Fetch 不发送任何 fetch RPC。
- **禁止破坏性快捷方式**：不提供 force、`reset --hard`、`clean -fd`、discard、autostash；delete branch 只用 `git branch -d`，delete tag 不 push。Fetch 只下载并更新 remote-tracking refs/tags（可选 prune），不 merge、不 rebase、不改工作区/HEAD。
- **hooks / 签名 / 外部 filter 不执行**：所有写操作（含 Fetch）使用统一 hardened `gitWrite` 配置，固定禁用 hooks、fsmonitor、replace refs、auto gc/maintenance、submodule recurse 与签名。checkout 目标树若实际选择 clean/smudge/process filter，会拒绝；metadata-only 操作允许，不因全局安装但未实际选择的 LFS driver 一概阻断。
- **Fetch 的名称与网络边界**：只执行 `git fetch [--prune] <remote>` 参数数组；remote 名先通过 refname 语法与 `git check-ref-format` 校验，All 模式逐个校验配置中的 remote；`--prune` 不作为自由文本拼接。认证必须在启动前通过 credential helper / SSH agent 配置，`GIT_TERMINAL_PROMPT=0` 不交互式索取凭据。
- **Fetch 不可中止与未知状态**：fetch 进程不接收 AbortSignal，开始后不会因 UI 取消/关闭而中断，只有 300 秒超时；超时或中途失败时 remote-tracking refs 可能已部分更新，必须 Refresh 后由用户决定，不自动 retry。expected HEAD 在 fetch 前后各校验一次。
- **工作区与路径保护**：checkout 拒绝 tracked 变更、冲突、其他 worktree 占用、ignored/untracked 碰撞；UTF-8 replacement 或无法无损 round-trip 的路径保守拒绝。
- **超时未知不自动重试**：写命令（含 Fetch）超时表示仓库状态未知，必须 Refresh 后由用户决定，绝不自动 retry。
- **读 diff/status 保持 filter override**：已实现枚举并空覆盖 clean/process/required，禁止执行外部 filter；无法安全枚举时明确失败。
- **残余 TOCTOU**：校验与 git 写命令之间仍存在外部 Git 进程或文件系统变更的竞态窗口，本插件不持有仓库全局锁。
- **dev harness 不是生产认证**：FR 5178 只读且七个写方法（含 `fetchRemote`）403；TEMP 5179 仅接受 marker 批准、位于批准 TEMP 子树下的两个临时仓真实 mutation。该桥只用于本地验收，不能当作生产认证。

## 7. Diff 能力边界

本仓库使用 `@opencode/plugin` **2.2.6**。该版本的公开 GUI API 中没有可直接复用的历史 Diff 组件；Review/Changes API 面向当前会话未提交变更，不接受 commit 或 parent 输入。因此：

- 历史 diff 使用本项目独立实现的只读 patch viewer，不声称使用宿主原生 Diff。
- 独立 patch viewer 支持 **commit 与其 parent**，以及 **两个 commit 配对**。
- 不把 working-tree/index diff 混入历史 commit 或 commit-pair diff；Uncommitted 顶部行的文件点击单独生成 **index** 或 **working-tree** 的整页只读 diff。
- 面板内 diff 是侧栏内容替换，不是宿主全窗口主页面。
- 当前 viewer 的 4000 行上限、binary 和 truncated 提示属于独立实现限制，不是上游行为等价承诺。

## 8. 文档维护

- 本文件只维护公开能力边界，不修改源码、测试或 dev 目录；README 负责使用说明，版本号只在 `package.json` / `package-lock.json` 顶层更新。
- 不包含私有仓库名称、子仓库名、commit hash、文件内容、用户名或私有仓库绝对路径、截图。
- 验收证据只引用批准 TEMP 目录或 `dev/UI-ACCEPTANCE.md` 的公开摘要。
- 状态变化时只改对应行；未实现项不打勾，任何“已实现”必须与当前 UI/backend 入口吻合。
- 发布收尾时由发布流程执行 `git diff --check`、提交并推送；文档子任务自身不改源码。
