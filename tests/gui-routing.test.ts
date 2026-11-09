import { describe, expect, it } from "vitest"
import { sessionRoute } from "../src/gui/routing.js"

interface FakeRpc {
  readonly label: string
}

interface FakeClient {
  readonly label: string
  rpc(definition: unknown): FakeRpc
}

function fakeClient(label: string): FakeClient {
  return { label, rpc: () => ({ label }) }
}

describe("sessionRoute", () => {
  it("reads the current session server client each time instead of caching", () => {
    let session = {
      directory: "/workspace-a",
      server: { id: "server-a", client: fakeClient("a") },
    }

    const first = sessionRoute(session)
    expect(first).toMatchObject({ directory: "/workspace-a", serverId: "server-a" })
    expect(first.client.rpc({})).toEqual({ label: "a" })

    session = {
      directory: "/workspace-b",
      server: { id: "server-b", client: fakeClient("b") },
    }

    const second = sessionRoute(session)
    expect(second.directory).toBe("/workspace-b")
    expect(second.serverId).toBe("server-b")
    expect(second.client).not.toBe(first.client)
    expect(second.client.rpc({})).toEqual({ label: "b" })
  })

  it("picks up a replaced client under the same server id", () => {
    let session = {
      directory: "/workspace",
      server: { id: "server-a", client: fakeClient("old") },
    }
    const before = sessionRoute(session)

    session = {
      directory: "/workspace",
      server: { id: "server-a", client: fakeClient("new") },
    }
    const after = sessionRoute(session)

    expect(after.client).not.toBe(before.client)
    expect(after.client.rpc({})).toEqual({ label: "new" })
  })
})
