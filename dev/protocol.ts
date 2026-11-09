/**
 * Shared constants for the dev-only UI harness.
 *
 * The harness is deliberately narrow: one loopback origin, one fixed
 * repository root and a small read-only RPC allowlist. Nothing here is used by
 * the production plugin bundle.
 */

/** Read-only RPC methods the harness bridge is allowed to expose. */
export const HARNESS_METHODS = [
  "ping",
  "listRepositories",
  "getStatus",
  "getLog",
  "getRefs",
  "getCommitFiles",
  "getDiff",
] as const

export type HarnessMethod = (typeof HARNESS_METHODS)[number]

export const HARNESS_METHOD_SET: ReadonlySet<string> = new Set(HARNESS_METHODS)

export const RPC_PATH_PREFIX = "/__gg/rpc/"

/** Request bodies above this size are rejected before parsing. */
export const MAX_BODY_BYTES = 64 * 1024

/** The only browser origin allowed to call the bridge. */
export const ALLOWED_ORIGIN = "http://127.0.0.1:5178"

/** The only Host header accepted by the bridge. */
export const ALLOWED_HOST = "127.0.0.1:5178"

/**
 * Fixed, read-only repository root for the harness. The bridge never accepts a
 * caller-supplied root and never accepts `repoPath` in RPC input.
 */
export const FR_ROOT = "D:\\Workspace\\FR"
