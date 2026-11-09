import { git, GitError, type GitSignalOptions } from "./executor.js"
import { GitInputError } from "./validation.js"

const FILTER_KEY = /^filter\.(.+)\.(clean|process|required)$/
const FILTER_QUERY = "^filter\\..*\\.(clean|process|required)$"
/** Driver names that cannot be expressed safely as `git -c <key>=<value>`. */
const UNSAFE_DRIVER_NAME = /[=\0\r\n]/

/**
 * Disable every clean/process filter configured in the *effective* git config.
 *
 * `git diff` (working tree) and `git status` may invoke `.gitattributes`
 * filter drivers, which are arbitrary commands. We enumerate the filter keys
 * first (reading config does not execute filters), then override each driver
 * on the command line:
 *
 *   -c filter.<name>.clean=
 *   -c filter.<name>.process=
 *   -c filter.<name>.required=false
 *
 * Command-line config wins over repository/global config, so the external
 * commands cannot run. Enumeration is deliberately uncached so a stale filter
 * set can never be used after the config changes.
 *
 * If the effective config cannot be read, or a driver name cannot be safely
 * expressed with `git -c`, callers must refuse the operation instead of
 * risking execution of an untrusted filter. Exit code 1 (no matching keys) is
 * the normal "no filters configured" case.
 */
export async function filterOverrideArgs(
  repoPath: string,
  options: GitSignalOptions = {},
): Promise<string[]> {
  let output: string
  try {
    output = await git(
      repoPath,
      ["config", "--includes", "--null", "--get-regexp", FILTER_QUERY],
      options,
    )
  } catch (error) {
    if (error instanceof GitError && error.code === 1) return []
    const reason = error instanceof Error ? error.message : String(error)
    throw new GitInputError(
      `Cannot safely enumerate repository filter configuration; refusing to run a command that may execute external filters: ${reason}`,
    )
  }

  const drivers = new Set<string>()
  for (const record of output.split("\0")) {
    if (!record) continue
    const newline = record.indexOf("\n")
    const rawKey = newline >= 0 ? record.slice(0, newline) : record
    const key = rawKey.endsWith("\r") ? rawKey.slice(0, -1) : rawKey
    const match = FILTER_KEY.exec(key)
    if (!match) continue

    const driver = match[1]
    if (UNSAFE_DRIVER_NAME.test(driver)) {
      throw new GitInputError(
        `Cannot safely disable filter ${JSON.stringify(driver)} (unsupported driver name); refusing to run a command that may execute external filters`,
      )
    }
    drivers.add(driver)
  }

  const args: string[] = []
  for (const driver of drivers) {
    args.push(
      "-c",
      `filter.${driver}.clean=`,
      "-c",
      `filter.${driver}.process=`,
      "-c",
      `filter.${driver}.required=false`,
    )
  }
  return args
}
