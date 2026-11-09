# OpenCode Git Graph

面向 OpenCode Desktop 的多仓库 Git 工作台插件，复刻 VS Code [mhutchie.git-graph](https://github.com/mhutchie/vscode-git-graph) 的核心体验：

- 侧边栏模式：仓库切换、未提交变更（Staged / Unstaged / Untracked）、最近提交
- 主面板模式：提交拓扑图（分支线 + 合并）、Commit 文件目录树、Unified Diff 查看器
- 统一 Git 后端（Server 插件 + 类型化 RPC），支持一个工作区管理多个独立 Git 仓库

## 状态

🚧 开发中（MVP 阶段）

## 技术栈

- OpenCode V2 插件 SDK（Server + GUI + RPC）
- SolidJS + TypeScript + Vite
- 原生 Git CLI（`git -C <repo>`，参数数组传递）

## 本地开发

```bash
npm install
npm run build   # 构建 GUI bundle（dist/gui-experimental.cjs）
npm test        # 运行单元测试
```

在 OpenCode 全局配置（`opencode.jsonc`）中加载本地插件：

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["D:\\Workspace\\opencode-plugins\\opencode-git-graph"]
}
```
