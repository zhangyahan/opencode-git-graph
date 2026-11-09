import { execFile, type ExecFileException } from "node:child_process"

/** Default timeout for a git invocation (15 seconds). */
const DEFAULT_TIMEOUT = 15_000
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
    if (!options.lock) env.GIT_OPTIONAL_LOCKS = "0"

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
