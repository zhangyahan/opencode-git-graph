import type { ChangedFile, FileDiff } from "../../shared/types.js"
import { git, GitError, type GitSignalOptions } from "./executor.js"
import { GitInputError, assertCommitOid, assertRelativeFilePath } from "./validation.js"

/** Options accepted by the comparison helpers (cancellation only). */
export interface ComparisonOptions {
  signal?: AbortSignal
}

type DiffStatus = ChangedFile["status"]

/** Compare two commits without touching the index or the working tree. */
const DIFF_SAFETY_ARGS = ["--no-color", "--no-ext-diff", "--no-textconv"]

function mapNameStatusLetter(letter: string): DiffStatus | null {
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
      return "modified"
    default:
      return null
  }
}

/** Prevent git from interpreting wildcard characters in a caller path. */
function literalPathspec(filePath: string): string {
  return `:(literal)${filePath}`
}

function isBinaryText(text: string): boolean {
  // Git's binary marker is a standalone line, e.g. "Binary files a/x and b/x differ".
  return /^Binary files .* differ$/m.test(text)
}

interface ResolvedComparison {
  /** Full oid of the base commit. */
  base: string
  /** Full oid of the head commit. */
  head: string
}

/**
 * Validate an oid and resolve it to the full commit oid it names.
 *
 * Only 4..64 hexadecimal characters are accepted (see `assertCommitOid`), and
 * `rev-parse --verify --end-of-options <oid>^{commit}` must confirm the object
 * is a commit (annotated tags are peeled, trees/blobs are rejected). The
 * explicit `--end-of-options` keeps the argument from ever being parsed as an
 * option.
 */
async function resolveCommitOid(
  repoPath: string,
  hash: string,
  options: GitSignalOptions,
): Promise<string> {
  const oid = assertCommitOid(hash)
  try {
    const resolved = (
      await git(
        repoPath,
        ["rev-parse", "--verify", "--end-of-options", `${oid}^{commit}`],
        options,
      )
    ).trim()
    if (!resolved) {
      throw new GitInputError(
        `Invalid commit oid ${JSON.stringify(hash)}: does not resolve to a commit`,
      )
    }
    return resolved
  } catch (error) {
    if (error instanceof GitInputError) throw error
    if (error instanceof GitError) {
      // Preserve cancellation instead of reporting it as bad input.
      if (options.signal?.aborted) throw error
      throw new GitInputError(
        `Invalid commit oid ${JSON.stringify(hash)}: does not resolve to a commit in this repository`,
      )
    }
    throw error
  }
}

async function resolveComparison(
  repoPath: string,
  baseHash: string,
  headHash: string,
  options: GitSignalOptions,
): Promise<ResolvedComparison> {
  const [base, head] = await Promise.all([
    resolveCommitOid(repoPath, baseHash, options),
    resolveCommitOid(repoPath, headHash, options),
  ])
  return { base, head }
}

/**
 * Parse `git diff --name-status -z` output.
 *
 * Records are NUL separated. In `-z` mode rename/copy records are emitted as
 * `<status>\0<old-path>\0<new-path>\0`, so `oldPath` is carried on the entry.
 * Comparison entries are commit-to-commit, so `staged` mirrors the commit diff
 * convention (`true`) even though the index is not involved.
 */
function parseComparisonNameStatus(output: string): ChangedFile[] {
  const tokens = output.split("\0")
  const files: ChangedFile[] = []

  for (let i = 0; i < tokens.length; i++) {
    const statusToken = tokens[i]
    if (!statusToken) continue
    const letter = statusToken[0]
    const status = mapNameStatusLetter(letter)
    if (!status) continue

    if (letter === "R" || letter === "C") {
      // `-z` name-status emits: <status>\0<old-path>\0<new-path>\0
      const oldPath = tokens[++i]
      const newPath = tokens[++i]
      if (newPath === undefined) continue
      files.push({ path: newPath, oldPath, status, staged: true })
    } else {
      const filePath = tokens[++i]
      if (filePath === undefined) continue
      files.push({ path: filePath, status, staged: true })
    }
  }

  return files
}

async function readComparisonFiles(
  repoPath: string,
  comparison: ResolvedComparison,
  options: GitSignalOptions,
): Promise<ChangedFile[]> {
  const output = await git(
    repoPath,
    [
      "diff",
      ...DIFF_SAFETY_ARGS,
      "--name-status",
      "-z",
      "-M",
      comparison.base,
      comparison.head,
      "--",
    ],
    options,
  )
  return parseComparisonNameStatus(output)
}

/**
 * List the files that differ between two commits.
 *
 * Both oids must name commits. The comparison is a pure `git diff base head`
 * over commit trees: neither the index nor the working tree is read, and
 * renames are detected with `-M`. Comparing a commit with itself yields `[]`;
 * a root commit is compared as an ordinary commit (its tree is used, not the
 * empty tree placeholder).
 */
export async function getComparisonFiles(
  repoPath: string,
  baseHash: string,
  headHash: string,
  options: ComparisonOptions = {},
): Promise<ChangedFile[]> {
  const comparison = await resolveComparison(repoPath, baseHash, headHash, options)
  return readComparisonFiles(repoPath, comparison, options)
}

/**
 * Produce the unified diff of a single path between two commits.
 *
 * `path` is the head-side (new) path of an entry returned by
 * {@link getComparisonFiles}; paths outside that comparison are rejected as
 * invalid input. Renames are diffed with both the old and new literal
 * pathspecs and the returned {@link FileDiff} carries `oldPath`. No blob text
 * is synthesized: binary files report `binary: true` and keep git's marker
 * text.
 */
export async function getComparisonDiff(
  repoPath: string,
  baseHash: string,
  headHash: string,
  filePath: string,
  options: ComparisonOptions = {},
): Promise<FileDiff> {
  const relativePath = assertRelativeFilePath(filePath)
  const comparison = await resolveComparison(repoPath, baseHash, headHash, options)
  const files = await readComparisonFiles(repoPath, comparison, options)
  const entry = files.find((file) => file.path === relativePath)
  if (!entry) {
    throw new GitInputError(
      `Invalid comparison path ${JSON.stringify(relativePath)}: not part of this comparison`,
    )
  }

  const paths = entry.oldPath ? [entry.oldPath, relativePath] : [relativePath]
  const text = await git(
    repoPath,
    [
      "diff",
      ...DIFF_SAFETY_ARGS,
      "-M",
      comparison.base,
      comparison.head,
      "--",
      ...paths.map(literalPathspec),
    ],
    options,
  )

  return {
    path: relativePath,
    status: entry.status,
    ...(entry.oldPath ? { oldPath: entry.oldPath } : {}),
    text,
    binary: isBinaryText(text),
  }
}
