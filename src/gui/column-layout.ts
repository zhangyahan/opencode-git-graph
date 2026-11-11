/**
 * Resizable history column layout.
 *
 * This module is deliberately UI-free: it only turns a panel width plus the
 * persisted column preferences into widths and the single CSS grid template the
 * sticky header and every history row must share.
 *
 * Layout contract
 * ---------------
 * - The graph column is user-resizable in 96..400px. Its width still
 *   participates in the same budget shrink; lanes keep a fixed step and the
 *   column clips the right-hand overflow, so no graph horizontal scroll is ever
 *   needed.
 * - The description column is the flexible column: it always takes whatever
 *   width is left after the fixed columns.
 * - Date/author visibility is still decided by `historyColumns()` (the existing
 *   responsive policy). If the remaining budget cannot keep the description
 *   readable, author is dropped first, then date.
 * - After visibility, the effective fixed widths are shrunk into the panel
 *   budget (widest column first) while keeping every column at its hard
 *   minimum. The shrink only affects the resolved layout; stored preferences
 *   stay intact so widening the panel restores them.
 * - When even the smallest visible set cannot fit (graph 96 + commit 56 +
 *   description 120 = 272px with date/author hidden), `satisfied` is false and
 *   `minimumWidth` reports the hard floor. Nothing is allowed to become
 *   negative, and no column is silently dropped beyond date/author.
 */

import {
  DEFAULT_GRAPH_COLUMN_WIDTH,
  GRAPH_COLUMN_MAX_WIDTH,
  GRAPH_COLUMN_MIN_WIDTH,
} from "./graph-geometry.js"
import { historyColumns } from "./history-columns.js"

export const COLUMN_IDS = [
  "graph",
  "description",
  "date",
  "author",
  "commit",
] as const

export type ColumnId = (typeof COLUMN_IDS)[number]

/** Hard lower bounds for every column. The graph has an application-owned width. */
export const COLUMN_MIN_WIDTHS: Readonly<Record<ColumnId, number>> = Object.freeze({
  graph: GRAPH_COLUMN_MIN_WIDTH,
  description: 120,
  date: 128,
  author: 80,
  commit: 56,
})

/** The width each column keeps in the global preference store. */
export interface ColumnPreferences {
  readonly graph: number
  readonly description: number
  readonly date: number
  readonly author: number
  readonly commit: number
}

/** Defaults: graph owned by the app, date wide enough for the 16-character stamp. */
export const DEFAULT_COLUMN_PREFERENCES: ColumnPreferences = Object.freeze({
  graph: DEFAULT_GRAPH_COLUMN_WIDTH,
  description: 660,
  date: 150,
  author: 118,
  commit: 74,
})

export const COLUMN_PREFERENCES_STORAGE_KEY =
  "opencode-git-graph.column-preferences"

/**
 * Minimal storage surface. Both members are optional so tests and the panel can
 * inject a read-only, write-only or throwing object without a real
 * `localStorage`. `window.localStorage` satisfies this structurally.
 */
export interface ColumnPreferenceStorage {
  getItem?(key: string): string | null
  setItem?(key: string, value: string): void
}

export interface ResolvedColumnLayout {
  /** Visible columns in render order. */
  readonly visible: readonly ColumnId[]
  /** Convenience lookup for callers that only need a boolean. */
  readonly visibility: Readonly<Record<ColumnId, boolean>>
  /** Resolved pixel widths. Hidden date/author still show their stored width. */
  readonly widths: Readonly<Record<ColumnId, number>>
  /** The one grid template shared by the header and every row. */
  readonly gridTemplate: string
  /** Smallest panel width that still honours the description minimum. */
  readonly minimumWidth: number
  /** False only when the panel is narrower than `minimumWidth`. */
  readonly satisfied: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function validWidth(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return fallback
  }
  return value
}

function clampWidth(
  value: number,
  minimum: number,
  maximum: number = Number.POSITIVE_INFINITY,
): number {
  return Math.round(Math.min(maximum, Math.max(minimum, value)))
}

function normalizePanelWidth(width: number): number {
  return Number.isFinite(width) && width > 0 ? Math.round(width) : 0
}

/**
 * Shrink fixed columns to `maximumTotal` while staying at or above their hard
 * minimums. The widest column gives way first (water-filling), so an oversized
 * stored preference does not squeeze the columns the user deliberately kept
 * small. When the target cannot be met the hard minimums are returned.
 */
function shrinkFixedWidths(
  widths: readonly number[],
  minimums: readonly number[],
  maximumTotal: number,
): number[] {
  const total = widths.reduce((sum, width) => sum + width, 0)
  if (total <= maximumTotal) return widths.slice()

  const minimumTotal = minimums.reduce((sum, width) => sum + width, 0)
  if (maximumTotal <= minimumTotal) return minimums.slice()

  // Largest cap whose capped sum still fits. Result widths are
  // max(minimum, min(storedWidth, cap)).
  let low = 0
  let high = 0
  for (const width of widths) {
    if (width > high) high = width
  }
  let cap = 0
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    let cappedTotal = 0
    for (let index = 0; index < widths.length; index += 1) {
      cappedTotal += Math.max(
        minimums[index]!,
        Math.min(widths[index]!, middle),
      )
    }
    if (cappedTotal <= maximumTotal) {
      cap = middle
      low = middle + 1
    } else {
      high = middle - 1
    }
  }

  const result = widths.map((width, index) =>
    Math.max(minimums[index]!, Math.min(width, cap)),
  )

  // Capping is integer-based; hand any remaining pixels back to the columns
  // that were actually capped so the fixed track sums to the budget exactly.
  let leftover =
    maximumTotal - result.reduce((sum, width) => sum + width, 0)
  for (let index = 0; index < result.length && leftover > 0; index += 1) {
    if (widths[index]! > cap) {
      result[index] = result[index]! + 1
      leftover -= 1
    }
  }

  return result
}

/**
 * Validate arbitrary persisted data into a complete preference object.
 * Non-finite, negative, zero and non-numeric widths fall back to their default;
 * finite widths are clamped into each column's supported range.
 */
export function normalizeColumnPreferences(value: unknown): ColumnPreferences {
  const source = isRecord(value) ? value : {}
  return {
    graph: clampWidth(
      validWidth(source.graph, DEFAULT_COLUMN_PREFERENCES.graph),
      GRAPH_COLUMN_MIN_WIDTH,
      GRAPH_COLUMN_MAX_WIDTH,
    ),
    description: clampWidth(
      validWidth(source.description, DEFAULT_COLUMN_PREFERENCES.description),
      COLUMN_MIN_WIDTHS.description,
    ),
    date: clampWidth(
      validWidth(source.date, DEFAULT_COLUMN_PREFERENCES.date),
      COLUMN_MIN_WIDTHS.date,
    ),
    author: clampWidth(
      validWidth(source.author, DEFAULT_COLUMN_PREFERENCES.author),
      COLUMN_MIN_WIDTHS.author,
    ),
    commit: clampWidth(
      validWidth(source.commit, DEFAULT_COLUMN_PREFERENCES.commit),
      COLUMN_MIN_WIDTHS.commit,
    ),
  }
}

/**
 * Resolve the actual layout for one panel width.
 *
 * Date/author visibility follows `historyColumns()` and the existing budget
 * rule (drop author, then date). After that, the remaining fixed columns are
 * shrunk into the panel budget, keeping description at least 120px and every
 * column at its hard minimum. Shrinking is only applied to the *effective*
 * widths; the caller's stored preferences are left untouched so widening the
 * panel restores the earlier layout.
 *
 * `satisfied` is false only when the panel is narrower than the hard minimum of
 * the visible set (graph 96 + commit 56 + description 120 = 272 when date and
 * author are hidden).
 */
export function resolveColumnLayout(
  panelWidth: number,
  preferences: ColumnPreferences = DEFAULT_COLUMN_PREFERENCES,
): ResolvedColumnLayout {
  const width = normalizePanelWidth(panelWidth)
  const prefs = normalizeColumnPreferences(preferences)

  const dateWidth = prefs.date
  const authorWidth = prefs.author

  const threshold = historyColumns(width)
  let date = threshold.date
  let author = threshold.author

  // Visibility still uses the stored preferences: an oversized date/author is
  // hidden before graph/description are squeezed.
  if (author) {
    const required =
      prefs.graph +
      dateWidth +
      authorWidth +
      prefs.commit +
      COLUMN_MIN_WIDTHS.description
    if (width < required) author = false
  }
  if (date) {
    const required =
      prefs.graph + dateWidth + prefs.commit + COLUMN_MIN_WIDTHS.description
    if (width < required) date = false
  }
  // Author is never shown when its leading date column is gone.
  if (!date) author = false

  const visibility: Record<ColumnId, boolean> = {
    graph: true,
    description: true,
    date,
    author,
    commit: true,
  }

  const visible: ColumnId[] = ["graph", "description"]
  if (date) visible.push("date")
  if (author) visible.push("author")
  visible.push("commit")

  const fixedIds: ColumnId[] = ["graph"]
  if (date) fixedIds.push("date")
  if (author) fixedIds.push("author")
  fixedIds.push("commit")

  const storedWidths = fixedIds.map((id) => prefs[id])
  const fixedMinimums = fixedIds.map((id) => COLUMN_MIN_WIDTHS[id])
  const fixedMinimumTotal = fixedMinimums.reduce(
    (sum, minimum) => sum + minimum,
    0,
  )
  const availableForFixed = width - COLUMN_MIN_WIDTHS.description
  const satisfied = availableForFixed >= fixedMinimumTotal
  const effectiveFixed = satisfied
    ? shrinkFixedWidths(storedWidths, fixedMinimums, availableForFixed)
    : fixedMinimums.slice()

  const effectiveById = new Map<ColumnId, number>()
  for (let index = 0; index < fixedIds.length; index += 1) {
    effectiveById.set(fixedIds[index]!, effectiveFixed[index]!)
  }

  const graph = effectiveById.get("graph")!
  const commit = effectiveById.get("commit")!
  const effectiveDate = date ? effectiveById.get("date")! : dateWidth
  const effectiveAuthor = author
    ? effectiveById.get("author")!
    : authorWidth
  const fixedTotal = effectiveFixed.reduce((sum, column) => sum + column, 0)
  const description = Math.max(COLUMN_MIN_WIDTHS.description, width - fixedTotal)
  const minimumWidth = fixedMinimumTotal + COLUMN_MIN_WIDTHS.description

  const templateParts = [
    `${graph}px`,
    `minmax(${COLUMN_MIN_WIDTHS.description}px, 1fr)`,
  ]
  if (date) templateParts.push(`${effectiveDate}px`)
  if (author) templateParts.push(`${effectiveAuthor}px`)
  templateParts.push(`${commit}px`)

  return {
    visible,
    visibility,
    widths: {
      graph,
      description,
      date: effectiveDate,
      author: effectiveAuthor,
      commit,
    },
    gridTemplate: templateParts.join(" "),
    minimumWidth,
    satisfied,
  }
}

/**
 * Apply one drag step.
 *
 * `delta` is the pointer movement in CSS pixels and positive always means
 * "make this column wider":
 * - graph/date/author/commit grow by `delta` and the description absorbs the
 *   difference.
 * - description grows by `delta` by shrinking its right-hand neighbour
 *   (date when visible, otherwise commit), then the description is recomputed.
 *
 * Drag maths uses the *effective* widths returned by `resolveColumnLayout`, not
 * the raw stored preference, so a layout that was budget-shrunk behaves
 * normally. Only the column the user is dragging (and, for a description drag,
 * its right neighbour) gets a new stored width; other stored preferences are
 * preserved so a later wide panel restores them.
 *
 * The returned object is new; the input preferences are never mutated.
 */
export function resizeColumnPreferences(
  preferences: ColumnPreferences,
  column: ColumnId,
  delta: number,
  panelWidth: number,
): ColumnPreferences {
  const base = normalizeColumnPreferences(preferences)
  const width = normalizePanelWidth(panelWidth)
  if (!Number.isFinite(delta) || delta === 0) {
    return { ...base }
  }

  const layout = resolveColumnLayout(width, base)
  const next: Record<ColumnId, number> = {
    graph: base.graph,
    description: base.description,
    date: base.date,
    author: base.author,
    commit: base.commit,
  }
  const descriptionMinimum = COLUMN_MIN_WIDTHS.description

  if (column === "description") {
    const neighbour: ColumnId = layout.visibility.date ? "date" : "commit"
    const neighbourMinimum = COLUMN_MIN_WIDTHS[neighbour]
    const currentNeighbour = layout.widths[neighbour]

    let nextNeighbour = currentNeighbour - delta
    nextNeighbour = Math.max(neighbourMinimum, nextNeighbour)
    if (delta < 0) {
      // Shrinking description grows the neighbour; never eat into the 120px
      // description floor.
      const shrinkable = Math.max(
        0,
        layout.widths.description - descriptionMinimum,
      )
      nextNeighbour = Math.min(nextNeighbour, currentNeighbour + shrinkable)
    }
    next[neighbour] = Math.round(nextNeighbour)
  } else {
    const minimum = COLUMN_MIN_WIDTHS[column]
    const maximum =
      column === "graph" ? GRAPH_COLUMN_MAX_WIDTH : Number.POSITIVE_INFINITY
    const current = layout.widths[column]
    const visible = layout.visibility[column]

    let nextWidth = Math.min(maximum, Math.max(minimum, current + delta))
    if (visible && delta > 0) {
      // Do not store a width that would need another visible fixed column to
      // go below its hard minimum on this panel.
      const otherMinimums = layout.visible.reduce(
        (sum, id) =>
          id === "description" || id === column
            ? sum
            : sum + COLUMN_MIN_WIDTHS[id],
        0,
      )
      const budgetedMaximum =
        width - descriptionMinimum - otherMinimums
      nextWidth = Math.min(
        nextWidth,
        Math.max(minimum, budgetedMaximum),
      )
    }
    next[column] = Math.round(nextWidth)
  }

  const resolved = resolveColumnLayout(width, next)
  next.description = resolved.widths.description
  return next
}

function defaultStorage(): ColumnPreferenceStorage | undefined {
  try {
    const candidate = (
      globalThis as {
        localStorage?: ColumnPreferenceStorage | null
      }
    ).localStorage
    return candidate ?? undefined
  } catch {
    // Accessing localStorage can throw in sandboxed/permission-restricted hosts.
    return undefined
  }
}

/**
 * Read the global preferences. Missing storage, invalid JSON, a throwing
 * getItem and invalid fields all degrade to safe defaults/widths.
 */
export function readColumnPreferences(
  storage?: ColumnPreferenceStorage | null,
): ColumnPreferences {
  const fallback = (): ColumnPreferences => ({ ...DEFAULT_COLUMN_PREFERENCES })
  try {
    const target = storage === undefined ? defaultStorage() : storage
    if (!target || typeof target.getItem !== "function") return fallback()

    const raw = target.getItem(COLUMN_PREFERENCES_STORAGE_KEY)
    if (typeof raw !== "string" || raw.length === 0) return fallback()

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return fallback()
    }
    return normalizeColumnPreferences(parsed)
  } catch {
    return fallback()
  }
}

/**
 * Persist the global preferences. Returns false instead of throwing when there
 * is no usable storage or setItem fails.
 */
export function writeColumnPreferences(
  preferences: ColumnPreferences,
  storage?: ColumnPreferenceStorage | null,
): boolean {
  try {
    const target = storage === undefined ? defaultStorage() : storage
    if (!target || typeof target.setItem !== "function") return false
    target.setItem(
      COLUMN_PREFERENCES_STORAGE_KEY,
      JSON.stringify(normalizeColumnPreferences(preferences)),
    )
    return true
  } catch {
    return false
  }
}
