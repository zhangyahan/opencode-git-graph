import { MenuItem, Panel, Plugin } from "@opencode/plugin/gui"
import type { PanelTab } from "@opencode/plugin/gui"
import { GitGraphPanel } from "./gui/panel.js"

export default Plugin.define({
  setup(ctx) {
    // Keep the tab object stable across list calls and session switches so the
    // host does not re-render the label. The icon comes from the host UI, so
    // the tabs are built here rather than at module scope.
    const tabs: readonly PanelTab[] = [
      {
        id: "main",
        title: "Git Graph",
        label: () => <ctx.ui.Icon name="branch" size="small" />,
      },
    ]

    ctx.add(Panel, {
      id: "main",
      region: "side",
      // The history graph and commit detail need a little more room than the
      // conversation's default side width. `wide` is intentionally not set:
      // this is a side panel, not a main-screen replacement.
      width: 520,
      mobile: {
        title: "Git Graph",
        order: 0,
        kind: "tab",
        icon: "branch",
      },
      list: (input) => (input.open.includes("main") ? tabs : []),
      render: (props) => <GitGraphPanel panel={props} />,
    })

    ctx.add(MenuItem, {
      menu: "session.panel",
      id: "main",
      title: "Git Graph",
      icon: "branch",
      run: () => {
        const session = ctx.sessions.current()
        if (session) ctx.layout.open(`${ctx.id}:main`, session)
      },
    })
  },
})
