import { describe, expect, it } from "vitest"
import {
  GRAPH_REFRESH_DEBOUNCE_MS,
  GraphChangeCoalescer,
  decideGraphChange,
  refsFingerprint,
  type GraphChangedEvent,
} from "../src/gui/graph-events.js"

function event(directory: string, repositoryId: string): GraphChangedEvent {
  return { location: { directory }, data: { repositoryId } }
}

describe("graphChanged filtering", () => {
  it("ignores another workspace even when the repository id matches", () => {
    expect(
      decideGraphChange(event("/workspace-b", "/repo"), "/workspace-a", "/repo"),
    ).toBe("ignore")
    expect(decideGraphChange(event("/workspace-a", "/repo"), "", "/repo")).toBe(
      "ignore",
    )
  })

  it("refreshes only the selected repository inside the current directory", () => {
    expect(
      decideGraphChange(event("/workspace-a", "/repo"), "/workspace-a", "/repo"),
    ).toBe("refresh-repository")
  })

  it("rechecks the repository list for a sibling repository", () => {
    expect(
      decideGraphChange(event("/workspace-a", "/other"), "/workspace-a", "/repo"),
    ).toBe("refresh-repositories")
    expect(
      decideGraphChange(event("/workspace-a", "/first"), "/workspace-a", undefined),
    ).toBe("refresh-repositories")
  })

  it("ignores a malformed payload", () => {
    expect(
      decideGraphChange(
        { location: { directory: "/workspace-a" }, data: {} } as GraphChangedEvent,
        "/workspace-a",
        "/repo",
      ),
    ).toBe("ignore")
  })
})

describe("graphChanged debounce", () => {
  it("uses a 300-500ms coalescing window", () => {
    expect(GRAPH_REFRESH_DEBOUNCE_MS).toBeGreaterThanOrEqual(300)
    expect(GRAPH_REFRESH_DEBOUNCE_MS).toBeLessThanOrEqual(500)
  })

  it("coalesces repeated events into one repository refresh", () => {
    const coalescer = new GraphChangeCoalescer()
    coalescer.push("refresh-repository")
    coalescer.push("refresh-repository")
    coalescer.push("refresh-repository")
    expect(coalescer.empty).toBe(false)
    expect(coalescer.take()).toEqual({ repository: true, repositories: false })
    expect(coalescer.empty).toBe(true)
    expect(coalescer.take()).toEqual({ repository: false, repositories: false })
  })

  it("keeps both scopes when a sibling and the selected repository change", () => {
    const coalescer = new GraphChangeCoalescer()
    coalescer.push("refresh-repositories")
    coalescer.push("refresh-repository")
    expect(coalescer.take()).toEqual({ repository: true, repositories: true })
  })

  it("ignores an explicit ignore scope", () => {
    const coalescer = new GraphChangeCoalescer()
    coalescer.push("ignore")
    expect(coalescer.take()).toEqual({ repository: false, repositories: false })
  })
})

describe("cached-state fingerprint", () => {
  it("is independent of ref order but notices a moved ref", () => {
    const main = { name: "main", hash: "a".repeat(40), kind: "branch" as const }
    const tag = { name: "v1", hash: "b".repeat(40), kind: "tag" as const }
    expect(refsFingerprint([main, tag])).toBe(refsFingerprint([tag, main]))
    expect(refsFingerprint([main, tag])).not.toBe(
      refsFingerprint([{ ...main, hash: "c".repeat(40) }, tag]),
    )
  })
})
