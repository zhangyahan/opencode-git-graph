import type { GitCommit } from "../../shared/types.js"
import { git, GitError } from "./executor.js"
import { assertLogLimit, assertLogSkip } from "./validation.js"

const LOG_FORMAT = "%H%x00%P%x00%an%x00%aI%x00%s%x00%D"

export interface LogOptions {
  limit?: number
  skip?: number
  signal?: AbortSignal
}

export interface LogResult {
  commits: GitCommit[]
  hasMore: boolean
}

function parseDecoration(decoration: string): string[] {
  if (!decoration) return []
  return decoration
    .split(", ")
    .map((ref) => ref.trim())
    .filter((ref) => ref.length > 0)
    .map((ref) => (ref.startsWith("tag: ") ? ref.slice("tag: ".length) : ref))
}

/**
 * Read commits across all refs newest first, ordered by commit date.
 *
 * `--date-order` still guarantees that every parent is emitted after all of its
 * children, but it interleaves independent lines by commit timestamp instead of
 * grouping each branch. On merge-heavy histories `--topo-order` moves side
 * parents far behind the merge that introduced them, so a bounded window leaves
 * dozens of tracks open and the layout explodes into a colourful fence.
 *
 * The format is field-delimited by NUL and records are newline separated. `%s`
 * (subject) is a single line, so it is safe to split records on `\n`.
 *
 * `limit` must be an integer in 1..1000 and `skip` an integer in 0..10000000;
 * anything else is rejected instead of being silently coerced.
 */
export async function getLog(
  repoPath: string,
  { limit = 200, skip = 0, signal }: LogOptions = {},
): Promise<LogResult> {
  const safeLimit = assertLogLimit(limit)
  const safeSkip = assertLogSkip(skip)

  const output = await git(
    repoPath,
    [
      "-c",
      "log.showSignature=false",
      "log",
      "--no-color",
      "--all",
      "--date-order",
      "--parents",
      `--format=${LOG_FORMAT}`,
      "--skip",
      String(safeSkip),
      "-n",
      String(safeLimit + 1),
    ],
    { signal },
  ).catch((error: unknown) => {
    // Older git versions reject `log --all` in an unborn repository.
    if (
      error instanceof GitError &&
      /(does not have any commits yet|bad revision .*HEAD|unknown revision)/i.test(error.stderr)
    ) {
      return ""
    }
    throw error
  })

  const commits: GitCommit[] = []
  for (const line of output.split("\n")) {
    if (!line) continue
    const fields = line.split("\0")
    if (fields.length < 6) continue
    const [hash, parentsRaw, author, authorDate, subject, decoration] = fields
    commits.push({
      hash,
      parents: parentsRaw.split(/\s+/).filter((parent) => parent.length > 0),
      author,
      authorDate,
      subject,
      refs: parseDecoration(decoration),
    })
  }

  return {
    commits: commits.slice(0, safeLimit),
    hasMore: commits.length > safeLimit,
  }
}
