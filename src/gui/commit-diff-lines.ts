import { classifyDiff, type DiffLineKind } from "./diff.js"

/** A classified diff line plus the old/new file line numbers it maps to. */
export interface CommitDiffLine {
  readonly kind: DiffLineKind
  readonly text: string
  /** 1-based old-file line number, or null when the line is not part of the old file. */
  readonly oldLine: number | null
  /** 1-based new-file line number, or null when the line is not part of the new file. */
  readonly newLine: number | null
}

/** Hard cap used by the view so a huge patch cannot create unbounded DOM nodes. */
export const MAX_COMMIT_DIFF_LINES = 4000

interface HunkState {
  oldLine: number
  newLine: number
  oldRemaining: number
  newRemaining: number
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

function parseHunkHeader(text: string): HunkState | null {
  const match = HUNK_HEADER.exec(text)
  if (!match) return null
  return {
    oldLine: Number(match[1]),
    newLine: Number(match[3]),
    // An omitted count means one line, as in `@@ -1 +1 @@`.
    oldRemaining: match[2] === undefined ? 1 : Number(match[2]),
    newRemaining: match[4] === undefined ? 1 : Number(match[4]),
  }
}

/**
 * Outside a hunk, reuse the shared classifier's metadata rules. It is only
 * consulted for lines that are known not to be hunk content, because its
 * `---`/`+++` header detection is ambiguous inside a hunk.
 */
function classifyOutsideHunk(line: string): DiffLineKind {
  if (line.length === 0) return "empty"
  return classifyDiff(line)[0]?.kind ?? "context"
}

function hunkFinished(hunk: HunkState): boolean {
  return hunk.oldRemaining === 0 && hunk.newRemaining === 0
}

/**
 * Turn a unified diff into classified lines that also carry old/new line
 * numbers. A valid `@@ -a,b +c,d @@` header opens a hunk with its declared
 * line counts; content is then classified by its first character (`+`, `-` or
 * space) until both counts are exhausted. That makes in-hunk source lines such
 * as `--- text` and `+++ text` ordinary removals/additions instead of file
 * headers. Metadata, blank separators and `\ No newline at end of file`
 * markers never consume either side. A new hunk, file boundary or exhausted
 * hunk resets the counters.
 */
export function buildCommitDiffLines(text: string): CommitDiffLine[] {
  const rawLines = text.split("\n")
  if (rawLines.length > 0 && rawLines[rawLines.length - 1] === "") rawLines.pop()

  const result: CommitDiffLine[] = []
  let hunk: HunkState | null = null

  for (const line of rawLines) {
    if (line.startsWith("@@")) {
      const parsed = parseHunkHeader(line)
      hunk = parsed && !hunkFinished(parsed) ? parsed : null
      result.push({ kind: "hunk", text: line, oldLine: null, newLine: null })
      continue
    }

    if (
      line.startsWith("\\ No newline") ||
      line.startsWith("Binary files ") ||
      line.startsWith("GIT binary patch")
    ) {
      // A no-newline marker is metadata even when it appears inside a hunk.
      result.push({ kind: "meta", text: line, oldLine: null, newLine: null })
      continue
    }

    if (
      line.startsWith("diff --git ") ||
      line.startsWith("diff --cc ") ||
      line.startsWith("diff --combined ")
    ) {
      // Start of a new file: never let the previous hunk's counters leak in.
      hunk = null
      result.push({ kind: "meta", text: line, oldLine: null, newLine: null })
      continue
    }

    if (hunk) {
      const marker = line[0]
      if (marker === "+") {
        result.push({ kind: "add", text: line, oldLine: null, newLine: hunk.newLine })
        hunk.newLine += 1
        hunk.newRemaining = Math.max(0, hunk.newRemaining - 1)
        if (hunkFinished(hunk)) hunk = null
        continue
      }
      if (marker === "-") {
        result.push({ kind: "remove", text: line, oldLine: hunk.oldLine, newLine: null })
        hunk.oldLine += 1
        hunk.oldRemaining = Math.max(0, hunk.oldRemaining - 1)
        if (hunkFinished(hunk)) hunk = null
        continue
      }
      // Any other line still inside the declared hunk counts as context. This
      // includes a normal ` text` line and tolerates a producer that omitted
      // the leading space on a context line.
      result.push({
        kind: "context",
        text: line,
        oldLine: hunk.oldLine,
        newLine: hunk.newLine,
      })
      hunk.oldLine += 1
      hunk.newLine += 1
      hunk.oldRemaining = Math.max(0, hunk.oldRemaining - 1)
      hunk.newRemaining = Math.max(0, hunk.newRemaining - 1)
      if (hunkFinished(hunk)) hunk = null
      continue
    }

    // Headers, metadata and blank separators outside a hunk. No numbering state
    // is consumed here, so the next hunk starts from its own `@@` header.
    result.push({
      kind: classifyOutsideHunk(line),
      text: line,
      oldLine: null,
      newLine: null,
    })
  }

  return result
}
