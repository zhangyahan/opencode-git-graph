import { Plugin } from "@opencode/plugin"
import { GitGraphRpc } from "./rpc.js"

export default Plugin.define({
  id: "git-graph",
  async setup(ctx) {
    await ctx.rpc.register(GitGraphRpc, {
      ping: async (input) => ({
        ok: true as const,
        message: input.message ?? "pong",
      }),
    })
  },
})
