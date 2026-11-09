import { open } from "node:fs/promises"
import type { ChangedFile, FileDiff, GitTarget } from "../../shared/types.js"
import { git, type GitSignalOptions } from "./executor.js"
import { filterOverrideArgs } from "./safety.js"
import {
  assertCommitOid,
  assertParentIndex,
  assertParentIndexInRange,
  assertRelativeFilePath,
  resolveRepositoryPath,
} from "./validation.js"

/** Well-known hash of git's empty tree object. */
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"
/** Maximum bytes of file content embedded in a synthetic diff. */
const MAX_TEXT_BYTES = 1024 * 1024
/** Number of leading bytes inspected for a NUL byte when guessing binary. */
const BINARY_SNIFF_BYTES = 8_000

type DiffStatus = ChangedFile["status"]

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

async function getParents(
  repoPath: string,
  hash: string,
  options: GitSignalOptions = {},
): Promise<string[]> {
  const output = await git(repoPath, ["rev-list", "--parents", "-n", "1", hash], options)
  const firstLine = output.split("\n")[0] ?? ""
  const parts = firstLine.trim().split(/\s+/).filter((part) => part.length > 0)
  return parts.slice(1)
}

interface CommitContext {
  oid: string
  parentIndex: number
  parents: string[]
  /** Commit or empty-tree object the diff should be taken against. */
  base: string
}

async function resolveCommitContext(
  repoPath: string,
  hash: string,
  parentIndex: number | undefined,
  options: GitSignalOptions,
): Promise<CommitContext> {
  const oid = assertCommitOid(hash)
  const index = assertParentIndex(parentIndex)
  const parents = await getParents(repoPath, oid, options)
  assertParentIndexInRange(index, parents.length)
  return {
    oid,
    parentIndex: index,
    parents,
    base: parents.length === 0 ? EMPTY_TREE : parents[index],
  }
}

function parseNameStatus(output: string): ChangedFile[] {
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

async function readCommitFiles(
  repoPath: string,
  context: CommitContext,
  options: GitSignalOptions,
): Promise<ChangedFile[]> {
  const args =
    context.parents.length === 0
      ? [
          "diff-tree",
          "--root",
          "--no-commit-id",
          "--name-status",
          "-r",
          "-z",
          "-M",
          "--no-color",
          "--no-ext-diff",
          "--no-textconv",
          context.oid,
        ]
      : [
          "diff-tree",
          "--no-commit-id",
          "--name-status",
          "-r",
          "-z",
          "-M",
          "--no-color",
          "--no-ext-diff",
          "--no-textconv",
          context.parents[context.parentIndex],
          context.oid,
        ]

  return parseNameStatus(await git(repoPath, args, options))
}

/** List staged changes. Comparing tree/index never applies worktree filters. */
async function readStagedFiles(
  repoPath: string,
  filterArgs: string[],
  options: GitSignalOptions = {},
): Promise<ChangedFile[]> {
  const output = await git(
    repoPath,
    [
      ...filterArgs,
      "diff",
      "--cached",
      "--name-status",
      "-z",
      "-M",
      "--no-color",
      "--no-ext-diff",
      "--no-textconv",
    ],
    options,
  )
  return parseNameStatus(output)
}

/** List the files changed by a commit, relative to its chosen parent. */
export async function getCommitFiles(
  repoPath: string,
  hash: string,
  parentIndex = 0,
  options: GitSignalOptions = {},
): Promise<ChangedFile[]> {
  const context = await resolveCommitContext(repoPath, hash, parentIndex, options)
  return readCommitFiles(repoPath, context, options)
}

function inferStatus(text: string, fallback: DiffStatus = "modified"): DiffStatus {
  if (/^new file mode /m.test(text)) return "added"
  if (/^deleted file mode /m.test(text)) return "deleted"
  if (/^rename from /m.test(text)) return "renamed"
  if (/^copy from /m.test(text)) return "copied"
  return fallback
}

function isBinaryText(text: string): boolean {
  // Git's binary marker is a standalone line, e.g. "Binary files a/x and b/x differ".
  return /^Binary files .* differ$/m.test(text)
}

async function isUntracked(
  repoPath: string,
  filePath: string,
  options: GitSignalOptions = {},
): Promise<boolean> {
  const output = await git(
    repoPath,
    ["ls-files", "--others", "--exclude-standard", "-z", "--", literalPathspec(filePath)],
    options,
  )
  return output.split("\0").some((entry) => entry.length > 0)
}

async function isInHead(
  repoPath: string,
  filePath: string,
  options: GitSignalOptions = {},
): Promise<boolean> {
  try {
    const output = await git(
      repoPath,
      ["ls-tree", "-z", "--name-only", "HEAD", "--", literalPathspec(filePath)],
      options,
    )
    return output.split("\0").some((entry) => entry.length > 0)
  } catch {
    // Unborn HEAD (empty repository) or other failure: treat as absent.
    return false
  }
}

async function readFileLimited(file: string): Promise<{ data: Buffer; truncated: boolean }> {
  const handle = await open(file, "r")
  try {
    const stats = await handle.stat()
    const length = Math.min(stats.size, MAX_TEXT_BYTES)
    const data = Buffer.alloc(length)
    if (length > 0) await handle.read(data, 0, length, 0)
    return { data, truncated: stats.size > MAX_TEXT_BYTES }
  } finally {
    await handle.close()
  }
}

function buildNewFileDiff(filePath: string, content: string, mode = "100644"): string {
  const lines = content.split("\n")
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop()

  const header = [
    `diff --git a/${filePath} b/${filePath}`,
    `new file mode ${mode}`,
    "--- /dev/null",
    `+++ b/${filePath}`,
  ]
  if (lines.length === 0) return `${header.join("\n")}\n`

  const body = [`@@ -0,0 +1,${lines.length} @@`, ...lines.map((line) => `+${line}`)]
  return `${[...header, ...body].join("\n")}\n`
}

/** Build a synthetic "new file" diff for content not tracked by git's diff. */
async function buildSyntheticDiff(
  repoPath: string,
  filePath: string,
  status: DiffStatus,
  source: "working-tree" | "index",
  options: GitSignalOptions = {},
): Promise<FileDiff> {
  if (source === "working-tree") {
    const resolved = await resolveRepositoryPath(repoPath, filePath)
    if (resolved.kind === "symlink") {
      // Never follow the link: show the link text git would store as a blob.
      return {
        path: filePath,
        status,
        text: buildNewFileDiff(filePath, resolved.linkTarget ?? "", "120000"),
        binary: false,
      }
    }

    const { data, truncated } = await readFileLimited(resolved.absolutePath)
    if (data.subarray(0, BINARY_SNIFF_BYTES).includes(0)) {
      return { path: filePath, status, text: "", binary: true, truncated: truncated || undefined }
    }
    return {
      path: filePath,
      status,
      text: buildNewFileDiff(filePath, data.toString("utf8")),
      binary: false,
      truncated: truncated || undefined,
    }
  }

  const blob = await git(repoPath, ["cat-file", "-p", `:${filePath}`], options)
  if (blob.includes("\0")) {
    return { path: filePath, status, text: "", binary: true }
  }
  return { path: filePath, status, text: buildNewFileDiff(filePath, blob), binary: false }
}

function pathspecsFor(entry: ChangedFile | undefined, filePath: string): string[] {
  const paths = entry?.oldPath ? [entry.oldPath, filePath] : [filePath]
  return paths.map(literalPathspec)
}

/** Produce a unified diff for a single file in a commit, the index or the worktree. */
export async function getDiff(
  repoPath: string,
  target: GitTarget,
  filePath: string,
  options: GitSignalOptions = {},
): Promise<FileDiff> {
  const relativePath = assertRelativeFilePath(filePath)

  switch (target.type) {
    case "commit": {
      const context = await resolveCommitContext(repoPath, target.hash, target.parentIndex, options)
      const changed = await readCommitFiles(repoPath, context, options)
      const entry = changed.find((file) => file.path === relativePath)
      const text = await git(
        repoPath,
        [
          "diff",
          "--no-color",
          "--no-ext-diff",
          "--no-textconv",
          "-M",
          context.base,
          context.oid,
          "--",
          ...pathspecsFor(entry, relativePath),
        ],
        options,
      )

      return {
        path: relativePath,
        status: entry?.status ?? inferStatus(text),
        ...(entry?.oldPath ? { oldPath: entry.oldPath } : {}),
        text,
        binary: isBinaryText(text),
      }
    }

    case "index": {
      const filterArgs = await filterOverrideArgs(repoPath, options)
      const changed = await readStagedFiles(repoPath, filterArgs, options)
      const entry = changed.find((file) => file.path === relativePath)
      const text = await git(
        repoPath,
        [
          ...filterArgs,
          "diff",
          "--cached",
          "--no-color",
          "--no-ext-diff",
          "--no-textconv",
          "-M",
          "--",
          ...pathspecsFor(entry, relativePath),
        ],
        options,
      )

      if (text.length > 0) {
        return {
          path: relativePath,
          status: entry?.status ?? inferStatus(text),
          ...(entry?.oldPath ? { oldPath: entry.oldPath } : {}),
          text,
          binary: isBinaryText(text),
        }
      }
      if (entry && !(await isInHead(repoPath, relativePath, options))) {
        return await buildSyntheticDiff(
          repoPath,
          relativePath,
          entry.status,
          "index",
          options,
        )
      }
      return { path: relativePath, status: entry?.status ?? "modified", text: "", binary: false }
    }

    case "working-tree": {
      const filterArgs = await filterOverrideArgs(repoPath, options)
      const text = await git(
        repoPath,
        [
          ...filterArgs,
          "diff",
          "--no-color",
          "--no-ext-diff",
          "--no-textconv",
          "-M",
          "--",
          literalPathspec(relativePath),
        ],
        options,
      )
      if (text.length > 0) {
        return {
          path: relativePath,
          status: inferStatus(text),
          text,
          binary: isBinaryText(text),
        }
      }
      if (await isUntracked(repoPath, relativePath, options)) {
        return await buildSyntheticDiff(
          repoPath,
          relativePath,
          "untracked",
          "working-tree",
          options,
        )
      }
      return { path: relativePath, status: "modified", text: "", binary: false }
    }
  }
}
