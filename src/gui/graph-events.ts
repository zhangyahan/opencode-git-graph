import type { GitRef } from "../shared/types.js"

/**
 * Payload the host delivers to the GUI for `GitGraphRpc.events.graphChanged`.
 * The host attaches the session location; the plugin only emits repositoryId
 * (and an optional change kind).
 */
export interface GraphChangedEvent {
  readonly location: { readonly directory: string }
  readonly data: {
    readonly repositoryId: string
    readonly kind?: "refs" | "worktree"
  }
}

/** Merge bursts of watcher events; one refresh is enough per quiet period. */
export const GRAPH_REFRESH_DEBOUNCE_MS = 400

export type GraphChangeScope =
  /** Another workspace or a malformed event. */
  | "ignore"
  /** The selected repository changed: silently refresh its status/log/refs. */
  | "refresh-repository"
  /** The directory changed but not the selected repository: a new repo may exist. */
  | "refresh-repositories"

/**
 * Decide what one watcher event should do. Directory equality is mandatory;
 * only the selected repository may trigger a history refresh. A different
 * repository in the same workspace only re-checks the repository list, so
 * unrelated work in a sibling repository cannot replace the visible history.
 */
export function decideGraphChange(
  event: GraphChangedEvent,
  currentDirectory: string,
  selectedRepositoryId: string | undefined,
): GraphChangeScope {
  if (!currentDirectory) return "ignore"
  if (event.location?.directory !== currentDirectory) return "ignore"
  if (typeof event.data?.repositoryId !== "string") return "ignore"
  if (selectedRepositoryId && event.data.repositoryId === selectedRepositoryId) {
    return "refresh-repository"
  }
  return "refresh-repositories"
}

export interface PendingGraphChanges {
  readonly repository: boolean
  readonly repositories: boolean
}

/** Coalesce the two event scopes until the debounce fires. */
export class GraphChangeCoalescer {
  #repository = false
  #repositories = false

  push(scope: GraphChangeScope): void {
    if (scope === "refresh-repository") this.#repository = true
    else if (scope === "refresh-repositories") this.#repositories = true
  }

  take(): PendingGraphChanges {
    const pending = {
      repository: this.#repository,
      repositories: this.#repositories,
    }
    this.clear()
    return pending
  }

  get empty(): boolean {
    return !this.#repository && !this.#repositories
  }

  clear(): void {
    this.#repository = false
    this.#repositories = false
  }
}

/**
 * Order-independent fingerprint of the typed refs. `getStatus().head` plus
 * this value tells the cached-state validator whether `getLog` is needed.
 */
export function refsFingerprint(refs: readonly GitRef[]): string {
  return refs
    .map((ref) => `${ref.kind}\u0000${ref.name}\u0000${ref.hash}`)
    .sort()
    .join("\n")
}
