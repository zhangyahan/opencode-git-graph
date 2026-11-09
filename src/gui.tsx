import { MenuItem, Panel, Plugin } from "@opencode/plugin/gui"
import type { PanelTab } from "@opencode/plugin/gui"
import { GitGraphPanel } from "./gui/panel.js"

const TABS: readonly PanelTab[] = [{ id: "main", title: "Git Graph" }]

export default Plugin.define({
  setup(ctx) {
    ctx.add(Panel, {
      id: "main",
      region: "side",
      // The history graph and commit detail need a little more room than the
      // conversation's default side width. `wide` is intentionally not set:
      // this is a side panel, not a main-screen replacement.
      width: 520,
      list: (input) => (input.open.includes("main") ? TABS : []),
      render: (props) => <GitGraphPanel panel={props} />,
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
