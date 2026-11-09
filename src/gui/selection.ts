import type { GitTarget } from "../shared/types.js"

export type FileSource = "index" | "working-tree" | "commit"

export interface FileSelection {
  readonly path: string
  readonly target: GitTarget
  readonly source: FileSource
}

/** Small, restorable record of one workspace's visible selection. */
export interface SelectionSnapshot {
  readonly repositoryId?: string
  readonly commitHash?: string
  readonly parentIndex?: number
  readonly filePath?: string
  readonly fileSource?: FileSource
}

/** Key a selection by both the server and the session directory. */
export function selectionKey(serverId: string, directory: string): string {
  return `${serverId}\n${directory}`
}

/**
 * Bounded least-recently-used cache for per-workspace selection snapshots.
 * Windows can visit many directories; only the most recent few are kept.
 */
export class BoundedSelectionCache<T> {
  readonly #maxEntries: number
  readonly #entries = new Map<string, T>()

  constructor(maxEntries = 16) {
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

  get size(): number {
    return this.#entries.size
  }

  clear(): void {
    this.#entries.clear()
  }
}

/**
 * Monotonic selection generation.
 *
 * A refresh captures `current()` before it starts. Any user selection made
 * while that refresh is in flight bumps the generation, so the refresh's
 * eventually-returned snapshot is stale and must not be restored over the
 * newer selection.
 */
export class SelectionGeneration {
  #value = 0

  current(): number {
    return this.#value
  }

  bump(): number {
    this.#value += 1
    return this.#value
  }

  isCurrent(token: number): boolean {
    return token === this.#value
  }
}
