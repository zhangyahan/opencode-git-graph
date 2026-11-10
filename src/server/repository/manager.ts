import { realpath } from "node:fs/promises"
import path from "node:path"
import type { RpcHandlers } from "@opencode/plugin/promise/rpc"
import {
  GitGraphRpc,
  MUTATION_REASON_MAX_LENGTH,
  isCommitHash,
  isFullCommitHash,
  isSafeRelativePath,
  isSafeShortRefName,
} from "../../rpc.js"
import type {
  ChangedFile,
  CommitFileContent,
  FileDiff,
  GitFetchResult,
  GitMutationResult,
  GitRef,
  GitRepository,
  GitStatus,
  GitTarget,
} from "../../shared/types.js"
import { getComparisonDiff, getComparisonFiles } from "../git/compare.js"
import { getCommitFiles, getDiff } from "../git/diff.js"
import { getCommitFileContent } from "../git/file-content.js"
import { git, GitError, type GitSignalOptions } from "../git/executor.js"
import { getLog, type LogOptions, type LogResult } from "../git/log.js"
import * as mutations from "../git/mutations.js"
import { getRefs } from "../git/refs.js"
import { getStatus } from "../git/status.js"
import { GitInputError } from "../git/validation.js"
import { discoverRepositories, type DiscoverOptions } from "./discovery.js"

/** Short-lived discovery cache; explicit refresh always bypasses it. */
const DEFAULT_TTL_MS = 5_000
const MAX_LOG_LIMIT = 1_000
const MAX_LOG_SKIP = 10_000_000

export type RepositoryManagerErrorType =
  | "repository_not_found"
  | "invalid_input"
  | "mutation_rejected"
  | "disposed"

export class RepositoryManagerError extends Error {
  readonly type: RepositoryManagerErrorType
  readonly data: { repositoryId?: string; reason?: string }

  constructor(
    type: RepositoryManagerErrorType,
    message: string,
    data: { repositoryId?: string; reason?: string } = {},
  ) {
    super(message)
    this.name = "RepositoryManagerError"
    this.type = type
    this.data = data
  }
}

/**
 * Frozen write-engine contract (implemented in `server/git/mutations.ts`).
 *
 * The manager never forwards an `AbortSignal` to these functions: a write that
 * has started must run to completion so UI cancellation/dispose cannot turn a
 * successful git operation into a reported failure.
 */
export interface MutationEngineOptions {
  expectedHead: string | null
  signal?: AbortSignal
}

/** Caller options accepted by manager write methods (cancellation is pre-start only). */
export interface WriteCallOptions {
  signal?: AbortSignal
}

export interface MutationEngineResult extends GitMutationResult {}

export interface MutationEngine {
  checkoutBranch(
    repositoryPath: string,
    options: { branch: string } & MutationEngineOptions,
  ): Promise<MutationEngineResult>
  createBranch(
    repositoryPath: string,
    options: {
      name: string
      startPoint: string
      checkout?: boolean
    } & MutationEngineOptions,
  ): Promise<MutationEngineResult>
  createTag(
    repositoryPath: string,
    options: { name: string; target: string; message?: string } & MutationEngineOptions,
  ): Promise<MutationEngineResult>
  renameBranch(
    repositoryPath: string,
    options: { oldName: string; newName: string } & MutationEngineOptions,
  ): Promise<MutationEngineResult>
  deleteBranch(
    repositoryPath: string,
    options: { name: string } & MutationEngineOptions,
  ): Promise<MutationEngineResult>
  deleteTag(
    repositoryPath: string,
    options: { name: string } & MutationEngineOptions,
  ): Promise<MutationEngineResult>
  fetchRemote(
    repositoryPath: string,
    options: { remote: string | null; prune?: boolean } & MutationEngineOptions,
  ): Promise<GitFetchResult>
}

/** The canonical working tree and git common dir a write is bound to. */
export interface RepositoryWriteBinding {
  /** Real (symlink-free) working-tree root. */
  realRoot: string
  /** Real absolute common git dir shared by linked worktrees. */
  commonDir: string
}

export interface RepositoryManagerDeps {
  discover: (root: string, options?: DiscoverOptions) => Promise<GitRepository[]>
  getStatus: (repositoryPath: string, options?: GitSignalOptions) => Promise<GitStatus>
  getLog: (repositoryPath: string, options?: LogOptions) => Promise<LogResult>
  getRefs: (repositoryPath: string, options?: GitSignalOptions) => Promise<GitRef[]>
  getCommitFiles: (
    repositoryPath: string,
    hash: string,
    parentIndex?: number,
    options?: GitSignalOptions,
  ) => Promise<ChangedFile[]>
  getCommitFileContent: (
    repositoryPath: string,
    hash: string,
    filePath: string,
    options?: GitSignalOptions,
  ) => Promise<CommitFileContent>
  getDiff: (
    repositoryPath: string,
    target: GitTarget,
    filePath: string,
    options?: GitSignalOptions,
  ) => Promise<FileDiff>
  getComparisonFiles: (
    repositoryPath: string,
    baseHash: string,
    headHash: string,
    options?: GitSignalOptions,
  ) => Promise<ChangedFile[]>
  getComparisonDiff: (
    repositoryPath: string,
    baseHash: string,
    headHash: string,
    filePath: string,
    options?: GitSignalOptions,
  ) => Promise<FileDiff>
  /** Write engine; injectable for tests. */
  mutations: MutationEngine
  /**
   * Re-validate a repository immediately before a write. Injectable so tests
   * can bind fake repositories to fake common dirs without touching the disk.
   */
  validateRepository?: (repository: GitRepository) => Promise<RepositoryWriteBinding>
  realpath: (value: string) => Promise<string>
  now: () => number
}

export interface RepositoryManagerOptions {
  deps?: Partial<RepositoryManagerDeps>
  discovery?: DiscoverOptions
  /** Discovery cache lifetime in milliseconds (`0` disables caching). */
  ttlMs?: number
}

const DEFAULT_DEPS: RepositoryManagerDeps = {
  discover: discoverRepositories,
  getStatus,
  getLog,
  getRefs,
  getCommitFiles,
  getCommitFileContent,
  getDiff,
  getComparisonFiles,
  getComparisonDiff,
  mutations,
  realpath,
  now: () => Date.now(),
}

function cloneRepository(repository: GitRepository): GitRepository {
  return { ...repository, changes: { ...repository.changes } }
}

function cloneRepositories(repositories: GitRepository[]): GitRepository[] {
  return repositories.map(cloneRepository)
}

function isNonNegativeInteger(value: number): boolean {
  return Number.isInteger(value) && value >= 0
}

/** Windows paths are case-insensitive, so fold them before comparing. */
function comparablePath(value: string): string {
  const resolved = path.resolve(value)
  return process.platform === "win32" ? resolved.toLowerCase() : resolved
}

function samePath(left: string, right: string): boolean {
  return comparablePath(left) === comparablePath(right)
}

function isWithinPath(root: string, candidate: string): boolean {
  const relative = path.relative(comparablePath(root), comparablePath(candidate))
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  )
}

function boundedMutationReason(value: unknown): string {
  if (typeof value !== "string") return "mutation_failed"
  const reason = value.trim().replace(/[\x00-\x1f\x7f]/g, " ").slice(0, MUTATION_REASON_MAX_LENGTH)
  return reason.length > 0 ? reason : "mutation_failed"
}

interface CombinedSignal {
  signal: AbortSignal
  cleanup: () => void
}

/**
 * Merge abort signals without relying on AbortSignal.any() so the plugin keeps
 * working on Node 20. Listeners are removed eagerly on abort and by cleanup()
 * once the operation settles.
 */
function combineSignals(signals: Array<AbortSignal | undefined>): CombinedSignal {
  const controller = new AbortController()
  const removers: Array<() => void> = []
  let cleaned = false

  const cleanup = () => {
    if (cleaned) return
    cleaned = true
    for (const remove of removers.splice(0)) remove()
  }

  for (const source of signals) {
    if (!source) continue
    if (source.aborted) {
      controller.abort(source.reason)
      cleanup()
      break
    }

    const onAbort = () => {
      controller.abort(source.reason)
      cleanup()
    }
    source.addEventListener("abort", onAbort, { once: true })
    removers.push(() => source.removeEventListener("abort", onAbort))
  }

  return { signal: controller.signal, cleanup }
}

function isAbortError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false
  const candidate = error as { name?: unknown; code?: unknown }
  return candidate.name === "AbortError" || candidate.code === "ABORT_ERR"
}

/** Detect the write engine's `GitMutationError` without importing it eagerly. */
function isGitMutationError(error: unknown): error is { name: "GitMutationError"; reason: string } {
  if (typeof error !== "object" || error === null) return false
  const candidate = error as { name?: unknown; reason?: unknown }
  return candidate.name === "GitMutationError" && typeof candidate.reason === "string"
}

/**
 * Owns the allowlist of repositories discovered below the session directory.
 *
 * Repository ids are normalized absolute working-tree paths produced by
 * discovery. Callers can only address repositories in that allowlist; the
 * manager never accepts an arbitrary filesystem path. Returns are cloned so a
 * caller cannot mutate the internal allowlist.
 */
export class RepositoryManager implements GitGraphManager {
  private readonly root: string
  private readonly deps: RepositoryManagerDeps
  private readonly discovery: DiscoverOptions | undefined
  private readonly ttlMs: number

  private allowlist = new Map<string, GitRepository>()
  private scanPromise: Promise<GitRepository[]> | null = null
  private scanGeneration = 0
  private scannedAt = 0
  private hasScanned = false
  private disposed = false
  private readonly lifetime = new AbortController()
  /** Real working-tree root recorded at discovery, used to detect swaps. */
  private writeBindings = new Map<string, RepositoryWriteBinding>()
  /** Canonical manager root recorded on the first scan. */
  private rootBinding: string | undefined
  /** One serialisation chain per real git common dir (shared by worktrees). */
  private readonly writeLocks = new Map<string, Promise<void>>()

  constructor(root: string, options: RepositoryManagerOptions = {}) {
    this.root = path.resolve(root)
    this.deps = { ...DEFAULT_DEPS, ...options.deps }
    this.discovery = options.discovery
    this.ttlMs = isNonNegativeInteger(options.ttlMs ?? DEFAULT_TTL_MS)
      ? Math.floor(options.ttlMs ?? DEFAULT_TTL_MS)
      : DEFAULT_TTL_MS
  }

  /** Scan (or reuse a recent scan) and return the current allowlist. */
  async listRepositories(
    options: { refresh?: boolean; signal?: AbortSignal } = {},
  ): Promise<GitRepository[]> {
    return this.withSignal(options.signal, async (signal) => {
      const repositories = await this.ensureScan(options.refresh === true)
      this.throwIfAborted(signal)
      return cloneRepositories(repositories)
    })
  }

  /** Resolve a repository id against the allowlist, scanning lazily if needed. */
  async requireRepository(repositoryId: string): Promise<GitRepository> {
    await this.ensureScan(false)
    if (this.disposed) {
      throw new RepositoryManagerError("disposed", "Repository manager has been disposed")
    }
    const repository = this.allowlist.get(repositoryId)
    if (!repository) {
      throw new RepositoryManagerError("repository_not_found", "Repository not found", {
        repositoryId,
      })
    }
    return cloneRepository(repository)
  }

  /** Stop all future operations and abort any in-flight git command. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.lifetime.abort()
    this.scanGeneration++
    this.scanPromise = null
    this.allowlist.clear()
    this.writeBindings.clear()
    this.hasScanned = false
    this.scannedAt = 0
  }

  async getStatus(
    repositoryId: string,
    options: GitSignalOptions = {},
  ): Promise<GitStatus> {
    return this.withSignal(options.signal, async (signal) => {
      const repository = await this.requireRepository(repositoryId)
      this.throwIfAborted(signal)
      const status = await this.deps.getStatus(repository.rootPath, { signal })
      return { ...status, repositoryId: repository.id }
    })
  }

  async getLog(repositoryId: string, options: LogOptions = {}): Promise<LogResult> {
    const { signal, ...logOptions } = options
    return this.withSignal(signal, async (combined) => {
      if (
        logOptions.limit !== undefined &&
        (!Number.isInteger(logOptions.limit) ||
          logOptions.limit < 1 ||
          logOptions.limit > MAX_LOG_LIMIT)
      ) {
        throw new RepositoryManagerError("invalid_input", "Invalid log limit", { reason: "limit" })
      }
      if (
        logOptions.skip !== undefined &&
        (!Number.isInteger(logOptions.skip) ||
          logOptions.skip < 0 ||
          logOptions.skip > MAX_LOG_SKIP)
      ) {
        throw new RepositoryManagerError("invalid_input", "Invalid log skip", { reason: "skip" })
      }

      const repository = await this.requireRepository(repositoryId)
      this.throwIfAborted(combined)
      return this.deps.getLog(repository.rootPath, { ...logOptions, signal: combined })
    })
  }

  async getRefs(repositoryId: string, options: GitSignalOptions = {}): Promise<GitRef[]> {
    return this.withSignal(options.signal, async (signal) => {
      const repository = await this.requireRepository(repositoryId)
      this.throwIfAborted(signal)
      return this.deps.getRefs(repository.rootPath, { signal })
    })
  }

  async getCommitFiles(
    repositoryId: string,
    hash: string,
    parentIndex = 0,
    options: GitSignalOptions = {},
  ): Promise<ChangedFile[]> {
    return this.withSignal(options.signal, async (signal) => {
      this.assertCommitHash(hash)
      if (!isNonNegativeInteger(parentIndex)) {
        throw new RepositoryManagerError("invalid_input", "Invalid parent index", {
          reason: "parentIndex",
        })
      }

      const repository = await this.requireRepository(repositoryId)
      this.throwIfAborted(signal)
      return this.deps.getCommitFiles(repository.rootPath, hash, parentIndex, { signal })
    })
  }

  async getCommitFileContent(
    repositoryId: string,
    hash: string,
    filePath: string,
    options: GitSignalOptions = {},
  ): Promise<CommitFileContent> {
    return this.withSignal(options.signal, async (signal) => {
      this.assertCommitHash(hash)
      if (!isSafeRelativePath(filePath)) {
        throw new RepositoryManagerError("invalid_input", "Invalid file path", { reason: "path" })
      }

      const repository = await this.requireRepository(repositoryId)
      this.throwIfAborted(signal)
      return this.deps.getCommitFileContent(repository.rootPath, hash, filePath, { signal })
    })
  }

  async getDiff(
    repositoryId: string,
    target: GitTarget,
    filePath: string,
    options: GitSignalOptions = {},
  ): Promise<FileDiff> {
    return this.withSignal(options.signal, async (signal) => {
      if (!isSafeRelativePath(filePath)) {
        throw new RepositoryManagerError("invalid_input", "Invalid file path", { reason: "path" })
      }
      if (target.type === "commit") {
        this.assertCommitHash(target.hash)
        if (target.parentIndex !== undefined && !isNonNegativeInteger(target.parentIndex)) {
          throw new RepositoryManagerError("invalid_input", "Invalid parent index", {
            reason: "parentIndex",
          })
        }
      }

      const repository = await this.requireRepository(repositoryId)
      const rootPath = path.resolve(repository.rootPath)
      const resolved = path.resolve(rootPath, filePath)
      const relative = path.relative(rootPath, resolved)
      if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new RepositoryManagerError("invalid_input", "Invalid file path", { reason: "path" })
      }
      this.throwIfAborted(signal)

      return this.deps.getDiff(repository.rootPath, target, filePath, { signal })
    })
  }

  async getComparisonFiles(
    repositoryId: string,
    baseHash: string,
    headHash: string,
    options: GitSignalOptions = {},
  ): Promise<ChangedFile[]> {
    return this.withSignal(options.signal, async (signal) => {
      this.assertCommitHash(baseHash)
      this.assertCommitHash(headHash)
      const repository = await this.requireRepository(repositoryId)
      this.throwIfAborted(signal)
      return this.deps.getComparisonFiles(repository.rootPath, baseHash, headHash, { signal })
    })
  }

  async getComparisonDiff(
    repositoryId: string,
    baseHash: string,
    headHash: string,
    filePath: string,
    options: GitSignalOptions = {},
  ): Promise<FileDiff> {
    return this.withSignal(options.signal, async (signal) => {
      this.assertCommitHash(baseHash)
      this.assertCommitHash(headHash)
      if (!isSafeRelativePath(filePath)) {
        throw new RepositoryManagerError("invalid_input", "Invalid file path", { reason: "path" })
      }
      const repository = await this.requireRepository(repositoryId)
      const rootPath = path.resolve(repository.rootPath)
      const resolved = path.resolve(rootPath, filePath)
      const relative = path.relative(rootPath, resolved)
      if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new RepositoryManagerError("invalid_input", "Invalid file path", { reason: "path" })
      }
      this.throwIfAborted(signal)
      return this.deps.getComparisonDiff(repository.rootPath, baseHash, headHash, filePath, {
        signal,
      })
    })
  }

  async checkoutBranch(
    repositoryId: string,
    input: { branch: string; expectedHead: string | null },
    options: WriteCallOptions = {},
  ): Promise<MutationEngineResult> {
    if (!isSafeShortRefName(input.branch)) {
      throw new RepositoryManagerError("invalid_input", "Invalid branch name", { reason: "branch" })
    }
    return this.runMutation(repositoryId, input.expectedHead, options, (engine, repository) =>
      engine.checkoutBranch(repository.rootPath, {
        branch: input.branch,
        expectedHead: input.expectedHead,
      }),
    )
  }

  async createBranch(
    repositoryId: string,
    input: {
      name: string
      startPoint: string
      checkout?: boolean
      expectedHead: string | null
    },
    options: WriteCallOptions = {},
  ): Promise<MutationEngineResult> {
    if (!isSafeShortRefName(input.name)) {
      throw new RepositoryManagerError("invalid_input", "Invalid branch name", { reason: "name" })
    }
    this.assertCommitHash(input.startPoint)
    return this.runMutation(repositoryId, input.expectedHead, options, (engine, repository) =>
      engine.createBranch(repository.rootPath, {
        name: input.name,
        startPoint: input.startPoint,
        ...(input.checkout === undefined ? {} : { checkout: input.checkout }),
        expectedHead: input.expectedHead,
      }),
    )
  }

  async createTag(
    repositoryId: string,
    input: { name: string; target: string; message?: string; expectedHead: string | null },
    options: WriteCallOptions = {},
  ): Promise<MutationEngineResult> {
    if (!isSafeShortRefName(input.name)) {
      throw new RepositoryManagerError("invalid_input", "Invalid tag name", { reason: "name" })
    }
    this.assertCommitHash(input.target)
    return this.runMutation(repositoryId, input.expectedHead, options, (engine, repository) =>
      engine.createTag(repository.rootPath, {
        name: input.name,
        target: input.target,
        ...(input.message === undefined ? {} : { message: input.message }),
        expectedHead: input.expectedHead,
      }),
    )
  }

  async renameBranch(
    repositoryId: string,
    input: { oldName: string; newName: string; expectedHead: string | null },
    options: WriteCallOptions = {},
  ): Promise<MutationEngineResult> {
    if (!isSafeShortRefName(input.oldName)) {
      throw new RepositoryManagerError("invalid_input", "Invalid branch name", { reason: "oldName" })
    }
    if (!isSafeShortRefName(input.newName)) {
      throw new RepositoryManagerError("invalid_input", "Invalid branch name", { reason: "newName" })
    }
    return this.runMutation(repositoryId, input.expectedHead, options, (engine, repository) =>
      engine.renameBranch(repository.rootPath, {
        oldName: input.oldName,
        newName: input.newName,
        expectedHead: input.expectedHead,
      }),
    )
  }

  async deleteBranch(
    repositoryId: string,
    input: { name: string; expectedHead: string | null },
    options: WriteCallOptions = {},
  ): Promise<MutationEngineResult> {
    if (!isSafeShortRefName(input.name)) {
      throw new RepositoryManagerError("invalid_input", "Invalid branch name", { reason: "name" })
    }
    return this.runMutation(repositoryId, input.expectedHead, options, (engine, repository) =>
      engine.deleteBranch(repository.rootPath, {
        name: input.name,
        expectedHead: input.expectedHead,
      }),
    )
  }

  async deleteTag(
    repositoryId: string,
    input: { name: string; expectedHead: string | null },
    options: WriteCallOptions = {},
  ): Promise<MutationEngineResult> {
    if (!isSafeShortRefName(input.name)) {
      throw new RepositoryManagerError("invalid_input", "Invalid tag name", { reason: "name" })
    }
    return this.runMutation(repositoryId, input.expectedHead, options, (engine, repository) =>
      engine.deleteTag(repository.rootPath, {
        name: input.name,
        expectedHead: input.expectedHead,
      }),
    )
  }

  /**
   * Fetch one remote (or all remotes) of an allowlisted repository.
   *
   * Runs through the same common-dir write lock as every other mutation, so a
   * fetch cannot race a local write in any worktree. A successful fetch
   * invalidates the discovery snapshot and updates the cached repository entry
   * from the returned status.
   */
  async fetchRemote(
    repositoryId: string,
    input: { remote?: string | null; prune?: boolean; expectedHead: string | null },
    options: WriteCallOptions = {},
  ): Promise<GitFetchResult> {
    const remote = input.remote ?? null
    if (remote !== null && !isSafeShortRefName(remote)) {
      throw new RepositoryManagerError("invalid_input", "Invalid remote name", { reason: "remote" })
    }
    if (input.prune !== undefined && typeof input.prune !== "boolean") {
      throw new RepositoryManagerError("invalid_input", "Invalid prune option", {
        reason: "prune",
      })
    }
    return this.runMutation(repositoryId, input.expectedHead, options, (engine, repository) =>
      engine.fetchRemote(repository.rootPath, {
        remote,
        ...(input.prune === undefined ? {} : { prune: input.prune }),
        expectedHead: input.expectedHead,
      }),
    )
  }

  private mutationRejected(reason: string): RepositoryManagerError {
    return new RepositoryManagerError("mutation_rejected", "Mutation rejected", { reason })
  }

  private assertExpectedHead(expectedHead: string | null): void {
    if (expectedHead !== null && !isFullCommitHash(expectedHead)) {
      throw new RepositoryManagerError("invalid_input", "Invalid expected head", {
        reason: "expectedHead",
      })
    }
  }

  private async runMutation<T extends MutationEngineResult>(
    repositoryId: string,
    expectedHead: string | null,
    options: WriteCallOptions,
    operation: (
      engine: MutationEngine,
      repository: GitRepository,
    ) => Promise<T>,
  ): Promise<T> {
    this.assertExpectedHead(expectedHead)
    this.throwIfWriteAborted(options.signal)

    const repository = await this.requireRepository(repositoryId)
    const binding = await this.validateForWrite(repository)
    this.throwIfWriteAborted(options.signal)

    return this.withWriteLock(binding.commonDir, async () => {
      // Re-check and re-bind after waiting: the caller may have cancelled or
      // the repository path may have been swapped while this write was queued.
      this.throwIfWriteAborted(options.signal)
      const current = await this.validateForWrite(repository)
      if (!samePath(current.commonDir, binding.commonDir)) {
        throw this.mutationRejected("repository_changed")
      }

      const engine = this.deps.mutations
      let result: T
      try {
        // Deliberately no signal: once the write starts it must complete and
        // its success must be reported even if the UI cancels or disposes.
        result = await operation(engine, current.repository)
      } catch (error) {
        throw this.mapMutationFailure(error)
      }

      this.applyMutationSuccess(repository.id, result)
      return result
    })
  }

  private mapMutationFailure(error: unknown): RepositoryManagerError {
    if (error instanceof RepositoryManagerError) return error
    if (error instanceof GitInputError) {
      return new RepositoryManagerError("invalid_input", "Invalid input", { reason: "input" })
    }
    if (isGitMutationError(error)) {
      return this.mutationRejected(boundedMutationReason(error.reason))
    }
    if (error instanceof GitError) {
      return this.mutationRejected("git_failed")
    }
    return this.mutationRejected("mutation_failed")
  }

  private throwIfWriteAborted(signal: AbortSignal | undefined): void {
    if (this.disposed) {
      throw new RepositoryManagerError("disposed", "Repository manager has been disposed")
    }
    if (signal?.aborted) {
      throw new DOMException("The operation was aborted", "AbortError")
    }
  }

  private async validateForWrite(
    repository: GitRepository,
  ): Promise<RepositoryWriteBinding & { repository: GitRepository }> {
    const binding = this.deps.validateRepository
      ? await this.deps.validateRepository(repository)
      : await this.defaultValidateForWrite(repository)
    return { ...binding, repository }
  }

  /**
   * Re-bind a cached repository to the filesystem immediately before a write.
   *
   * The manager root and the working tree are canonicalized afresh, then
   * `git rev-parse --show-toplevel` must still point at that same real root and
   * the real common dir is used as the write-lock key. This defeats a cached
   * `core.worktree` redirect or a symlink swapped in after discovery.
   */
  private async defaultValidateForWrite(
    repository: GitRepository,
  ): Promise<RepositoryWriteBinding> {
    const rootReal = await this.realPathOrResolve(this.root)
    if (this.rootBinding !== undefined && !samePath(rootReal, this.rootBinding)) {
      throw this.mutationRejected("repository_changed")
    }
    let realRoot: string
    try {
      realRoot = await this.deps.realpath(repository.rootPath)
    } catch {
      throw this.mutationRejected("repository_unavailable")
    }
    if (!isWithinPath(rootReal, realRoot)) {
      throw this.mutationRejected("repository_outside_root")
    }

    const recorded = this.writeBindings.get(repository.id)
    if (recorded && !samePath(recorded.realRoot, realRoot)) {
      throw this.mutationRejected("repository_changed")
    }

    let showTopRaw: string
    let commonDirRaw: string
    try {
      const output = await git(realRoot, [
        "rev-parse",
        "--show-toplevel",
        "--path-format=absolute",
        "--git-common-dir",
      ])
      const lines = output
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
      showTopRaw = lines[0] ?? ""
      commonDirRaw = lines[1] ?? ""
    } catch {
      throw this.mutationRejected("repository_unavailable")
    }
    if (!showTopRaw || !commonDirRaw) {
      throw this.mutationRejected("repository_unavailable")
    }

    const showTopReal = await this.realPathOrResolve(path.resolve(realRoot, showTopRaw))
    if (!isWithinPath(rootReal, showTopReal) || !samePath(showTopReal, realRoot)) {
      throw this.mutationRejected("repository_changed")
    }

    const commonDir = await this.realPathOrResolve(path.resolve(realRoot, commonDirRaw))
    if (!this.writeBindings.has(repository.id)) {
      this.writeBindings.set(repository.id, { realRoot, commonDir: "" })
    }
    return { realRoot, commonDir }
  }

  private async realPathOrResolve(value: string): Promise<string> {
    try {
      return await this.deps.realpath(value)
    } catch {
      return path.resolve(value)
    }
  }

  private async withWriteLock<T>(commonDir: string, run: () => Promise<T>): Promise<T> {
    const key = comparablePath(commonDir)
    const previous = this.writeLocks.get(key) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>((resolve) => {
      release = resolve
    })
    const tail = previous.then(
      () => current,
      () => current,
    )
    this.writeLocks.set(key, tail)

    await previous.catch(() => undefined)
    try {
      return await run()
    } finally {
      release()
      if (this.writeLocks.get(key) === tail) this.writeLocks.delete(key)
    }
  }

  private applyMutationSuccess(repositoryId: string, result: MutationEngineResult): void {
    if (this.disposed) return

    // A successful write invalidates the short-lived discovery snapshot; the
    // allowlist entry itself is updated immediately from the returned status so
    // a follow-up read does not have to wait for a rescan.
    this.hasScanned = false
    this.scannedAt = 0
    this.scanGeneration++
    this.scanPromise = null

    const current = this.allowlist.get(repositoryId)
    if (!current) return
    this.allowlist.set(repositoryId, {
      ...current,
      branch: result.status.branch,
      head: result.status.head,
      detached: result.status.detached,
      changes: { ...result.status.counts },
    })
  }

  private abortError(): RepositoryManagerError | DOMException {
    if (this.disposed) {
      return new RepositoryManagerError("disposed", "Repository manager has been disposed")
    }
    return new DOMException("The operation was aborted", "AbortError")
  }

  private throwIfAborted(signal: AbortSignal): void {
    if (signal.aborted) throw this.abortError()
  }

  private async withSignal<T>(
    signal: AbortSignal | undefined,
    run: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const combined = combineSignals([signal, this.lifetime.signal])
    try {
      this.throwIfAborted(combined.signal)
      const result = await run(combined.signal)
      this.throwIfAborted(combined.signal)
      return result
    } catch (error) {
      if (combined.signal.aborted) throw this.abortError()
      throw error
    } finally {
      combined.cleanup()
    }
  }

  private assertCommitHash(hash: string): void {
    if (!isCommitHash(hash)) {
      throw new RepositoryManagerError("invalid_input", "Invalid commit hash", { reason: "hash" })
    }
  }

  private snapshot(): GitRepository[] {
    return cloneRepositories([...this.allowlist.values()])
  }

  private ensureScan(refresh: boolean): Promise<GitRepository[]> {
    if (this.disposed) {
      return Promise.reject(
        new RepositoryManagerError("disposed", "Repository manager has been disposed"),
      )
    }

    if (refresh) {
      this.hasScanned = false
      this.scannedAt = 0
    } else if (this.scanPromise) {
      return this.scanPromise
    } else if (this.hasScanned && this.deps.now() - this.scannedAt < this.ttlMs) {
      return Promise.resolve(this.snapshot())
    }

    const promise = this.runScan()
    this.scanPromise = promise
    const clear = () => {
      if (this.scanPromise === promise) this.scanPromise = null
    }
    promise.then(clear, clear)
    return promise
  }

  private async runScan(): Promise<GitRepository[]> {
    const generation = ++this.scanGeneration
    const discovered = await this.deps.discover(this.root, this.discovery)

    if (this.disposed) {
      throw new RepositoryManagerError("disposed", "Repository manager has been disposed")
    }
    if (generation !== this.scanGeneration) {
      // A newer refresh superseded this scan; return a private copy but do not
      // let stale data overwrite the allowlist.
      return cloneRepositories(discovered)
    }

    const allowlist = new Map<string, GitRepository>()
    for (const repository of discovered) allowlist.set(repository.id, repository)

    // Record the canonical root at discovery time. A later write compares its
    // fresh realpath against this binding, so swapping the path for a symlink
    // (or a cached core.worktree redirect) cannot silently retarget the write.
    const rootReal = await this.realPathOrResolve(this.root)
    if (this.rootBinding === undefined) this.rootBinding = rootReal
    const writeBindings = new Map<string, RepositoryWriteBinding>()
    for (const repository of discovered) {
      const realRoot = await this.realPathOrResolve(repository.rootPath)
      writeBindings.set(repository.id, { realRoot, commonDir: "" })
    }

    this.allowlist = allowlist
    this.writeBindings = writeBindings
    this.hasScanned = true
    this.scannedAt = this.deps.now()
    return cloneRepositories(discovered)
  }
}

/** The subset of the manager the RPC handlers depend on (for test injection). */
export interface GitGraphManager {
  listRepositories(options?: {
    refresh?: boolean
    signal?: AbortSignal
  }): Promise<GitRepository[]>
  getStatus(repositoryId: string, options?: GitSignalOptions): Promise<GitStatus>
  getLog(repositoryId: string, options?: LogOptions): Promise<LogResult>
  getRefs(repositoryId: string, options?: GitSignalOptions): Promise<GitRef[]>
  getCommitFiles(
    repositoryId: string,
    hash: string,
    parentIndex?: number,
    options?: GitSignalOptions,
  ): Promise<ChangedFile[]>
  getCommitFileContent(
    repositoryId: string,
    hash: string,
    filePath: string,
    options?: GitSignalOptions,
  ): Promise<CommitFileContent>
  getDiff(
    repositoryId: string,
    target: GitTarget,
    filePath: string,
    options?: GitSignalOptions,
  ): Promise<FileDiff>
  getComparisonFiles(
    repositoryId: string,
    baseHash: string,
    headHash: string,
    options?: GitSignalOptions,
  ): Promise<ChangedFile[]>
  getComparisonDiff(
    repositoryId: string,
    baseHash: string,
    headHash: string,
    filePath: string,
    options?: GitSignalOptions,
  ): Promise<FileDiff>
  checkoutBranch(
    repositoryId: string,
    input: { branch: string; expectedHead: string | null },
    options?: WriteCallOptions,
  ): Promise<GitMutationResult>
  createBranch(
    repositoryId: string,
    input: {
      name: string
      startPoint: string
      checkout?: boolean
      expectedHead: string | null
    },
    options?: WriteCallOptions,
  ): Promise<GitMutationResult>
  createTag(
    repositoryId: string,
    input: { name: string; target: string; message?: string; expectedHead: string | null },
    options?: WriteCallOptions,
  ): Promise<GitMutationResult>
  renameBranch(
    repositoryId: string,
    input: { oldName: string; newName: string; expectedHead: string | null },
    options?: WriteCallOptions,
  ): Promise<GitMutationResult>
  deleteBranch(
    repositoryId: string,
    input: { name: string; expectedHead: string | null },
    options?: WriteCallOptions,
  ): Promise<GitMutationResult>
  deleteTag(
    repositoryId: string,
    input: { name: string; expectedHead: string | null },
    options?: WriteCallOptions,
  ): Promise<GitMutationResult>
  fetchRemote(
    repositoryId: string,
    input: { remote?: string | null; prune?: boolean; expectedHead: string | null },
    options?: WriteCallOptions,
  ): Promise<GitFetchResult>
}

const SIGNAL_BEFORE =
  "Request cancelled before the git operation; no git process was started"
const SIGNAL_AFTER =
  "Request cancelled after the operation completed; no further work was started"
const SIGNAL_ABORTED =
  "Request cancelled; the in-flight git operation was aborted where possible (repository discovery is not cancellable)"

type MappedRpcError =
  | { type: "repository_not_found"; repositoryId: string }
  | { type: "invalid_input"; reason: string }
  | { type: "disposed" }
  | { type: "git_failed"; operation: string }

function mapError(error: unknown, operation: string): MappedRpcError {
  if (error instanceof RepositoryManagerError) {
    switch (error.type) {
      case "repository_not_found":
        return { type: "repository_not_found", repositoryId: error.data.repositoryId ?? "" }
      case "invalid_input":
        return { type: "invalid_input", reason: error.data.reason ?? "input" }
      case "mutation_rejected":
        return { type: "git_failed", operation }
      case "disposed":
        return { type: "disposed" }
    }
  }
  // Engine-level validation errors (e.g. an out-of-range parent index) are
  // caller input problems, not git failures. Their messages can echo the
  // rejected value, so only a generic reason crosses the RPC boundary.
  if (error instanceof GitInputError) {
    return { type: "invalid_input", reason: "input" }
  }
  return { type: "git_failed", operation }
}

interface MutationErrorInfo {
  type: "repository_not_found" | "invalid_input" | "disposed" | "mutation_rejected" | "git_failed"
  message: string
  data: Record<string, unknown>
}

/**
 * Write failures are mapped to a single `mutation_rejected` error carrying only
 * a bounded reason. Stderr, GitError fields and filesystem paths never cross
 * the RPC boundary.
 */
function mutationErrorInfo(error: unknown): MutationErrorInfo {
  if (error instanceof RepositoryManagerError) {
    switch (error.type) {
      case "repository_not_found":
        return {
          type: "repository_not_found",
          message: "Repository not found",
          data: { repositoryId: error.data.repositoryId ?? "" },
        }
      case "invalid_input":
        return {
          type: "invalid_input",
          message: "Invalid input",
          data: { reason: error.data.reason ?? "input" },
        }
      case "mutation_rejected":
        return {
          type: "mutation_rejected",
          message: "Mutation rejected",
          data: { reason: boundedMutationReason(error.data.reason) },
        }
      case "disposed":
        return { type: "disposed", message: "Git graph manager has been disposed", data: {} }
    }
  }
  if (isAbortError(error)) {
    return {
      type: "git_failed",
      message: SIGNAL_BEFORE,
      data: { operation: "cancelled" },
    }
  }
  if (error instanceof GitInputError) {
    return { type: "invalid_input", message: "Invalid input", data: { reason: "input" } }
  }
  if (isGitMutationError(error)) {
    return {
      type: "mutation_rejected",
      message: "Mutation rejected",
      data: { reason: boundedMutationReason(error.reason) },
    }
  }
  return {
    type: "mutation_rejected",
    message: "Mutation rejected",
    data: { reason: "mutation_failed" },
  }
}

function reportMutationError(
  context: { error: unknown },
  error: unknown,
): never {
  const info = mutationErrorInfo(error)
  const factory = context.error as (
    type: string,
    message: string,
    data: Record<string, unknown>,
  ) => unknown
  return factory(info.type, info.message, info.data) as never
}

/**
 * Build typed RPC handlers for a repository manager.
 *
 * The caller signal is forwarded through the manager into the git engine, so
 * in-flight git commands are aborted. Repository discovery is not cancellable;
 * when an abort lands during a scan the scan is allowed to finish and the
 * request is then rejected. Handler-level pre/post checks cover the race where
 * the signal aborts just outside the manager call.
 */
export function createGitGraphHandlers(
  manager: GitGraphManager,
): RpcHandlers<typeof GitGraphRpc> {
  return {
    ping: async (input) => ({
      ok: true as const,
      message: input.message ?? "pong",
    }),

    listRepositories: async (input, context) => {
      if (context.signal.aborted) {
        return context.error("git_failed", SIGNAL_BEFORE, { operation: "cancelled" })
      }
      try {
        const repositories = await manager.listRepositories({
          refresh: input.refresh === true,
          signal: context.signal,
        })
        if (context.signal.aborted) {
          return context.error("git_failed", SIGNAL_AFTER, { operation: "cancelled" })
        }
        return { repositories }
      } catch (error) {
        const mapped = mapError(error, "listRepositories")
        if (mapped.type === "disposed") {
          return context.error("disposed", "Git graph manager has been disposed", {})
        }
        if (context.signal.aborted || isAbortError(error)) {
          return context.error("git_failed", SIGNAL_ABORTED, { operation: "cancelled" })
        }
        switch (mapped.type) {
          case "repository_not_found":
            return context.error("repository_not_found", "Repository not found", {
              repositoryId: mapped.repositoryId,
            })
          case "invalid_input":
            return context.error("invalid_input", "Invalid input", { reason: mapped.reason })
          case "git_failed":
            return context.error("git_failed", "Git operation failed", {
              operation: mapped.operation,
            })
        }
      }
    },

    getStatus: async (input, context) => {
      if (context.signal.aborted) {
        return context.error("git_failed", SIGNAL_BEFORE, { operation: "cancelled" })
      }
      try {
        const status = await manager.getStatus(input.repositoryId, { signal: context.signal })
        if (context.signal.aborted) {
          return context.error("git_failed", SIGNAL_AFTER, { operation: "cancelled" })
        }
        return status
      } catch (error) {
        const mapped = mapError(error, "getStatus")
        if (mapped.type === "disposed") {
          return context.error("disposed", "Git graph manager has been disposed", {})
        }
        if (context.signal.aborted || isAbortError(error)) {
          return context.error("git_failed", SIGNAL_ABORTED, { operation: "cancelled" })
        }
        switch (mapped.type) {
          case "repository_not_found":
            return context.error("repository_not_found", "Repository not found", {
              repositoryId: mapped.repositoryId,
            })
          case "invalid_input":
            return context.error("invalid_input", "Invalid input", { reason: mapped.reason })
          case "git_failed":
            return context.error("git_failed", "Git operation failed", {
              operation: mapped.operation,
            })
        }
      }
    },

    getLog: async (input, context) => {
      if (context.signal.aborted) {
        return context.error("git_failed", SIGNAL_BEFORE, { operation: "cancelled" })
      }
      try {
        const result = await manager.getLog(input.repositoryId, {
          limit: input.limit,
          skip: input.skip,
          refs: input.refs,
          showRemotes: input.showRemotes,
          showTags: input.showTags,
          firstParent: input.firstParent,
          order: input.order,
          signal: context.signal,
        })
        if (context.signal.aborted) {
          return context.error("git_failed", SIGNAL_AFTER, { operation: "cancelled" })
        }
        return result
      } catch (error) {
        const mapped = mapError(error, "getLog")
        if (mapped.type === "disposed") {
          return context.error("disposed", "Git graph manager has been disposed", {})
        }
        if (context.signal.aborted || isAbortError(error)) {
          return context.error("git_failed", SIGNAL_ABORTED, { operation: "cancelled" })
        }
        switch (mapped.type) {
          case "repository_not_found":
            return context.error("repository_not_found", "Repository not found", {
              repositoryId: mapped.repositoryId,
            })
          case "invalid_input":
            return context.error("invalid_input", "Invalid input", { reason: mapped.reason })
          case "git_failed":
            return context.error("git_failed", "Git operation failed", {
              operation: mapped.operation,
            })
        }
      }
    },

    getRefs: async (input, context) => {
      if (context.signal.aborted) {
        return context.error("git_failed", SIGNAL_BEFORE, { operation: "cancelled" })
      }
      try {
        const refs = await manager.getRefs(input.repositoryId, { signal: context.signal })
        if (context.signal.aborted) {
          return context.error("git_failed", SIGNAL_AFTER, { operation: "cancelled" })
        }
        return { refs }
      } catch (error) {
        const mapped = mapError(error, "getRefs")
        if (mapped.type === "disposed") {
          return context.error("disposed", "Git graph manager has been disposed", {})
        }
        if (context.signal.aborted || isAbortError(error)) {
          return context.error("git_failed", SIGNAL_ABORTED, { operation: "cancelled" })
        }
        switch (mapped.type) {
          case "repository_not_found":
            return context.error("repository_not_found", "Repository not found", {
              repositoryId: mapped.repositoryId,
            })
          case "invalid_input":
            return context.error("invalid_input", "Invalid input", { reason: mapped.reason })
          case "git_failed":
            return context.error("git_failed", "Git operation failed", {
              operation: mapped.operation,
            })
        }
      }
    },

    getCommitFiles: async (input, context) => {
      if (context.signal.aborted) {
        return context.error("git_failed", SIGNAL_BEFORE, { operation: "cancelled" })
      }
      try {
        const files = await manager.getCommitFiles(
          input.repositoryId,
          input.hash,
          input.parentIndex,
          { signal: context.signal },
        )
        if (context.signal.aborted) {
          return context.error("git_failed", SIGNAL_AFTER, { operation: "cancelled" })
        }
        return { files }
      } catch (error) {
        const mapped = mapError(error, "getCommitFiles")
        if (mapped.type === "disposed") {
          return context.error("disposed", "Git graph manager has been disposed", {})
        }
        if (context.signal.aborted || isAbortError(error)) {
          return context.error("git_failed", SIGNAL_ABORTED, { operation: "cancelled" })
        }
        switch (mapped.type) {
          case "repository_not_found":
            return context.error("repository_not_found", "Repository not found", {
              repositoryId: mapped.repositoryId,
            })
          case "invalid_input":
            return context.error("invalid_input", "Invalid input", { reason: mapped.reason })
          case "git_failed":
            return context.error("git_failed", "Git operation failed", {
              operation: mapped.operation,
            })
        }
      }
    },

    getCommitFileContent: async (input, context) => {
      if (context.signal.aborted) {
        return context.error("git_failed", SIGNAL_BEFORE, { operation: "cancelled" })
      }
      try {
        const content = await manager.getCommitFileContent(
          input.repositoryId,
          input.hash,
          input.path,
          { signal: context.signal },
        )
        if (context.signal.aborted) {
          return context.error("git_failed", SIGNAL_AFTER, { operation: "cancelled" })
        }
        return content
      } catch (error) {
        const mapped = mapError(error, "getCommitFileContent")
        if (mapped.type === "disposed") {
          return context.error("disposed", "Git graph manager has been disposed", {})
        }
        if (context.signal.aborted || isAbortError(error)) {
          return context.error("git_failed", SIGNAL_ABORTED, { operation: "cancelled" })
        }
        switch (mapped.type) {
          case "repository_not_found":
            return context.error("repository_not_found", "Repository not found", {
              repositoryId: mapped.repositoryId,
            })
          case "invalid_input":
            return context.error("invalid_input", "Invalid input", { reason: mapped.reason })
          case "git_failed":
            return context.error("git_failed", "Git operation failed", {
              operation: mapped.operation,
            })
        }
      }
    },

    getDiff: async (input, context) => {
      if (context.signal.aborted) {
        return context.error("git_failed", SIGNAL_BEFORE, { operation: "cancelled" })
      }
      try {
        const diff = await manager.getDiff(input.repositoryId, input.target, input.path, {
          signal: context.signal,
        })
        if (context.signal.aborted) {
          return context.error("git_failed", SIGNAL_AFTER, { operation: "cancelled" })
        }
        return diff
      } catch (error) {
        const mapped = mapError(error, "getDiff")
        if (mapped.type === "disposed") {
          return context.error("disposed", "Git graph manager has been disposed", {})
        }
        if (context.signal.aborted || isAbortError(error)) {
          return context.error("git_failed", SIGNAL_ABORTED, { operation: "cancelled" })
        }
        switch (mapped.type) {
          case "repository_not_found":
            return context.error("repository_not_found", "Repository not found", {
              repositoryId: mapped.repositoryId,
            })
          case "invalid_input":
            return context.error("invalid_input", "Invalid input", { reason: mapped.reason })
          case "git_failed":
            return context.error("git_failed", "Git operation failed", {
              operation: mapped.operation,
            })
        }
      }
    },

    getComparisonFiles: async (input, context) => {
      if (context.signal.aborted) {
        return context.error("git_failed", SIGNAL_BEFORE, { operation: "cancelled" })
      }
      try {
        const files = await manager.getComparisonFiles(
          input.repositoryId,
          input.baseHash,
          input.headHash,
          { signal: context.signal },
        )
        if (context.signal.aborted) {
          return context.error("git_failed", SIGNAL_AFTER, { operation: "cancelled" })
        }
        return { files }
      } catch (error) {
        const mapped = mapError(error, "getComparisonFiles")
        if (mapped.type === "disposed") {
          return context.error("disposed", "Git graph manager has been disposed", {})
        }
        if (context.signal.aborted || isAbortError(error)) {
          return context.error("git_failed", SIGNAL_ABORTED, { operation: "cancelled" })
        }
        switch (mapped.type) {
          case "repository_not_found":
            return context.error("repository_not_found", "Repository not found", {
              repositoryId: mapped.repositoryId,
            })
          case "invalid_input":
            return context.error("invalid_input", "Invalid input", { reason: mapped.reason })
          case "git_failed":
            return context.error("git_failed", "Git operation failed", {
              operation: mapped.operation,
            })
        }
      }
    },

    getComparisonDiff: async (input, context) => {
      if (context.signal.aborted) {
        return context.error("git_failed", SIGNAL_BEFORE, { operation: "cancelled" })
      }
      try {
        const diff = await manager.getComparisonDiff(
          input.repositoryId,
          input.baseHash,
          input.headHash,
          input.path,
          { signal: context.signal },
        )
        if (context.signal.aborted) {
          return context.error("git_failed", SIGNAL_AFTER, { operation: "cancelled" })
        }
        return diff
      } catch (error) {
        const mapped = mapError(error, "getComparisonDiff")
        if (mapped.type === "disposed") {
          return context.error("disposed", "Git graph manager has been disposed", {})
        }
        if (context.signal.aborted || isAbortError(error)) {
          return context.error("git_failed", SIGNAL_ABORTED, { operation: "cancelled" })
        }
        switch (mapped.type) {
          case "repository_not_found":
            return context.error("repository_not_found", "Repository not found", {
              repositoryId: mapped.repositoryId,
            })
          case "invalid_input":
            return context.error("invalid_input", "Invalid input", { reason: mapped.reason })
          case "git_failed":
            return context.error("git_failed", "Git operation failed", {
              operation: mapped.operation,
            })
        }
      }
    },

    checkoutBranch: async (input, context) => {
      if (input.confirmed !== true) {
        return context.error("invalid_input", "Invalid input", { reason: "confirmation" })
      }
      if (context.signal.aborted) {
        return context.error("git_failed", SIGNAL_BEFORE, { operation: "cancelled" })
      }
      try {
        return await manager.checkoutBranch(
          input.repositoryId,
          { branch: input.branch, expectedHead: input.expectedHead },
          { signal: context.signal },
        )
      } catch (error) {
        return reportMutationError(context, error)
      }
    },

    createBranch: async (input, context) => {
      if (input.confirmed !== true) {
        return context.error("invalid_input", "Invalid input", { reason: "confirmation" })
      }
      if (context.signal.aborted) {
        return context.error("git_failed", SIGNAL_BEFORE, { operation: "cancelled" })
      }
      try {
        return await manager.createBranch(
          input.repositoryId,
          {
            name: input.name,
            startPoint: input.startPoint,
            checkout: input.checkout,
            expectedHead: input.expectedHead,
          },
          { signal: context.signal },
        )
      } catch (error) {
        return reportMutationError(context, error)
      }
    },

    createTag: async (input, context) => {
      if (input.confirmed !== true) {
        return context.error("invalid_input", "Invalid input", { reason: "confirmation" })
      }
      if (context.signal.aborted) {
        return context.error("git_failed", SIGNAL_BEFORE, { operation: "cancelled" })
      }
      try {
        return await manager.createTag(
          input.repositoryId,
          {
            name: input.name,
            target: input.target,
            message: input.message,
            expectedHead: input.expectedHead,
          },
          { signal: context.signal },
        )
      } catch (error) {
        return reportMutationError(context, error)
      }
    },

    renameBranch: async (input, context) => {
      if (input.confirmed !== true) {
        return context.error("invalid_input", "Invalid input", { reason: "confirmation" })
      }
      if (context.signal.aborted) {
        return context.error("git_failed", SIGNAL_BEFORE, { operation: "cancelled" })
      }
      try {
        return await manager.renameBranch(
          input.repositoryId,
          {
            oldName: input.oldName,
            newName: input.newName,
            expectedHead: input.expectedHead,
          },
          { signal: context.signal },
        )
      } catch (error) {
        return reportMutationError(context, error)
      }
    },

    deleteBranch: async (input, context) => {
      if (input.confirmed !== true) {
        return context.error("invalid_input", "Invalid input", { reason: "confirmation" })
      }
      if (context.signal.aborted) {
        return context.error("git_failed", SIGNAL_BEFORE, { operation: "cancelled" })
      }
      try {
        return await manager.deleteBranch(
          input.repositoryId,
          { name: input.name, expectedHead: input.expectedHead },
          { signal: context.signal },
        )
      } catch (error) {
        return reportMutationError(context, error)
      }
    },

    deleteTag: async (input, context) => {
      if (input.confirmed !== true) {
        return context.error("invalid_input", "Invalid input", { reason: "confirmation" })
      }
      if (context.signal.aborted) {
        return context.error("git_failed", SIGNAL_BEFORE, { operation: "cancelled" })
      }
      try {
        return await manager.deleteTag(
          input.repositoryId,
          { name: input.name, expectedHead: input.expectedHead },
          { signal: context.signal },
        )
      } catch (error) {
        return reportMutationError(context, error)
      }
    },

    fetchRemote: async (input, context) => {
      if (input.confirmed !== true) {
        return context.error("invalid_input", "Invalid input", { reason: "confirmation" })
      }
      if (context.signal.aborted) {
        return context.error("git_failed", SIGNAL_BEFORE, { operation: "cancelled" })
      }
      try {
        return await manager.fetchRemote(
          input.repositoryId,
          {
            remote: input.remote ?? null,
            ...(input.prune === undefined ? {} : { prune: input.prune }),
            expectedHead: input.expectedHead,
          },
          { signal: context.signal },
        )
      } catch (error) {
        return reportMutationError(context, error)
      }
    },
  }
}
