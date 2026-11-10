import { For, Show } from "solid-js"
import type { ChangedFile, FileDiff, GitCommit } from "../shared/types.js"
import { statusLetter } from "./changes.js"
import { CommitDiffView } from "./commit-diff-view.js"
import { shortHash } from "./format.js"

export interface ComparisonViewProps {
  readonly base: GitCommit
  readonly head: GitCommit
  readonly files: readonly ChangedFile[]
  readonly filesLoading: boolean
  readonly filesError?: string
  readonly selectedPath?: string
  readonly diff?: FileDiff
  readonly diffLoading: boolean
  readonly diffError?: string
  readonly orientation: "columns" | "rows"
  readonly onSelectFile: (file: ChangedFile) => void
  readonly onRetryFiles: () => void
  readonly onRetryDiff: () => void
  readonly onBack: () => void
}

const COMPARE_STYLES = `
.gg-compare-page {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--color-background, transparent);
}
.gg-compare-topbar {
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
.gg-compare-back {
  flex: 0 0 auto;
  padding: 3px 8px;
  border: 1px solid var(--color-border, #444);
  border-radius: 4px;
  background: var(--color-surface, #242424);
  cursor: pointer;
}
.gg-compare-readonly {
  flex: 0 0 auto;
  padding: 0 5px;
  border: 1px solid var(--color-border, #3a3a3a);
  border-radius: 3px;
  color: var(--color-textMuted, #8a8a8a);
  font-size: 10px;
}
.gg-compare-range {
  flex: 1 1 150px;
  min-width: 0;
  overflow: hidden;
  color: var(--color-textPrimary, #d4d4d4);
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.gg-compare-subjects {
  flex: 1 1 100%;
  min-width: 0;
  overflow: hidden;
  color: var(--color-textMuted, #8a8a8a);
  font-size: 10.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.gg-compare-body {
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
.gg-compare-body.gg-compare-columns {
  flex-direction: row;
}
.gg-compare-body.gg-compare-rows {
  flex-direction: column;
}
.gg-compare-files {
  display: flex;
  flex-direction: column;
  flex: 0 0 auto;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  padding: 4px;
}
.gg-compare-columns .gg-compare-files {
  width: 236px;
  border-right: 1px solid var(--color-border, #3a3a3a);
}
.gg-compare-rows .gg-compare-files {
  max-height: 36%;
  border-bottom: 1px solid var(--color-border, #3a3a3a);
}
.gg-compare-file {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-width: 0;
  padding: 2px 5px !important;
  border: 0 !important;
  border-radius: 3px !important;
  background: transparent !important;
  text-align: left;
}
.gg-compare-file:hover {
  background: var(--color-surfaceHover, #303030) !important;
}
.gg-compare-file.gg-selected {
  background: rgba(90, 130, 220, 0.24) !important;
}
.gg-compare-file-path {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.gg-compare-file-old {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  color: var(--color-textMuted, #8a8a8a);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.gg-compare-diff {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
.gg-compare-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1 1 auto;
  padding: 12px;
  color: var(--color-textMuted, #8a8a8a);
  font-size: 11px;
  text-align: center;
}
.gg-compare-status {
  padding: 8px;
  color: var(--color-textMuted, #8a8a8a);
  font-size: 11px;
}
.gg-compare-page .gg-error {
  margin: 6px;
}
`

/**
 * Full-panel read-only comparison page.
 *
 * `base` and `head` are explicit commits from the selection; there is no
 * parent selector, so a comparison can never be confused with a parent diff.
 */
export function ComparisonView(props: ComparisonViewProps) {
  return (
    <div
      class="gg-compare-page"
      data-testid="comparison-page"
      aria-label="Commit comparison"
    >
      <style>{COMPARE_STYLES}</style>
      <div class="gg-compare-topbar">
        <button
          type="button"
          class="gg-compare-back"
          data-testid="details-back"
          data-comparison-back="true"
          onClick={() => props.onBack()}
        >
          Back to history
        </button>
        <span class="gg-compare-readonly">Read only</span>
        <span
          class="gg-compare-range"
          data-testid="comparison-range"
          title={`${props.base.hash} → ${props.head.hash}`}
        >
          {shortHash(props.base.hash)} → {shortHash(props.head.hash)}
        </span>
        <span class="gg-compare-subjects" title={`${props.base.subject} → ${props.head.subject}`}>
          {props.base.subject || "(no subject)"} → {props.head.subject || "(no subject)"}
        </span>
      </div>

      <div class={`gg-compare-body gg-compare-${props.orientation}`}>
        <div
          class="gg-compare-files"
          data-testid="comparison-files"
          aria-label="Files in comparison"
        >
          <Show when={props.filesLoading}>
            <div class="gg-compare-status">Loading changed files…</div>
          </Show>
          <Show when={props.filesError}>
            {(message) => (
              <div class="gg-error">
                <span>{message()}</span>
                <button type="button" onClick={() => props.onRetryFiles()}>
                  Retry
                </button>
              </div>
            )}
          </Show>
          <Show when={!props.filesLoading && !props.filesError}>
            <Show
              when={props.files.length > 0}
              fallback={
                <div class="gg-compare-status">
                  No files differ between these commits.
                </div>
              }
            >
              <For each={props.files}>
                {(file) => (
                  <button
                    type="button"
                    class={
                      props.selectedPath === file.path
                        ? "gg-compare-file gg-selected"
                        : "gg-compare-file"
                    }
                    data-testid="comparison-file"
                    data-path={file.path}
                    title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
                    onClick={() => props.onSelectFile(file)}
                  >
                    <span class={`gg-status-letter gg-status-${file.status}`}>
                      {statusLetter(file.status)}
                    </span>
                    <span class="gg-compare-file-path">{file.path}</span>
                    <Show when={file.oldPath}>
                      <span class="gg-compare-file-old">← {file.oldPath}</span>
                    </Show>
                  </button>
                )}
              </For>
            </Show>
          </Show>
        </div>

        <div class="gg-compare-diff">
          <Show
            when={props.selectedPath}
            fallback={
              <div class="gg-compare-placeholder">
                Select a file to view its diff between these two commits.
              </div>
            }
          >
            {(path) => (
              <CommitDiffView
                commit={props.head}
                parentIndex={0}
                comparisonBase={props.base}
                embedded
                path={path()}
                diff={props.diff}
                loading={props.diffLoading}
                error={props.diffError}
                onBack={props.onBack}
                onRetry={props.onRetryDiff}
              />
            )}
          </Show>
        </div>
      </div>
    </div>
  )
}
