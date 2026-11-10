import { execFile, type ExecFileException } from "node:child_process"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import path from "node:path"

/** Default timeout for a git invocation (15 seconds). */
const DEFAULT_TIMEOUT = 15_000
/** Write operations can legitimately take longer than reads. */
export const DEFAULT_WRITE_TIMEOUT = 120_000
/** Default stdout/stderr buffer (20 MiB). */
const DEFAULT_MAX_BUFFER = 20 * 1024 * 1024
/** Maximum number of stderr characters carried in the error message. */
const ERROR_SUMMARY_LIMIT = 4_000

export interface GitOptions {
  signal?: AbortSignal
  timeout?: number
  maxBuffer?: number
  /**
   * Allow git to take optional locks (writing operations). Read-only commands
   * default to `lock: false`, which disables `GIT_OPTIONAL_LOCKS`.
   */
  lock?: boolean
}

/** Options accepted by read helpers that only need cancellation support. */
export type GitSignalOptions = Pick<GitOptions, "signal">

/** Read-only commands disable any repository/object redirect inherited from the parent. */
const BLOCKED_ENV_KEYS = new Set([
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_COMMON_DIR",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_NAMESPACE",
  "GIT_CEILING_DIRECTORIES",
  "GIT_DISCOVERY_ACROSS_FILESYSTEM",
  "GIT_CONFIG",
  "GIT_CONFIG_GLOBAL",
  "GIT_CONFIG_SYSTEM",
  "GIT_CONFIG_PARAMETERS",
  "GIT_CONFIG_COUNT",
  "GIT_EXTERNAL_DIFF",
  "GIT_ATTR_SOURCE",
  "GIT_QUARANTINE_PATH",
  "GIT_PREFIX",
  "GIT_SUPER_PREFIX",
  "GIT_SHALLOW_FILE",
  "GIT_REDIRECT_STDERR",
  "GIT_PROXY_COMMAND",
  "GIT_SSH",
  "GIT_SSH_COMMAND",
  "GIT_ASKPASS",
  "SSH_ASKPASS",
])

const BLOCKED_ENV_PREFIXES = ["GIT_CONFIG_KEY_", "GIT_CONFIG_VALUE_", "GIT_TRACE"]

function isBlockedEnvKey(key: string): boolean {
  const upper = key.toUpperCase()
  return (
    BLOCKED_ENV_KEYS.has(upper) ||
    BLOCKED_ENV_PREFIXES.some((prefix) => upper.startsWith(prefix))
  )
}

function sanitizedEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  for (const key of Object.keys(env)) {
    if (isBlockedEnvKey(key)) delete env[key]
  }
  return env
}

export class GitError extends Error {
  /** Process exit code, or null when git could not be spawned / timed out. */
  code: number | null
  /** Raw stderr emitted by git (empty when the process never started). */
  stderr: string

  constructor(message: string, code: number | null, stderr: string) {
    super(message)
    this.name = "GitError"
    this.code = code
    this.stderr = stderr
  }
}

function summarize(text: string): string {
  const trimmed = text.trim()
  if (trimmed.length <= ERROR_SUMMARY_LIMIT) return trimmed
  return `${trimmed.slice(0, ERROR_SUMMARY_LIMIT)}…`
}

/**
 * Run a git command inside `repoPath`.
 *
 * All invocations are non-interactive (`GIT_TERMINAL_PROMPT=0`) and read-only
 * commands default to `GIT_OPTIONAL_LOCKS=0`. Any non-zero exit status or spawn
 * failure is surfaced as a {@link GitError}.
 */
export function git(
  repoPath: string,
  args: string[],
  options: GitOptions = {},
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const env: NodeJS.ProcessEnv = {
      ...sanitizedEnv(),
      GIT_TERMINAL_PROMPT: "0",
      // Keep porcelain/diff markers ("Binary files ...", "rename from ...")
      // stable regardless of the user's locale.
      LC_ALL: "C",
      LANG: "C",
    }
    // Always set this explicitly: an inherited GIT_OPTIONAL_LOCKS=0 must not
    // leak into a write operation (and vice versa).
    env.GIT_OPTIONAL_LOCKS = options.lock ? "1" : "0"

    execFile(
      "git",
      ["-C", repoPath, "--no-pager", "-c", "core.fsmonitor=false", ...args],
      {
        encoding: "utf8",
        windowsHide: true,
        timeout: options.timeout ?? DEFAULT_TIMEOUT,
        maxBuffer: options.maxBuffer ?? DEFAULT_MAX_BUFFER,
        signal: options.signal,
        env,
      },
      (error: ExecFileException | null, stdout: string, stderr: string) => {
        if (error) {
          const stderrText = typeof stderr === "string" ? stderr : ""
          const rawCode = (error as ExecFileException & { code?: number | string }).code
          const code = typeof rawCode === "number" ? rawCode : null
          const detail = summarize(stderrText) || summarize(error.message)
          reject(
            new GitError(
              `git ${args.join(" ")} failed${code === null ? "" : ` (exit ${code})`}: ${detail}`,
              code,
              stderrText,
            ),
          )
          return
        }
        resolve(stdout)
      },
    )
  })
}

/** Options for a write invocation. Deliberately has no `signal`: a started
 * write must be allowed to finish (or time out) so its outcome is knowable. */
export interface GitWriteOptions {
  timeout?: number
  maxBuffer?: number
}

/**
 * Raised when a write invocation fails. `timedOut` means the process was
 * killed by the timeout: the repository state is unknown and the command must
 * never be retried automatically.
 */
export class GitWriteError extends GitError {
  readonly timedOut: boolean

  constructor(message: string, code: number | null, stderr: string, timedOut: boolean) {
    super(message, code, stderr)
    this.name = "GitWriteError"
    this.timedOut = timedOut
  }
}

/**
 * Command-line configuration applied to every write.
 *
 * `-c` values win over repository, global and system config, so a hostile or
 * misconfigured repository cannot redirect hooks, spawn maintenance commands,
 * recurse into submodules, use the filesystem monitor or run replace refs.
 * Signing is disabled here as well as with command-specific flags.
 */
function writeConfigArgs(): string[] {
  // A randomized, absolute path that is expected not to exist. Using /dev/null
  // or NUL is not portable and git treats a hooksPath that is a file oddly.
  const hooksPath = path.join(tmpdir(), `opencode-git-graph-no-hooks-${randomUUID()}`)
  return [
    "-c",
    "core.fsmonitor=false",
    "-c",
    "core.useReplaceRefs=false",
    "-c",
    `core.hooksPath=${hooksPath}`,
    "-c",
    "gc.auto=0",
    "-c",
    "maintenance.auto=false",
    "-c",
    "submodule.recurse=false",
    "-c",
    "commit.gpgsign=false",
    "-c",
    "tag.gpgsign=false",
  ]
}

/**
 * Run a mutating git command.
 *
 * Unlike {@link git}, this uses a long timeout, permits optional locks, never
 * accepts an AbortSignal and always prepends the hardened command-line config
 * from {@link writeConfigArgs}. A timeout is surfaced as a
 * {@link GitWriteError} with `timedOut: true`; callers must treat the outcome
 * as unknown and must not retry.
 */
export function gitWrite(
  repoPath: string,
  args: string[],
  options: GitWriteOptions = {},
): Promise<string> {
  const timeout = options.timeout ?? DEFAULT_WRITE_TIMEOUT
  return new Promise<string>((resolve, reject) => {
    const env: NodeJS.ProcessEnv = {
      ...sanitizedEnv(),
      GIT_TERMINAL_PROMPT: "0",
      LC_ALL: "C",
      LANG: "C",
      GIT_OPTIONAL_LOCKS: "1",
    }

    execFile(
      "git",
      ["-C", repoPath, "--no-pager", ...writeConfigArgs(), ...args],
      {
        encoding: "utf8",
        windowsHide: true,
        timeout,
        maxBuffer: options.maxBuffer ?? DEFAULT_MAX_BUFFER,
        env,
      },
      (error: ExecFileException | null, stdout: string, stderr: string) => {
        if (!error) {
          resolve(stdout)
          return
        }

        const stderrText = typeof stderr === "string" ? stderr : ""
        const raw = error as ExecFileException & {
          code?: number | string
          killed?: boolean
          signal?: string
        }
        const code = typeof raw.code === "number" ? raw.code : null
        const maxBufferExceeded = raw.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
        const timedOut =
          !maxBufferExceeded &&
          raw.killed === true &&
          (raw.signal === "SIGTERM" || raw.signal === "SIGKILL")

        const detail = summarize(stderrText) || summarize(error.message)
        const message = timedOut
          ? `git write command timed out after ${timeout}ms; repository state is unknown`
          : `git ${args.join(" ")} failed${code === null ? "" : ` (exit ${code})`}: ${detail}`
        reject(new GitWriteError(message, code, stderrText, timedOut))
      },
    )
  })
}
