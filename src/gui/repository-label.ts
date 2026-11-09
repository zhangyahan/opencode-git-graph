import type { GitRepository } from "../shared/types.js"

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+$/, "")
}

/**
 * Repository-relative label for the picker. Works without `node:path` because
 * the GUI bundle runs in the host renderer.
 */
export function relativeRepositoryPath(directory: string, rootPath: string): string {
  const base = normalizePath(directory)
  const target = normalizePath(rootPath)
  if (!base) return target
  if (target === base) return "."
  const lowerBase = base.toLowerCase()
  const lowerTarget = target.toLowerCase()
  if (lowerTarget.startsWith(`${lowerBase}/`)) return target.slice(base.length + 1)
  return target
}

/**
 * Option text for one repository.
 *
 * - A unique name stays short.
 * - Same-named repositories (common in monorepos with nested packages) are
 *   disambiguated by their path relative to the session directory.
 * - Worktrees and submodules are always marked, since they share the main
 *   repository's name.
 */
export function repositoryOptionLabel(
  repository: GitRepository,
  repositories: readonly GitRepository[],
  sessionDirectory: string,
): string {
  const duplicateName = repositories.some(
    (candidate) => candidate.id !== repository.id && candidate.name === repository.name,
  )
  let label = repository.name
  if (duplicateName) {
    const relative = relativeRepositoryPath(sessionDirectory, repository.rootPath)
    label = relative === "." ? repository.name : relative
  }
  if (repository.type === "worktree") label += " (worktree)"
  else if (repository.type === "submodule") label += " (submodule)"
  return label
}
