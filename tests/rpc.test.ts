import { describe, expect, it } from "vitest"
import { GitGraphRpc } from "../src/rpc.js"

describe("git-graph RPC contract", () => {
  it("declares the ping method", () => {
    expect(GitGraphRpc.id).toBe("git-graph")
    expect(Object.keys(GitGraphRpc.methods)).toEqual(["ping"])
    expect(Object.keys(GitGraphRpc.events)).toEqual([])
  })
})
