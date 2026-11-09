import { z } from "zod"
import { Rpc } from "@opencode/plugin/rpc"

/**
 * Portable RPC contract shared by the server and GUI halves of the plugin.
 *
 * The server registers handlers with `ctx.rpc.register(GitGraphRpc, ...)` and the
 * GUI calls them through `ctx.client.rpc(GitGraphRpc)`.
 */
export const GitGraphRpc = Rpc.define({
  id: "git-graph",
  methods: {
    ping: {
      input: z.object({ message: z.string().optional() }),
      output: z.object({ ok: z.literal(true), message: z.string() }),
    },
  },
  events: {},
})
