import { MenuItem, Panel, Plugin } from "@opencode/plugin/gui"
import type { PanelTab } from "@opencode/plugin/gui"

const TABS: readonly PanelTab[] = [{ id: "main", title: "Git Graph" }]

function GitGraphPanel() {
  return (
    <div class="git-graph-panel">
      <p>Git Graph 开发中</p>
    </div>
  )
}

export default Plugin.define({
  setup(ctx) {
    ctx.add(Panel, {
      id: "main",
      region: "side",
      list: () => TABS,
      render: () => <GitGraphPanel />,
    })

    ctx.add(MenuItem, {
      menu: "session.panel",
      id: "main",
      title: "Git Graph",
      run: () => {
        const session = ctx.sessions.current()
        if (session) ctx.layout.open(`${ctx.id}:main`, session)
      },
    })
  },
})
