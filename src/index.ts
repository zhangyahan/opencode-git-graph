import { Plugin } from "@opencode/plugin"
import { GitGraphRpc } from "./rpc.js"
import { createGitGraphHandlers, RepositoryManager } from "./server/repository/manager.js"

export default Plugin.define({
  id: "git-graph",
  async setup(ctx) {
    const manager = new RepositoryManager(ctx.location.directory)
    let registration: { dispose: () => Promise<void> } | undefined

    try {
      registration = await ctx.rpc.register(GitGraphRpc, createGitGraphHandlers(manager))
    } catch (error) {
      manager.dispose()
      throw error
    }

    return async () => {
      try {
        await registration?.dispose()
      } finally {
        manager.dispose()
      }
    }
  },
})
