import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it as vitestIt } from "vitest"
import {
  git,
  GitError,
  GitWriteError,
  gitWrite,
} from "../src/server/git/executor.js"
import {
  checkoutBranch,
  createBranch,
  createTag,
  GitMutationError,
  parseNulPathList,
} from "../src/server/git/mutations.js"
import { commit, mkTmpDir, mkTmpRepo, type TmpRepo } from "./helpers.js"

const TEST_TIMEOUT = 15_000
function it(name: string, run: () => Promise<void>): void {
  vitestIt(name, run, TEST_TIMEOUT)
}

function head(repo: TmpRepo): string {
  return repo.git(["rev-parse", "HEAD"]).trim()
}

function currentBranch(repo: TmpRepo): string {
  return repo.git(["symbolic-ref", "--short", "HEAD"]).trim()
}

async function failure(promise: Promise<unknown>): Promise<GitMutationError> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  )
  expect(error).toBeInstanceOf(GitMutationError)
  return error as GitMutationError
}

function syncFailure(run: () => unknown): GitMutationError {
  let caught: unknown
  try {
    run()
  } catch (error) {
    caught = error
  }
  expect(caught).toBeInstanceOf(GitMutationError)
  return caught as GitMutationError
}

/** Create an executable shell filter that records every execution. */
function markerFilter(directory: string, marker: string): string {
  const script = join(directory, "filter.sh")
  writeFileSync(
    script,
    `#!/bin/sh\nprintf executed >> "${marker.replace(/\\/g, "/")}"\ncat\n`,
    { mode: 0o755 },
  )
  chmodSync(script, 0o755)
  return script.replace(/\\/g, "/")
}

describe("executor environment hardening", () => {
  it("ignores inherited GIT_CONFIG_GLOBAL/SYSTEM and repository redirection for writes", async () => {
    const repo = mkTmpRepo()
    const decoy = mkTmpRepo()
    const configDir = mkTmpDir("git-graph-config-")
    const globalConfig = join(configDir.dir, "global.gitconfig")
    const systemConfig = join(configDir.dir, "system.gitconfig")
    writeFileSync(globalConfig, "[test]\n\tinjected = global\n")
    writeFileSync(systemConfig, "[test]\n\tinjected = system\n")

    const keys = [
      "GIT_CONFIG_GLOBAL",
      "GIT_CONFIG_SYSTEM",
      "GIT_DIR",
      "GIT_WORK_TREE",
      "GIT_OPTIONAL_LOCKS",
    ] as const
    const previous = new Map<string, string | undefined>()
    try {
      const repoHead = commit(repo.dir, { "a.txt": "repo\n" }, "repo")
      commit(decoy.dir, { "b.txt": "decoy\n" }, "decoy")
      for (const key of keys) previous.set(key, process.env[key])

      process.env.GIT_CONFIG_GLOBAL = globalConfig
      process.env.GIT_CONFIG_SYSTEM = systemConfig
      process.env.GIT_DIR = join(decoy.dir, ".git")
      process.env.GIT_WORK_TREE = decoy.dir
      process.env.GIT_OPTIONAL_LOCKS = "0"

      const readConfig = await git(repo.dir, ["config", "--get", "test.injected"]).then(
        () => null,
        (caught: unknown) => caught,
      )
      expect(readConfig).toBeInstanceOf(GitError)
      expect((readConfig as GitError).code).toBe(1)

      const writeConfig = await gitWrite(repo.dir, ["config", "--get", "test.injected"]).then(
        () => null,
        (caught: unknown) => caught,
      )
      expect(writeConfig).toBeInstanceOf(GitError)
      expect((writeConfig as GitError).code).toBe(1)

      expect((await gitWrite(repo.dir, ["rev-parse", "HEAD"])).trim()).toBe(repoHead)
    } finally {
      for (const [key, value] of previous) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
      configDir.cleanup()
      decoy.cleanup()
      repo.cleanup()
    }
  })

  it("forces GIT_OPTIONAL_LOCKS=1 for writes and 0 for reads", async () => {
    const repo = mkTmpRepo()
    const previous = process.env.GIT_OPTIONAL_LOCKS
    try {
      commit(repo.dir, { "a.txt": "base\n" }, "base")
      process.env.GIT_OPTIONAL_LOCKS = "0"
      const alias = 'alias.showlocks=!echo "$GIT_OPTIONAL_LOCKS"'

      expect((await gitWrite(repo.dir, ["-c", alias, "showlocks"])).trim()).toBe("1")
      expect((await git(repo.dir, ["-c", alias, "showlocks"])).trim()).toBe("0")
    } finally {
      if (previous === undefined) delete process.env.GIT_OPTIONAL_LOCKS
      else process.env.GIT_OPTIONAL_LOCKS = previous
      repo.cleanup()
    }
  })

  it("does not retry a timed-out write and marks the state unknown", async () => {
    const repo = mkTmpRepo()
    try {
      const base = commit(repo.dir, { "a.txt": "base\n" }, "base")
      const started = Date.now()
      const error = await gitWrite(repo.dir, ["cat-file", "--batch"], { timeout: 400 }).then(
        () => null,
        (caught: unknown) => caught,
      )
      const elapsed = Date.now() - started

      expect(error).toBeInstanceOf(GitWriteError)
      expect((error as GitWriteError).timedOut).toBe(true)
      // A single 400ms timeout plus spawn overhead. An automatic retry would
      // exceed this window.
      expect(elapsed).toBeLessThan(750)
      expect((await gitWrite(repo.dir, ["rev-parse", "HEAD"])).trim()).toBe(base)
    } finally {
      repo.cleanup()
    }
  })
})

describe("write safety", () => {
  it("does not run repository or configured hooks during checkout", async () => {
    const repo = mkTmpRepo()
    const hookDir = mkTmpDir("git-graph-hooks-")
    const marker = join(hookDir.dir, "post-checkout-ran.txt")
    try {
      const base = commit(repo.dir, { "a.txt": "base\n" }, "base")
      repo.git(["branch", "feature"])
      const hook = join(hookDir.dir, "post-checkout")
      writeFileSync(
        hook,
        `#!/bin/sh\nprintf executed >> "${marker.replace(/\\/g, "/")}"\n`,
        { mode: 0o755 },
      )
      chmodSync(hook, 0o755)
      repo.git(["config", "core.hooksPath", hookDir.dir.replace(/\\/g, "/")])

      const result = await checkoutBranch(repo.dir, { branch: "feature", expectedHead: base })

      expect(result.status.branch).toBe("feature")
      expect(existsSync(marker)).toBe(false)
    } finally {
      hookDir.cleanup()
      repo.cleanup()
    }
  })

  it("refuses checkout when the target tree selects an active smudge filter", async () => {
    const repo = mkTmpRepo()
    const aux = mkTmpDir("git-graph-filter-")
    const marker = join(aux.dir, "smudge-ran.txt")
    try {
      commit(repo.dir, { "a.txt": "base\n" }, "base")
      repo.git(["checkout", "-b", "feature"])
      writeFileSync(join(repo.dir, ".gitattributes"), "*.dat filter=evil\n")
      writeFileSync(join(repo.dir, "data.dat"), "payload\n")
      repo.git(["add", "-A"])
      repo.git(["commit", "-m", "feature"])
      repo.git(["checkout", "main"])

      repo.git(["config", "filter.evil.smudge", markerFilter(aux.dir, marker)])

      const error = await failure(checkoutBranch(repo.dir, { branch: "feature", expectedHead: null }))

      expect(error.reason).toBe("filters")
      expect(currentBranch(repo)).toBe("main")
      expect(existsSync(marker)).toBe(false)
    } finally {
      aux.cleanup()
      repo.cleanup()
    }
  })

  it("refuses checkout when the target tree selects an active process filter", async () => {
    const repo = mkTmpRepo()
    const aux = mkTmpDir("git-graph-filter-")
    const marker = join(aux.dir, "process-ran.txt")
    try {
      commit(repo.dir, { "a.txt": "base\n" }, "base")
      repo.git(["checkout", "-b", "feature"])
      writeFileSync(join(repo.dir, ".gitattributes"), "*.dat filter=evil\n")
      writeFileSync(join(repo.dir, "data.dat"), "payload\n")
      repo.git(["add", "-A"])
      repo.git(["commit", "-m", "feature"])
      repo.git(["checkout", "main"])

      repo.git(["config", "filter.evil.process", markerFilter(aux.dir, marker)])

      const error = await failure(checkoutBranch(repo.dir, { branch: "feature", expectedHead: null }))

      expect(error.reason).toBe("filters")
      expect(currentBranch(repo)).toBe("main")
      expect(existsSync(marker)).toBe(false)
    } finally {
      aux.cleanup()
      repo.cleanup()
    }
  })

  it("refuses checkout when the current worktree selects an active filter", async () => {
    const repo = mkTmpRepo()
    const aux = mkTmpDir("git-graph-filter-")
    const marker = join(aux.dir, "worktree-filter-ran.txt")
    try {
      commit(repo.dir, { "a.txt": "base\n" }, "base")
      repo.git(["branch", "feature"])
      writeFileSync(join(repo.dir, ".gitattributes"), "*.dat filter=evil\n")
      writeFileSync(join(repo.dir, "data.dat"), "payload\n")
      repo.git(["add", "-A"])
      repo.git(["commit", "-m", "attributes"])
      repo.git(["config", "filter.evil.smudge", markerFilter(aux.dir, marker)])

      const error = await failure(checkoutBranch(repo.dir, { branch: "feature", expectedHead: null }))

      expect(error.reason).toBe("filters")
      expect(existsSync(marker)).toBe(false)
    } finally {
      aux.cleanup()
      repo.cleanup()
    }
  })

  it("allows checkout when only a global LFS driver is configured without matching attributes", async () => {
    const repo = mkTmpRepo()
    const home = mkTmpDir("git-graph-home-")
    const previousHome = process.env.HOME
    const previousProfile = process.env.USERPROFILE
    try {
      const base = commit(repo.dir, { "a.txt": "base\n" }, "base")
      repo.git(["branch", "feature"])
      writeFileSync(
        join(home.dir, ".gitconfig"),
        [
          '[filter "lfs"]',
          "\tsmudge = /nonexistent/lfs-smudge",
          "\tclean = /nonexistent/lfs-clean",
          "\tprocess = /nonexistent/lfs-process",
          "\trequired = true",
          "",
        ].join("\n"),
      )
      process.env.HOME = home.dir
      process.env.USERPROFILE = home.dir

      const result = await checkoutBranch(repo.dir, { branch: "feature", expectedHead: base })

      expect(result.changed).toBe(true)
      expect(result.status.branch).toBe("feature")
    } finally {
      if (previousHome === undefined) delete process.env.HOME
      else process.env.HOME = previousHome
      if (previousProfile === undefined) delete process.env.USERPROFILE
      else process.env.USERPROFILE = previousProfile
      home.cleanup()
      repo.cleanup()
    }
  })

  it("does not block metadata-only branch and tag creation because of filters", async () => {
    const repo = mkTmpRepo()
    const aux = mkTmpDir("git-graph-filter-")
    try {
      const base = commit(repo.dir, { "a.txt": "base\n" }, "base")
      writeFileSync(join(repo.dir, ".gitattributes"), "*.dat filter=evil\n")
      writeFileSync(join(repo.dir, "data.dat"), "payload\n")
      repo.git(["add", "-A"])
      repo.git(["commit", "-m", "attributes"])
      const tip = head(repo)
      repo.git(["config", "filter.evil.smudge", markerFilter(aux.dir, join(aux.dir, "m.txt"))])

      const tag = await createTag(repo.dir, { name: "v1", target: tip, expectedHead: tip })
      expect(tag.changed).toBe(true)

      const branch = await createBranch(repo.dir, {
        name: "metadata",
        startPoint: tip,
        checkout: false,
        expectedHead: tip,
      })
      expect(branch.changed).toBe(true)
      expect(repo.git(["rev-parse", "refs/heads/metadata"]).trim()).toBe(tip)
    } finally {
      aux.cleanup()
      repo.cleanup()
    }
  })

  it("rejects a repository whose top level is redirected with core.worktree", async () => {
    const repo = mkTmpRepo()
    const decoy = mkTmpDir("git-graph-decoy-")
    try {
      const base = commit(repo.dir, { "a.txt": "base\n" }, "base")
      repo.git(["branch", "feature"])
      repo.git(["config", "core.worktree", decoy.dir.replace(/\\/g, "/")])

      const error = await failure(checkoutBranch(repo.dir, { branch: "feature", expectedHead: base }))
      expect(error.reason).toBe("unsafe_repository")
    } finally {
      decoy.cleanup()
      repo.cleanup()
    }
  })
})

describe("path decoding safety", () => {
  it("accepts ordinary UTF-8 paths and rejects lossy or malformed listings", async () => {
    expect(parseNulPathList("")).toEqual([])
    expect(parseNulPathList("中文 文件.txt\0line\nbreak.txt\0")).toEqual([
      "中文 文件.txt",
      "line\nbreak.txt",
    ])

    // A legal U+FFFD name is indistinguishable from a UTF-8 decode failure
    // with the string-returning executor, so it is conservatively refused.
    expect(syncFailure(() => parseNulPathList("ok.txt\0bad\uFFFD.txt\0")).reason).toBe("filters")
    expect(syncFailure(() => parseNulPathList("bad\uD800.txt\0")).reason).toBe("filters")
    expect(syncFailure(() => parseNulPathList("missing-trailing-nul")).reason).toBe("filters")
    expect(
      syncFailure(() => parseNulPathList("bad\uFFFD.txt\0", "unsafe_repository")).reason,
    ).toBe("unsafe_repository")
  })

  it("refuses checkout when a target-tree path cannot be decoded losslessly", async () => {
    const repo = mkTmpRepo()
    const hookDir = mkTmpDir("git-graph-hooks-")
    const marker = join(hookDir.dir, "post-checkout-ran.txt")
    try {
      const base = commit(repo.dir, { "a.txt": "base\n" }, "base")
      repo.git(["checkout", "-b", "feature"])
      writeFileSync(join(repo.dir, "bad\uFFFD.dat"), "payload\n")
      repo.git(["add", "-A"])
      repo.git(["commit", "-m", "weird path"])
      repo.git(["checkout", "main"])

      const hook = join(hookDir.dir, "post-checkout")
      writeFileSync(
        hook,
        `#!/bin/sh\nprintf executed >> "${marker.replace(/\\/g, "/")}"\n`,
        { mode: 0o755 },
      )
      chmodSync(hook, 0o755)
      repo.git(["config", "core.hooksPath", hookDir.dir.replace(/\\/g, "/")])

      const error = await failure(checkoutBranch(repo.dir, { branch: "feature", expectedHead: base }))

      expect(error.reason).toBe("filters")
      expect(currentBranch(repo)).toBe("main")
      expect(existsSync(join(repo.dir, "bad\uFFFD.dat"))).toBe(false)
      expect(existsSync(marker)).toBe(false)
    } finally {
      hookDir.cleanup()
      repo.cleanup()
    }
  })

  it("refuses checkout when a current-worktree path cannot be decoded losslessly", async () => {
    const repo = mkTmpRepo()
    try {
      commit(repo.dir, { "a.txt": "base\n" }, "base")
      repo.git(["branch", "feature"])
      writeFileSync(join(repo.dir, "bad\uFFFD.dat"), "payload\n")
      repo.git(["add", "-A"])
      repo.git(["commit", "-m", "weird path"])

      const error = await failure(checkoutBranch(repo.dir, { branch: "feature", expectedHead: null }))

      expect(error.reason).toBe("filters")
      expect(currentBranch(repo)).toBe("main")
      expect(existsSync(join(repo.dir, "bad\uFFFD.dat"))).toBe(true)
    } finally {
      repo.cleanup()
    }
  })

  it("still checks out ordinary UTF-8 non-ascii paths", async () => {
    const repo = mkTmpRepo()
    try {
      const base = commit(repo.dir, { "a.txt": "base\n" }, "base")
      repo.git(["checkout", "-b", "feature"])
      writeFileSync(join(repo.dir, "中文 文件.txt"), "payload\n")
      repo.git(["add", "-A"])
      repo.git(["commit", "-m", "unicode"])
      repo.git(["checkout", "main"])

      const result = await checkoutBranch(repo.dir, { branch: "feature", expectedHead: base })

      expect(result.changed).toBe(true)
      expect(result.status.branch).toBe("feature")
      expect(existsSync(join(repo.dir, "中文 文件.txt"))).toBe(true)
    } finally {
      repo.cleanup()
    }
  })

  // Windows filenames cannot contain a newline; the pure parser test above
  // still covers newline-containing UTF-8 paths.
  vitestIt.skipIf(process.platform === "win32")(
    "still checks out a file whose name contains a newline",
    async () => {
      const repo = mkTmpRepo()
      try {
        const base = commit(repo.dir, { "a.txt": "base\n" }, "base")
        repo.git(["checkout", "-b", "feature"])
        writeFileSync(join(repo.dir, "line\nbreak.txt"), "payload\n")
        repo.git(["add", "-A"])
        repo.git(["commit", "-m", "newline"])
        repo.git(["checkout", "main"])

        const result = await checkoutBranch(repo.dir, { branch: "feature", expectedHead: base })

        expect(result.status.branch).toBe("feature")
        expect(existsSync(join(repo.dir, "line\nbreak.txt"))).toBe(true)
      } finally {
        repo.cleanup()
      }
    },
    TEST_TIMEOUT,
  )
})

describe("ignored path collisions", () => {
  it("refuses checkout when a target file replaces an ignored directory", async () => {
    const repo = mkTmpRepo()
    try {
      commit(repo.dir, { ".gitignore": "dir/\n" }, "base")
      repo.git(["checkout", "-b", "feature"])
      writeFileSync(join(repo.dir, "dir"), "tracked file\n")
      repo.git(["add", "-A"])
      repo.git(["commit", "-m", "target file"])
      repo.git(["checkout", "main"])
      mkdirSync(join(repo.dir, "dir"), { recursive: true })
      writeFileSync(join(repo.dir, "dir", "keep.txt"), "user data\n")

      const error = await failure(checkoutBranch(repo.dir, { branch: "feature", expectedHead: null }))

      expect(error.reason).toBe("untracked_collision")
      expect(currentBranch(repo)).toBe("main")
      expect(readFileSync(join(repo.dir, "dir", "keep.txt"), "utf8")).toBe("user data\n")
    } finally {
      repo.cleanup()
    }
  })

  it("refuses checkout when an ignored file shadows a target directory", async () => {
    const repo = mkTmpRepo()
    try {
      commit(repo.dir, { ".gitignore": "f\n" }, "base")
      repo.git(["checkout", "-b", "feature"])
      mkdirSync(join(repo.dir, "f"), { recursive: true })
      writeFileSync(join(repo.dir, "f", "inner.txt"), "tracked inner\n")
      repo.git(["add", "-f", "f/inner.txt"])
      repo.git(["commit", "-m", "target directory"])
      repo.git(["checkout", "main"])
      writeFileSync(join(repo.dir, "f"), "user data\n")

      const error = await failure(checkoutBranch(repo.dir, { branch: "feature", expectedHead: null }))

      expect(error.reason).toBe("untracked_collision")
      expect(currentBranch(repo)).toBe("main")
      expect(readFileSync(join(repo.dir, "f"), "utf8")).toBe("user data\n")
    } finally {
      repo.cleanup()
    }
  })

  it("refuses checkout when a deeper ignored file is below a target file", async () => {
    const repo = mkTmpRepo()
    try {
      commit(repo.dir, { ".gitignore": "a/b/keep\n" }, "base")
      repo.git(["checkout", "-b", "feature"])
      writeFileSync(join(repo.dir, "a"), "tracked file\n")
      repo.git(["add", "-A"])
      repo.git(["commit", "-m", "target file a"])
      repo.git(["checkout", "main"])
      mkdirSync(join(repo.dir, "a", "b"), { recursive: true })
      writeFileSync(join(repo.dir, "a", "b", "keep"), "deep user data\n")

      const error = await failure(checkoutBranch(repo.dir, { branch: "feature", expectedHead: null }))

      expect(error.reason).toBe("untracked_collision")
      expect(currentBranch(repo)).toBe("main")
      expect(readFileSync(join(repo.dir, "a", "b", "keep"), "utf8")).toBe("deep user data\n")
    } finally {
      repo.cleanup()
    }
  })

  it("allows a non-colliding prefix sibling and preserves the ignored file", async () => {
    const repo = mkTmpRepo()
    try {
      const base = commit(repo.dir, { ".gitignore": "a\n" }, "base")
      repo.git(["checkout", "-b", "feature"])
      writeFileSync(join(repo.dir, "ab"), "tracked sibling\n")
      repo.git(["add", "-A"])
      repo.git(["commit", "-m", "target ab"])
      repo.git(["checkout", "main"])
      writeFileSync(join(repo.dir, "a"), "ignored sibling\n")

      const result = await checkoutBranch(repo.dir, { branch: "feature", expectedHead: base })

      expect(result.changed).toBe(true)
      expect(result.status.branch).toBe("feature")
      expect(readFileSync(join(repo.dir, "a"), "utf8")).toBe("ignored sibling\n")
      expect(readFileSync(join(repo.dir, "ab"), "utf8")).toBe("tracked sibling\n")
    } finally {
      repo.cleanup()
    }
  })

  it("maps native untracked-directory loss errors to untracked_collision", async () => {
    const repo = mkTmpRepo()
    try {
      commit(repo.dir, { "a.txt": "base\n" }, "base")
      repo.git(["checkout", "-b", "feature"])
      writeFileSync(join(repo.dir, "dir"), "tracked file\n")
      repo.git(["add", "-A"])
      repo.git(["commit", "-m", "target file"])
      repo.git(["checkout", "main"])
      mkdirSync(join(repo.dir, "dir"), { recursive: true })
      writeFileSync(join(repo.dir, "dir", "keep.txt"), "untracked user data\n")

      const error = await failure(checkoutBranch(repo.dir, { branch: "feature", expectedHead: null }))

      expect(error.reason).toBe("untracked_collision")
      expect(currentBranch(repo)).toBe("main")
      expect(readFileSync(join(repo.dir, "dir", "keep.txt"), "utf8")).toBe(
        "untracked user data\n",
      )
    } finally {
      repo.cleanup()
    }
  })

  it("preflights ignored collisions before creating the new ref", async () => {
    const repo = mkTmpRepo()
    try {
      commit(repo.dir, { ".gitignore": "dir/\n" }, "base")
      repo.git(["checkout", "-b", "feature"])
      writeFileSync(join(repo.dir, "dir"), "tracked file\n")
      repo.git(["add", "-A"])
      repo.git(["commit", "-m", "target file"])
      const featureHead = head(repo)
      repo.git(["checkout", "main"])
      mkdirSync(join(repo.dir, "dir"), { recursive: true })
      writeFileSync(join(repo.dir, "dir", "keep.txt"), "user data\n")

      const error = await failure(
        createBranch(repo.dir, {
          name: "copy",
          startPoint: featureHead,
          checkout: true,
          expectedHead: null,
        }),
      )

      expect(error.reason).toBe("untracked_collision")
      expect(currentBranch(repo)).toBe("main")
      expect(repo.tryGit(["rev-parse", "--verify", "refs/heads/copy"]).status).not.toBe(0)
      expect(readFileSync(join(repo.dir, "dir", "keep.txt"), "utf8")).toBe("user data\n")
    } finally {
      repo.cleanup()
    }
  })

  vitestIt.skipIf(process.platform !== "win32")(
    "refuses case-only ignored collisions on Windows",
    async () => {
      const repo = mkTmpRepo()
      try {
        commit(repo.dir, { ".gitignore": "Foo\n" }, "base")
        repo.git(["checkout", "-b", "feature"])
        writeFileSync(join(repo.dir, "foo"), "tracked lower\n")
        repo.git(["add", "-f", "foo"])
        repo.git(["commit", "-m", "target foo"])
        repo.git(["checkout", "main"])
        writeFileSync(join(repo.dir, "Foo"), "user data\n")

        const error = await failure(
          checkoutBranch(repo.dir, { branch: "feature", expectedHead: null }),
        )

        expect(error.reason).toBe("untracked_collision")
        expect(currentBranch(repo)).toBe("main")
        expect(readFileSync(join(repo.dir, "Foo"), "utf8")).toBe("user data\n")
      } finally {
        repo.cleanup()
      }
    },
    TEST_TIMEOUT,
  )
})
