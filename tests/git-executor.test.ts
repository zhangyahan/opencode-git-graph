import { chmodSync, existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { git, GitError } from "../src/server/git/executor.js"
import { commit, mkTmpRepo } from "./helpers.js"

describe("git executor", () => {
  it("returns stdout for a successful command", async () => {
    const repo = mkTmpRepo()
    try {
      const output = await git(repo.dir, ["rev-parse", "--is-inside-work-tree"])
      expect(output.trim()).toBe("true")
    } finally {
      repo.cleanup()
    }
  })

  it("rejects with a GitError containing stderr for a missing repository", async () => {
    const repo = mkTmpRepo()
    try {
      const missing = join(repo.dir, "does-not-exist")
      const error = await git(missing, ["status"]).then(
        () => null,
        (caught: unknown) => caught,
      )

      expect(error).toBeInstanceOf(GitError)
      const gitError = error as GitError
      expect(gitError.code).not.toBeNull()
      expect(gitError.stderr.length).toBeGreaterThan(0)
      expect(gitError.message).toContain("cannot change to")
      expect(gitError.message).toContain("fatal:")
    } finally {
      repo.cleanup()
    }
  })

  it("rejects with a GitError for an invalid subcommand", async () => {
    const repo = mkTmpRepo()
    try {
      const error = await git(repo.dir, ["definitely-not-a-git-command"]).then(
        () => null,
        (caught: unknown) => caught,
      )

      expect(error).toBeInstanceOf(GitError)
      const gitError = error as GitError
      expect(gitError.code).not.toBeNull()
      expect(gitError.stderr).toContain("not a git command")
    } finally {
      repo.cleanup()
    }
  })

  it("works when the repository path contains non-ascii characters and spaces", async () => {
    const repo = mkTmpRepo()
    try {
      const dir = join(repo.dir, "中文 仓库")
      mkdirSync(dir, { recursive: true })
      repo.git(["init", "-b", "main"], dir)

      const output = await git(dir, ["rev-parse", "--is-inside-work-tree"])
      expect(output.trim()).toBe("true")
    } finally {
      repo.cleanup()
    }
  })

  it("disables repository-configured core.fsmonitor programs", async () => {
    const repo = mkTmpRepo()
    try {
      commit(repo.dir, { "a.txt": "one\n" }, "first")
      const marker = join(repo.dir, "fsmonitor-ran.txt")
      const script = join(repo.dir, "fake-fsmonitor.sh")
      writeFileSync(
        script,
        `#!/bin/sh\nprintf executed >> "${marker.replace(/\\/g, "/")}"\nexit 1\n`,
      )
      chmodSync(script, 0o755)
      repo.git(["config", "core.fsmonitor", script.replace(/\\/g, "/")])
      writeFileSync(join(repo.dir, "a.txt"), "two\n")

      await git(repo.dir, ["status", "--porcelain", "-z"])
      await git(repo.dir, ["diff", "--", "a.txt"])

      expect(existsSync(marker)).toBe(false)
    } finally {
      repo.cleanup()
    }
  })

  it("ignores inherited repository redirection and config injection variables", async () => {
    const repo = mkTmpRepo()
    const decoy = mkTmpRepo()
    const keys = [
      "GIT_DIR",
      "GIT_WORK_TREE",
      "GIT_INDEX_FILE",
      "GIT_COMMON_DIR",
      "GIT_OBJECT_DIRECTORY",
      "GIT_ALTERNATE_OBJECT_DIRECTORIES",
      "GIT_NAMESPACE",
      "GIT_CONFIG_PARAMETERS",
      "GIT_CONFIG_COUNT",
      "GIT_CONFIG_KEY_0",
      "GIT_CONFIG_VALUE_0",
      "GIT_TRACE",
    ]
    const previous = new Map<string, string | undefined>()
    try {
      const hash = commit(repo.dir, { "a.txt": "one\n" }, "target")
      commit(decoy.dir, { "b.txt": "decoy\n" }, "decoy")
      const trace = join(repo.dir, "git-trace.log")
      for (const key of keys) previous.set(key, process.env[key])

      process.env.GIT_DIR = join(decoy.dir, ".git")
      process.env.GIT_WORK_TREE = decoy.dir
      process.env.GIT_INDEX_FILE = join(decoy.dir, ".git", "index")
      process.env.GIT_COMMON_DIR = join(decoy.dir, ".git")
      process.env.GIT_OBJECT_DIRECTORY = join(decoy.dir, ".git", "objects")
      process.env.GIT_ALTERNATE_OBJECT_DIRECTORIES = join(decoy.dir, ".git", "objects")
      process.env.GIT_NAMESPACE = "decoy"
      process.env.GIT_CONFIG_PARAMETERS = "'core.bare'='true'"
      process.env.GIT_CONFIG_COUNT = "1"
      process.env.GIT_CONFIG_KEY_0 = "user.injected"
      process.env.GIT_CONFIG_VALUE_0 = "attacker"
      process.env.GIT_TRACE = trace

      const top = (await git(repo.dir, ["rev-parse", "--show-toplevel"])).trim()
      expect(realpathSync(top)).toBe(realpathSync(repo.dir))
      expect((await git(repo.dir, ["rev-parse", "HEAD"])).trim()).toBe(hash)

      const configError = await git(repo.dir, ["config", "--get", "user.injected"]).then(
        () => null,
        (caught: unknown) => caught,
      )
      expect(configError).toBeInstanceOf(GitError)
      expect((configError as GitError).code).toBe(1)
      expect(existsSync(trace)).toBe(false)
    } finally {
      for (const [key, value] of previous) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
      decoy.cleanup()
      repo.cleanup()
    }
  })
})
