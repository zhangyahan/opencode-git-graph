import type { GraphRow } from "../server/graph/layout.js"

/**
 * A point in row-relative coordinates.
 *
 * `y` is measured in row heights: 0 is the row's top edge, 0.5 the commit
 * node's centre, and 1 the row's bottom edge.
 */
export interface GraphPoint {
  readonly lane: number
  readonly y: 0 | 0.5 | 1
}

export type GraphLineKind = "incoming" | "through" | "outgoing"

export interface GraphLine {
  readonly kind: GraphLineKind
  readonly from: GraphPoint
  readonly to: GraphPoint
  readonly colour: number
}

/**
 * Fixed lane step. Narrowing the graph column never compresses the tracks:
 * anything beyond the column's right edge is clipped instead.
 */
export const LANE_SPACING = 14
/** Backwards-compatible alias for the fixed lane step. */
export const DEFAULT_LANE_SPACING = LANE_SPACING
/** Horizontal padding on each side of the lane field. */
export const DEFAULT_LANE_PADDING = 8
/**
 * The graph column is user-resizable (96..400px). Lanes keep their fixed
 * 14px step, and the container clips the overflow instead of scrolling.
 */
export const GRAPH_COLUMN_WIDTH = 240
export const GRAPH_COLUMN_MIN_WIDTH = 96
export const GRAPH_COLUMN_MAX_WIDTH = 400
export const DEFAULT_GRAPH_COLUMN_WIDTH = GRAPH_COLUMN_WIDTH

export interface GraphPathOptions {
  readonly laneSpacing: number
  readonly rowHeight: number
  readonly padding: number
}

/** Centre x for a lane. Lanes are never compressed below the configured step. */
export function graphLaneX(lane: number, laneSpacing: number, padding: number): number {
  return padding + lane * laneSpacing + laneSpacing / 2
}

/**
 * Lane step for the graph column.
 *
 * The step is always the fixed `LANE_SPACING` (14px). The column no longer
 * compresses tracks to fit: when `graphContentWidth` exceeds the column width,
 * the right-hand lanes are clipped by the row/graph container.
 */
export function graphLaneSpacing(): number {
  return LANE_SPACING
}

/** True when the lane field is wider than its column and the right side is clipped. */
export function isGraphClipped(contentWidth: number, columnWidth: number): boolean {
  if (!Number.isFinite(contentWidth) || !Number.isFinite(columnWidth)) return false
  return contentWidth > columnWidth
}

/**
 * Width of the full lane field: every lane at the fixed 14px step plus padding.
 * The panel renders each SVG at this width and lets the column clip the excess.
 */
export function graphContentWidth(lanes: number, laneSpacing: number, padding: number): number {
  const laneCount = Number.isFinite(lanes) ? Math.max(1, Math.ceil(lanes)) : 1
  const spacing = Number.isFinite(laneSpacing) ? Math.max(1, laneSpacing) : LANE_SPACING
  const edge = Number.isFinite(padding) ? Math.max(0, padding) : DEFAULT_LANE_PADDING
  return laneCount * spacing + edge * 2
}

export function clampGraphColumnWidth(width: number): number {
  if (!Number.isFinite(width)) return DEFAULT_GRAPH_COLUMN_WIDTH
  return Math.round(
    Math.min(GRAPH_COLUMN_MAX_WIDTH, Math.max(GRAPH_COLUMN_MIN_WIDTH, width)),
  )
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * SVG path for one graph segment. Vertical tracks are plain lines; lane changes
 * use a cubic Bezier whose control points sit halfway down the row, which
 * produces the soft fork/merge curves Git Graph shows.
 */
export function graphLinePath(line: GraphLine, options: GraphPathOptions): string {
  const spacing = Number.isFinite(options.laneSpacing)
    ? Math.max(1, options.laneSpacing)
    : DEFAULT_LANE_SPACING
  const rowHeight = Number.isFinite(options.rowHeight)
    ? Math.max(1, options.rowHeight)
    : 1
  const padding = Number.isFinite(options.padding) ? Math.max(0, options.padding) : 0

  const x1 = round(graphLaneX(line.from.lane, spacing, padding))
  const x2 = round(graphLaneX(line.to.lane, spacing, padding))
  const y1 = round(line.from.y * rowHeight)
  const y2 = round(line.to.y * rowHeight)

  if (x1 === x2) return `M ${x1} ${y1} L ${x2} ${y2}`
  const middleY = round((y1 + y2) / 2)
  return `M ${x1} ${y1} C ${x1} ${middleY}, ${x2} ${middleY}, ${x2} ${y2}`
}

/**
 * Geometry for one graph row.
 *
 * - Incoming edges end at the node centre (`0 → 0.5`).
 * - Edges leaving the commit start at the node centre (`0.5 → 1`).
 * - Tracks that merely pass through the row span the full row (`0 → 1`).
 *
 * The distinction matters for a tip/root commit whose lane is reused by its
 * parent: that is an *outgoing* edge and must not draw a line above the node.
 */
export function graphRowLines(row: GraphRow, previous: GraphRow | undefined): GraphLine[] {
  const lines: GraphLine[] = []

  if (previous) {
    for (const segment of previous.segments) {
      if (segment.to !== row.lane) continue
      lines.push({
        kind: "incoming",
        from: { lane: segment.to, y: 0 },
        to: { lane: segment.to, y: 0.5 },
        colour: segment.colour,
      })
    }
  }

  for (const segment of row.segments) {
    if (segment.from === row.lane) {
      lines.push({
        kind: "outgoing",
        from: { lane: segment.from, y: 0.5 },
        to: { lane: segment.to, y: 1 },
        colour: segment.colour,
      })
      continue
    }
    lines.push({
      kind: "through",
      from: { lane: segment.from, y: 0 },
      to: { lane: segment.to, y: 1 },
      colour: segment.colour,
    })
  }

  return lines
}
