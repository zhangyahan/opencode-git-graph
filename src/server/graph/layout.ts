/**
 * Pure Git commit topology layout engine.
 *
 * The engine is an independent, dependency-free implementation of a
 * newest-to-oldest, lane-oriented DAG layout. It does not derive from the
 * mhutchie/vscode-git-graph sources.
 *
 * Input is ordered **newest to oldest**: row `i` describes `commits[i]`, and a
 * known parent must appear on a later row (an older commit). Unknown parents
 * (outside the current window/page) are allowed; their lanes are kept alive
 * until the bottom of the window.
 *
 * Each row carries the line segments that cross the gap between row `i` and
 * row `i + 1`. The last row therefore has no segments. A segment is a numeric
 * lane transition plus a stable colour; multiple segments may share the same
 * `from` or `to` lane (forks, merges and pass-through tracks).
 *
 * Complexity: O(n + E + S), where `E` is the total number of parent edges and
 * `S` is the number of emitted segments. `S` is the actual output size (for a
 * window with `L` concurrent lanes it is O(n * L)); no hidden quadratic work
 * beyond the segments that are returned.
 */

export interface LayoutCommit {
  hash: string
  parents: string[]
  refs: string[]
}

export interface GraphSegment {
  /** Lane on row `i` (the row that owns this segment). */
  from: number
  /** Lane on row `i + 1`. */
  to: number
  /** Stable lane colour. Colours are reused once their lane is released. */
  colour: number
}

export interface GraphRow {
  commit: LayoutCommit
  /** Lane occupied by the commit node itself. */
  lane: number
  /** Colour of the commit node (same as its lane track). */
  colour: number
  /** Segments crossing from this row to the next row (empty on the last row). */
  segments: GraphSegment[]
  /** Number of lane slots needed to render this row (max lane id + 1). */
  lanes: number
}

export function layoutGraph(commits: LayoutCommit[]): GraphRow[] {
  const rowCount = commits.length

  const rowOf = new Map<string, number>()
  for (let i = 0; i < rowCount; i += 1) {
    const { hash } = commits[i]
    if (rowOf.has(hash)) {
      throw new Error(`[layoutGraph] duplicate commit hash "${hash}" at row ${i}`)
    }
    rowOf.set(hash, i)
  }

  // Validate every parent that is inside the window. Newest-first input means
  // a known parent must live on a strictly later row.
  for (let i = 0; i < rowCount; i += 1) {
    for (const parent of commits[i].parents) {
      const parentRow = rowOf.get(parent)
      if (parentRow !== undefined && parentRow <= i) {
        throw new Error(
          `[layoutGraph] input is not topologically sorted newest-first: ` +
            `commit "${commits[i].hash}" at row ${i} has parent "${parent}" at row ${parentRow}`,
        )
      }
    }
  }

  /**
   * Active target tracks. Each lane waits for at most one commit hash; each
   * hash is targeted by at most one lane so a merge can always join an
   * existing track instead of creating a duplicate.
   */
  const laneOfTarget = new Map<string, number>()
  const targetOfLane: Array<string | undefined> = []

  /** Lanes that no longer carry a target, reused LIFO to keep ids compact. */
  const freeLanes: number[] = []
  let nextLane = 0

  const allocateLane = (): number => {
    const reused = freeLanes.pop()
    if (reused !== undefined) return reused
    const lane = nextLane
    nextLane += 1
    return lane
  }

  const rows: GraphRow[] = new Array(rowCount)

  for (let i = 0; i < rowCount; i += 1) {
    const commit = commits[i]
    const { parents } = commit

    // Consume the track that was waiting for this commit, or open a new track
    // for a branch tip / disconnected root.
    let lane = laneOfTarget.get(commit.hash)
    if (lane !== undefined) {
      laneOfTarget.delete(commit.hash)
      targetOfLane[lane] = undefined
    } else {
      lane = allocateLane()
    }
    // Lanes are allocated compactly, so the lane id doubles as a stable,
    // reusable colour. A lane keeps that colour for its whole lifetime.
    const colour = lane

    // Tracks that pass straight through this row. The node's lane was already
    // consumed above, so none of these can be the node itself.
    const throughLanes: number[] = []
    for (const throughLane of laneOfTarget.values()) {
      throughLanes.push(throughLane)
    }

    // Aim each parent edge at a parent track. Rules, in order:
    //  - an already-active parent target wins, which keeps merges connected
    //    and avoids duplicate lanes for the same commit;
    //  - the first parent that is not already represented reuses the node's
    //    own lane when it is free;
    //  - anything else gets a free/new lane.
    const parentLanes: number[] = []
    let nodeLaneReused = false
    for (let p = 0; p < parents.length; p += 1) {
      const parent = parents[p]
      let parentLane = laneOfTarget.get(parent)
      if (parentLane !== undefined) {
        parentLanes.push(parentLane)
        continue
      }

      if (!nodeLaneReused && targetOfLane[lane] === undefined) {
        parentLane = lane
      } else {
        parentLane = allocateLane()
      }

      targetOfLane[parentLane] = parent
      laneOfTarget.set(parent, parentLane)
      parentLanes.push(parentLane)
      if (parentLane === lane) nodeLaneReused = true
    }

    // The node lane ends here when no parent continues on it (root, or all
    // parents were already represented by other tracks).
    if (!nodeLaneReused) {
      freeLanes.push(lane)
    }

    const segments: GraphSegment[] = []
    if (i < rowCount - 1) {
      // Tracks that only pass through this row stay vertical.
      for (const throughLane of throughLanes) {
        segments.push({ from: throughLane, to: throughLane, colour: throughLane })
      }
      // One outgoing segment per parent edge. Multiple edges may leave the
      // same node lane, and several may join the same target lane.
      for (const parentLane of parentLanes) {
        segments.push({ from: lane, to: parentLane, colour: parentLane })
      }
    }

    let maxLane = lane
    for (const throughLane of throughLanes) {
      if (throughLane > maxLane) maxLane = throughLane
    }
    for (const parentLane of parentLanes) {
      if (parentLane > maxLane) maxLane = parentLane
    }
    for (const activeLane of laneOfTarget.values()) {
      if (activeLane > maxLane) maxLane = activeLane
    }

    rows[i] = {
      commit,
      lane,
      colour,
      segments,
      lanes: maxLane + 1,
    }
  }

  return rows
}
