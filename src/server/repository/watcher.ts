import { existsSync, watch, type FSWatcher, type WatchOptions } from "node:fs"
import path from "node:path"
import type { GitRepository } from "../../shared/types.js"
import { git } from "../git/executor.js"

/**
 * Watches every allowlisted repository for changes that can move refs, HEAD or
 * the index and reports the affected repository id.
 *
 * The watcher deliberately stays coarse: it only observes git metadata (control
 * files and the refs subtree), never the working tree. A trailing debounce
 * coalesces the burst of events a single `git commit`/`checkout` produces into
 * one notification per repository, which is all the GUI needs to refetch.
 */

/** Minimal manager surface required by the watcher (for test injection). */
export interface RepositoryListSource {
  listRepositories(options?: {
    refresh?: boolean
    signal?: AbortSignal
  }): Promise<GitRepository[]>
}

export type WatchFactory = (
  target: string,
  options: WatchOptions,
  listener: (eventType: string, filename: string | Buffer | null) => void,
) => FSWatcher

export interface WorkspaceWatcherOptions {
  /** Trailing coalescing window per repository. Defaults to 250 ms. */
  debounceMs?: number
  /** Allowlist refresh interval. Defaults to 12 s. */
  syncIntervalMs?: number
  /** First reconnect delay after a watcher error. Defaults to 500 ms. */
  reconnectBaseMs?: number
  /** Maximum reconnect delay. Defaults to 30 s. */
  reconnectMaxMs?: number
  /** Injectable `fs.watch` (tests use this to surface watcher errors). */
  watchFactory?: WatchFactory
}

const DEFAULT_DEBOUNCE_MS = 250
const DEFAULT_SYNC_INTERVAL_MS = 12_000
const DEFAULT_RECONNECT_BASE_MS = 500
const DEFAULT_RECONNECT_MAX_MS = 30_000

const CONTROL_FILES = new Set(["HEAD", "index", "packed-refs"])

const defaultWatchFactory: WatchFactory = (target, options, listener) =>
  watch(target, options, listener)

type SlotKind = "control" | "refs"

/**
 * One independently retried watch target. Control-file and refs watches never
 * share a retry timer, so a failure in the refs subtree cannot take down the
 * HEAD/index watcher (and vice versa).
 */
interface WatchSlot {
  readonly key: string
  readonly kind: SlotKind
  readonly dir: string
  watcher: FSWatcher | undefined
  reconnectTimer: ReturnType<typeof setTimeout> | undefined
  /** Consecutive attach failures, used for the exponential backoff. */
  failures: number
  /** True while a reconnect is scheduled or an attach is in progress. */
  rebuilding: boolean
  /** Refs only: watching `dir` because `dir/refs` was missing. */
  degraded: boolean
}

interface WatchedRepository {
  id: string
  gitDir: string
  type: GitRepository["type"]
  dirs: string[]
  /** Last observed existence of `dirs[i]/refs`, per dir. */
  refsPresent: Map<string, boolean>
  slots: Map<string, WatchSlot>
  debounceTimer: ReturnType<typeof setTimeout> | undefined
}

function comparablePath(value: string): string {
  const resolved = path.resolve(value)
  return process.platform === "win32" ? resolved.toLowerCase() : resolved
}

function samePath(left: string, right: string): boolean {
  return comparablePath(left) === comparablePath(right)
}

function slotKey(kind: SlotKind, dir: string): string {
  return `${kind}:${comparablePath(dir)}`
}

function normalizedFilename(filename: string | Buffer | null): string | null {
  if (filename === null) return null
  const value = typeof filename === "string" ? filename : filename.toString()
  return value.replace(/\\/g, "/")
}

function unref(timer: ReturnType<typeof setTimeout> | ReturnType<typeof setInterval>): void {
  const candidate = timer as { unref?: () => void }
  candidate.unref?.()
}

function positiveDuration(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value < 0) return fallback
  return Math.floor(value)
}

export class WorkspaceWatcher {
  private readonly manager: RepositoryListSource
  private readonly onChange: (repositoryId: string) => void
  private readonly debounceMs: number
  private readonly syncIntervalMs: number
  private readonly reconnectBaseMs: number
  private readonly reconnectMaxMs: number
  private readonly watchFactory: WatchFactory

  private readonly repositories = new Map<string, WatchedRepository>()
  private started = false
  private disposed = false
  private hasCompletedInitialSync = false
  private syncTimer: ReturnType<typeof setInterval> | undefined
  private syncPromise: Promise<void> | null = null

  constructor(
    manager: RepositoryListSource,
    onChange: (repositoryId: string) => void,
    options: WorkspaceWatcherOptions = {},
  ) {
    this.manager = manager
    this.onChange = onChange
    this.debounceMs = positiveDuration(options.debounceMs, DEFAULT_DEBOUNCE_MS)
    this.syncIntervalMs = positiveDuration(options.syncIntervalMs, DEFAULT_SYNC_INTERVAL_MS)
    this.reconnectBaseMs = positiveDuration(options.reconnectBaseMs, DEFAULT_RECONNECT_BASE_MS)
    this.reconnectMaxMs = positiveDuration(options.reconnectMaxMs, DEFAULT_RECONNECT_MAX_MS)
    this.watchFactory = options.watchFactory ?? defaultWatchFactory
  }

  /**
   * Discover the current allowlist and attach one watcher set per repository.
   * Calls are idempotent; discovery failures are retried by the periodic sync.
   */
  async start(): Promise<void> {
    if (this.started || this.disposed) return
    this.started = true
    await this.sync()
    if (this.disposed) return
    this.syncTimer = setInterval(() => {
      void this.sync()
    }, this.syncIntervalMs)
    unref(this.syncTimer)
  }

  /** Stop watching and cancel every pending notification. Idempotent. */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.started = false
    if (this.syncTimer !== undefined) {
      clearInterval(this.syncTimer)
      this.syncTimer = undefined
    }
    this.syncPromise = null
    for (const entry of [...this.repositories.values()]) this.removeEntry(entry)
    this.repositories.clear()
  }

  /** Re-run the allowlist sync immediately (used by tests). */
  async refreshForTests(): Promise<void> {
    await this.sync()
  }

  private sync(): Promise<void> {
    if (this.disposed) return Promise.resolve()
    if (this.syncPromise) return this.syncPromise

    let promise: Promise<void>
    promise = (async () => {
      try {
        await this.runSync()
      } catch {
        // A failed scan is not fatal: the next sync retries.
      }
    })().finally(() => {
      if (this.syncPromise === promise) this.syncPromise = null
    })
    this.syncPromise = promise
    return promise
  }

  private async runSync(): Promise<void> {
    if (this.disposed) return

    let repositories: GitRepository[]
    try {
      repositories = await this.manager.listRepositories()
    } catch {
      // Manager disposed or discovery failed; keep the previous allowlist.
      return
    }
    if (this.disposed) return

    const initialSync = !this.hasCompletedInitialSync
    const next = new Map<string, GitRepository>()
    for (const repository of repositories) next.set(repository.id, repository)

    for (const id of [...this.repositories.keys()]) {
      if (!next.has(id)) this.removeRepository(id)
    }

    for (const repository of next.values()) {
      if (this.disposed) return
      const existing = this.repositories.get(repository.id)
      if (existing) {
        const sameGitDir =
          existing.type === repository.type && samePath(existing.gitDir, repository.gitDir)
        if (sameGitDir) {
          await this.reconcileRepository(existing, repository)
          continue
        }
        this.removeEntry(existing)
      }
      await this.addRepository(repository, { notify: !initialSync })
    }

    this.hasCompletedInitialSync = true
  }

  private async addRepository(
    repository: GitRepository,
    options: { notify: boolean },
  ): Promise<void> {
    const dirs = await this.resolveWatchDirs(repository)
    if (this.disposed) return

    const entry: WatchedRepository = {
      id: repository.id,
      gitDir: repository.gitDir,
      type: repository.type,
      dirs,
      refsPresent: new Map(),
      slots: new Map(),
      debounceTimer: undefined,
    }
    for (const dir of dirs) {
      entry.refsPresent.set(dir, existsSync(path.join(dir, "refs")))
    }
    this.repositories.set(entry.id, entry)
    this.attachRepository(entry)

    // A repository that appears after startup changes the allowlist, so the
    // GUI needs one refresh. The initial scan is silent (the GUI lists on
    // load), and periodic syncs never re-notify existing repositories.
    if (options.notify) this.schedule(entry)
  }

  /**
   * A linked worktree's `gitDir` only holds its private metadata (HEAD, index);
   * refs live in the shared common dir. Resolve the common dir so both sides are
   * watched; a normal repository resolves to the same directory once.
   *
   * `--path-format=absolute` is avoided so older git versions work; the
   * returned path may be relative to the working tree, so it is resolved
   * against `rootPath`. If resolution fails the watcher keeps only the private
   * gitDir (a documented degradation: shared refs are not reported).
   */
  private async resolveWatchDirs(repository: GitRepository): Promise<string[]> {
    const dirs = [path.resolve(repository.gitDir)]
    try {
      const output = await git(repository.rootPath, ["rev-parse", "--git-common-dir"])
      const raw = output.trim()
      if (raw) {
        const commonDir = path.resolve(repository.rootPath, raw)
        if (!dirs.some((dir) => samePath(dir, commonDir))) dirs.push(commonDir)
      }
    } catch {
      // Degraded: watch the private gitDir only. The next sync retries while
      // the common dir is still missing for a worktree.
    }
    return dirs
  }

  private attachRepository(entry: WatchedRepository): void {
    if (!this.isCurrent(entry)) return
    for (const dir of entry.dirs) {
      this.ensureSlot(entry, "control", dir)
      this.ensureSlot(entry, "refs", dir)
    }
  }

  private ensureSlot(
    entry: WatchedRepository,
    kind: SlotKind,
    dir: string,
    force = false,
  ): void {
    if (!this.isCurrent(entry)) return
    const key = slotKey(kind, dir)
    let slot = entry.slots.get(key)
    if (!slot) {
      slot = {
        key,
        kind,
        dir,
        watcher: undefined,
        reconnectTimer: undefined,
        failures: 0,
        rebuilding: false,
        degraded: false,
      }
      entry.slots.set(key, slot)
    }
    if (slot.watcher !== undefined) return
    if (slot.rebuilding || slot.reconnectTimer !== undefined) {
      if (!force) return
      // A periodic sync may retry a slot that is waiting in backoff; this keeps
      // a failed attach from waiting up to reconnectMaxMs without blocking any
      // other slot.
      if (slot.reconnectTimer !== undefined) {
        clearTimeout(slot.reconnectTimer)
        slot.reconnectTimer = undefined
      }
      slot.rebuilding = false
    }
    this.attachSlot(entry, slot)
  }

  /** Attach one slot; failures only schedule that slot's own retry. */
  private attachSlot(entry: WatchedRepository, slot: WatchSlot): void {
    if (!this.isLiveSlot(entry, slot)) return

    let target = slot.dir
    let options: WatchOptions = { persistent: false }
    let degraded = false
    if (slot.kind === "refs") {
      const refsDir = path.join(slot.dir, "refs")
      const refsExist = existsSync(refsDir)
      entry.refsPresent.set(slot.dir, refsExist)
      if (refsExist) {
        target = refsDir
        options = { recursive: true, persistent: false }
      } else {
        // Fallback: the refs dir does not exist yet. Watching the git dir still
        // lets us notice its creation and then upgrade to a recursive watch.
        // Known limitation: reftable repositories keep refs outside refs/
        // (e.g. under reftable/) and are not observed by this watcher.
        degraded = true
      }
    }
    // Record the mode we are attempting even if the watch call fails, so the
    // next sync knows this slot is degraded and retries it.
    slot.degraded = degraded

    let watcher: FSWatcher
    try {
      watcher = this.watchFactory(target, options, (_event, filename) => {
        this.handleSlotEvent(entry, slot, filename)
      })
    } catch {
      this.handleSlotFailure(entry, slot)
      return
    }

    if (!this.isLiveSlot(entry, slot)) {
      // The entry/slot was replaced while the watcher was being created.
      this.closeWatcher(watcher)
      return
    }

    slot.watcher = watcher
    slot.failures = 0
    slot.rebuilding = false
    watcher.on("error", () => this.handleSlotFailure(entry, slot))
  }

  private handleSlotEvent(
    entry: WatchedRepository,
    slot: WatchSlot,
    filename: string | Buffer | null,
  ): void {
    if (!this.isLiveSlot(entry, slot)) return

    // Refs can be deleted and recreated (or a worktree common dir can appear
    // later); reconcile before filtering so the next update uses the right
    // watcher mode.
    this.reconcileRefsSlot(entry, slot.dir)

    if (slot.kind === "control") {
      if (!this.isControlFileEvent(filename)) return
    } else if (this.isIgnoredFilename(filename)) {
      return
    }
    this.schedule(entry)
  }

  /**
   * Compare the actual `refs` existence with the last recorded state and
   * rebuild that slot on a mismatch. A refs slot is also rebuilt when its
   * degraded flag no longer matches reality (fallback vs recursive).
   */
  private reconcileRefsSlot(entry: WatchedRepository, dir: string): void {
    if (!this.isCurrent(entry)) return
    const slot = entry.slots.get(slotKey("refs", dir))
    if (!slot) return

    const exists = existsSync(path.join(dir, "refs"))
    const recorded = entry.refsPresent.get(dir)
    const modeMismatch = slot.degraded !== !exists
    if (recorded === exists && !modeMismatch) return

    entry.refsPresent.set(dir, exists)
    this.rebuildSlot(entry, slot)
  }

  private rebuildSlot(entry: WatchedRepository, slot: WatchSlot): void {
    if (!this.isLiveSlot(entry, slot)) return
    this.closeSlotWatcher(slot)
    if (slot.reconnectTimer !== undefined) {
      clearTimeout(slot.reconnectTimer)
      slot.reconnectTimer = undefined
    }
    slot.rebuilding = false
    slot.failures = 0
    this.attachSlot(entry, slot)
  }

  private isControlFileEvent(filename: string | Buffer | null): boolean {
    const value = normalizedFilename(filename)
    if (value === null) return true
    if (value.includes("/")) return false
    if (this.isIgnoredFilename(value)) return false
    return CONTROL_FILES.has(value)
  }

  private isIgnoredFilename(filename: string | Buffer | null): boolean {
    const value = normalizedFilename(filename)
    if (value === null) return false
    const segments = value.split("/")
    if (segments.includes("objects")) return true
    return segments[segments.length - 1]?.endsWith(".lock") ?? false
  }

  /**
   * Trailing debounce: every new event restarts the window, so a burst (or a
   * slow disk emitting events over a longer period) produces one notification.
   */
  private schedule(entry: WatchedRepository): void {
    if (!this.isCurrent(entry)) return
    if (entry.debounceTimer !== undefined) clearTimeout(entry.debounceTimer)

    entry.debounceTimer = setTimeout(() => {
      entry.debounceTimer = undefined
      if (!this.isCurrent(entry)) return
      try {
        this.onChange(entry.id)
      } catch {
        // A failing consumer must never break the watch loop.
      }
    }, this.debounceMs)
    unref(entry.debounceTimer)
  }

  private handleSlotFailure(entry: WatchedRepository, slot: WatchSlot): void {
    if (!this.isLiveSlot(entry, slot)) return
    if (slot.rebuilding || slot.reconnectTimer !== undefined) return

    slot.rebuilding = true
    this.closeSlotWatcher(slot)
    this.scheduleSlotReconnect(entry, slot)
  }

  private scheduleSlotReconnect(entry: WatchedRepository, slot: WatchSlot): void {
    if (!this.isLiveSlot(entry, slot)) return
    if (slot.reconnectTimer !== undefined) return

    slot.failures = Math.min(slot.failures + 1, 30)
    const delay = Math.min(
      this.reconnectMaxMs,
      this.reconnectBaseMs * 2 ** (slot.failures - 1),
    )
    slot.reconnectTimer = setTimeout(() => {
      slot.reconnectTimer = undefined
      if (!this.isLiveSlot(entry, slot)) return
      slot.rebuilding = false
      this.attachSlot(entry, slot)
    }, delay)
    unref(slot.reconnectTimer)
  }

  /**
   * Reconcile an existing repository on every sync: retry a failed common-dir
   * resolution for worktrees, restore degraded refs watches, and re-establish
   * any slot that lost its watcher. Existing repositories are never notified
   * here; only a newly added repository triggers a list refresh.
   */
  private async reconcileRepository(
    entry: WatchedRepository,
    repository: GitRepository,
  ): Promise<void> {
    if (!this.isCurrent(entry)) return

    if (entry.type === "worktree" && entry.dirs.length < 2) {
      const resolved = await this.resolveWatchDirs(repository)
      if (!this.isCurrent(entry)) return
      for (const dir of resolved) {
        if (entry.dirs.some((existing) => samePath(existing, dir))) continue
        entry.dirs.push(dir)
        entry.refsPresent.set(dir, existsSync(path.join(dir, "refs")))
        this.ensureSlot(entry, "control", dir)
        this.ensureSlot(entry, "refs", dir)
      }
    }

    for (const dir of entry.dirs) {
      if (!this.isCurrent(entry)) return
      const exists = existsSync(path.join(dir, "refs"))
      const recorded = entry.refsPresent.get(dir)
      const refsSlot = entry.slots.get(slotKey("refs", dir))
      const modeMismatch = refsSlot !== undefined && refsSlot.degraded !== !exists
      if (recorded !== exists || modeMismatch) {
        entry.refsPresent.set(dir, exists)
        if (refsSlot) this.rebuildSlot(entry, refsSlot)
        else this.ensureSlot(entry, "refs", dir)
      } else {
        // Retry a slot whose previous attach failed instead of waiting for the
        // full reconnect backoff. A healthy degraded fallback has a watcher and
        // is therefore left untouched.
        this.ensureSlot(entry, "refs", dir, true)
      }
      this.ensureSlot(entry, "control", dir, true)
    }
  }

  private isCurrent(entry: WatchedRepository): boolean {
    return !this.disposed && this.repositories.get(entry.id) === entry
  }

  private isLiveSlot(entry: WatchedRepository, slot: WatchSlot): boolean {
    return this.isCurrent(entry) && entry.slots.get(slot.key) === slot
  }

  private removeRepository(id: string): void {
    const entry = this.repositories.get(id)
    if (entry) this.removeEntry(entry)
  }

  private removeEntry(entry: WatchedRepository): void {
    // Delete first so any late event from a closing watcher sees a stale entry.
    if (this.repositories.get(entry.id) === entry) this.repositories.delete(entry.id)
    if (entry.debounceTimer !== undefined) {
      clearTimeout(entry.debounceTimer)
      entry.debounceTimer = undefined
    }
    for (const slot of entry.slots.values()) {
      if (slot.reconnectTimer !== undefined) {
        clearTimeout(slot.reconnectTimer)
        slot.reconnectTimer = undefined
      }
      slot.rebuilding = false
      this.closeSlotWatcher(slot)
    }
    entry.slots.clear()
  }

  private closeSlotWatcher(slot: WatchSlot): void {
    const watcher = slot.watcher
    slot.watcher = undefined
    if (watcher) this.closeWatcher(watcher)
  }

  private closeWatcher(watcher: FSWatcher): void {
    try {
      watcher.close()
    } catch {
      // Already closed.
    }
  }
}
