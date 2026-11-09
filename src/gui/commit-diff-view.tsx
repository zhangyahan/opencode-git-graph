import { For, Show, createMemo } from "solid-js"
import type { FileDiff, GitCommit } from "../shared/types.js"
import { shortHash } from "./format.js"
import {
  MAX_COMMIT_DIFF_LINES,
  buildCommitDiffLines,
  type CommitDiffLine,
} from "./commit-diff-lines.js"

export interface CommitDiffViewProps {
  commit: GitCommit
  parentIndex: number
  path: string
  diff?: FileDiff
  loading: boolean
  error?: string
  onBack: () => void
  onRetry: () => void
  onParentChange?: (index: number) => void
}

/**
 * Styles owned by this component. Every selector is scoped to the
 * `gg-commit-diff-` prefix so the view can be embedded in the side panel
 * without touching the panel's global stylesheet.
 */
export const COMMIT_DIFF_STYLES = `
.gg-commit-diff-page {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  box-sizing: border-box;
  color: var(--color-textPrimary, #d4d4d4);
  background: var(--color-background, transparent);
  font-family: var(--font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif);
  font-size: 12px;
  line-height: 1.35;
}
.gg-commit-diff-page *,
.gg-commit-diff-page *::before,
.gg-commit-diff-page *::after {
  box-sizing: border-box;
}
.gg-commit-diff-page button,
.gg-commit-diff-page select {
  font: inherit;
  color: inherit;
}
.gg-commit-diff-topbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  flex: 0 0 auto;
  min-width: 0;
  padding: 6px 8px;
  border-bottom: 1px solid var(--color-border, #3a3a3a);
  background: var(--color-surface, rgba(128, 128, 128, 0.035));
}
.gg-commit-diff-back {
  flex: 0 0 auto;
  padding: 3px 8px;
  border: 1px solid var(--color-border, #444);
  border-radius: 4px;
  background: var(--color-surface, #242424);
  cursor: pointer;
}
.gg-commit-diff-back:hover {
  background: var(--color-surfaceHover, #303030);
}
.gg-commit-diff-readonly {
  flex: 0 0 auto;
  padding: 0 5px;
  border: 1px solid var(--color-border, #3a3a3a);
  border-radius: 3px;
  color: var(--color-textMuted, #8a8a8a);
  font-size: 10px;
  letter-spacing: 0.02em;
}
.gg-commit-diff-range {
  flex: 1 1 120px;
  min-width: 0;
  overflow: hidden;
  color: var(--color-textSecondary, #b0b0b0);
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  font-size: 10.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.gg-commit-diff-parent {
  display: flex;
  align-items: center;
  flex: 0 0 auto;
  max-width: 100%;
  margin-left: auto;
}
.gg-commit-diff-parent select {
  min-width: 0;
  max-width: 190px;
  height: 23px;
  padding: 2px 6px;
  border: 1px solid var(--color-border, #444);
  border-radius: 4px;
  background: var(--color-surface, #242424);
}
.gg-commit-diff-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
.gg-commit-diff-body {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
.gg-commit-diff-scroll {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  background: rgba(0, 0, 0, 0.1);
}
.gg-commit-diff-filehead {
  position: sticky;
  top: 0;
  left: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-width: 0;
  padding: 5px 8px;
  border-bottom: 1px solid var(--color-border, #3a3a3a);
  background: var(--color-surface, #242424);
  color: var(--color-textMuted, #8a8a8a);
  font-size: 10.5px;
}
.gg-commit-diff-path {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  color: var(--color-textPrimary, #d4d4d4);
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.gg-commit-diff-status {
  flex: 0 0 auto;
  padding: 0 4px;
  border-radius: 3px;
  background: rgba(128, 128, 128, 0.16);
  color: var(--color-textSecondary, #b0b0b0);
}
.gg-commit-diff-status-added { color: #7ddb88; }
.gg-commit-diff-status-modified { color: #e6c15a; }
.gg-commit-diff-status-deleted { color: #ff8585; }
.gg-commit-diff-status-renamed,
.gg-commit-diff-status-copied { color: #7fb4ff; }
.gg-commit-diff-status-untracked { color: #8ad9d9; }
.gg-commit-diff-status-conflicted { color: #ff8fcf; }
.gg-commit-diff-rename {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  color: var(--color-textMuted, #8a8a8a);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.gg-commit-diff-lines {
  width: max-content;
  min-width: 100%;
  padding: 4px 0;
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  font-size: 11px;
  line-height: 1.45;
}
.gg-commit-diff-line {
  display: flex;
  align-items: flex-start;
  width: max-content;
  min-width: 100%;
}
.gg-commit-diff-num {
  flex: 0 0 auto;
  width: 46px;
  padding: 0 6px;
  color: var(--color-textMuted, #8a8a8a);
  text-align: right;
  user-select: none;
  white-space: nowrap;
}
.gg-commit-diff-text {
  flex: 1 1 auto;
  padding: 0 8px 0 4px;
  white-space: pre;
}
.gg-commit-diff-add {
  color: #8ce99a;
  background: rgba(46, 160, 67, 0.16);
}
.gg-commit-diff-remove {
  color: #ff9b9b;
  background: rgba(190, 50, 50, 0.16);
}
.gg-commit-diff-hunk {
  color: #8ec5ff;
  background: rgba(50, 110, 190, 0.16);
}
.gg-commit-diff-context {
  color: inherit;
}
.gg-commit-diff-meta {
  color: var(--color-textMuted, #8a8a8a);
}
.gg-commit-diff-empty {
  color: transparent;
}
.gg-commit-diff-warning {
  margin: 6px;
  padding: 6px 8px;
  border: 1px solid rgba(230, 193, 90, 0.35);
  border-radius: 4px;
  background: rgba(230, 193, 90, 0.1);
  color: #e6c15a;
  font-size: 11px;
}
.gg-commit-diff-notice {
  margin: 6px;
  padding: 6px 8px;
  border: 1px solid rgba(80, 150, 220, 0.35);
  border-radius: 4px;
  background: rgba(50, 110, 190, 0.1);
  color: #8ec5ff;
  font-size: 11px;
}
.gg-commit-diff-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin: 8px;
  padding: 8px;
  border: 1px solid rgba(190, 50, 50, 0.4);
  border-radius: 4px;
  background: rgba(190, 50, 50, 0.1);
  color: #ff9b9b;
  font-size: 11px;
}
.gg-commit-diff-retry {
  flex: 0 0 auto;
  padding: 3px 8px;
  border: 1px solid var(--color-border, #444);
  border-radius: 4px;
  background: var(--color-surface, #242424);
  cursor: pointer;
}
.gg-commit-diff-retry:hover {
  background: var(--color-surfaceHover, #303030);
}
.gg-commit-diff-state {
  padding: 12px;
  color: var(--color-textMuted, #8a8a8a);
  font-size: 11px;
}
`

/**
 * Full-page, read-only view of one file's diff inside a historical commit.
 *
 * The component is intentionally data-only: it never loads a repository, never
 * opens the index or working tree, and never writes a session. The caller
 * supplies the already-fetched `FileDiff`, which is the patch for `path`
 * against the selected parent of `commit`.
 */
export function CommitDiffView(props: CommitDiffViewProps) {
  const selectedParentIndex = (): number => {
    const last = props.commit.parents.length - 1
    if (last < 0) return 0
    const requested = Number.isFinite(props.parentIndex)
      ? Math.trunc(props.parentIndex)
      : 0
    return Math.min(Math.max(0, requested), last)
  }

  const parentHash = (): string | undefined => {
    const parents = props.commit.parents
    if (parents.length === 0) return undefined
    return parents[selectedParentIndex()] ?? parents[0]
  }

  const rangeTitle = () => `${parentHash() ?? "Empty tree"} → ${props.commit.hash}`
  const canPickParent = () =>
    props.onParentChange !== undefined && props.commit.parents.length > 0

  const allLines = createMemo(() => buildCommitDiffLines(props.diff?.text ?? ""))
  const visibleLines = createMemo(() =>
    allLines().slice(0, MAX_COMMIT_DIFF_LINES),
  )
  const hasText = () => (props.diff?.text.trim().length ?? 0) > 0

  return (
    <div
      class="gg-commit-diff-page"
      data-testid="commit-diff-page"
      aria-label="Commit diff"
    >
      <style>{COMMIT_DIFF_STYLES}</style>

      <div class="gg-commit-diff-topbar">
        <button
          type="button"
          class="gg-commit-diff-back"
          data-testid="details-back"
          aria-label="Back to history"
          onClick={() => props.onBack()}
        >
          Back to history
        </button>
        <span class="gg-commit-diff-readonly" title="Historical commit diffs are read-only">
          Read only
        </span>
        <span class="gg-commit-diff-range" title={rangeTitle()}>
          <span class="gg-commit-diff-parent-hash">
            {parentHash() ? shortHash(parentHash()) : "Empty tree"}
          </span>
          {" → "}
          <span class="gg-commit-diff-commit-hash">
            {shortHash(props.commit.hash)}
          </span>
        </span>
        <Show when={canPickParent()}>
          <label class="gg-commit-diff-parent">
            <span class="gg-commit-diff-sr-only">Diff parent</span>
            <select
              aria-label="Diff parent"
              value={String(selectedParentIndex())}
              disabled={props.loading}
              onChange={(event) =>
                props.onParentChange?.(Number(event.currentTarget.value))
              }
            >
              <For each={props.commit.parents}>
                {(parent, index) => (
                  <option value={String(index())}>
                    Parent {index() + 1} · {shortHash(parent)}
                  </option>
                )}
              </For>
            </select>
          </label>
        </Show>
      </div>

      <div class="gg-commit-diff-body" data-testid="diff" aria-label="Diff">
        <div class="gg-commit-diff-scroll">
          <div class="gg-commit-diff-filehead">
            <span class="gg-commit-diff-path" title={props.path}>
              {props.path || "(unknown path)"}
            </span>
            <Show when={props.diff}>
              {(diff) => (
                <>
                  <span
                    class={`gg-commit-diff-status gg-commit-diff-status-${diff().status}`}
                  >
                    {diff().status}
                  </span>
                  <Show when={diff().oldPath}>
                    {(oldPath) => (
                      <span class="gg-commit-diff-rename" title={oldPath()}>
                        from {oldPath()}
                      </span>
                    )}
                  </Show>
                </>
              )}
            </Show>
          </div>

          <Show when={props.error}>
            {(message) => (
              <div class="gg-commit-diff-error">
                <span>{message()}</span>
                <button
                  type="button"
                  class="gg-commit-diff-retry"
                  onClick={() => props.onRetry()}
                >
                  Retry
                </button>
              </div>
            )}
          </Show>

          <Show when={!props.error && props.loading}>
            <div class="gg-commit-diff-state" role="status">
              Loading diff…
            </div>
          </Show>

          <Show when={!props.error && !props.loading}>
            <Show
              when={props.diff}
              fallback={
                <div class="gg-commit-diff-state">
                  No diff data for this file.
                </div>
              }
            >
              {(diff) => (
                <>
                  <Show when={diff().binary}>
                    <div class="gg-commit-diff-warning">
                      Binary file. No textual diff is available.
                    </div>
                  </Show>
                  <Show when={diff().truncated}>
                    <div class="gg-commit-diff-warning">
                      Diff truncated by the server: this file is larger than the
                      readable limit. The text below is incomplete.
                    </div>
                  </Show>

                  <Show when={!diff().binary && hasText()}>
                    <div class="gg-commit-diff-lines">
                      <For each={visibleLines()}>
                        {(line: CommitDiffLine) => (
                          <div
                            class={`gg-commit-diff-line gg-commit-diff-${line.kind}`}
                          >
                            <span class="gg-commit-diff-num" aria-hidden="true">
                              {line.oldLine ?? ""}
                            </span>
                            <span class="gg-commit-diff-num" aria-hidden="true">
                              {line.newLine ?? ""}
                            </span>
                            <span class="gg-commit-diff-text">
                              {line.text.length > 0 ? line.text : " "}
                            </span>
                          </div>
                        )}
                      </For>
                    </div>
                    <Show when={allLines().length > MAX_COMMIT_DIFF_LINES}>
                      <div class="gg-commit-diff-notice">
                        Showing the first {MAX_COMMIT_DIFF_LINES} of{" "}
                        {allLines().length} diff lines.
                      </div>
                    </Show>
                  </Show>

                  <Show when={!diff().binary && !hasText()}>
                    <div class="gg-commit-diff-state">
                      No textual changes in this file.
                    </div>
                  </Show>
                </>
              )}
            </Show>
          </Show>
        </div>
      </div>
    </div>
  )
}
