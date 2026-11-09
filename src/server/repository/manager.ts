import path from "node:path"
import type { RpcHandlers } from "@opencode/plugin/promise/rpc"
import { GitGraphRpc, isCommitHash, isSafeRelativePath } from "../../rpc.js"
import type {
  ChangedFile,
  FileDiff,
  GitRef,
  GitRepository,
  GitStatus,
  GitTarget,
} from "../../shared/types.js"
import { getCommitFiles, getDiff } from "../git/diff.js"
import type { GitSignalOptions } from "../git/executor.js"
import { getLog, type LogOptions, type LogResult } from "../git/log.js"
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
  getDiff: (
    repositoryPath: string,
    target: GitTarget,
    filePath: string,
    options?: GitSignalOptions,
  ) => Promise<FileDiff>
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
  getDiff,
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
    this.allowlist = allowlist
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
  getDiff(
    repositoryId: string,
    target: GitTarget,
    filePath: string,
    options?: GitSignalOptions,
  ): Promise<FileDiff>
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
  }
}
