import type { ChangedFile, GitTarget } from "../shared/types.js"

export interface StatusGroups {
  readonly staged: ChangedFile[]
  readonly unstaged: ChangedFile[]
  readonly untracked: ChangedFile[]
  readonly conflicted: ChangedFile[]
}

/**
 * Split status entries into the four working-tree groups shown by the panel.
 * A path that is partly staged and partly unstaged intentionally appears in
 * both the staged and unstaged groups, matching git's two-column status.
 */
export function groupStatusFiles(files: readonly ChangedFile[]): StatusGroups {
  const staged: ChangedFile[] = []
  const unstaged: ChangedFile[] = []
  const untracked: ChangedFile[] = []
  const conflicted: ChangedFile[] = []

  for (const file of files) {
    if (file.status === "conflicted") conflicted.push(file)
    else if (file.status === "untracked") untracked.push(file)
    else if (file.staged) staged.push(file)
    else unstaged.push(file)
  }

  return { staged, unstaged, untracked, conflicted }
}

/** The diff target a status entry opens: index for staged changes, worktree otherwise. */
export function statusFileTarget(file: ChangedFile): GitTarget {
  return file.staged && file.status !== "conflicted" ? { type: "index" } : { type: "working-tree" }
}

export function findStatusFile(
  files: readonly ChangedFile[],
  path: string,
  source: "index" | "working-tree",
): ChangedFile | undefined {
  return files.find((file) => file.path === path && statusFileTarget(file).type === source)
}

export function statusLetter(status: ChangedFile["status"]): string {
  switch (status) {
    case "added":
      return "A"
    case "modified":
      return "M"
    case "deleted":
      return "D"
    case "renamed":
      return "R"
    case "copied":
      return "C"
    case "untracked":
      return "U"
    case "conflicted":
      return "!"
  }
}
