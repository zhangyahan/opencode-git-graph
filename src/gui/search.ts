import type { GitCommit } from "../shared/types.js"

/**
 * Search across the commits that have already been loaded into the panel.
 *
 * This is deliberately *not* a server-side filter: the RPC log has no query
 * parameter and the UI must not imply that older commits were searched. The
 * caller keeps every row visible and only highlights matches.
 */
export function commitMatches(commit: GitCommit, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (needle.length === 0) return true
  return (
    commit.subject.toLowerCase().includes(needle) ||
    commit.hash.toLowerCase().includes(needle) ||
    commit.author.toLowerCase().includes(needle) ||
    commit.refs.some((ref) => ref.toLowerCase().includes(needle))
  )
}

/**
 * Hashes of loaded commits matching `query`, or `null` when the query is empty
 * (meaning "no search active"). Hash uniqueness lets callers use the result as
 * a set without touching the row list or its virtual-DOM identity.
 */
export function searchMatches(
  commits: readonly GitCommit[],
  query: string,
): Set<string> | null {
  const needle = query.trim()
  if (needle.length === 0) return null
  const matches = new Set<string>()
  for (const commit of commits) {
    if (commitMatches(commit, needle)) matches.add(commit.hash)
  }
  return matches
}
