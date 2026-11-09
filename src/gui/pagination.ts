/**
 * Append a page of commits while de-duplicating by hash.
 *
 * Commit objects from the existing page are kept as-is, so a selected commit
 * object stays referentially stable across "Load more".
 */
export function mergeCommits<T extends { readonly hash: string }>(
  existing: readonly T[],
  incoming: readonly T[],
): T[] {
  const seen = new Set(existing.map((commit) => commit.hash))
  const merged = [...existing]

  for (const commit of incoming) {
    if (seen.has(commit.hash)) continue
    seen.add(commit.hash)
    merged.push(commit)
  }

  return merged
}

/* ---------- automatic "load more" while scrolling ---------- */

/** Distance from the bottom, in commit rows, that arms automatic loading. */
export const AUTO_LOAD_THRESHOLD_ROWS = 3

/**
 * Small, serialisable guard state for automatic pagination.
 *
 * One automatic request is allowed per "bottom visit": `attempted` is set when
 * it starts and only cleared once the viewport has left the bottom zone (or the
 * user retries). This is what stops an under-filled first screen from pulling
 * the whole repository in a `while` loop. `failed` locks a failed automatic
 * attempt until re-armed, and `stalled` stops automatic loading after a page
 * appended nothing (duplicate or empty page).
 */
export interface AutoLoadState {
  readonly attempted: boolean
  readonly failed: boolean
  readonly stalled: boolean
}

export const INITIAL_AUTO_LOAD_STATE: AutoLoadState = Object.freeze({
  attempted: false,
  failed: false,
  stalled: false,
})

export interface AutoLoadContext {
  readonly state: AutoLoadState
  readonly nearBottom: boolean
  readonly hasMore: boolean
  readonly busy: boolean
  readonly loadingMore: boolean
  readonly graphError: boolean
  readonly historyActive: boolean
}

/** Whether the current viewport is allowed to trigger one automatic page. */
export function shouldAutoLoad(context: AutoLoadContext): boolean {
  return (
    context.nearBottom &&
    context.hasMore &&
    !context.busy &&
    !context.loadingMore &&
    !context.graphError &&
    context.historyActive &&
    !context.state.attempted &&
    !context.state.failed &&
    !context.state.stalled
  )
}

/** Mark that an automatic request is now in flight for this bottom visit. */
export function beginAutoLoad(state: AutoLoadState): AutoLoadState {
  if (state.attempted) return state
  return { ...state, attempted: true }
}

export interface AutoLoadPageOutcome {
  /** Number of genuinely new commits appended by the page. */
  readonly added: number
  readonly failed: boolean
  /** A newer request/reset superseded this one; do not overwrite newer state. */
  readonly cancelled: boolean
}

/**
 * Apply the response of an automatic page.
 *
 * A cancelled page leaves the state untouched: the request that superseded it
 * owns the guard now. A failed page locks automatic loading until re-armed. A
 * page that added no commits marks the guard as stalled, so neither a duplicate
 * page nor an empty page can spin the automatic loader.
 */
export function completeAutoLoad(
  state: AutoLoadState,
  outcome: AutoLoadPageOutcome,
): AutoLoadState {
  if (outcome.cancelled) return state
  return {
    attempted: true,
    failed: outcome.failed,
    stalled: !outcome.failed && outcome.added <= 0,
  }
}

/**
 * Re-arm automatic loading after the viewport left the bottom zone or the user
 * explicitly retried. Manual "Load more" is unaffected by this guard.
 */
export function rearmAutoLoad(state: AutoLoadState): AutoLoadState {
  if (!state.attempted && !state.failed && !state.stalled) return state
  return INITIAL_AUTO_LOAD_STATE
}

export interface NearBottomInput {
  readonly scrollTop: number
  readonly viewportHeight: number
  readonly contentHeight: number
  /** Trigger distance in pixels. */
  readonly threshold: number
}

/** The three measurements automatic loading depends on. */
export interface ScrollMetrics {
  readonly scrollTop: number
  readonly viewportHeight: number
  readonly contentHeight: number
}

/** Structural subset of a scroll container (a real element satisfies this). */
export interface ScrollViewportLike {
  readonly scrollTop: number
  readonly clientHeight: number
  readonly scrollHeight: number
}

/**
 * Prefer live scroll-container measurements over signals that can lag behind
 * the host.
 *
 * Desktop hosts can mount the panel in a background Review tab where
 * `ResizeObserver` callbacks are frozen; the `viewportHeight` signal then keeps
 * its default while the real element already has its final size. Reading
 * `clientHeight`/`scrollHeight` at the moment automatic loading is evaluated
 * avoids depending on that delivery order. Each field falls back independently
 * so a detached or zero-sized element cannot disable loading.
 */
export function resolveScrollMetrics(
  viewport: ScrollViewportLike | null | undefined,
  fallback: { readonly scrollTop: number; readonly viewportHeight: number; readonly contentHeight: number },
): ScrollMetrics {
  const scrollTop =
    viewport && Number.isFinite(viewport.scrollTop)
      ? Math.max(0, viewport.scrollTop)
      : Math.max(0, finite(fallback.scrollTop, 0))
  const viewportHeight =
    viewport && Number.isFinite(viewport.clientHeight) && viewport.clientHeight > 0
      ? viewport.clientHeight
      : Math.max(0, finite(fallback.viewportHeight, 0))
  const contentHeight =
    viewport && Number.isFinite(viewport.scrollHeight) && viewport.scrollHeight > 0
      ? Math.max(viewport.scrollHeight, Math.max(0, finite(fallback.contentHeight, 0)))
      : Math.max(0, finite(fallback.contentHeight, 0))
  return { scrollTop, viewportHeight, contentHeight }
}

/**
 * Whether the viewport is within `threshold` pixels of the end of the content.
 * All measurements are sanitised; content shorter than the viewport counts as
 * near the bottom so a single supplement can still happen.
 */
export function isNearBottom(input: NearBottomInput): boolean {
  const scrollTop = Math.max(0, finite(input.scrollTop, 0))
  const viewport = Math.max(0, finite(input.viewportHeight, 0))
  const content = Math.max(0, finite(input.contentHeight, 0))
  const threshold = Math.max(0, finite(input.threshold, 0))
  return content - (scrollTop + viewport) <= threshold
}

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback
}
