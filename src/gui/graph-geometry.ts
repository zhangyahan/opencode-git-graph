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

/** Default lane step. Git Graph keeps tracks readable instead of shrinking them. */
export const DEFAULT_LANE_SPACING = 14
/** Horizontal padding on each side of the lane field. */
export const DEFAULT_LANE_PADDING = 8
export const GRAPH_COLUMN_MIN_WIDTH = 96
export const GRAPH_COLUMN_MAX_WIDTH = 260
export const DEFAULT_GRAPH_COLUMN_WIDTH = 152

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
 * Width of the scrollable lane field. The graph column itself stays narrow and
 * clips this field, so wide histories get a local horizontal viewport instead
 * of pushing the commit text off screen.
 */
export function graphContentWidth(lanes: number, laneSpacing: number, padding: number): number {
  const laneCount = Number.isFinite(lanes) ? Math.max(1, Math.ceil(lanes)) : 1
  const spacing = Number.isFinite(laneSpacing) ? Math.max(1, laneSpacing) : DEFAULT_LANE_SPACING
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
