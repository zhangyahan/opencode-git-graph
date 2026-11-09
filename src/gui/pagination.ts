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
