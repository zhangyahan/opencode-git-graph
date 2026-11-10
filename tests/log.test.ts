import { execFileSync } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { describe, expect, it } from "vitest"
import { getLog } from "../src/server/git/log.js"
import { commit, mkTmpRepo, type TmpRepo } from "./helpers.js"

const GIT_ENV: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: "0" }

/** Run git with a fixed author/committer date so date-order is deterministic. */
function gitAt(dir: string, args: string[], date: string): string {
  return execFileSync("git", ["-C", dir, "--no-pager", ...args], {
    encoding: "utf8",
    env: { ...GIT_ENV, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
    windowsHide: true,
  })
}

function commitAt(
  dir: string,
  files: Record<string, string>,
  message: string,
  date: string,
): string {
  for (const [relativePath, content] of Object.entries(files)) {
    const absolute = join(dir, relativePath)
    mkdirSync(dirname(absolute), { recursive: true })
    writeFileSync(absolute, content, "utf8")
  }
  gitAt(dir, ["add", "-A"], date)
  gitAt(dir, ["commit", "-m", message], date)
  return gitAt(dir, ["rev-parse", "HEAD"], date).trim()
}

function mergeAt(dir: string, branch: string, message: string, date: string): string {
  gitAt(dir, ["merge", "--no-ff", "-m", message, branch], date)
  return gitAt(dir, ["rev-parse", "HEAD"], date).trim()
}

function day(n: number): string {
  return `2000-01-${String(n).padStart(2, "0")}T00:00:00 +0000`
}

/**
 * Build a real merge DAG whose side and mainline commits alternate in date:
 * base <- main1..main4 and base <- side1..side4, joined by a final merge.
 *
 * `--date-order` interleaves the two lines by timestamp; `--topo-order` groups
 * the whole side branch ahead of the mainline, which is what pushed merge
 * parents far behind their merge in the reported "colourful fence" history.
 *
 * Returns the expected newest-first hash order.
 */
function buildMergeHistory(repo: TmpRepo): string[] {
  const base = commitAt(repo.dir, { "base.txt": "base\n" }, "base", day(1))

  repo.git(["checkout", "-b", "side"])
  const side = [1, 2, 3, 4].map((n) =>
    commitAt(repo.dir, { [`s${n}.txt`]: `s${n}\n` }, `side${n}`, day(2 * n + 1)),
  )

  repo.git(["checkout", "main"])
  const main = [1, 2, 3, 4].map((n) =>
    commitAt(repo.dir, { [`m${n}.txt`]: `m${n}\n` }, `main${n}`, day(2 * n)),
  )

  const merge = mergeAt(repo.dir, "side", "merge side", day(10))

  return [
    merge,
    side[3],
    main[3],
    side[2],
    main[2],
    side[1],
    main[1],
    side[0],
    main[0],
    base,
  ]
}

describe("getLog", () => {
  it("returns linear commits newest first with parent chains", async () => {
    const repo = mkTmpRepo()
    try {
      const c1 = commit(repo.dir, { "a.txt": "one\n" }, "first")
      const c2 = commit(repo.dir, { "a.txt": "two\n" }, "second")
      const c3 = commit(repo.dir, { "a.txt": "three\n" }, "third")

      const { commits, hasMore } = await getLog(repo.dir)
      expect(commits.map((commit) => commit.hash)).toEqual([c3, c2, c1])
      expect(commits[0].parents).toEqual([c2])
      expect(commits[1].parents).toEqual([c1])
      expect(commits[2].parents).toEqual([])
      expect(hasMore).toBe(false)
      expect(commits[0].subject).toBe("third")
      expect(commits[0].author).toBe("Test User")
      expect(commits[0].authorDate).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    } finally {
      repo.cleanup()
    }
  })

  it("exposes both parents for merge commits", async () => {
    const repo = mkTmpRepo()
    try {
      commit(repo.dir, { "base.txt": "base\n" }, "base")
      repo.git(["checkout", "-b", "feature"])
      commit(repo.dir, { "feature.txt": "feature\n" }, "feature work")
      repo.git(["checkout", "main"])
      commit(repo.dir, { "main.txt": "main\n" }, "main work")
      repo.git(["merge", "--no-ff", "-m", "merge feature", "feature"])

      const mergeHash = repo.git(["rev-parse", "HEAD"]).trim()
      const { commits } = await getLog(repo.dir)
      const mergeCommit = commits.find((commit) => commit.hash === mergeHash)
      expect(mergeCommit).toBeDefined()
      expect(mergeCommit?.parents).toHaveLength(2)
    } finally {
      repo.cleanup()
    }
  })

  it("orders a merge DAG by date and paginates without splitting the order", async () => {
    const repo = mkTmpRepo()
    try {
      const newestFirst = buildMergeHistory(repo)

      const full = await getLog(repo.dir, { limit: newestFirst.length })
      expect(full.commits.map((entry) => entry.hash)).toEqual(newestFirst)
      expect(full.hasMore).toBe(false)

      // Date order is still topological: every parent inside the window must be
      // on a later (older) row, which is exactly what layoutGraph requires.
      const rowOf = new Map(full.commits.map((entry, index) => [entry.hash, index]))
      for (let index = 0; index < full.commits.length; index += 1) {
        for (const parent of full.commits[index].parents) {
          const parentRow = rowOf.get(parent)
          if (parentRow !== undefined) expect(parentRow).toBeGreaterThan(index)
        }
      }

      // Two pages concatenated must equal the prefix of one larger request.
      // The expected order also distinguishes --date-order from --topo-order:
      // topo groups side1..side4 before main1..main4 instead of interleaving.
      const pageSize = 5
      const page1 = await getLog(repo.dir, { limit: pageSize, skip: 0 })
      const page2 = await getLog(repo.dir, { limit: pageSize, skip: pageSize })
      const paged = [...page1.commits, ...page2.commits]

      expect(paged).toEqual(full.commits)
      expect(page1.hasMore).toBe(true)
      expect(page2.hasMore).toBe(false)
    } finally {
      repo.cleanup()
    }
  })

  it("parses decorations from %D, stripping the tag prefix", async () => {
    const repo = mkTmpRepo()
    try {
      const hash = commit(repo.dir, { "a.txt": "one\n" }, "release")
      repo.git(["tag", "v1.0.0"])

      const { commits } = await getLog(repo.dir)
      const tagged = commits.find((entry) => entry.hash === hash)
      expect(tagged).toBeDefined()
      expect(tagged?.refs).toContain("HEAD -> main")
      expect(tagged?.refs).toContain("v1.0.0")
      expect(tagged?.refs.some((ref) => ref.startsWith("tag:"))).toBe(false)
    } finally {
      repo.cleanup()
    }
  })

  it("paginates with limit/skip and reports hasMore", async () => {
    const repo = mkTmpRepo()
    try {
      const hashes: string[] = []
      for (let index = 0; index < 5; index++) {
        hashes.push(commit(repo.dir, { "a.txt": `${index}\n` }, `commit ${index}`))
      }
      const newestFirst = [...hashes].reverse()

      const page1 = await getLog(repo.dir, { limit: 2, skip: 0 })
      expect(page1.commits.map((commit) => commit.hash)).toEqual(newestFirst.slice(0, 2))
      expect(page1.hasMore).toBe(true)

      const page2 = await getLog(repo.dir, { limit: 2, skip: 2 })
      expect(page2.commits.map((commit) => commit.hash)).toEqual(newestFirst.slice(2, 4))
      expect(page2.hasMore).toBe(true)

      const page3 = await getLog(repo.dir, { limit: 2, skip: 4 })
      expect(page3.commits.map((commit) => commit.hash)).toEqual(newestFirst.slice(4, 5))
      expect(page3.hasMore).toBe(false)
    } finally {
      repo.cleanup()
    }
  })

  it("returns an empty page for an empty repository", async () => {
    const repo = mkTmpRepo()
    try {
      await expect(getLog(repo.dir)).resolves.toEqual({ commits: [], hasMore: false })
    } finally {
      repo.cleanup()
    }
  })

  it("includes a detached HEAD even when no branch points at it", async () => {
    const repo = mkTmpRepo()
    try {
      const hash = commit(repo.dir, { "a.txt": "one\n" }, "only")
      repo.git(["checkout", "--detach", hash])
      repo.git(["branch", "-D", "main"])

      const { commits } = await getLog(repo.dir)
      expect(commits.map((entry) => entry.hash)).toEqual([hash])
    } finally {
      repo.cleanup()
    }
  })

  it("disables configured signature verification programs", async () => {
    const repo = mkTmpRepo()
    try {
      commit(repo.dir, { "a.txt": "one\n" }, "base")
      const marker = join(repo.dir, "gpg-ran.txt")
      const script = join(repo.dir, "fake-gpg.sh")
      writeFileSync(
        script,
        `#!/bin/sh\nprintf executed >> "${marker.replace(/\\/g, "/")}"\nexit 0\n`,
      )
      chmodSync(script, 0o755)
      repo.git(["config", "gpg.program", script.replace(/\\/g, "/")])
      repo.git(["config", "log.showSignature", "true"])

      // Hand-crafted commit carrying a gpgsig header, so git would try to
      // verify it (and invoke gpg.program) when signatures are enabled.
      const tree = repo.git(["write-tree"]).trim()
      const parent = repo.git(["rev-parse", "HEAD"]).trim()
      const objectFile = join(repo.dir, "fake-signed-commit.txt")
      writeFileSync(
        objectFile,
        [
          `tree ${tree}`,
          `parent ${parent}`,
          "author Test User <test@example.com> 1700000000 +0000",
          "committer Test User <test@example.com> 1700000000 +0000",
          "gpgsig -----BEGIN PGP SIGNATURE-----",
          " ",
          " ZmFrZQ==",
          " -----END PGP SIGNATURE-----",
          "",
          "fake signed",
          "",
        ].join("\n"),
      )
      const signed = repo.git(["hash-object", "-t", "commit", "-w", objectFile]).trim()
      repo.git(["update-ref", "refs/heads/fake-signed", signed])

      const { commits } = await getLog(repo.dir)
      expect(commits.map((entry) => entry.hash)).toContain(signed)
      expect(existsSync(marker)).toBe(false)
    } finally {
      repo.cleanup()
    }
  })

  it("rejects invalid limit and skip values", async () => {
    const repo = mkTmpRepo()
    try {
      for (const limit of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 1001]) {
        await expect(getLog(repo.dir, { limit })).rejects.toThrow(/Invalid log limit/)
      }
      for (const skip of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 10_000_001]) {
        await expect(getLog(repo.dir, { skip })).rejects.toThrow(/Invalid log skip/)
      }

      await expect(getLog(repo.dir, { limit: 1000, skip: 0 })).resolves.toEqual({
        commits: [],
        hasMore: false,
      })
    } finally {
      repo.cleanup()
    }
  })
})

/**
 * Build a repository where some commits are reachable only through a tag or
 * only through a remote-tracking ref:
 *
 *   base <- tag-only (annotated tag v1.0)      -> deleted local branch
 *   base <- remote-only                        -> refs/remotes/origin/remote-only
 *   base <- main tip
 */
function buildRefKindsHistory(repo: TmpRepo): {
  base: string
  tagCommit: string
  remoteCommit: string
  tip: string
} {
  const base = commit(repo.dir, { "a.txt": "1\n" }, "base")

  repo.git(["checkout", "-b", "tag-only"])
  const tagCommit = commit(repo.dir, { "tag.txt": "t\n" }, "tag only")
  repo.git(["tag", "-a", "v1.0", "-m", "release"])
  repo.git(["checkout", "main"])
  repo.git(["branch", "-D", "tag-only"])

  repo.git(["checkout", "-b", "remote-only"])
  const remoteCommit = commit(repo.dir, { "remote.txt": "r\n" }, "remote only")
  repo.git(["update-ref", "refs/remotes/origin/remote-only", remoteCommit])
  repo.git(["checkout", "main"])
  repo.git(["branch", "-D", "remote-only"])

  const tip = commit(repo.dir, { "a.txt": "2\n" }, "main tip")
  return { base, tagCommit, remoteCommit, tip }
}

describe("getLog ref filtering", () => {
  it("honours showRemotes and showTags in All mode", async () => {
    const repo = mkTmpRepo()
    try {
      const { base, tagCommit, remoteCommit, tip } = buildRefKindsHistory(repo)
      const hashes = async (options: Parameters<typeof getLog>[1]) =>
        new Set((await getLog(repo.dir, { limit: 100, ...options })).commits.map((entry) => entry.hash))

      const all = await hashes({})
      expect(all).toEqual(new Set([base, tagCommit, remoteCommit, tip]))

      const noRemotes = await hashes({ showRemotes: false })
      expect(noRemotes).toEqual(new Set([base, tagCommit, tip]))
      expect(noRemotes.has(remoteCommit)).toBe(false)

      const noTags = await hashes({ showTags: false })
      expect(noTags).toEqual(new Set([base, remoteCommit, tip]))
      expect(noTags.has(tagCommit)).toBe(false)

      const branchesOnly = await hashes({ showRemotes: false, showTags: false })
      expect(branchesOnly).toEqual(new Set([base, tip]))
    } finally {
      repo.cleanup()
    }
  })

  it("walks only explicitly selected local, remote and tag refs", async () => {
    const repo = mkTmpRepo()
    try {
      const { base, tagCommit, remoteCommit, tip } = buildRefKindsHistory(repo)

      const onlyMain = await getLog(repo.dir, { refs: ["refs/heads/main"], limit: 100 })
      expect(onlyMain.commits.map((entry) => entry.hash)).toEqual([tip, base])

      const onlyRemote = await getLog(repo.dir, {
        refs: ["refs/remotes/origin/remote-only"],
        limit: 100,
      })
      expect(onlyRemote.commits.map((entry) => entry.hash)).toEqual([remoteCommit, base])

      // Annotated tags are peeled to the commit they point at.
      const onlyTag = await getLog(repo.dir, { refs: ["refs/tags/v1.0"], limit: 100 })
      expect(onlyTag.commits.map((entry) => entry.hash)).toEqual([tagCommit, base])

      const multi = await getLog(repo.dir, {
        refs: ["refs/heads/main", "refs/remotes/origin/remote-only"],
        limit: 100,
      })
      expect(new Set(multi.commits.map((entry) => entry.hash))).toEqual(
        new Set([tip, remoteCommit, base]),
      )
    } finally {
      repo.cleanup()
    }
  })

  it("lets explicit refs win over showRemotes/showTags", async () => {
    const repo = mkTmpRepo()
    try {
      const { base, remoteCommit } = buildRefKindsHistory(repo)

      const result = await getLog(repo.dir, {
        refs: ["refs/remotes/origin/remote-only"],
        showRemotes: false,
        showTags: false,
        limit: 100,
      })
      expect(result.commits.map((entry) => entry.hash)).toEqual([remoteCommit, base])
    } finally {
      repo.cleanup()
    }
  })

  it("accepts a symbolic remote HEAD when selected", async () => {
    const repo = mkTmpRepo()
    try {
      const { base, remoteCommit } = buildRefKindsHistory(repo)
      repo.git(["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/remote-only"])

      const result = await getLog(repo.dir, {
        refs: ["refs/remotes/origin/HEAD"],
        limit: 100,
      })
      expect(result.commits.map((entry) => entry.hash)).toEqual([remoteCommit, base])
    } finally {
      repo.cleanup()
    }
  })

  it("treats an empty refs array as All", async () => {
    const repo = mkTmpRepo()
    try {
      const { base, tagCommit, remoteCommit, tip } = buildRefKindsHistory(repo)
      const result = await getLog(repo.dir, { refs: [], limit: 100 })
      expect(new Set(result.commits.map((entry) => entry.hash))).toEqual(
        new Set([base, tagCommit, remoteCommit, tip]),
      )
    } finally {
      repo.cleanup()
    }
  })

  it("rejects unknown, glob, revision-expression and option-like refs", async () => {
    const repo = mkTmpRepo()
    try {
      const hash = commit(repo.dir, { "a.txt": "one\n" }, "base")
      repo.git(["tag", "v1.0"])
      const marker = join(repo.dir, "created-by-ref-attack.txt")

      const invalid = [
        "--all",
        `--output=${marker}`,
        "HEAD",
        "main",
        "refs/heads/main~1",
        "refs/heads/main^",
        "refs/heads/*",
        "refs/tags/v1.0^{commit}",
        "refs/heads/../evil",
        "refs/heads/",
        "refs/notes/commits",
        "refs/heads/main\0evil",
        "refs/heads/main.lock",
      ]
      for (const ref of invalid) {
        await expect(getLog(repo.dir, { refs: [ref], limit: 10 })).rejects.toThrow(
          /Invalid log ref|Unknown log ref/,
        )
        await expect(getLog(repo.dir, { refs: [hash, ref], limit: 10 })).rejects.toThrow(
          /Invalid log ref|Unknown log ref/,
        )
      }

      await expect(
        getLog(repo.dir, { refs: ["refs/heads/does-not-exist"], limit: 10 }),
      ).rejects.toThrow(/Unknown log ref/)
      await expect(getLog(repo.dir, { refs: "refs/heads/main" as never })).rejects.toThrow(
        /Invalid log refs/,
      )
      await expect(
        getLog(repo.dir, {
          refs: Array.from({ length: 33 }, () => "refs/heads/main"),
          limit: 10,
        }),
      ).rejects.toThrow(/at most 32 refs/)

      expect(existsSync(marker)).toBe(false)
      await expect(getLog(repo.dir, { refs: ["refs/heads/"], limit: 10 })).rejects.toThrow()
      expect(existsSync(marker)).toBe(false)
    } finally {
      repo.cleanup()
    }
  })

  it("rejects invalid boolean and order options", async () => {
    const repo = mkTmpRepo()
    try {
      commit(repo.dir, { "a.txt": "one\n" }, "base")
      await expect(getLog(repo.dir, { showRemotes: "yes" as never })).rejects.toThrow(
        /Invalid log showRemotes/,
      )
      await expect(getLog(repo.dir, { showTags: 1 as never })).rejects.toThrow(
        /Invalid log showTags/,
      )
      await expect(getLog(repo.dir, { firstParent: "no" as never })).rejects.toThrow(
        /Invalid log firstParent/,
      )
      await expect(getLog(repo.dir, { order: "topological" as never })).rejects.toThrow(
        /Invalid log order/,
      )
    } finally {
      repo.cleanup()
    }
  })

  it("follows only first parents when firstParent is set", async () => {
    const repo = mkTmpRepo()
    try {
      buildMergeHistory(repo)

      const full = await getLog(repo.dir, { limit: 100 })
      const byHash = new Map(full.commits.map((entry) => [entry.hash, entry]))
      const expected: string[] = []
      let cursor = full.commits.find((entry) => entry.subject === "merge side")
      while (cursor) {
        expected.push(cursor.hash)
        cursor = cursor.parents[0] ? byHash.get(cursor.parents[0]) : undefined
      }

      // `--first-parent` limits the walk from each start point, so select the
      // mainline ref explicitly: with `--all` every side-branch tip is a start.
      const firstParent = await getLog(repo.dir, {
        limit: 100,
        firstParent: true,
        refs: ["refs/heads/main"],
      })
      expect(firstParent.commits.map((entry) => entry.hash)).toEqual(expected)
      expect(firstParent.commits.map((entry) => entry.subject)).toEqual([
        "merge side",
        "main4",
        "main3",
        "main2",
        "main1",
        "base",
      ])

      // Side-branch commits are only reachable through second parents.
      expect(firstParent.commits.map((entry) => entry.subject)).not.toContain("side4")
    } finally {
      repo.cleanup()
    }
  })

  it("switches between date and topo order", async () => {
    const repo = mkTmpRepo()
    try {
      const newestFirst = buildMergeHistory(repo)

      const date = await getLog(repo.dir, { limit: 100, order: "date" })
      const topo = await getLog(repo.dir, { limit: 100, order: "topo" })

      expect(date.commits.map((entry) => entry.hash)).toEqual(newestFirst)
      expect(new Set(topo.commits.map((entry) => entry.hash))).toEqual(new Set(newestFirst))
      expect(topo.commits.map((entry) => entry.hash)).not.toEqual(
        date.commits.map((entry) => entry.hash),
      )

      // Topo order must still emit every parent after its children.
      const rowOf = new Map(topo.commits.map((entry, index) => [entry.hash, index]))
      for (let index = 0; index < topo.commits.length; index += 1) {
        for (const parent of topo.commits[index].parents) {
          const parentRow = rowOf.get(parent)
          if (parentRow !== undefined) expect(parentRow).toBeGreaterThan(index)
        }
      }
    } finally {
      repo.cleanup()
    }
  })

  it("keeps 100+100 pagination identical to a larger request", async () => {
    const repo = mkTmpRepo()
    try {
      commit(repo.dir, { "a.txt": "base\n" }, "base")
      for (let index = 0; index < 204; index++) {
        repo.git(["commit", "--allow-empty", "-m", `empty ${index}`])
      }

      const full = await getLog(repo.dir, { limit: 1000 })
      expect(full.commits).toHaveLength(205)
      expect(full.hasMore).toBe(false)

      const page1 = await getLog(repo.dir, { limit: 100, skip: 0 })
      const page2 = await getLog(repo.dir, { limit: 100, skip: 100 })

      expect([...page1.commits, ...page2.commits]).toEqual(full.commits.slice(0, 200))
      expect(page1.hasMore).toBe(true)
      expect(page2.hasMore).toBe(true)
    } finally {
      repo.cleanup()
    }
  }, 60_000)

  it("preserves a detached HEAD when show flags narrow All mode", async () => {
    const repo = mkTmpRepo()
    try {
      const hash = commit(repo.dir, { "a.txt": "one\n" }, "only")
      repo.git(["checkout", "--detach", hash])
      repo.git(["branch", "-D", "main"])

      const result = await getLog(repo.dir, { showRemotes: false, showTags: false })
      expect(result.commits.map((entry) => entry.hash)).toEqual([hash])
    } finally {
      repo.cleanup()
    }
  })

  it("keeps branch history when HEAD is unborn", async () => {
    const repo = mkTmpRepo()
    try {
      repo.git(["checkout", "--orphan", "other"])
      const hash = commit(repo.dir, { "other.txt": "one\n" }, "other")
      // Point HEAD at an unborn main: --all would still see refs/heads/other.
      repo.git(["symbolic-ref", "HEAD", "refs/heads/main"])

      const result = await getLog(repo.dir, { showRemotes: false, showTags: false })
      expect(result.commits.map((entry) => entry.hash)).toEqual([hash])

      const defaulted = await getLog(repo.dir)
      expect(defaulted.commits.map((entry) => entry.hash)).toEqual([hash])
    } finally {
      repo.cleanup()
    }
  })

  it("returns an empty page for an empty repository with any show flags", async () => {
    const repo = mkTmpRepo()
    try {
      await expect(
        getLog(repo.dir, { showRemotes: false, showTags: false }),
      ).resolves.toEqual({ commits: [], hasMore: false })
      await expect(getLog(repo.dir, { showRemotes: false, showTags: true })).resolves.toEqual({
        commits: [],
        hasMore: false,
      })
      await expect(getLog(repo.dir, { refs: [], showRemotes: true, showTags: false })).resolves.toEqual({
        commits: [],
        hasMore: false,
      })
    } finally {
      repo.cleanup()
    }
  })
})
