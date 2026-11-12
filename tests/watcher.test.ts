import { EventEmitter } from "node:events"
import {
  mkdirSync,
  rmSync,
  watch,
  type FSWatcher,
  type WatchOptions,
} from "node:fs"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"
import type { GitRepository } from "../src/shared/types.js"
import { RepositoryManager } from "../src/server/repository/manager.js"
import {
  WorkspaceWatcher,
  type RepositoryListSource,
  type WatchFactory,
  type WorkspaceWatcherOptions,
} from "../src/server/repository/watcher.js"
import { commit, initRepo, mkTmpDir, runGit } from "./helpers.js"

type WatchListener = (eventType: string, filename: string | Buffer | null) => void

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function comparable(value: string): string {
  const resolved = path.resolve(value)
  return process.platform === "win32" ? resolved.toLowerCase() : resolved
}

function samePath(left: string, right: string): boolean {
  return comparable(left) === comparable(right)
}

function freshRepo(rootDir: string, name = "repo"): string {
  const dir = path.join(rootDir, name)
  initRepo(dir)
  commit(dir, { "a.txt": "one\n" }, "first")
  return dir
}

function repositoryFixture(repo: string, type: GitRepository["type"] = "normal"): GitRepository {
  return {
    id: repo,
    name: path.basename(repo),
    rootPath: repo,
    gitDir: runGit(repo, ["rev-parse", "--absolute-git-dir"]).trim(),
    type,
    branch: "main",
    head: runGit(repo, ["rev-parse", "HEAD"]).trim(),
    detached: false,
    changes: { staged: 0, unstaged: 0, untracked: 0, conflicted: 0 },
  }
}

function startWatcher(
  manager: RepositoryListSource,
  onChange: (repositoryId: string) => void,
  options: WorkspaceWatcherOptions = {},
): WorkspaceWatcher {
  return new WorkspaceWatcher(manager, onChange, {
    debounceMs: 200,
    syncIntervalMs: 60_000,
    ...options,
  })
}

/** Minimal FSWatcher stand-in that records close() calls. */
class FakeWatcher extends EventEmitter {
  closed = false

  close(): void {
    this.closed = true
  }
}

interface FakeEvent {
  target: string
  options: WatchOptions
  listener: WatchListener
}

function fakeWatchFactory(created: FakeWatcher[], events: FakeEvent[]): WatchFactory {
  return (target, options, listener) => {
    const watcher = new FakeWatcher()
    created.push(watcher)
    events.push({ target, options, listener })
    return watcher as unknown as FSWatcher
  }
}

describe("WorkspaceWatcher", () => {
  it("emits the repository id once after a commit", async () => {
    const root = mkTmpDir()
    const repo = freshRepo(root.dir)
    const manager = new RepositoryManager(root.dir, { ttlMs: 60_000 })
    const calls: string[] = []
    const watcher = startWatcher(manager, (id) => calls.push(id))

    try {
      await watcher.start()
      const [entry] = await manager.listRepositories()
      expect(entry).toBeDefined()
      expect(calls).toEqual([])

      commit(repo, { "a.txt": "two\n" }, "second")

      await vi.waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(1), {
        timeout: 6_000,
        interval: 25,
      })
      expect(calls.every((id) => id === entry.id)).toBe(true)

      // A trailing debounce must keep a late second burst to one call.
      await delay(400)
      expect(calls).toHaveLength(1)
    } finally {
      watcher.dispose()
      manager.dispose()
      root.cleanup()
    }
  })

  it("emits for update-ref and checkout changes", async () => {
    const root = mkTmpDir()
    const repo = freshRepo(root.dir)
    const head = runGit(repo, ["rev-parse", "HEAD"]).trim()
    const manager = new RepositoryManager(root.dir, { ttlMs: 60_000 })
    const calls: string[] = []
    const watcher = startWatcher(manager, (id) => calls.push(id), { debounceMs: 120 })

    try {
      await watcher.start()
      const [entry] = await manager.listRepositories()

      runGit(repo, ["update-ref", "refs/heads/topic", head])
      await vi.waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(1), {
        timeout: 6_000,
        interval: 25,
      })
      expect(calls).toContain(entry.id)

      calls.length = 0
      await delay(300)

      runGit(repo, ["checkout", "-b", "feature"])
      await vi.waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(1), {
        timeout: 6_000,
        interval: 25,
      })
      expect(calls).toContain(entry.id)
    } finally {
      watcher.dispose()
      manager.dispose()
      root.cleanup()
    }
  }, 20_000)

  it("coalesces a burst of ref writes into one notification", async () => {
    const root = mkTmpDir()
    const repo = freshRepo(root.dir)
    const head = runGit(repo, ["rev-parse", "HEAD"]).trim()
    const manager = new RepositoryManager(root.dir, { ttlMs: 60_000 })
    const calls: string[] = []
    const watcher = startWatcher(manager, (id) => calls.push(id), { debounceMs: 350 })

    try {
      await watcher.start()
      await manager.listRepositories()

      for (let index = 0; index < 6; index++) {
        runGit(repo, ["update-ref", `refs/heads/flood-${index}`, head])
      }

      await vi.waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(1), {
        timeout: 6_000,
        interval: 25,
      })
      await delay(900)
      expect(calls).toHaveLength(1)
    } finally {
      watcher.dispose()
      manager.dispose()
      root.cleanup()
    }
  }, 20_000)

  it("uses a trailing debounce window", async () => {
    const root = mkTmpDir()
    const repo = freshRepo(root.dir)
    const repository = repositoryFixture(repo)
    const manager: RepositoryListSource = { listRepositories: async () => [repository] }
    const created: FakeWatcher[] = []
    const events: FakeEvent[] = []
    const calls: string[] = []
    const watcher = startWatcher(manager, (id) => calls.push(id), {
      debounceMs: 100,
      watchFactory: fakeWatchFactory(created, events),
    })

    try {
      await watcher.start()
      const control = events.find(
        (event) => samePath(event.target, repository.gitDir) && event.options.recursive !== true,
      )
      expect(control).toBeDefined()
      expect(calls).toEqual([])

      // Emit across the first window; each event must restart it, so the only
      // notification happens after the last event + debounce.
      for (let index = 0; index < 5; index++) {
        control!.listener("change", "index")
        await delay(40)
      }

      await vi.waitFor(() => expect(calls).toHaveLength(1), {
        timeout: 2_000,
        interval: 10,
      })
      await delay(250)
      expect(calls).toHaveLength(1)
    } finally {
      watcher.dispose()
      root.cleanup()
    }
  })

  it("stops emitting after dispose and can be disposed twice", async () => {
    const root = mkTmpDir()
    const repo = freshRepo(root.dir)
    const manager = new RepositoryManager(root.dir, { ttlMs: 60_000 })
    const calls: string[] = []
    const watcher = startWatcher(manager, (id) => calls.push(id), { debounceMs: 120 })

    try {
      await watcher.start()
      watcher.dispose()
      watcher.dispose()

      commit(repo, { "a.txt": "after dispose\n" }, "third")
      await delay(500)
      expect(calls).toEqual([])
    } finally {
      manager.dispose()
      root.cleanup()
    }
  })

  it("notifies once when a repository is added after start", async () => {
    const root = mkTmpDir()
    const manager = new RepositoryManager(root.dir, { ttlMs: 0 })
    const calls: string[] = []
    const watcher = startWatcher(manager, (id) => calls.push(id), { debounceMs: 120 })

    try {
      await watcher.start()
      expect(await manager.listRepositories()).toEqual([])

      const repo = freshRepo(root.dir, "later")
      await watcher.refreshForTests()
      const [entry] = await manager.listRepositories()
      expect(entry).toBeDefined()

      await vi.waitFor(() => expect(calls).toHaveLength(1), {
        timeout: 2_000,
        interval: 10,
      })
      await delay(300)
      expect(calls).toEqual([entry.id])

      calls.length = 0
      commit(repo, { "a.txt": "two\n" }, "second")
      await vi.waitFor(() => expect(calls).toContain(entry.id), {
        timeout: 6_000,
        interval: 25,
      })
    } finally {
      watcher.dispose()
      manager.dispose()
      root.cleanup()
    }
  }, 20_000)

  it("restores recursive refs watching when refs appears, is deleted and is recreated", async () => {
    const root = mkTmpDir()
    const gitDir = path.join(root.dir, "git")
    mkdirSync(gitDir, { recursive: true })
    const refsDir = path.join(gitDir, "refs")
    const repository: GitRepository = {
      id: "fake-repository",
      name: "fake",
      rootPath: gitDir,
      gitDir,
      type: "normal",
      branch: null,
      head: null,
      detached: false,
      changes: { staged: 0, unstaged: 0, untracked: 0, conflicted: 0 },
    }
    const manager: RepositoryListSource = { listRepositories: async () => [repository] }
    const created: FakeWatcher[] = []
    const events: FakeEvent[] = []
    const calls: string[] = []
    const watcher = startWatcher(manager, (id) => calls.push(id), {
      debounceMs: 40,
      watchFactory: fakeWatchFactory(created, events),
    })

    try {
      await watcher.start()
      expect(calls).toEqual([])

      // events[0] is the control-file watcher; events[1] the refs fallback.
      const control = events[0]
      expect(control).toBeDefined()
      expect(samePath(control.target, gitDir)).toBe(true)

      // refs missing -> appears: reconcile upgrades to a recursive refs watch.
      mkdirSync(refsDir, { recursive: true })
      control.listener("rename", "refs")
      const recursive = events[events.length - 1]
      expect(samePath(recursive.target, refsDir)).toBe(true)
      expect(recursive.options.recursive).toBe(true)

      recursive.listener("change", "heads/appeared")
      await vi.waitFor(() => expect(calls).toHaveLength(1), {
        timeout: 2_000,
        interval: 10,
      })

      // refs deleted: reconcile falls back to the git dir.
      calls.length = 0
      rmSync(refsDir, { recursive: true, force: true })
      control.listener("rename", "refs")
      const fallback = events[events.length - 1]
      expect(samePath(fallback.target, gitDir)).toBe(true)
      expect(fallback.options.recursive).not.toBe(true)

      // refs recreated: the fallback watcher upgrades back to recursive and
      // subsequent ref updates are reported again.
      mkdirSync(refsDir, { recursive: true })
      fallback.listener("rename", "refs")
      const restored = events[events.length - 1]
      expect(samePath(restored.target, refsDir)).toBe(true)
      expect(restored.options.recursive).toBe(true)

      restored.listener("change", "heads/recreated")
      await vi.waitFor(() => expect(calls).toHaveLength(1), {
        timeout: 2_000,
        interval: 10,
      })
    } finally {
      watcher.dispose()
      root.cleanup()
    }

    expect(created.every((watcher) => watcher.closed)).toBe(true)
  })

  it("keeps control-file watching alive when the refs watcher throws", async () => {
    const root = mkTmpDir()
    const repo = freshRepo(root.dir)
    const repository = repositoryFixture(repo)
    const refsDir = path.join(repository.gitDir, "refs")
    const manager = new RepositoryManager(root.dir, { ttlMs: 60_000 })
    const calls: string[] = []
    const watchFactory: WatchFactory = (target, options, listener) => {
      if (samePath(target, refsDir)) throw new Error("refs watch unavailable")
      return watch(target, options, listener)
    }
    const watcher = startWatcher(manager, (id) => calls.push(id), {
      debounceMs: 120,
      reconnectBaseMs: 20,
      reconnectMaxMs: 100,
      watchFactory,
    })

    try {
      await watcher.start()
      const [entry] = await manager.listRepositories()

      commit(repo, { "a.txt": "index-only\n" }, "second")
      await vi.waitFor(() => expect(calls).toContain(entry.id), {
        timeout: 6_000,
        interval: 25,
      })
    } finally {
      watcher.dispose()
      manager.dispose()
      root.cleanup()
    }
  }, 20_000)

  it("watches the shared refs of a linked worktree through the common dir", async () => {
    const root = mkTmpDir()
    const repo = freshRepo(root.dir, "main")
    const worktree = path.join(root.dir, "wt")
    runGit(repo, ["worktree", "add", worktree, "-b", "topic"])
    const manager = new RepositoryManager(root.dir, { ttlMs: 60_000 })
    const calls: string[] = []
    const watcher = startWatcher(manager, (id) => calls.push(id), { debounceMs: 120 })

    try {
      await watcher.start()
      const entries = await manager.listRepositories()
      const worktreeEntry = entries.find((entry) => entry.type === "worktree")
      expect(worktreeEntry).toBeDefined()

      const head = runGit(repo, ["rev-parse", "HEAD"]).trim()
      runGit(repo, ["update-ref", "refs/heads/shared", head])

      await vi.waitFor(() => expect(calls).toContain(worktreeEntry!.id), {
        timeout: 6_000,
        interval: 25,
      })
    } finally {
      watcher.dispose()
      manager.dispose()
      root.cleanup()
    }
  }, 20_000)

  it("recovers a worktree common dir that failed to resolve on the first sync", async () => {
    const root = mkTmpDir()
    const main = freshRepo(root.dir, "main")
    const worktree = path.join(root.dir, "wt")
    runGit(main, ["worktree", "add", worktree, "-b", "topic"])
    const repository = repositoryFixture(worktree, "worktree")
    repository.rootPath = path.join(root.dir, "not-yet-a-repository")

    const manager: RepositoryListSource = { listRepositories: async () => [repository] }
    const calls: string[] = []
    const watcher = startWatcher(manager, (id) => calls.push(id), { debounceMs: 120 })

    try {
      await watcher.start()
      // The first resolve failed, so only the private gitDir is watched.
      repository.rootPath = worktree
      await watcher.refreshForTests()

      const head = runGit(main, ["rev-parse", "HEAD"]).trim()
      runGit(main, ["update-ref", "refs/heads/shared-common", head])

      await vi.waitFor(() => expect(calls).toContain(repository.id), {
        timeout: 6_000,
        interval: 25,
      })
    } finally {
      watcher.dispose()
      root.cleanup()
    }
  }, 30_000)

  it("ignores late errors from a removed entry without leaking or re-notifying", async () => {
    const root = mkTmpDir()
    const repo = freshRepo(root.dir)
    const repository = repositoryFixture(repo)
    let current: GitRepository[] = [repository]
    const manager: RepositoryListSource = { listRepositories: async () => current }
    const created: FakeWatcher[] = []
    const events: FakeEvent[] = []
    const calls: string[] = []
    const watcher = startWatcher(manager, (id) => calls.push(id), {
      debounceMs: 60,
      reconnectBaseMs: 10,
      reconnectMaxMs: 20,
      watchFactory: fakeWatchFactory(created, events),
    })

    try {
      await watcher.start()
      const oldWatchers = [...created]
      expect(oldWatchers.length).toBeGreaterThan(0)

      current = []
      await watcher.refreshForTests()
      expect(oldWatchers.every((watcher) => watcher.closed)).toBe(true)
      const createdAfterRemoval = created.length

      oldWatchers[0].emit("error", new Error("late error after removal"))
      await delay(120)
      expect(created.length).toBe(createdAfterRemoval)

      current = [repository]
      await watcher.refreshForTests()
      const newWatchers = created.slice(createdAfterRemoval)
      expect(newWatchers.length).toBeGreaterThan(0)

      await vi.waitFor(() => expect(calls).toHaveLength(1), {
        timeout: 2_000,
        interval: 10,
      })

      oldWatchers[0].emit("error", new Error("second late error"))
      await delay(120)
      expect(created.length).toBe(createdAfterRemoval + newWatchers.length)
      expect(newWatchers.some((watcher) => watcher.closed)).toBe(false)
      expect(calls).toHaveLength(1)
    } finally {
      watcher.dispose()
      root.cleanup()
    }

    expect(created.every((watcher) => watcher.closed)).toBe(true)
  })
})
