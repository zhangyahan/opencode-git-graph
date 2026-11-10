import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it as vitestIt } from "vitest"
import { GitError, GitWriteError } from "../src/server/git/executor.js"
import {
  fetchRemote,
  GitMutationError,
  mapFetchFailure,
} from "../src/server/git/mutations.js"
import { commit, gitTry, initRepo, mkTmpDir, mkTmpRepo, runGit } from "./helpers.js"

// These tests use real git processes against a TEMP bare repository; no test
// ever contacts a network remote.
const TEST_TIMEOUT = 30_000
function it(name: string, run: () => Promise<void>): void {
  vitestIt(name, run, TEST_TIMEOUT)
}

async function failure(promise: Promise<unknown>): Promise<GitMutationError> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  )
  expect(error).toBeInstanceOf(GitMutationError)
  return error as GitMutationError
}

interface FetchFixture {
  dir: string
  remote: string
  local: string
  other: string
  base: string
  cleanup: () => void
}

/** A bare "remote" plus two working clones, all under one TEMP directory. */
function fetchFixture(): FetchFixture {
  const tmp = mkTmpDir("git-graph-fetch-")
  const remote = join(tmp.dir, "remote.git")
  mkdirSync(remote, { recursive: true })
  runGit(remote, ["init", "--bare", "--initial-branch=main"])

  const local = join(tmp.dir, "local")
  initRepo(local)
  runGit(local, ["remote", "add", "origin", remote])
  const base = commit(local, { "a.txt": "one\n" }, "base")
  runGit(local, ["push", "-u", "origin", "main"])

  const other = join(tmp.dir, "other")
  runGit(tmp.dir, ["clone", remote, other])
  runGit(other, ["config", "user.name", "Other User"])
  runGit(other, ["config", "user.email", "other@example.com"])
  runGit(other, ["config", "commit.gpgsign", "false"])

  return { dir: tmp.dir, remote, local, other, base, cleanup: tmp.cleanup }
}

function pushCommitFromOther(fixture: FetchFixture, message: string): string {
  return commit(fixture.other, { "a.txt": `${message}\n` }, message)
}

describe("fetchRemote", () => {
  it("fetches a named remote, updates remote-tracking refs and reports the count", async () => {
    const fixture = fetchFixture()
    try {
      // Make refs/remotes/origin/HEAD symbolic so the count can prove symbolic
      // refs are not double counted when their target moves.
      runGit(fixture.local, [
        "symbolic-ref",
        "refs/remotes/origin/HEAD",
        "refs/remotes/origin/main",
      ])

      pushCommitFromOther(fixture, "second")
      const pushed = runGit(fixture.other, ["rev-parse", "HEAD"]).trim()
      runGit(fixture.other, ["push", "origin", "main"])
      const result = await fetchRemote(fixture.local, {
        remote: "origin",
        expectedHead: fixture.base,
      })

      expect(result.refsUpdated).toBe(1)
      expect(result.changed).toBe(true)
      expect(result.warning).toBeUndefined()
      expect(result.status.head).toBe(fixture.base)
      expect(result.status.branch).toBe("main")
      expect(runGit(fixture.local, ["rev-parse", "refs/remotes/origin/main"]).trim()).toBe(
        pushed,
      )
    } finally {
      fixture.cleanup()
    }
  })

  it("treats an up-to-date fetch as a successful no-op", async () => {
    const fixture = fetchFixture()
    try {
      const first = await fetchRemote(fixture.local, { remote: "origin", expectedHead: null })
      expect(first.changed).toBe(false)
      expect(first.refsUpdated).toBe(0)

      const second = await fetchRemote(fixture.local, { remote: "origin", expectedHead: null })
      expect(second.changed).toBe(false)
      expect(second.refsUpdated).toBe(0)
    } finally {
      fixture.cleanup()
    }
  })

  it("counts tag updates explicitly", async () => {
    const fixture = fetchFixture()
    try {
      runGit(fixture.other, ["tag", "v1", fixture.base])
      runGit(fixture.other, ["push", "origin", "refs/tags/v1"])

      const result = await fetchRemote(fixture.local, {
        remote: "origin",
        expectedHead: fixture.base,
      })

      // The remote branch did not move; only refs/tags/v1 was written.
      expect(result.refsUpdated).toBe(1)
      expect(result.changed).toBe(true)
      expect(runGit(fixture.local, ["rev-parse", "refs/tags/v1"]).trim()).toBe(fixture.base)
    } finally {
      fixture.cleanup()
    }
  })

  it("prunes stale remote-tracking refs without counting the deletion as an update", async () => {
    const fixture = fetchFixture()
    try {
      runGit(fixture.other, ["push", "origin", "main:feature"])
      const added = await fetchRemote(fixture.local, {
        remote: "origin",
        expectedHead: fixture.base,
      })
      expect(added.refsUpdated).toBe(1)
      expect(
        runGit(fixture.local, ["rev-parse", "--verify", "refs/remotes/origin/feature"]).trim(),
      ).toBe(fixture.base)

      runGit(fixture.other, ["push", "origin", "--delete", "feature"])
      const pruned = await fetchRemote(fixture.local, {
        remote: "origin",
        prune: true,
        expectedHead: fixture.base,
      })

      expect(pruned.refsUpdated).toBe(0)
      expect(pruned.changed).toBe(true)
      expect(
        gitTry(fixture.local, ["rev-parse", "--verify", "--quiet", "refs/remotes/origin/feature"])
          .status,
      ).not.toBe(0)
    } finally {
      fixture.cleanup()
    }
  })

  it("fetches every configured remote when remote is null", async () => {
    const fixture = fetchFixture()
    try {
      pushCommitFromOther(fixture, "second")
      runGit(fixture.other, ["push", "origin", "main"])

      const result = await fetchRemote(fixture.local, { remote: null, expectedHead: null })
      expect(result.changed).toBe(true)
      expect(result.refsUpdated).toBe(1)
    } finally {
      fixture.cleanup()
    }
  })

  it("rejects an unknown remote before running git fetch", async () => {
    const fixture = fetchFixture()
    try {
      const error = await failure(
        fetchRemote(fixture.local, { remote: "missing", expectedHead: null }),
      )
      expect(error.reason).toBe("remote_not_found")
      expect(error.message).not.toContain(fixture.dir)
    } finally {
      fixture.cleanup()
    }
  })

  it("rejects unsafe remote names before running git fetch", async () => {
    const fixture = fetchFixture()
    try {
      for (const remote of ["--upload-pack=evil", "a b", "x..y", "refs/heads/main"]) {
        const error = await failure(
          fetchRemote(fixture.local, { remote, expectedHead: null }),
        )
        expect(error.reason).toBe("invalid_name")
      }
    } finally {
      fixture.cleanup()
    }
  })

  it("reports no_remotes when the repository has none configured", async () => {
    const repo = mkTmpRepo()
    try {
      commit(repo.dir, { "a.txt": "one\n" }, "base")
      const error = await failure(
        fetchRemote(repo.dir, { remote: null, expectedHead: null }),
      )
      expect(error.reason).toBe("no_remotes")
    } finally {
      repo.cleanup()
    }
  })

  it("rejects a stale expected head before fetching", async () => {
    const fixture = fetchFixture()
    try {
      pushCommitFromOther(fixture, "second")
      runGit(fixture.other, ["push", "origin", "main"])

      const error = await failure(
        fetchRemote(fixture.local, { remote: "origin", expectedHead: "f".repeat(40) }),
      )
      expect(error.reason).toBe("head_mismatch")
      // No ref was updated because the guard runs before the fetch.
      expect(
        runGit(fixture.local, ["rev-parse", "refs/remotes/origin/main"]).trim(),
      ).toBe(fixture.base)
    } finally {
      fixture.cleanup()
    }
  })

  it("classifies an unreachable configured remote", async () => {
    const fixture = fetchFixture()
    try {
      runGit(fixture.local, ["remote", "add", "broken", join(fixture.dir, "missing.git")])
      const error = await failure(
        fetchRemote(fixture.local, { remote: "broken", expectedHead: fixture.base }),
      )
      expect(["remote_not_found", "network_failed"]).toContain(error.reason)
    } finally {
      fixture.cleanup()
    }
  })
})

describe("mapFetchFailure", () => {
  vitestIt("marks a timed-out fetch as partial and non-retryable", () => {
    const error = mapFetchFailure(
      new GitWriteError("timed out", null, "", true),
    )
    expect(error.reason).toBe("fetch_timeout")
    expect(error.message).toContain("partially updated")
  })

  vitestIt("classifies authentication and network failures from git stderr", () => {
    expect(
      mapFetchFailure(new GitError("failed", 128, "fatal: Authentication failed for 'x'"))
        .reason,
    ).toBe("auth_failed")
    expect(
      mapFetchFailure(
        new GitError("failed", 128, "fatal: unable to access 'x': Could not resolve host: x"),
      ).reason,
    ).toBe("network_failed")
    expect(
      mapFetchFailure(new GitError("failed", 128, "fatal: could not read Username for 'x'"))
        .reason,
    ).toBe("auth_failed")
    expect(
      mapFetchFailure(new GitError("failed", 128, "fatal: '/x' does not appear to be a git repository"))
        .reason,
    ).toBe("remote_not_found")
    expect(mapFetchFailure(new Error("boom")).reason).toBe("fetch_failed")
  })
})
