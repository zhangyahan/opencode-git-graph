import { Plugin } from "@opencode/plugin"
import type { RpcRegistration } from "@opencode/plugin/promise/rpc"
import { GitGraphRpc } from "./rpc.js"
import { createGitGraphHandlers, RepositoryManager } from "./server/repository/manager.js"
import { WorkspaceWatcher } from "./server/repository/watcher.js"

export default Plugin.define({
  id: "git-graph",
  async setup(ctx) {
    const manager = new RepositoryManager(ctx.location.directory)
    let registration: RpcRegistration<typeof GitGraphRpc> | undefined
    let watcher: WorkspaceWatcher | undefined

    try {
      registration = await ctx.rpc.register(GitGraphRpc, createGitGraphHandlers(manager))
      watcher = new WorkspaceWatcher(manager, (repositoryId) => {
        // The host attaches the location to the event payload. A failed emit
        // (e.g. no GUI attached) must not tear down the watcher.
        void registration?.events
          .emit("graphChanged", { repositoryId })
          .catch(() => undefined)
      })
      void watcher.start()
    } catch (error) {
      watcher?.dispose()
      manager.dispose()
      throw error
    }

    return async () => {
      watcher?.dispose()
      try {
        await registration?.dispose()
      } finally {
        manager.dispose()
      }
    }
  },
})
