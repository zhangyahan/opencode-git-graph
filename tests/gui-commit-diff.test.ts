import { describe, expect, it } from "vitest"
import {
  MAX_COMMIT_DIFF_LINES,
  buildCommitDiffLines,
} from "../src/gui/commit-diff-lines.js"

function unified(lines: readonly string[]): string {
  return `${lines.join("\n")}\n`
}

describe("commit diff line numbering", () => {
  it("numbers a root commit addition from the new file and leaves old lines empty", () => {
    const lines = buildCommitDiffLines(
      unified([
        "diff --git a/hello.txt b/hello.txt",
        "new file mode 100644",
        "--- /dev/null",
        "+++ b/hello.txt",
        "@@ -0,0 +1,2 @@",
        "+first",
        "+second",
      ]),
    )

    expect(lines).toHaveLength(7)
    for (const line of lines.slice(0, 5)) {
      expect(line.oldLine).toBeNull()
      expect(line.newLine).toBeNull()
    }
    expect(lines[5]).toEqual({
      kind: "add",
      text: "+first",
      oldLine: null,
      newLine: 1,
    })
    expect(lines[6]).toEqual({
      kind: "add",
      text: "+second",
      oldLine: null,
      newLine: 2,
    })
  })

  it("numbers a root commit deletion from the old file and leaves new lines empty", () => {
    const lines = buildCommitDiffLines(
      unified([
        "diff --git a/old.txt b/old.txt",
        "deleted file mode 100644",
        "--- a/old.txt",
        "+++ /dev/null",
        "@@ -1,2 +0,0 @@",
        "-first",
        "-second",
      ]),
    )

    expect(lines[5]).toEqual({
      kind: "remove",
      text: "-first",
      oldLine: 1,
      newLine: null,
    })
    expect(lines[6]).toEqual({
      kind: "remove",
      text: "-second",
      oldLine: 2,
      newLine: null,
    })
  })

  it("keeps rename metadata unnumbered and still starts the hunk at its own header", () => {
    const lines = buildCommitDiffLines(
      unified([
        "diff --git a/old.ts b/new.ts",
        "similarity index 100%",
        "rename from old.ts",
        "rename to new.ts",
        "@@ -4 +4 @@",
        "-old",
        "+new",
      ]),
    )

    for (const line of lines.slice(0, 4)) {
      expect(line.kind).toBe("meta")
      expect(line.oldLine).toBeNull()
      expect(line.newLine).toBeNull()
    }
    expect(lines[5]).toMatchObject({ kind: "remove", oldLine: 4, newLine: null })
    expect(lines[6]).toMatchObject({ kind: "add", oldLine: null, newLine: 4 })
  })

  it("does not let metadata or blank separator lines consume line numbers", () => {
    const lines = buildCommitDiffLines(
      unified([
        "diff --git a/a.ts b/a.ts",
        "",
        "index 1111111..2222222 100644",
        "--- a/a.ts",
        "+++ b/a.ts",
        "@@ -7 +7 @@",
        "-old",
        "+new",
      ]),
    )

    const blank = lines.find((line) => line.kind === "empty")
    expect(blank).toMatchObject({ oldLine: null, newLine: null })
    expect(lines.find((line) => line.text === "-old")).toMatchObject({
      oldLine: 7,
      newLine: null,
    })
    expect(lines.find((line) => line.text === "+new")).toMatchObject({
      oldLine: null,
      newLine: 7,
    })
  })

  it("resets old and new counters at every hunk header", () => {
    const lines = buildCommitDiffLines(
      unified([
        "diff --git a/src/a.ts b/src/a.ts",
        "index 1111111..2222222 100644",
        "--- a/src/a.ts",
        "+++ b/src/a.ts",
        "@@ -1,3 +1,3 @@",
        " one",
        "-two",
        "+TWO",
        " three",
        "@@ -10,2 +10,2 @@ function",
        " ten",
        "-eleven",
        "+ELEVEN",
      ]),
    )

    const numbered = lines
      .filter((line) => line.kind !== "meta" && line.kind !== "empty")
      .map((line) => [line.kind, line.oldLine, line.newLine])
    expect(numbered).toEqual([
      ["hunk", null, null],
      ["context", 1, 1],
      ["remove", 2, null],
      ["add", null, 2],
      ["context", 3, 3],
      ["hunk", null, null],
      ["context", 10, 10],
      ["remove", 11, null],
      ["add", null, 11],
    ])
  })

  it("ignores the no-newline marker instead of advancing either side", () => {
    const lines = buildCommitDiffLines(
      unified([
        "diff --git a/a.txt b/a.txt",
        "--- a/a.txt",
        "+++ b/a.txt",
        "@@ -1 +1 @@",
        "-old",
        "\\ No newline at end of file",
        "+new",
      ]),
    )

    expect(lines[4]).toMatchObject({ kind: "remove", oldLine: 1, newLine: null })
    expect(lines[5]).toEqual({
      kind: "meta",
      text: "\\ No newline at end of file",
      oldLine: null,
      newLine: null,
    })
    expect(lines[6]).toMatchObject({ kind: "add", oldLine: null, newLine: 1 })
  })

  it("keeps diff-looking and HTML-looking content as inert classified text", () => {
    const lines = buildCommitDiffLines(
      unified([
        "@@ -1,3 +1,3 @@",
        " context",
        "--- looks like a file header",
        "+++ looks like a file header",
        "<script>alert(1)</script>",
      ]),
    )

    expect(lines[1]).toEqual({
      kind: "context",
      text: " context",
      oldLine: 1,
      newLine: 1,
    })
    expect(lines[2]).toEqual({
      kind: "remove",
      text: "--- looks like a file header",
      oldLine: 2,
      newLine: null,
    })
    expect(lines[3]).toEqual({
      kind: "add",
      text: "+++ looks like a file header",
      oldLine: null,
      newLine: 2,
    })
    expect(lines[4]).toEqual({
      kind: "context",
      text: "<script>alert(1)</script>",
      oldLine: 3,
      newLine: 3,
    })
  })

  it("treats in-hunk ---/+++ source lines as content, not file headers", () => {
    const lines = buildCommitDiffLines(
      unified([
        "diff --git a/src/a.ts b/src/a.ts",
        "--- a/src/a.ts",
        "+++ b/src/a.ts",
        "@@ -1,3 +1,3 @@",
        " keep",
        "--- removed source that starts with two dashes",
        "+++ added source that starts with two pluses",
        " tail",
      ]),
    )

    expect(lines[4]).toEqual({
      kind: "context",
      text: " keep",
      oldLine: 1,
      newLine: 1,
    })
    expect(lines[5]).toEqual({
      kind: "remove",
      text: "--- removed source that starts with two dashes",
      oldLine: 2,
      newLine: null,
    })
    expect(lines[6]).toEqual({
      kind: "add",
      text: "+++ added source that starts with two pluses",
      oldLine: null,
      newLine: 2,
    })
    expect(lines[7]).toEqual({
      kind: "context",
      text: " tail",
      oldLine: 3,
      newLine: 3,
    })
  })

  it("resets hunk state between files and keeps the new file headers as metadata", () => {
    const lines = buildCommitDiffLines(
      unified([
        "diff --git a/one.txt b/one.txt",
        "--- a/one.txt",
        "+++ b/one.txt",
        "@@ -1,2 +1,2 @@",
        " one",
        "-two",
        "+TWO",
        "diff --git a/two.txt b/two.txt",
        "--- a/two.txt",
        "+++ b/two.txt",
        "@@ -10,2 +20,2 @@",
        " ten",
        "-old",
        "+new",
      ]),
    )

    expect(lines[5]).toMatchObject({ kind: "remove", oldLine: 2, newLine: null })
    expect(lines[6]).toMatchObject({ kind: "add", oldLine: null, newLine: 2 })
    expect(lines[7]).toEqual({
      kind: "meta",
      text: "diff --git a/two.txt b/two.txt",
      oldLine: null,
      newLine: null,
    })
    expect(lines[8]).toEqual({
      kind: "meta",
      text: "--- a/two.txt",
      oldLine: null,
      newLine: null,
    })
    expect(lines[9]).toEqual({
      kind: "meta",
      text: "+++ b/two.txt",
      oldLine: null,
      newLine: null,
    })
    expect(lines[11]).toEqual({
      kind: "context",
      text: " ten",
      oldLine: 10,
      newLine: 20,
    })
    expect(lines[12]).toMatchObject({ kind: "remove", oldLine: 11, newLine: null })
    expect(lines[13]).toMatchObject({ kind: "add", oldLine: null, newLine: 21 })
  })

  it("exposes the 4000-line display cap used by the view", () => {
    expect(MAX_COMMIT_DIFF_LINES).toBe(4000)
  })
})
