import path from "node:path"
import type { ChangeCounts, ChangedFile, GitStatus } from "../../shared/types.js"
import { git, type GitSignalOptions } from "./executor.js"
import { filterOverrideArgs } from "./safety.js"

const UNMERGED = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"])

type StatusLetter = "added" | "modified" | "deleted" | "renamed" | "copied"

function mapStatusLetter(letter: string): StatusLetter | null {
  switch (letter) {
    case "A":
      return "added"
    case "M":
      return "modified"
    case "D":
      return "deleted"
    case "R":
      return "renamed"
    case "C":
      return "copied"
    case "T":
      // Type change (e.g. file <-> symlink <-> gitlink) is reported as modified.
      return "modified"
    default:
      return null
  }
}

/**
 * Parse `git status --porcelain=v1 -z --untracked-files=all` output.
 *
 * Records are NUL separated. In `-z` mode rename/copy records are emitted as
 * `XY <new-path>\0<old-path>\0`, so the token following a rename/copy record is
 * the original path.
 */
export function parsePorcelainV1(buffer: string): ChangedFile[] {
  const tokens = buffer.split("\0")
  const files: ChangedFile[] = []

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (!token) continue

    // Each record looks like "XY <path>"; the two status columns are followed
    // by a single space separator.
    const x = token[0] ?? " "
    const y = token[1] ?? " "
    const filePath = token.slice(3)

    if (x === "?" && y === "?") {
      files.push({ path: filePath, status: "untracked", staged: false })
      continue
    }
    if (x === "!" && y === "!") {
      // Ignored files are not requested by design; skip defensively.
      continue
    }

    const code = `${x}${y}`
    if (UNMERGED.has(code)) {
      files.push({ path: filePath, status: "conflicted", staged: false })
      continue
    }

    let oldPath: string | undefined
    if (x === "R" || x === "C" || y === "R" || y === "C") {
      const next = tokens[i + 1]
      if (next !== undefined) {
        oldPath = next
        i++
      }
    }

    if (x !== " ") {
      const status = mapStatusLetter(x)
      if (status) {
        files.push(oldPath ? { path: filePath, oldPath, status, staged: true } : { path: filePath, status, staged: true })
      }
    }
    if (y !== " ") {
      const status = mapStatusLetter(y)
      if (status) {
        files.push(oldPath ? { path: filePath, oldPath, status, staged: false } : { path: filePath, status, staged: false })
      }
    }
  }

  return files
}

/** Aggregate per-file entries into the counts shown in the repository list. */
export function countChanges(files: ChangedFile[]): ChangeCounts {
  const counts: ChangeCounts = { staged: 0, unstaged: 0, untracked: 0, conflicted: 0 }
  for (const file of files) {
    if (file.status === "conflicted") counts.conflicted++
    else if (file.status === "untracked") counts.untracked++
    else if (file.staged) counts.staged++
    else counts.unstaged++
  }
  return counts
}

/**
 * Normalize a working-tree path into the repository identifier used across the
 * plugin: absolute path with a lowercased drive letter on win32.
 */
export function normalizeRepositoryId(repoPath: string): string {
  const resolved = path.resolve(repoPath)
  if (process.platform === "win32") {
    return resolved.replace(/^([a-zA-Z]):/, (_match, drive: string) => `${drive.toLowerCase()}:`)
  }
  return resolved
}

async function readHead(
  repoPath: string,
  options: GitSignalOptions = {},
): Promise<{ branch: string | null; head: string | null; detached: boolean }> {
  let branch: string | null = null
  try {
    const short = (
      await git(repoPath, ["symbolic-ref", "--quiet", "--short", "HEAD"], options)
    ).trim()
    branch = short || null
  } catch {
    branch = null
  }

  let head: string | null = null
  try {
    const hash = (await git(repoPath, ["rev-parse", "HEAD"], options)).trim()
    head = hash || null
  } catch {
    head = null
  }

  // An unborn HEAD (empty repository) has a symbolic ref but no commit; expose
  // it as "no branch, no head, not detached" so callers can render an empty
  // repository consistently.
  if (head === null) {
    return { branch: null, head: null, detached: false }
  }

  return { branch, head, detached: branch === null }
}

/** Read the working-tree status for a repository. */
export async function getStatus(
  repoPath: string,
  options: GitSignalOptions = {},
): Promise<GitStatus> {
  const filterArgs = await filterOverrideArgs(repoPath, options)
  const [porcelain, headInfo] = await Promise.all([
    git(
      repoPath,
      [
        ...filterArgs,
        "status",
        "--porcelain=v1",
        "-z",
        "--untracked-files=all",
      ],
      options,
    ),
    readHead(repoPath, options),
  ])

  const files = parsePorcelainV1(porcelain)
  return {
    repositoryId: normalizeRepositoryId(repoPath),
    branch: headInfo.branch,
    head: headInfo.head,
    detached: headInfo.detached,
    files,
    counts: countChanges(files),
  }
}
