import { realpath } from "node:fs/promises"
import path from "node:path"
import type { GitStatus } from "../../shared/types.js"
import { git, GitError, GitWriteError, gitWrite } from "./executor.js"
import { readFilterDrivers } from "./safety.js"
import { getStatus } from "./status.js"
import {
  assertCommitOid,
  assertExpectedHead,
  checkRefFormat,
  GitInputError,
  isValidBranchNameSyntax,
  isValidTagNameSyntax,
} from "./validation.js"

/** Shared options for every mutation. */
export interface MutationOptions {
  /**
   * Full 40/64 character commit id the caller observed before preparing the
   * operation, or `null` to skip the stale-head check. The engine compares it
   * with HEAD immediately before the write.
   */
  expectedHead: string | null
  /** Cancels preflight reads only. A write that has started is never aborted. */
  signal?: AbortSignal
}

export interface MutationResult {
  status: GitStatus
  changed: boolean
  warning?: string
}

export interface CheckoutBranchOptions extends MutationOptions {
  branch: string
}

export interface CreateBranchOptions extends MutationOptions {
  name: string
  /** Commit id to start the new branch at. Revision expressions are rejected. */
  startPoint: string
  checkout?: boolean
}

export interface CreateTagOptions extends MutationOptions {
  name: string
  target: string
  /** When set, an annotated tag is created with this message. */
  message?: string
}

export interface RenameBranchOptions extends MutationOptions {
  oldName: string
  newName: string
}

export interface DeleteBranchOptions extends MutationOptions {
  name: string
}

export interface DeleteTagOptions extends MutationOptions {
  name: string
}

/**
 * A refused or failed mutation.
 *
 * `reason` is a stable, path-free code safe to expose over RPC. The message is
 * deliberately generic and never contains the repository path; the underlying
 * error (which may include git stderr) is only retained as `cause` for local
 * diagnostics.
 */
export class GitMutationError extends Error {
  readonly reason: string

  constructor(reason: string, message: string, options: { cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = "GitMutationError"
    this.reason = reason
  }
}

function isAbortError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false
  const candidate = error as { name?: unknown; code?: unknown }
  return candidate.name === "AbortError" || candidate.code === "ABORT_ERR"
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  if (signal.reason instanceof Error) throw signal.reason
  throw new DOMException("The operation was aborted", "AbortError")
}

function invalidName(kind: "branch" | "tag"): GitMutationError {
  return new GitMutationError("invalid_name", `Invalid ${kind} name`)
}

function unsafeRepository(message: string): GitMutationError {
  return new GitMutationError("unsafe_repository", message)
}

const REPLACEMENT_CHARACTER = "\uFFFD"

/**
 * True when a path string cannot be trusted as a lossless decode of the bytes
 * git emitted.
 *
 * The executor decodes git output with Node's UTF-8 decoder, which silently
 * substitutes U+FFFD for invalid byte sequences. A file whose real name
 * contains U+FFFD is indistinguishable from such a substitution, so both are
 * refused: a false rejection of a legal U+FFFD name is preferable to running a
 * checkout filter over the wrong path. Lone surrogates are also rejected
 * because they do not round-trip through a UTF-8 encode/decode.
 */
function hasUndecodablePath(value: string): boolean {
  if (value.includes(REPLACEMENT_CHARACTER)) return true
  return Buffer.from(value, "utf8").toString("utf8") !== value
}

function assertDecodablePath(
  value: string,
  reason: "filters" | "unsafe_repository",
): string {
  if (hasUndecodablePath(value)) {
    throw new GitMutationError(
      reason,
      "Cannot safely enumerate repository paths: a path did not decode losslessly as UTF-8",
    )
  }
  return value
}

/**
 * Parse a `-z` (NUL-separated) git path listing.
 *
 * Exported so the conservative decode guard can be unit-tested without relying
 * on an OS that can create invalid UTF-8 filenames. Git always terminates every
 * record with NUL; a missing terminator or any undecodable path rejects the
 * whole listing instead of silently operating on a subset.
 */
export function parseNulPathList(
  output: string,
  reason: "filters" | "unsafe_repository" = "filters",
): string[] {
  if (output.length > 0 && !output.endsWith("\0")) {
    throw new GitMutationError(
      reason,
      "Cannot safely enumerate repository paths: malformed NUL-separated output",
    )
  }

  const paths: string[] = []
  for (const entry of output.split("\0")) {
    if (entry.length === 0) continue
    paths.push(assertDecodablePath(entry, reason))
  }
  return paths
}

function comparablePath(value: string): string {
  const resolved = path.resolve(value)
  return process.platform === "win32" ? resolved.toLowerCase() : resolved
}

function samePath(left: string, right: string): boolean {
  return comparablePath(left) === comparablePath(right)
}

/**
 * Resolve the working-tree root and ensure it is exactly the repository the
 * caller pointed at.
 *
 * A repository-local `core.worktree` (or a symlinked path) can make git report
 * a different top level. Writes are only allowed when the canonical top level
 * matches the real path of the caller's repository, so a poisoned config
 * cannot redirect operations into another checkout.
 */
async function resolveRepositoryRoot(
  repoPath: string,
  signal?: AbortSignal,
): Promise<string> {
  let root: string
  try {
    root = await realpath(repoPath)
  } catch (error) {
    if (isAbortError(error)) throw error
    throw unsafeRepository("Cannot resolve the repository path")
  }

  let topLevel: string
  try {
    topLevel = (await git(root, ["rev-parse", "--show-toplevel"], { signal })).trim()
  } catch (error) {
    if (isAbortError(error)) throw error
    throw unsafeRepository("Cannot resolve the repository top level")
  }
  if (!topLevel) throw unsafeRepository("Cannot resolve the repository top level")

  let canonicalTop: string
  try {
    canonicalTop = await realpath(topLevel)
  } catch (error) {
    if (isAbortError(error)) throw error
    throw unsafeRepository("Cannot resolve the repository top level")
  }
  if (!samePath(root, canonicalTop)) {
    throw unsafeRepository("The repository top level does not match the requested path")
  }

  let insideWorkTree: string
  try {
    insideWorkTree = (
      await git(canonicalTop, ["rev-parse", "--is-inside-work-tree"], { signal })
    ).trim()
  } catch (error) {
    if (isAbortError(error)) throw error
    throw unsafeRepository("Cannot verify that the repository has a working tree")
  }
  if (insideWorkTree !== "true") {
    throw unsafeRepository("The repository does not have a working tree")
  }

  return canonicalTop
}

function assertExpectedHeadMatches(status: GitStatus, expectedHead: string | null): void {
  if (expectedHead === null) return
  if (!status.head || status.head.toLowerCase() !== expectedHead) {
    throw new GitMutationError(
      "head_mismatch",
      "The repository HEAD changed since the operation was prepared; refresh and retry",
    )
  }
}

interface PreparedMutation {
  root: string
  status: GitStatus
  expectedHead: string | null
}

async function prepare(repoPath: string, options: MutationOptions): Promise<PreparedMutation> {
  // Validate the pure value before touching the repository.
  const expectedHead = assertExpectedHead(options?.expectedHead ?? null)
  throwIfAborted(options?.signal)
  const root = await resolveRepositoryRoot(repoPath, options?.signal)
  const status = await getStatus(root, { signal: options?.signal })
  assertExpectedHeadMatches(status, expectedHead)
  return { root, status, expectedHead }
}

async function assertBranchName(
  root: string,
  name: unknown,
  signal?: AbortSignal,
): Promise<string> {
  if (!isValidBranchNameSyntax(name)) throw invalidName("branch")
  let valid: boolean
  try {
    valid = await checkRefFormat(root, `refs/heads/${name}`, { signal })
  } catch (error) {
    if (isAbortError(error)) throw error
    throw unsafeRepository("Cannot validate the branch name")
  }
  if (!valid) throw invalidName("branch")
  return name
}

async function assertTagName(
  root: string,
  name: unknown,
  signal?: AbortSignal,
): Promise<string> {
  if (!isValidTagNameSyntax(name)) throw invalidName("tag")
  let valid: boolean
  try {
    valid = await checkRefFormat(root, `refs/tags/${name}`, { signal })
  } catch (error) {
    if (isAbortError(error)) throw error
    throw unsafeRepository("Cannot validate the tag name")
  }
  if (!valid) throw invalidName("tag")
  return name
}

async function refExists(root: string, refname: string, signal?: AbortSignal): Promise<boolean> {
  try {
    await git(root, ["show-ref", "--verify", "--quiet", refname], { signal })
    return true
  } catch (error) {
    if (error instanceof GitError && error.code === 1) return false
    throw error
  }
}

async function resolveCommit(
  root: string,
  oid: string,
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    const output = (await git(root, ["rev-parse", "--verify", "--quiet", `${oid}^{commit}`], {
      signal,
    })).trim()
    return /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(output) ? output.toLowerCase() : null
  } catch (error) {
    if (isAbortError(error)) throw error
    if (error instanceof GitError) return null
    throw error
  }
}

async function resolveRefCommit(
  root: string,
  refname: string,
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    const output = (
      await git(root, ["rev-parse", "--verify", "--quiet", `${refname}^{commit}`], { signal })
    ).trim()
    return /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(output) ? output.toLowerCase() : null
  } catch (error) {
    if (isAbortError(error)) throw error
    if (error instanceof GitError) return null
    throw error
  }
}

interface WorktreeEntry {
  path: string
  branch: string | null
}

function parseWorktrees(output: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = []
  let current: WorktreeEntry | null = null

  const finish = () => {
    if (current?.path) entries.push(current)
    current = null
  }

  for (const token of output.split("\0")) {
    if (token === "") {
      finish()
      continue
    }
    if (!current) current = { path: "", branch: null }
    const space = token.indexOf(" ")
    const key = space === -1 ? token : token.slice(0, space)
    const value = space === -1 ? "" : token.slice(space + 1)
    if (key === "worktree") current.path = assertDecodablePath(value, "unsafe_repository")
    else if (key === "branch") current.branch = assertDecodablePath(value, "unsafe_repository")
  }
  finish()
  return entries
}

async function listWorktrees(root: string, signal?: AbortSignal): Promise<WorktreeEntry[]> {
  let output: string
  try {
    output = await git(root, ["worktree", "list", "--porcelain", "-z"], { signal })
  } catch (error) {
    if (isAbortError(error)) throw error
    throw unsafeRepository("Cannot read the repository worktree list")
  }
  return parseWorktrees(output)
}

async function findWorktreeForBranch(
  root: string,
  branch: string,
  signal?: AbortSignal,
): Promise<WorktreeEntry | null> {
  const refname = `refs/heads/${branch}`
  for (const entry of await listWorktrees(root, signal)) {
    if (entry.branch === refname) return entry
  }
  return null
}

function assertWorktreeClean(status: GitStatus): void {
  if (status.files.some((file) => file.status === "conflicted")) {
    throw new GitMutationError(
      "conflicted",
      "Resolve the conflicted files before switching branches",
    )
  }
  if (status.files.some((file) => file.status !== "untracked")) {
    throw new GitMutationError(
      "dirty",
      "Commit or stash tracked changes before switching branches",
    )
  }
}

async function listTrackedPaths(root: string, signal?: AbortSignal): Promise<string[]> {
  const output = await git(root, ["ls-files", "-z"], { signal })
  return parseNulPathList(output, "filters")
}

async function listTreePaths(
  root: string,
  treeish: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const output = await git(root, ["ls-tree", "-r", "-z", "--name-only", treeish], { signal })
  return parseNulPathList(output, "filters")
}

async function listIgnoredPaths(root: string, signal?: AbortSignal): Promise<string[]> {
  // `--directory` collapses ignored directories (node_modules, dist, ...) so a
  // large ignored tree does not turn this preflight into an expensive listing.
  const output = await git(
    root,
    ["ls-files", "-z", "--others", "--ignored", "--exclude-standard", "--directory"],
    { signal },
  )
  return parseNulPathList(output, "unsafe_repository")
}

function normalizeRepoPath(value: string): string {
  let end = value.length
  while (end > 0 && value.charCodeAt(end - 1) === 0x2f) end--
  return value.slice(0, end)
}

function foldRepoPath(value: string, caseFold: boolean): string {
  return caseFold ? value.toLowerCase() : value
}

/**
 * Whether paths should be compared case-insensitively. Windows filesystems are
 * case-insensitive regardless of `core.ignorecase`; elsewhere the repository
 * setting decides. If the setting cannot be read, refuse rather than guess.
 */
async function pathsAreCaseInsensitive(
  root: string,
  signal?: AbortSignal,
): Promise<boolean> {
  if (process.platform === "win32") return true
  try {
    const output = (
      await git(root, ["config", "--bool", "--get", "core.ignorecase"], { signal })
    )
      .trim()
      .toLowerCase()
    return output === "true"
  } catch (error) {
    if (isAbortError(error)) throw error
    if (error instanceof GitError && error.code === 1) return false
    throw new GitMutationError(
      "unsafe_repository",
      "Cannot determine whether the repository compares paths case-insensitively",
    )
  }
}

/**
 * Segment-aware collision test between ignored paths and target leaf paths.
 *
 * A collision exists when:
 *   - the paths are equal, or
 *   - one is a path-segment ancestor of the other (in either direction).
 *
 * This covers Git's D/F replacement cases where switching silently deletes an
 * ignored directory or file. String `startsWith` is deliberately not used:
 * "ab" is not a path ancestor of "a". Ancestor sets keep this O(path segments)
 * instead of O(ignored × target).
 */
function ignoredPathsCollide(
  targetPaths: string[],
  ignoredPaths: string[],
  caseFold: boolean,
): boolean {
  const leaves = new Set<string>()
  const targetAncestors = new Set<string>()

  const addAncestors = (value: string, into: Set<string>): void => {
    let index = value.indexOf("/")
    while (index >= 0) {
      into.add(value.slice(0, index))
      index = value.indexOf("/", index + 1)
    }
  }

  for (const raw of targetPaths) {
    const value = foldRepoPath(normalizeRepoPath(raw), caseFold)
    if (!value) continue
    leaves.add(value)
    addAncestors(value, targetAncestors)
  }
  if (leaves.size === 0) return false

  for (const raw of ignoredPaths) {
    const value = foldRepoPath(normalizeRepoPath(raw), caseFold)
    if (!value) continue
    // Same path, or the ignored path is an ancestor of a target leaf.
    if (leaves.has(value) || targetAncestors.has(value)) return true

    // The target leaf is an ancestor of the ignored path (including deeper
    // ignored entries such as a/b/keep when the target tracks the file "a").
    let index = value.indexOf("/")
    while (index >= 0) {
      if (leaves.has(value.slice(0, index))) return true
      index = value.indexOf("/", index + 1)
    }
  }
  return false
}

/**
 * Git happily overwrites ignored files when they are tracked by the target
 * branch, including deleting a whole ignored directory when the target has a
 * file at the same path (and vice versa). That is native behaviour but still
 * silent data loss for the user, so any segment-prefix collision is refused
 * before switching.
 */
async function assertNoIgnoredCollision(
  root: string,
  targetOid: string,
  signal?: AbortSignal,
): Promise<void> {
  const [targetPaths, ignoredPaths, caseFold] = await Promise.all([
    listTreePaths(root, targetOid, signal),
    listIgnoredPaths(root, signal),
    pathsAreCaseInsensitive(root, signal),
  ])
  if (ignoredPaths.length === 0 || targetPaths.length === 0) return

  if (ignoredPathsCollide(targetPaths, ignoredPaths, caseFold)) {
    throw new GitMutationError(
      "untracked_collision",
      "Switching branches would overwrite ignored files; move them before retrying",
    )
  }
}

/** Keep each `check-attr` invocation comfortably below OS argv limits. */
function* pathBatches(paths: string[]): Generator<string[]> {
  const MAX_PATHS = 400
  const MAX_BYTES = 8_000
  let batch: string[] = []
  let bytes = 0

  for (const filePath of paths) {
    const size = Buffer.byteLength(filePath, "utf8") + 1
    if (batch.length >= MAX_PATHS || (batch.length > 0 && bytes + size > MAX_BYTES)) {
      yield batch
      batch = []
      bytes = 0
    }
    batch.push(filePath)
    bytes += size
  }
  if (batch.length > 0) yield batch
}

async function readFilterAttributes(
  root: string,
  paths: string[],
  source: string | null,
  signal?: AbortSignal,
): Promise<string[]> {
  const args = ["check-attr", "-z"]
  if (source) args.push(`--source=${source}`)
  args.push("filter", "--", ...paths)

  const output = await git(root, args, { signal })
  if (output.length > 0 && !output.endsWith("\0")) {
    throw new GitMutationError(
      "filters",
      "Cannot safely inspect filter attributes: malformed NUL-separated output",
    )
  }
  const tokens = output.split("\0")
  // `-z` emits path/attribute/value triples followed by one trailing NUL.
  if (tokens.length > 0 && (tokens.length - 1) % 3 !== 0) {
    throw new GitMutationError(
      "filters",
      "Cannot safely inspect filter attributes: malformed attribute records",
    )
  }
  const values: string[] = []
  for (let index = 0; index + 2 < tokens.length; index += 3) {
    const pathToken = tokens[index]
    if (!pathToken) {
      throw new GitMutationError(
        "filters",
        "Cannot safely inspect filter attributes: malformed attribute records",
      )
    }
    // `check-attr` echoes the path; it must be the same losslessly decoded path
    // that was passed in.
    assertDecodablePath(pathToken, "filters")
    const attribute = tokens[index + 1]
    const value = tokens[index + 2]
    if (attribute !== "filter" || !value) continue
    if (value === "unspecified" || value === "unset") continue
    values.push(value)
  }
  return values
}

/**
 * Fail closed when switching branches would run an external clean/smudge/process
 * filter driver for a file that actually selects one.
 *
 * Drivers configured globally (for example `filter.lfs.*` installed by Git LFS)
 * are harmless on their own; only an attribute that selects that driver makes a
 * file affected. Both the current working tree attributes (which include
 * `.git/info/attributes` and the configured global attributes file) and the
 * target tree's attributes are inspected. Merely disabling smudge would leave
 * pointer content behind, so the operation is refused instead.
 *
 * `git check-attr --source=<tree-ish>` is required to inspect the target tree;
 * if the installed git does not support it the operation is refused.
 */
async function assertNoActiveFilters(
  root: string,
  targetOid: string,
  signal?: AbortSignal,
): Promise<void> {
  try {
    const drivers = await readFilterDrivers(root, { signal })
    const tracked = await listTrackedPaths(root, signal)
    const target = await listTreePaths(root, targetOid, signal)
    const paths = [...new Set([...tracked, ...target])]
    if (paths.length === 0) return

    const selected = new Set<string>()
    for (const batch of pathBatches(paths)) {
      for (const value of await readFilterAttributes(root, batch, null, signal)) {
        selected.add(value)
      }
      for (const value of await readFilterAttributes(root, batch, targetOid, signal)) {
        selected.add(value)
      }
    }

    for (const driver of selected) {
      const config = drivers.get(driver.toLowerCase())
      if (!config) continue
      if (
        config.clean.length > 0 ||
        config.smudge.length > 0 ||
        config.process.length > 0 ||
        config.required
      ) {
        throw new GitMutationError(
          "filters",
          "Switching branches would run a configured external filter driver; refusing",
        )
      }
    }
  } catch (error) {
    if (error instanceof GitMutationError) throw error
    if (isAbortError(error)) throw error
    throw new GitMutationError(
      "filters",
      "Cannot verify filter attributes for the target tree; refusing",
      { cause: error },
    )
  }
}

interface WriteFailureRule {
  pattern: RegExp
  reason: string
  message: string
}

function mapWriteFailure(
  error: unknown,
  rules: WriteFailureRule[],
  fallbackMessage: string,
): GitMutationError {
  if (error instanceof GitWriteError && error.timedOut) {
    return new GitMutationError(
      "partial_failure",
      "The git command timed out; the repository state is unknown. Refresh before retrying.",
      { cause: error },
    )
  }
  if (error instanceof GitError) {
    for (const rule of rules) {
      if (rule.pattern.test(error.stderr)) {
        return new GitMutationError(rule.reason, rule.message, { cause: error })
      }
    }
  }
  return new GitMutationError("partial_failure", fallbackMessage, { cause: error })
}

const SWITCH_RULES: WriteFailureRule[] = [
  {
    pattern: /would be overwritten by checkout|untracked working tree files/i,
    reason: "untracked_collision",
    message: "Switching branches would overwrite untracked files; move them before retrying",
  },
  {
    pattern: /Updating (?:the )?following directories would lose untracked files/i,
    reason: "untracked_collision",
    message: "Switching branches would delete directories containing untracked files",
  },
  {
    pattern: /cannot lock ref.*exists/i,
    reason: "target_exists",
    message: "A ref with that name already exists",
  },
  {
    pattern: /already checked out at|is already checked out/i,
    reason: "branch_in_use",
    message: "The branch is checked out in another worktree",
  },
  {
    pattern: /not a valid branch name|invalid reference/i,
    reason: "invalid_name",
    message: "Invalid branch name",
  },
]

const BRANCH_CREATE_RULES: WriteFailureRule[] = [
  {
    pattern: /already exists|cannot lock ref.*exists/i,
    reason: "target_exists",
    message: "A branch with that name already exists",
  },
  {
    pattern: /not a valid branch name|invalid reference/i,
    reason: "invalid_name",
    message: "Invalid branch name",
  },
]

const BRANCH_RENAME_RULES: WriteFailureRule[] = [
  {
    pattern: /already exists/i,
    reason: "target_exists",
    message: "A branch with the new name already exists",
  },
  {
    pattern: /checked out at|checked out in/i,
    reason: "branch_in_use",
    message: "The branch is checked out in another worktree",
  },
  {
    pattern: /not found|no branch named/i,
    reason: "branch_not_found",
    message: "The branch to rename does not exist",
  },
]

const BRANCH_DELETE_RULES: WriteFailureRule[] = [
  {
    pattern: /not fully merged/i,
    reason: "not_merged",
    message: "The branch is not fully merged; refusing to delete it",
  },
  {
    pattern: /checked out at|checked out in|cannot delete branch/i,
    reason: "branch_in_use",
    message: "The branch is checked out and cannot be deleted",
  },
  {
    pattern: /not found|no branch named/i,
    reason: "branch_not_found",
    message: "The branch does not exist",
  },
]

const TAG_CREATE_RULES: WriteFailureRule[] = [
  {
    pattern: /already exists/i,
    reason: "target_exists",
    message: "A tag with that name already exists",
  },
  {
    pattern: /not a valid tag name|invalid reference/i,
    reason: "invalid_name",
    message: "Invalid tag name",
  },
]

const TAG_DELETE_RULES: WriteFailureRule[] = [
  {
    pattern: /not found|no tag named/i,
    reason: "tag_not_found",
    message: "The tag does not exist",
  },
]

async function refreshStatus(
  root: string,
  fallback: GitStatus,
  overrides?: Partial<Pick<GitStatus, "branch" | "head" | "detached">>,
): Promise<{ status: GitStatus; warning?: string }> {
  try {
    return { status: await getStatus(root) }
  } catch {
    // The write already completed. Never report it as failed (that would invite
    // the caller to repeat it); return the best status we have plus a warning.
    return {
      status: {
        ...fallback,
        ...overrides,
        files: fallback.files.map((file) => ({ ...file })),
        counts: { ...fallback.counts },
      },
      warning:
        "The git operation completed, but the refreshed repository status could not be read. Refresh the repository.",
    }
  }
}

function buildResult(
  refreshed: { status: GitStatus; warning?: string },
  changed: boolean,
): MutationResult {
  return refreshed.warning
    ? { status: refreshed.status, changed, warning: refreshed.warning }
    : { status: refreshed.status, changed }
}

function branchNotFound(): GitMutationError {
  return new GitMutationError("branch_not_found", "The local branch does not exist")
}

function tagNotFound(): GitMutationError {
  return new GitMutationError("tag_not_found", "The tag does not exist")
}

function invalidTarget(): GitMutationError {
  return new GitMutationError(
    "invalid_target",
    "The target object is not a commit in this repository",
  )
}

function assertTagMessage(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "string") {
    throw new GitInputError("Invalid tag message: expected a string")
  }
  if (value.includes("\0")) {
    throw new GitInputError("Invalid tag message: NUL bytes are not allowed")
  }
  if (value.length > 65_536) {
    throw new GitInputError("Invalid tag message: too long")
  }
  return value
}

/**
 * Switch to an existing local branch.
 *
 * Same-branch requests are a no-op (dirty worktrees included). Otherwise the
 * target must be an exact local `refs/heads/*` ref; no DWIM, remote-tracking or
 * tag checkout is performed. Tracked changes, conflicts, worktree occupation
 * and active external filter drivers all cause the operation to be refused
 * before git is asked to switch.
 */
export async function checkoutBranch(
  repoPath: string,
  options: CheckoutBranchOptions,
): Promise<MutationResult> {
  if (typeof options?.branch !== "string") {
    throw new GitInputError("Invalid branch: expected a string")
  }
  const { root, status } = await prepare(repoPath, options)
  const name = await assertBranchName(root, options.branch, options.signal)

  if (status.head === null) {
    throw new GitMutationError("unborn", "Cannot switch branches before the first commit")
  }
  if (status.branch === name) {
    return { status, changed: false }
  }

  if (!(await refExists(root, `refs/heads/${name}`, options.signal))) throw branchNotFound()
  const targetOid = await resolveRefCommit(root, `refs/heads/${name}`, options.signal)
  if (!targetOid) throw invalidTarget()

  if (await findWorktreeForBranch(root, name, options.signal)) {
    throw new GitMutationError("branch_in_use", "The branch is checked out in a worktree")
  }

  assertWorktreeClean(status)
  await assertNoIgnoredCollision(root, targetOid, options.signal)
  await assertNoActiveFilters(root, targetOid, options.signal)
  throwIfAborted(options.signal)

  try {
    await gitWrite(root, ["switch", "--no-guess", name])
  } catch (error) {
    throw mapWriteFailure(
      error,
      SWITCH_RULES,
      "The branch switch command failed; verify the repository state",
    )
  }

  const refreshed = await refreshStatus(root, status, {
    branch: name,
    head: targetOid,
    detached: false,
  })
  return buildResult(refreshed, true)
}

/**
 * Create a local branch, optionally checking it out.
 *
 * The branch is created with `--no-track` so no upstream is configured. If the
 * branch is created but the follow-up checkout fails, a typed `partial_failure`
 * is reported and the new ref is deliberately left in place (no cleanup that
 * could hide the partial state).
 */
export async function createBranch(
  repoPath: string,
  options: CreateBranchOptions,
): Promise<MutationResult> {
  if (typeof options?.name !== "string") {
    throw new GitInputError("Invalid branch name: expected a string")
  }
  if (typeof options?.startPoint !== "string") {
    throw new GitInputError("Invalid branch start point: expected a commit id")
  }
  const startOidInput = assertCommitOid(options.startPoint)

  const { root, status } = await prepare(repoPath, options)
  const name = await assertBranchName(root, options.name, options.signal)

  if (status.head === null) {
    throw new GitMutationError("unborn", "Cannot create a branch before the first commit")
  }

  const startOid = await resolveCommit(root, startOidInput, options.signal)
  if (!startOid) throw invalidTarget()
  if (await refExists(root, `refs/heads/${name}`, options.signal)) {
    throw new GitMutationError("target_exists", "A branch with that name already exists")
  }

  const checkout = options.checkout === true
  if (checkout) {
    assertWorktreeClean(status)
    await assertNoIgnoredCollision(root, startOid, options.signal)
    await assertNoActiveFilters(root, startOid, options.signal)
  }
  throwIfAborted(options.signal)

  try {
    await gitWrite(root, ["branch", "--no-track", name, startOid])
  } catch (error) {
    throw mapWriteFailure(
      error,
      BRANCH_CREATE_RULES,
      "The branch creation command failed; verify the repository state",
    )
  }

  if (checkout) {
    try {
      await gitWrite(root, ["switch", "--no-guess", name])
    } catch (error) {
      const mapped = mapWriteFailure(
        error,
        SWITCH_RULES,
        "The branch was created, but switching to it failed",
      )
      throw new GitMutationError(
        "partial_failure",
        `The branch was created, but switching to it failed (${mapped.reason}). Refresh before retrying.`,
        { cause: error },
      )
    }
  }

  const refreshed = await refreshStatus(
    root,
    status,
    checkout ? { branch: name, head: startOid, detached: false } : undefined,
  )
  return buildResult(refreshed, true)
}

/** Rename a local branch without forcing (`git branch -m`). */
export async function renameBranch(
  repoPath: string,
  options: RenameBranchOptions,
): Promise<MutationResult> {
  if (typeof options?.oldName !== "string" || typeof options?.newName !== "string") {
    throw new GitInputError("Invalid branch name: expected a string")
  }
  const { root, status } = await prepare(repoPath, options)
  const oldName = await assertBranchName(root, options.oldName, options.signal)
  const newName = await assertBranchName(root, options.newName, options.signal)

  if (!(await refExists(root, `refs/heads/${oldName}`, options.signal))) throw branchNotFound()

  if (oldName === newName) {
    return {
      status,
      changed: false,
      warning: "The branch already has the requested name",
    }
  }

  if (await refExists(root, `refs/heads/${newName}`, options.signal)) {
    throw new GitMutationError("target_exists", "A branch with the new name already exists")
  }

  const occupied = await findWorktreeForBranch(root, oldName, options.signal)
  if (occupied && (!samePath(occupied.path, root) || status.branch !== oldName)) {
    throw new GitMutationError("branch_in_use", "The branch is checked out in another worktree")
  }

  throwIfAborted(options.signal)
  try {
    await gitWrite(root, ["branch", "-m", oldName, newName])
  } catch (error) {
    throw mapWriteFailure(
      error,
      BRANCH_RENAME_RULES,
      "The branch rename command failed; verify the repository state",
    )
  }

  const refreshed = await refreshStatus(
    root,
    status,
    status.branch === oldName
      ? { branch: newName, head: status.head, detached: false }
      : undefined,
  )
  return buildResult(refreshed, true)
}

/**
 * Delete a fully merged local branch using `git branch -d` only.
 *
 * The current branch and branches checked out in any worktree are refused. No
 * `-D`/force deletion is ever used, so unmerged commits cannot be lost.
 */
export async function deleteBranch(
  repoPath: string,
  options: DeleteBranchOptions,
): Promise<MutationResult> {
  if (typeof options?.name !== "string") {
    throw new GitInputError("Invalid branch name: expected a string")
  }
  const { root, status } = await prepare(repoPath, options)
  const name = await assertBranchName(root, options.name, options.signal)

  if (!(await refExists(root, `refs/heads/${name}`, options.signal))) throw branchNotFound()

  if (status.branch === name || (await findWorktreeForBranch(root, name, options.signal))) {
    throw new GitMutationError("branch_in_use", "The branch is checked out and cannot be deleted")
  }

  throwIfAborted(options.signal)
  try {
    await gitWrite(root, ["branch", "-d", name])
  } catch (error) {
    throw mapWriteFailure(
      error,
      BRANCH_DELETE_RULES,
      "The branch deletion command failed; verify the repository state",
    )
  }

  const refreshed = await refreshStatus(root, status)
  return buildResult(refreshed, true)
}

/** Create a lightweight or annotated tag. Signing is always disabled. */
export async function createTag(
  repoPath: string,
  options: CreateTagOptions,
): Promise<MutationResult> {
  if (typeof options?.name !== "string") {
    throw new GitInputError("Invalid tag name: expected a string")
  }
  if (typeof options?.target !== "string") {
    throw new GitInputError("Invalid tag target: expected a commit id")
  }
  const targetInput = assertCommitOid(options.target)
  const message = assertTagMessage(options.message)

  const { root, status } = await prepare(repoPath, options)
  const name = await assertTagName(root, options.name, options.signal)

  const targetOid = await resolveCommit(root, targetInput, options.signal)
  if (!targetOid) throw invalidTarget()
  if (await refExists(root, `refs/tags/${name}`, options.signal)) {
    throw new GitMutationError("target_exists", "A tag with that name already exists")
  }

  throwIfAborted(options.signal)
  const args = ["tag", "--no-sign"]
  if (message !== undefined) args.push("-a", "-m", message)
  args.push(name, targetOid)

  try {
    await gitWrite(root, args)
  } catch (error) {
    throw mapWriteFailure(
      error,
      TAG_CREATE_RULES,
      "The tag creation command failed; verify the repository state",
    )
  }

  const refreshed = await refreshStatus(root, status)
  return buildResult(refreshed, true)
}

/** Delete a tag without force. */
export async function deleteTag(
  repoPath: string,
  options: DeleteTagOptions,
): Promise<MutationResult> {
  if (typeof options?.name !== "string") {
    throw new GitInputError("Invalid tag name: expected a string")
  }
  const { root, status } = await prepare(repoPath, options)
  const name = await assertTagName(root, options.name, options.signal)

  if (!(await refExists(root, `refs/tags/${name}`, options.signal))) throw tagNotFound()

  throwIfAborted(options.signal)
  try {
    await gitWrite(root, ["tag", "-d", name])
  } catch (error) {
    throw mapWriteFailure(
      error,
      TAG_DELETE_RULES,
      "The tag deletion command failed; verify the repository state",
    )
  }

  const refreshed = await refreshStatus(root, status)
  return buildResult(refreshed, true)
}
