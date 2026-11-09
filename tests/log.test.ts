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
