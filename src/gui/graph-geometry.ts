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
