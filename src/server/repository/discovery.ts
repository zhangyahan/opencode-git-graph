import { readdir, readFile, realpath } from "node:fs/promises"
import type { Dirent } from "node:fs"
import path from "node:path"
import type { GitRepository, GitStatus } from "../../shared/types.js"
import { git } from "../git/executor.js"
import { getStatus, normalizeRepositoryId } from "../git/status.js"

const DEFAULT_MAX_DEPTH = 4
const DEFAULT_IGNORE = ["node_modules", ".venv", "dist", "build", ".next"]

export interface DiscoverOptions {
  maxDepth?: number
  ignore?: string[]
}

type RepositoryType = GitRepository["type"]

interface Candidate {
  dir: string
  type: RepositoryType
}

function classifyGitdir(gitdir: string): RepositoryType {
  const normalized = gitdir.replace(/\\/g, "/")
  if (normalized.includes("/worktrees/")) return "worktree"
  if (normalized.includes("/modules/")) return "submodule"
  return "normal"
}

async function classifyGitEntry(dir: string, entry: Dirent): Promise<RepositoryType | null> {
  if (entry.isDirectory()) return "normal"
  if (!entry.isFile()) return null

  try {
    const content = await readFile(path.join(dir, ".git"), "utf8")
    const match = /^gitdir:\s*(.+?)\s*$/m.exec(content)
    if (!match) return null
    return classifyGitdir(match[1])
  } catch {
    return null
  }
}

/**
 * Canonical form for path comparison. Windows paths are case-insensitive, so
 * fold both sides (including the drive letter) before comparing.
 */
function comparablePath(value: string): string {
  const resolved = path.resolve(value)
  return process.platform === "win32" ? resolved.toLowerCase() : resolved
}

/** True when `candidate` is the root itself or lives below it. */
function isWithinRoot(root: string, candidate: string): boolean {
  const relative = path.relative(comparablePath(root), comparablePath(candidate))
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  )
}

async function scan(
  dir: string,
  depth: number,
  maxDepth: number,
  ignore: Set<string>,
  out: Candidate[],
): Promise<void> {
  let entries: Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }

  const gitEntry = entries.find((entry) => entry.name === ".git" && !entry.isSymbolicLink())
  if (gitEntry) {
    const type = await classifyGitEntry(dir, gitEntry)
    // A directory with an unusable .git entry is skipped as a subtree; it is not
    // descended into, mirroring "registered repositories are not descended".
    if (type) out.push({ dir, type })
    return
  }

  if (depth >= maxDepth) return

  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue
    if (!entry.isDirectory()) continue
    if (ignore.has(entry.name.toLowerCase())) continue
    await scan(path.join(dir, entry.name), depth + 1, maxDepth, ignore, out)
  }
}

/**
 * Discover git repositories under `root`.
 *
 * A repository is recognized by a `.git` directory (normal) or a `.git` file
 * pointing at a gitdir (worktree/submodule/separate git dir). Repository
 * directories are not descended into, ignored directory names are skipped and
 * symbolic links are never followed.
 */
export async function discoverRepositories(
  root: string,
  options: DiscoverOptions = {},
): Promise<GitRepository[]> {
  const maxDepth = Math.max(0, Math.floor(options.maxDepth ?? DEFAULT_MAX_DEPTH))
  const ignore = new Set((options.ignore ?? DEFAULT_IGNORE).map((name) => name.toLowerCase()))
  const rootPath = path.resolve(root)
  let rootRealPath: string
  try {
    rootRealPath = await realpath(rootPath)
  } catch {
    // The scan below will surface an unreadable root by producing no candidates.
    rootRealPath = rootPath
  }

  const candidates: Candidate[] = []
  await scan(rootPath, 0, maxDepth, ignore, candidates)

  const seen = new Set<string>()
  const repositories: GitRepository[] = []

  for (const candidate of candidates) {
    let workTree: string
    let gitDir: string
    try {
      const toplevel = (await git(candidate.dir, ["rev-parse", "--show-toplevel"])).trim()
      if (!toplevel) continue
      workTree = path.resolve(toplevel)
      const absoluteGitDir = (await git(candidate.dir, ["rev-parse", "--absolute-git-dir"])).trim()
      if (!absoluteGitDir) continue
      gitDir = path.resolve(absoluteGitDir)
    } catch {
      // Not a usable repository (or git failed to resolve it): skip candidate.
      continue
    }

    // A `.git/config` `core.worktree` (or a linked worktree's gitdir) can point
    // anywhere. Only the working tree must stay inside the scanned root: the
    // realpath comparison also catches symlinks escaping the root. A linked
    // worktree's gitdir outside the root is legitimate.
    let workTreeRealPath: string
    try {
      workTreeRealPath = await realpath(workTree)
    } catch {
      continue
    }
    if (!isWithinRoot(rootRealPath, workTreeRealPath)) continue

    let status: GitStatus
    try {
      status = await getStatus(workTree)
    } catch {
      // A single broken repository (e.g. a corrupt index) must not hide the
      // other repositories discovered in the same scan.
      continue
    }

    const id = normalizeRepositoryId(workTree)
    if (seen.has(id)) continue
    seen.add(id)

    repositories.push({
      id,
      name: path.basename(workTree),
      rootPath: workTree,
      gitDir,
      type: candidate.type,
      branch: status.branch,
      head: status.head,
      detached: status.detached,
      changes: status.counts,
    })
  }

  return repositories
}
