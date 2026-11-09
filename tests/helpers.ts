import { execFileSync, spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

const ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_TERMINAL_PROMPT: "0",
}

export interface GitRunResult {
  status: number | null
  stdout: string
  stderr: string
}

export interface TmpRepo {
  dir: string
  git: (args: string[], cwd?: string) => string
  tryGit: (args: string[], cwd?: string) => GitRunResult
  cleanup: () => void
}

/** Run git synchronously, throwing on a non-zero exit status. */
export function runGit(cwd: string, args: string[]): string {
  return execFileSync("git", ["-C", cwd, "--no-pager", ...args], {
    encoding: "utf8",
    env: ENV,
    windowsHide: true,
  })
}

/** Run git synchronously, returning the exit status instead of throwing. */
export function gitTry(cwd: string, args: string[]): GitRunResult {
  const result = spawnSync("git", ["-C", cwd, "--no-pager", ...args], {
    encoding: "utf8",
    env: ENV,
    windowsHide: true,
  })
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  }
}

/** Create a temporary directory plus a cleanup callback. */
export function mkTmpDir(prefix = "git-graph-"): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  return {
    dir,
    cleanup: () => {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    },
  }
}

/** Initialize a git repository in `dir` (creating it if necessary). */
export function initRepo(dir: string): void {
  mkdirSync(dir, { recursive: true })
  runGit(dir, ["init", "-b", "main"])
  runGit(dir, ["config", "user.name", "Test User"])
  runGit(dir, ["config", "user.email", "test@example.com"])
  runGit(dir, ["config", "commit.gpgsign", "false"])
  runGit(dir, ["config", "tag.gpgsign", "false"])
  runGit(dir, ["config", "core.autocrlf", "false"])
}

/** Create and initialize a temporary git repository. */
export function mkTmpRepo(prefix = "git-graph-"): TmpRepo {
  const { dir, cleanup } = mkTmpDir(prefix)
  initRepo(dir)
  return {
    dir,
    git: (args, cwd = dir) => runGit(cwd, args),
    tryGit: (args, cwd = dir) => gitTry(cwd, args),
    cleanup,
  }
}

/**
 * Write files (nested paths supported, `null` deletes), stage everything and
 * commit. Returns the new commit hash.
 */
export function commit(
  dir: string,
  files: Record<string, string | null>,
  message: string,
  options: { allowEmpty?: boolean } = {},
): string {
  for (const [relativePath, content] of Object.entries(files)) {
    const absolute = join(dir, relativePath)
    if (content === null) {
      rmSync(absolute, { force: true })
    } else {
      mkdirSync(dirname(absolute), { recursive: true })
      writeFileSync(absolute, content, "utf8")
    }
  }

  runGit(dir, ["add", "-A"])
  runGit(dir, ["commit", "-m", message, ...(options.allowEmpty ? ["--allow-empty"] : [])])
  return runGit(dir, ["rev-parse", "HEAD"]).trim()
}
