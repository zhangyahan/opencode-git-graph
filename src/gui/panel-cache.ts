import type {
  ChangedFile,
  GitCommit,
  GitRef,
  GitRepository,
  GitStatus,
} from "../shared/types.js"
import type { HistoryFilterState, HistoryOrder } from "./ref-utils.js"

/**
 * Per-directory panel state that should survive a tab switch.
 *
 * The panel can be unmounted when the user opens a file or switches tabs, and
 * the host does not restore DOM state. This snapshot is deliberately plain
 * JSON: it is cheap to clone, can be inspected in tests, and never borrows a
 * signal or a live DOM object. Column widths stay in their existing
 * localStorage preference and are not duplicated here.
 */
export interface PanelCacheSnapshot {
  readonly repositories: readonly GitRepository[]
  readonly selectedRepositoryId: string | null
  readonly status: GitStatus | null
  readonly commits: readonly GitCommit[]
  readonly hasMore: boolean
  readonly nextSkip: number
  readonly filters: HistoryFilterState
  readonly firstParent: boolean
  readonly historyOrder: HistoryOrder
  readonly refs: readonly GitRef[]
  readonly selectedCommitHash: string | null
  readonly selectedParentIndex: number
  readonly expandedDirectories: readonly string[]
  readonly commitFiles: readonly ChangedFile[]
  readonly commitFilesKey: string | null
  readonly uncommittedExpanded: boolean
  readonly collapsedGroups: readonly string[]
  readonly inlineView: "list" | "tree"
  readonly slotHeightOverrides: Readonly<Record<string, number>>
  readonly inlineInfoRatio: number
  readonly scrollTop: number
  readonly searchQuery: string
}

/** How many directories a window remembers. Older entries fall out first. */
export const PANEL_CACHE_LIMIT = 8

/** Key a panel snapshot by both server and directory, like `selectionKey`. */
export function panelCacheKey(serverId: string, directory: string): string {
  return `${serverId}\n${directory}`
}

/**
 * Identify the file list cached for one expanded commit. A parent switch
 * changes the list, so the parent index is part of the key.
 */
export function commitFilesKey(hash: string, parentIndex: number): string {
  return `${hash}\n${parentIndex}`
}

/**
 * Bounded least-recently-used map. `get` and overwriting a key both promote it
 * so the entries a user visits recently are the ones retained.
 */
export class BoundedPanelCache<T> {
  readonly #maxEntries: number
  readonly #entries = new Map<string, T>()

  constructor(maxEntries = PANEL_CACHE_LIMIT) {
    this.#maxEntries = Math.max(1, Math.trunc(maxEntries) || 1)
  }

  get(key: string): T | undefined {
    const value = this.#entries.get(key)
    if (value === undefined) return undefined
    this.#entries.delete(key)
    this.#entries.set(key, value)
    return value
  }

  set(key: string, value: T): void {
    if (this.#entries.has(key)) this.#entries.delete(key)
    this.#entries.set(key, value)
    while (this.#entries.size > this.#maxEntries) {
      const oldest = this.#entries.keys().next().value
      if (oldest === undefined) break
      this.#entries.delete(oldest)
    }
  }

  delete(key: string): boolean {
    return this.#entries.delete(key)
  }

  get size(): number {
    return this.#entries.size
  }

  clear(): void {
    this.#entries.clear()
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
}

function isFilters(value: unknown): value is HistoryFilterState {
  return (
    isRecord(value) &&
    isStringArray(value.refs) &&
    typeof value.showRemotes === "boolean" &&
    typeof value.showTags === "boolean"
  )
}

function isPanelCacheSnapshot(value: unknown): value is PanelCacheSnapshot {
  if (!isRecord(value)) return false
  return (
    Array.isArray(value.repositories) &&
    (value.selectedRepositoryId === null || typeof value.selectedRepositoryId === "string") &&
    (value.status === null || isRecord(value.status)) &&
    Array.isArray(value.commits) &&
    typeof value.hasMore === "boolean" &&
    typeof value.nextSkip === "number" &&
    isFilters(value.filters) &&
    typeof value.firstParent === "boolean" &&
    (value.historyOrder === "date" || value.historyOrder === "topo") &&
    Array.isArray(value.refs) &&
    (value.selectedCommitHash === null || typeof value.selectedCommitHash === "string") &&
    typeof value.selectedParentIndex === "number" &&
    isStringArray(value.expandedDirectories) &&
    Array.isArray(value.commitFiles) &&
    (value.commitFilesKey === null || typeof value.commitFilesKey === "string") &&
    typeof value.uncommittedExpanded === "boolean" &&
    isStringArray(value.collapsedGroups) &&
    (value.inlineView === "list" || value.inlineView === "tree") &&
    isRecord(value.slotHeightOverrides) &&
    Object.values(value.slotHeightOverrides).every((height) => typeof height === "number") &&
    typeof value.inlineInfoRatio === "number" &&
    typeof value.scrollTop === "number" &&
    typeof value.searchQuery === "string"
  )
}

/** Snapshot to JSON, for tests and for hosts that want their own side storage. */
export function serializePanelCache(snapshot: PanelCacheSnapshot): string {
  return JSON.stringify(snapshot)
}

/** Decode a previously serialized snapshot; malformed or older data is ignored. */
export function deserializePanelCache(
  text: string | null | undefined,
): PanelCacheSnapshot | undefined {
  if (!text) return undefined
  try {
    const parsed: unknown = JSON.parse(text)
    return isPanelCacheSnapshot(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}
