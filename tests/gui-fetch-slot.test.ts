import { describe, expect, it } from "vitest"
import type { GitRef } from "../src/shared/types.js"
import {
  clampSlotHeight,
  defaultSlotHeight,
  SLOT_MAX_HEIGHT,
  SLOT_MIN_HEIGHT,
  slotHeightBounds,
} from "../src/gui/slot-size.js"
import {
  detectFetchRemoteSupport,
  remoteNamesFromRefs,
  rpcErrorReason,
} from "../src/gui/ref-utils.js"

describe("slot height bounds", () => {
  it("clamps the maximum to the viewport while never dropping below 96", () => {
    expect(slotHeightBounds(320)).toEqual({ min: 96, max: 240 })
    expect(slotHeightBounds(1_200)).toEqual({ min: 96, max: SLOT_MAX_HEIGHT })
    expect(slotHeightBounds(700)).toEqual({ min: 96, max: 560 })
    expect(slotHeightBounds(150)).toEqual({ min: 96, max: 96 })
    expect(slotHeightBounds(Number.NaN)).toEqual({ min: 96, max: 96 })
  })

  it("clamps drag heights into the current viewport bounds", () => {
    expect(clampSlotHeight(10, 1_000)).toBe(SLOT_MIN_HEIGHT)
    expect(clampSlotHeight(9_999, 1_000)).toBe(SLOT_MAX_HEIGHT)
    expect(clampSlotHeight(999, 320)).toBe(240)
    expect(clampSlotHeight(200.4, 1_000)).toBe(200)
    expect(clampSlotHeight(Number.NaN, 1_000)).toBe(SLOT_MIN_HEIGHT)
  })

  it("derives a default height from rows, capped for internal scrolling", () => {
    expect(defaultSlotHeight(0, 1_000)).toBe(96)
    expect(defaultSlotHeight(2, 1_000)).toBe(96)
    expect(defaultSlotHeight(10, 1_000)).toBe(250)
    expect(defaultSlotHeight(100, 1_000)).toBe(260)
    expect(defaultSlotHeight(100, 320)).toBe(240)
    expect(defaultSlotHeight(100, 150)).toBe(96)
  })
})

describe("fetch helpers", () => {
  const refs: GitRef[] = [
    { name: "origin/main", hash: "a".repeat(40), kind: "remote" },
    { name: "origin/dev", hash: "b".repeat(40), kind: "remote" },
    { name: "upstream/main", hash: "c".repeat(40), kind: "remote" },
    { name: "main", hash: "d".repeat(40), kind: "branch" },
  ]

  it("lists unique remote names from remote-tracking refs", () => {
    expect(remoteNamesFromRefs(refs)).toEqual(["origin", "upstream"])
    expect(remoteNamesFromRefs([])).toEqual([])
  })

  it("detects the fetchRemote method at runtime or in the definition", () => {
    expect(detectFetchRemoteSupport({ fetchRemote: async () => ({}) })).toBe(true)
    expect(
      detectFetchRemoteSupport({}, { methods: { fetchRemote: { input: {} } } }),
    ).toBe(true)
    expect(detectFetchRemoteSupport({})).toBe(false)
    expect(detectFetchRemoteSupport(undefined)).toBe(false)
  })

  it("extracts the server reason from nested and direct errors", () => {
    expect(rpcErrorReason({ data: { reason: "head_mismatch" } })).toBe(
      "head_mismatch",
    )
    expect(rpcErrorReason({ reason: "fetch_timeout" })).toBe("fetch_timeout")
    expect(rpcErrorReason({ data: {} })).toBeUndefined()
    expect(rpcErrorReason("nope")).toBeUndefined()
  })
})
