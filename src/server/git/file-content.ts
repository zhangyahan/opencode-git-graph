import type { CommitFileContent } from "../../shared/types.js"
import { git, GitError, type GitSignalOptions } from "./executor.js"
import { GitInputError, assertCommitOid, assertRelativeFilePath } from "./validation.js"

/** Maximum blob bytes returned as text (larger blobs are truncated). */
const MAX_CONTENT_BYTES = 1024 * 1024
/**
 * The git executor's default stdout buffer (20 MiB, see `executor.ts`). A blob
 * larger than this cannot be read with `cat-file blob` without failing the
 * whole request, so it is reported by size only.
 */
const MAX_READABLE_BLOB_BYTES = 20 * 1024 * 1024
/** Prefix length inspected for a NUL byte when guessing binary (same as diff.ts). */
const BINARY_SNIFF_BYTES = 8_000

/** Prevent git from interpreting wildcard characters in a caller path. */
function literalPathspec(filePath: string): string {
  return `:(literal)${filePath}`
}

interface TreeEntry {
  mode: string
  type: string
  oid: string
  path: string
}

/** Parse the first record of `git ls-tree -z` output (`<mode> <type> <oid>\t<path>`). */
function parseTreeEntry(output: string): TreeEntry | null {
  const token = output.split("\0")[0]
  if (!token) return null
  const tab = token.indexOf("\t")
  if (tab < 0) return null
  const [mode, type, oid] = token.slice(0, tab).split(" ")
  const path = token.slice(tab + 1)
  if (!mode || !type || !oid) return null
  return { mode, type, oid, path }
}

/**
 * Truncate UTF-8 text to at most MAX_CONTENT_BYTES without splitting a code
 * point (which would produce U+FFFD). Backtracking is at most 3 bytes.
 */
function truncateText(text: string): string {
  const bytes = Buffer.from(text, "utf8")
  if (bytes.length <= MAX_CONTENT_BYTES) return text
  let end = MAX_CONTENT_BYTES
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--
  return bytes.subarray(0, end).toString("utf8")
}

function limitText(text: string, size: number): { text: string; truncated: boolean } {
  if (size <= MAX_CONTENT_BYTES) return { text, truncated: false }
  return { text: truncateText(text), truncated: true }
}

/**
 * Validate an oid and resolve it to a commit, matching `compare.ts`.
 *
 * Trees, blobs, missing objects and ambiguous abbreviations all become
 * `GitInputError` so the RPC layer reports `invalid_input`, not `git_failed`.
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

async function readBlobSize(
  repoPath: string,
  oid: string,
  options: GitSignalOptions,
): Promise<number> {
  const size = Number((await git(repoPath, ["cat-file", "-s", oid], options)).trim())
  if (!Number.isSafeInteger(size) || size < 0) {
    throw new Error(`Invalid blob size for ${oid}`)
  }
  return size
}

/**
 * Read the full content of one path in a commit tree.
 *
 * The commit is resolved to the object its id names; no parent, index or
 * working-tree state participates. `git ls-tree` with a literal pathspec
 * confirms the entry type and mode before anything is read:
 *
 * - regular files (`100644`/`100755`) are read as text or reported as binary
 *   after an 8,000-byte NUL sniff (matches `diff.ts`);
 * - symlinks (`120000`) return the stored link target, never the target file;
 * - gitlinks/submodules (`160000`) have no blob in this tree and are reported
 *   as `kind: "missing"` so no submodule repository is entered;
 * - an absent path (or a directory) is invalid input.
 *
 * Text larger than 1 MiB is truncated and flagged with `truncated: true`.
 * Binary content returns `text: null` plus the byte size.
 *
 * Blobs larger than the executor's 20 MiB stdout buffer are not read at all.
 * Regular files return `kind: "text"`, `text: null`, the known `size` and
 * `truncated: true`; the kind cannot be sniffed without reading, so it is not
 * claimed to be binary. Symlinks keep `kind: "symlink"` with the same null/
 * size/truncated shape. Callers should treat `text: null` plus `truncated` as
 * "size-only, content omitted".
 */
export async function getCommitFileContent(
  repoPath: string,
  hash: string,
  filePath: string,
  options: GitSignalOptions = {},
): Promise<CommitFileContent> {
  const oid = await resolveCommitOid(repoPath, hash, options)
  const relativePath = assertRelativeFilePath(filePath)

  const entry = parseTreeEntry(
    await git(
      repoPath,
      ["ls-tree", "-z", oid, "--", literalPathspec(relativePath)],
      options,
    ),
  )
  if (!entry || entry.path !== relativePath) {
    throw new GitInputError(
      `Path ${JSON.stringify(relativePath)} does not exist in commit ${JSON.stringify(oid)}`,
    )
  }
  if (entry.type === "tree") {
    throw new GitInputError(`Path ${JSON.stringify(relativePath)} is not a file`)
  }
  if (entry.type === "commit" || entry.mode === "160000") {
    // A gitlink points at another repository's commit; this commit tree has no
    // file content for it, and entering the submodule is out of scope.
    return {
      path: relativePath,
      mode: entry.mode,
      kind: "missing",
      text: null,
      size: null,
    }
  }
  if (entry.type !== "blob") {
    throw new GitInputError(`Path ${JSON.stringify(relativePath)} is not a blob`)
  }

  const size = await readBlobSize(repoPath, entry.oid, options)

  if (entry.mode === "120000") {
    if (size > MAX_READABLE_BLOB_BYTES) {
      // Keep the symlink kind even when the target is too large to read.
      return {
        path: relativePath,
        mode: entry.mode,
        kind: "symlink",
        text: null,
        size,
        truncated: true,
      }
    }
    const blob = await git(repoPath, ["cat-file", "blob", entry.oid], options)
    const limited = limitText(blob, size)
    return {
      path: relativePath,
      mode: entry.mode,
      kind: "symlink",
      text: limited.text,
      size,
      ...(limited.truncated ? { truncated: true } : {}),
    }
  }

  if (size > MAX_READABLE_BLOB_BYTES) {
    // Do not start a read that would exceed the executor buffer and fail the
    // whole request. Binary/text cannot be sniffed without reading, so report
    // the neutral "text, content omitted" shape documented above.
    return {
      path: relativePath,
      mode: entry.mode,
      kind: "text",
      text: null,
      size,
      truncated: true,
    }
  }
  const blob = await git(repoPath, ["cat-file", "blob", entry.oid], options)

  if (Buffer.from(blob, "utf8").subarray(0, BINARY_SNIFF_BYTES).includes(0)) {
    return {
      path: relativePath,
      mode: entry.mode,
      kind: "binary",
      text: null,
      size,
    }
  }

  const limited = limitText(blob, size)
  return {
    path: relativePath,
    mode: entry.mode,
    kind: "text",
    text: limited.text,
    size,
    ...(limited.truncated ? { truncated: true } : {}),
  }
}
