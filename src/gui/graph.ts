import type { GitCommit } from "../shared/types.js"
import { layoutGraph, type GraphRow } from "../server/graph/layout.js"
import { formatError } from "./errors.js"

export interface CommitGraph {
  readonly rows: GraphRow[]
  readonly error?: string
}

/**
 * The graph layout expects newest-to-oldest, topologically sorted input. The
 * RPC log is already in that order, but stale pages or a repository rewritten
 * during a session can still produce a layout error; surface it instead of
 * crashing the panel.
 */
export function buildCommitGraph(commits: readonly GitCommit[]): CommitGraph {
  try {
    return { rows: layoutGraph([...commits]) }
  } catch (error) {
    return { rows: [], error: formatError(error) }
  }
}
