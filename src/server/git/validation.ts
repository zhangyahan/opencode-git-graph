import { lstat, readlink, realpath } from "node:fs/promises"
import path from "node:path"

/** Maximum number of commits a single `getLog` page may request. */
export const MAX_LOG_LIMIT = 1_000
/** Maximum offset accepted by `getLog` (keeps `--skip` bounded). */
export const MAX_LOG_SKIP = 10_000_000

/**
 * Raised when a caller-supplied value (commit oid, path, pagination option)
 * would be unsafe or meaningless to pass to git.
 */
export class GitInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "GitInputError"
  }
}

/** Full or abbreviated hex object id, never an option or revision expression. */
const COMMIT_OID = /^[0-9a-fA-F]{4,64}$/

/**
 * Validate a commit object id.
 *
 * Only hexadecimal ids (4..64 characters) are accepted. Everything that could
 * be interpreted by git as an option (`--output=...`) or as a revision
 * expression (`HEAD`, `main~1`, `:/message`) is rejected before it reaches git.
 */
export function assertCommitOid(hash: unknown): string {
  if (typeof hash !== "string" || !COMMIT_OID.test(hash)) {
    throw new GitInputError(
      `Invalid commit oid ${JSON.stringify(hash)}: expected 4-64 hexadecimal characters`,
    )
  }
  return hash
}

/** Validate a parent index; the default (0) is applied when undefined. */
export function assertParentIndex(parentIndex: unknown): number {
  const index = parentIndex === undefined ? 0 : parentIndex
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0) {
    throw new GitInputError(
      `Invalid parent index ${JSON.stringify(parentIndex)}: expected a non-negative integer`,
    )
  }
  return index
}

/**
 * Reject an out-of-range parent index instead of silently falling back to the
 * first parent. A root commit (no parents) still allows index 0 so it can be
 * diffed against the empty tree.
 */
export function assertParentIndexInRange(index: number, parentCount: number): number {
  const max = parentCount === 0 ? 0 : parentCount - 1
  if (index > max) {
    throw new GitInputError(
      parentCount === 0
        ? `Parent index ${index} is out of range for a root commit (only index 0 is valid)`
        : `Parent index ${index} is out of range: commit has ${parentCount} parent(s)`,
    )
  }
  return index
}

/** Validate `getLog`'s limit: a positive, finite integer up to {@link MAX_LOG_LIMIT}. */
export function assertLogLimit(limit: unknown): number {
  if (
    typeof limit !== "number" ||
    !Number.isFinite(limit) ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > MAX_LOG_LIMIT
  ) {
    throw new GitInputError(
      `Invalid log limit ${JSON.stringify(limit)}: expected an integer between 1 and ${MAX_LOG_LIMIT}`,
    )
  }
  return limit
}

/** Validate `getLog`'s skip offset: a non-negative integer up to {@link MAX_LOG_SKIP}. */
export function assertLogSkip(skip: unknown): number {
  if (
    typeof skip !== "number" ||
    !Number.isFinite(skip) ||
    !Number.isInteger(skip) ||
    skip < 0 ||
    skip > MAX_LOG_SKIP
  ) {
    throw new GitInputError(
      `Invalid log skip ${JSON.stringify(skip)}: expected an integer between 0 and ${MAX_LOG_SKIP}`,
    )
  }
  return skip
}

function normalizeSeparators(value: string): string {
  return value.replace(/\\/g, "/")
}

/**
 * Validate a repository-relative file path and return it with `/` separators.
 *
 * Rejects empty paths, NUL bytes, absolute paths (POSIX, Windows drive and UNC)
 * and any `..` segment that could escape the repository root.
 */
export function assertRelativeFilePath(filePath: unknown): string {
  if (typeof filePath !== "string" || filePath.length === 0) {
    throw new GitInputError("Invalid file path: expected a non-empty relative path")
  }
  if (filePath.includes("\0")) {
    throw new GitInputError(`Invalid file path ${JSON.stringify(filePath)}: NUL bytes are not allowed`)
  }

  const normalized = normalizeSeparators(filePath)
  if (path.isAbsolute(filePath) || normalized.startsWith("/")) {
    throw new GitInputError(`Invalid file path ${JSON.stringify(filePath)}: absolute paths are not allowed`)
  }
  if (/^[A-Za-z]:/.test(normalized)) {
    throw new GitInputError(`Invalid file path ${JSON.stringify(filePath)}: drive paths are not allowed`)
  }
  if (normalized.startsWith("//")) {
    throw new GitInputError(`Invalid file path ${JSON.stringify(filePath)}: UNC paths are not allowed`)
  }
  if (normalized.split("/").includes("..")) {
    throw new GitInputError(`Invalid file path ${JSON.stringify(filePath)}: parent traversal is not allowed`)
  }

  return normalized
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  )
}

export interface ResolvedRepositoryPath {
  absolutePath: string
  kind: "file" | "symlink"
  /** Link text when `kind === "symlink"` (never the target's content). */
  linkTarget?: string
}

/**
 * Resolve a repository-relative path to a safe absolute path.
 *
 * The repository root and the path's parent directory are canonicalized with
 * `realpath`, so a symlinked parent directory cannot redirect reads outside the
 * repository. A final symlink is not followed: its link text is returned
 * instead, matching git's symlink blob semantics.
 */
export async function resolveRepositoryPath(
  repoRoot: string,
  filePath: unknown,
): Promise<ResolvedRepositoryPath> {
  const relative = assertRelativeFilePath(filePath)
  const root = await realpath(repoRoot)
  const candidate = path.resolve(root, relative)

  if (!isInside(root, candidate)) {
    throw new GitInputError(`Invalid file path ${JSON.stringify(relative)}: escapes the repository root`)
  }

  const parent = path.dirname(candidate)
  let realParent: string
  try {
    realParent = await realpath(parent)
  } catch {
    throw new GitInputError(`Invalid file path ${JSON.stringify(relative)}: parent does not exist`)
  }
  if (!isInside(root, realParent)) {
    throw new GitInputError(
      `Invalid file path ${JSON.stringify(relative)}: parent resolves outside the repository`,
    )
  }

  const stats = await lstat(candidate)
  if (stats.isSymbolicLink()) {
    return { absolutePath: candidate, kind: "symlink", linkTarget: await readlink(candidate) }
  }
  if (!stats.isFile()) {
    throw new GitInputError(`Invalid file path ${JSON.stringify(relative)}: not a regular file`)
  }

  const realCandidate = await realpath(candidate)
  if (!isInside(root, realCandidate)) {
    throw new GitInputError(`Invalid file path ${JSON.stringify(relative)}: resolves outside the repository`)
  }
  return { absolutePath: realCandidate, kind: "file" }
}
