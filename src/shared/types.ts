/**
 * Canonical types shared by the server (git engine) and the GUI.
 */

export interface ChangeCounts {
  staged: number
  unstaged: number
  untracked: number
  conflicted: number
}

export interface GitRepository {
  /** Normalized absolute working-tree path (drive letter lowercased on win32). */
  id: string
  /** Basename of the working-tree directory. */
  name: string
  /** Absolute working-tree path. */
  rootPath: string
  /** Absolute git directory (actual gitdir for worktrees/submodules). */
  gitDir: string
  type: "normal" | "worktree" | "submodule"
  branch: string | null
  /** Full commit hash, null for an empty repository. */
  head: string | null
  detached: boolean
  changes: ChangeCounts
}

export interface GitStatus {
  repositoryId: string
  branch: string | null
  head: string | null
  detached: boolean
  files: ChangedFile[]
  counts: ChangeCounts
}

export interface ChangedFile {
  path: string
  oldPath?: string
  status:
    | "added"
    | "modified"
    | "deleted"
    | "renamed"
    | "copied"
    | "untracked"
    | "conflicted"
  staged: boolean
  /** Lines added, when git's numstat reported a numeric count (never for binary). */
  added?: number
  /** Lines deleted, when git's numstat reported a numeric count (never for binary). */
  deleted?: number
}

/** Immutable content of one path in a commit tree. */
export interface CommitFileContent {
  path: string
  mode: string | null
  kind: "text" | "binary" | "symlink" | "missing"
  text: string | null
  /** Blob size in bytes; null when the path has no blob (gitlink). */
  size: number | null
  truncated?: boolean
}

export interface GitCommit {
  hash: string
  parents: string[]
  author: string
  authorDate: string
  subject: string
  refs: string[]
}

export interface GitRef {
  name: string
  hash: string
  kind: "branch" | "remote" | "tag" | "head"
}

export type GitTarget =
  | { type: "commit"; hash: string; parentIndex?: number }
  | { type: "index" }
  | { type: "working-tree" }

export interface FileDiff {
  path: string
  status: ChangedFile["status"]
  oldPath?: string
  text: string
  binary: boolean
  truncated?: boolean
}

/** Result shared by every write (mutation) method. */
export interface GitMutationResult {
  status: GitStatus
  changed: boolean
  warning?: string
}

/**
 * Result of `fetchRemote`.
 *
 * `refsUpdated` counts refs under `refs/remotes/` and `refs/tags/` that were
 * created or moved by the fetch. Deleted refs (`prune`) still set `changed` but
 * are not included in `refsUpdated`. A fetch that changes nothing resolves with
 * `refsUpdated: 0` and `changed: false` (an up-to-date repository is not an
 * error).
 */
export interface GitFetchResult extends GitMutationResult {
  refsUpdated: number
}
