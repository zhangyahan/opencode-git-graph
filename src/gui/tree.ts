import type { ChangedFile } from "../shared/types.js"

export interface FileTreeFile {
  readonly kind: "file"
  readonly name: string
  readonly path: string
  readonly file: ChangedFile
}

export interface FileTreeDirectory {
  readonly kind: "directory"
  readonly name: string
  readonly path: string
  readonly children: FileTreeNode[]
  /** Number of files in this directory and all of its descendants. */
  readonly fileCount: number
}

export type FileTreeNode = FileTreeFile | FileTreeDirectory

interface MutableDirectory {
  readonly name: string
  readonly path: string
  readonly directories: Map<string, MutableDirectory>
  readonly files: FileTreeFile[]
}

function compareName(a: { readonly name: string }, b: { readonly name: string }): number {
  if (a.name < b.name) return -1
  if (a.name > b.name) return 1
  return 0
}

function createDirectory(name: string, path: string): MutableDirectory {
  return { name, path, directories: new Map(), files: [] }
}

function finalize(directory: MutableDirectory): FileTreeDirectory {
  const directories = [...directory.directories.values()].sort(compareName).map(finalize)
  const files = [...directory.files].sort(compareName)
  const children: FileTreeNode[] = [...directories, ...files]
  return {
    kind: "directory",
    name: directory.name,
    path: directory.path,
    children,
    fileCount: children.reduce(
      (count, child) => count + (child.kind === "directory" ? child.fileCount : 1),
      0,
    ),
  }
}

/**
 * Build a sorted, nested file tree from repository-relative paths.
 *
 * Paths use `/` separators. Duplicate paths are ignored after their first
 * occurrence. Directories sort before files at every level.
 */
export function buildFileTree(files: readonly ChangedFile[]): FileTreeNode[] {
  const root = createDirectory("", "")
  const seen = new Set<string>()

  for (const file of files) {
    if (!file.path || seen.has(file.path)) continue
    seen.add(file.path)

    const segments = file.path.split("/").filter((segment) => segment.length > 0)
    if (segments.length === 0) continue

    let parent = root
    for (let index = 0; index < segments.length - 1; index += 1) {
      const name = segments[index]
      const path = parent.path ? `${parent.path}/${name}` : name
      let child = parent.directories.get(name)
      if (!child) {
        child = createDirectory(name, path)
        parent.directories.set(name, child)
      }
      parent = child
    }

    const name = segments[segments.length - 1]
    parent.files.push({ kind: "file", name, path: file.path, file })
  }

  const directories: FileTreeNode[] = [...root.directories.values()]
    .sort(compareName)
    .map(finalize)
  const rootFiles: FileTreeNode[] = [...root.files].sort(compareName)
  return [...directories, ...rootFiles]
}

/** Directory paths in stable depth-first order, for "expand all" state. */
export function collectDirectoryPaths(nodes: readonly FileTreeNode[]): string[] {
  const paths: string[] = []
  for (const node of nodes) {
    if (node.kind !== "directory") continue
    paths.push(node.path)
    paths.push(...collectDirectoryPaths(node.children))
  }
  return paths
}
