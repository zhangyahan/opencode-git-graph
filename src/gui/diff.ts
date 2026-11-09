export type DiffLineKind = "add" | "remove" | "hunk" | "meta" | "context" | "empty"

export interface DiffLine {
  readonly kind: DiffLineKind
  readonly text: string
}

const META_PREFIXES = [
  "index ",
  "new file mode ",
  "deleted file mode ",
  "old mode ",
  "new mode ",
  "similarity index ",
  "dissimilarity index ",
  "rename from ",
  "rename to ",
  "copy from ",
  "copy to ",
  "create mode ",
  "delete mode ",
] as const

/**
 * Classify unified-diff text for safe, line-oriented rendering.
 *
 * `---`/`+++` are headers only before the first hunk. Inside a hunk they are
 * ordinary removed/added content, including content that itself starts with
 * `++` or `--`.
 */
export function classifyDiff(text: string): DiffLine[] {
  if (text.length === 0) return []

  const rawLines = text.split("\n")
  if (rawLines.length > 0 && rawLines[rawLines.length - 1] === "") rawLines.pop()

  const lines: DiffLine[] = []
  let inHunk = false

  for (const line of rawLines) {
    if (line.length === 0) {
      lines.push({ kind: "empty", text: line })
      continue
    }
    if (line.startsWith("diff --git ") || line.startsWith("diff --cc ") || line.startsWith("diff --combined ")) {
      inHunk = false
      lines.push({ kind: "meta", text: line })
      continue
    }
    if (line.startsWith("@@")) {
      inHunk = true
      lines.push({ kind: "hunk", text: line })
      continue
    }
    if (line.startsWith("\\ No newline") || line.startsWith("Binary files ") || line.startsWith("GIT binary patch")) {
      lines.push({ kind: "meta", text: line })
      continue
    }
    if (!inHunk && (line.startsWith("--- ") || line.startsWith("+++ ") || META_PREFIXES.some((prefix) => line.startsWith(prefix)))) {
      lines.push({ kind: "meta", text: line })
      continue
    }
    if (line.startsWith("+")) {
      lines.push({ kind: "add", text: line })
      continue
    }
    if (line.startsWith("-")) {
      lines.push({ kind: "remove", text: line })
      continue
    }
    lines.push({ kind: "context", text: line })
  }

  return lines
}
