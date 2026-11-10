/**
 * Shared constants for the dev-only UI harness.
 *
 * The harness has two deliberately separated modes:
 *
 * - `fr` — the real FR repositories, strictly read-only.
 * - `mutation-fixture` — two throwaway repositories created by
 *   `dev/ui-test/create-mutation-fixture.mjs` under the approved TEMP tree.
 *
 * Nothing here is used by the production plugin bundle.
 */

/** Read-only RPC methods exposed in both harness modes. */
export const FR_READ_METHODS = [
  "ping",
  "listRepositories",
  "getStatus",
  "getLog",
  "getRefs",
  "getCommitFiles",
  "getCommitFileContent",
  "getDiff",
  "getComparisonFiles",
  "getComparisonDiff",
] as const

/** Write methods that are only available in mutation-fixture mode. */
export const MUTATION_METHODS = [
  "checkoutBranch",
  "createBranch",
  "createTag",
  "renameBranch",
  "deleteBranch",
  "deleteTag",
] as const

export const FR_READ_METHOD_SET: ReadonlySet<string> = new Set(FR_READ_METHODS)
export const MUTATION_METHOD_SET: ReadonlySet<string> = new Set(MUTATION_METHODS)

/** Every method name known to the harness; still filtered by mode. */
export const HARNESS_METHODS = [...FR_READ_METHODS, ...MUTATION_METHODS] as const

export type HarnessMethod = (typeof HARNESS_METHODS)[number]
export type UiMode = "fr" | "mutation-fixture"

/**
 * Values replaced by `dev/vite.config.ts`. Vite 7's built-in `define` only
 * rewrites client modules during a build, so the same config also installs a
 * small pre-transform fallback for the dev server.
 */
declare global {
  const __GG_UI_MODE__: UiMode
  const __GG_UI_DIRECTORY__: string
  const __GG_UI_PORT__: number
}

export const HARNESS_METHOD_SET: ReadonlySet<string> = new Set(HARNESS_METHODS)

export function methodsForMode(mode: UiMode): ReadonlySet<string> {
  return mode === "mutation-fixture"
    ? new Set([...FR_READ_METHODS, ...MUTATION_METHODS])
    : FR_READ_METHOD_SET
}

export const RPC_PATH_PREFIX = "/__gg/rpc/"

/** Request bodies above this size are rejected before parsing. */
export const MAX_BODY_BYTES = 64 * 1024

/** The only interface the harness ever binds. */
export const LOOPBACK_HOST = "127.0.0.1"

export const FR_PORT = 5178
export const MUTATION_PORT = 5179

/** The only browser origin allowed to call the harness (FR mode). */
export const ALLOWED_ORIGIN = `http://${LOOPBACK_HOST}:${FR_PORT}`

/** The only Host header accepted by the harness (FR mode). */
export const ALLOWED_HOST = `${LOOPBACK_HOST}:${FR_PORT}`

/**
 * Fixed, read-only repository root for FR mode. The bridge never accepts a
 * caller-supplied root and never accepts `repoPath` in RPC input.
 */
export const FR_ROOT = "D:\\Workspace\\FR"

/**
 * Approved TEMP subtree for mutation fixtures. The fixture script only creates
 * directories below this path and the bridge refuses any other root.
 */
export const FIXTURE_BASE = "C:\\Users\\yahan\\AppData\\Local\\Temp\\opencode\\gg-mutation-fixtures"

/** Parent of the fixed subtree; checked so the base itself cannot be redirected. */
export const FIXTURE_TEMP_PARENT = "C:\\Users\\yahan\\AppData\\Local\\Temp\\opencode"

export const FIXTURE_MARKER_NAME = ".gg-mutation-fixture.json"
export const FIXTURE_MARKER_KIND = "gg-mutation-fixture"
export const FIXTURE_MARKER_VERSION = 1

export function normalizeUiMode(value: string | undefined): UiMode {
  if (value === undefined || value.trim() === "" || value === "fr") return "fr"
  if (value === "mutation-fixture") return "mutation-fixture"
  throw new Error(
    `GG_UI_MODE must be "fr" or "mutation-fixture" (received ${JSON.stringify(value)})`,
  )
}

export function portForMode(mode: UiMode): number {
  return mode === "mutation-fixture" ? MUTATION_PORT : FR_PORT
}
