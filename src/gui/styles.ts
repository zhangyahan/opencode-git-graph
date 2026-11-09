/**
 * Self-contained panel styles. The host supplies the surrounding tokens; every
 * rule has a neutral fallback so the panel is readable in both themes.
 *
 * Layout contract: the panel is a flex column that fills its host, the history
 * section flexes to take the remaining height, and only the history body,
 * changes body and diff body scroll. Nothing is pinned to a fixed pixel height
 * that would leave half the host blank.
 */
export const GG_STYLES = `
.git-graph-panel {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  padding: 0;
  box-sizing: border-box;
  font-family: var(--font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif);
  font-size: 12px;
  line-height: 1.35;
  color: var(--color-textPrimary, #d4d4d4);
  background: var(--color-background, transparent);
}
.git-graph-panel *,
.git-graph-panel *::before,
.git-graph-panel *::after {
  box-sizing: border-box;
}
.git-graph-panel button,
.git-graph-panel select,
.git-graph-panel input {
  font: inherit;
  color: inherit;
}
.git-graph-panel button {
  border: 1px solid var(--color-border, #444);
  border-radius: 4px;
  background: var(--color-surface, #242424);
  padding: 3px 8px;
  cursor: pointer;
}
.git-graph-panel button:hover:not(:disabled) {
  background: var(--color-surfaceHover, #303030);
}
.git-graph-panel button:disabled {
  opacity: 0.5;
  cursor: default;
}
.git-graph-panel select {
  min-width: 0;
  border: 1px solid var(--color-border, #444);
  border-radius: 4px;
  background: var(--color-surface, #242424);
  padding: 2px 6px;
}
.gg-sr-only {
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

/* ---------- toolbar ---------- */
.gg-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
  min-width: 0;
  padding: 6px 8px;
  border-bottom: 1px solid var(--color-border, #3a3a3a);
  background: var(--color-surface, rgba(128, 128, 128, 0.04));
}
.gg-repo-select {
  flex: 1 1 150px;
  min-width: 88px;
  max-width: 280px;
  height: 26px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.gg-icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 26px;
  height: 26px;
  padding: 0 !important;
  line-height: 1;
}
.gg-spin svg {
  animation: gg-spin 0.9s linear infinite;
}
@keyframes gg-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
.gg-branch {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 0 1 auto;
  min-width: 0;
  max-width: 170px;
  height: 24px;
  padding: 0 7px;
  border-radius: 12px;
  border: 1px solid var(--color-border, #444);
  background: rgba(90, 130, 220, 0.12);
  color: var(--color-textPrimary, #d4d4d4);
}
.gg-branch-icon {
  display: block;
  flex: 0 0 auto;
  color: #7aa2f7;
}
.gg-branch-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}
.gg-branch.gg-branch-detached {
  border-color: rgba(224, 175, 104, 0.55);
  background: rgba(224, 175, 104, 0.14);
}
.gg-badge-detached {
  flex: 0 0 auto;
  padding: 0 4px;
  border-radius: 3px;
  font-size: 10px;
  font-weight: 600;
  color: #f3c969;
  background: rgba(224, 175, 104, 0.18);
}
.gg-search {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1 1 150px;
  min-width: 96px;
  height: 26px;
  padding: 0 5px 0 6px;
  border: 1px solid var(--color-border, #444);
  border-radius: 4px;
  background: var(--color-surface, #242424);
}
.gg-search:focus-within {
  border-color: rgba(122, 162, 247, 0.75);
  box-shadow: 0 0 0 1px rgba(122, 162, 247, 0.35);
}
.gg-search-icon {
  flex: 0 0 auto;
  color: var(--color-textMuted, #8a8a8a);
}
.gg-search input {
  flex: 1 1 auto;
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  padding: 0;
  font-size: 11.5px;
}
.gg-search input::placeholder {
  color: var(--color-textMuted, #8a8a8a);
}
.gg-search-clear {
  flex: 0 0 auto;
  width: 18px;
  height: 18px;
  padding: 0 !important;
  border: 0 !important;
  border-radius: 3px !important;
  background: transparent !important;
  color: var(--color-textMuted, #8a8a8a);
  line-height: 1;
}
.gg-search-clear:hover {
  color: var(--color-textPrimary, #d4d4d4);
  background: var(--color-surfaceHover, #303030) !important;
}

/* ---------- shared status blocks ---------- */
.gg-status,
.gg-empty,
.gg-error,
.gg-warning,
.gg-notice {
  border-radius: 4px;
  padding: 5px 8px;
  font-size: 11px;
}
.gg-status,
.gg-empty {
  color: var(--color-textMuted, #8a8a8a);
  background: color-mix(in srgb, var(--color-surface, #242424) 70%, transparent);
}
.gg-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 64px;
  text-align: center;
}
.gg-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: var(--color-danger, #ff8a8a);
  background: rgba(190, 50, 50, 0.12);
  border: 1px solid rgba(190, 50, 50, 0.35);
}
.gg-warning {
  color: var(--color-warning, #ffd479);
  background: rgba(190, 140, 40, 0.12);
  border: 1px solid rgba(190, 140, 40, 0.35);
}
.gg-notice {
  color: var(--color-textSecondary, #b0b0b0);
  background: rgba(90, 120, 180, 0.12);
}
.gg-muted {
  color: var(--color-textMuted, #8a8a8a);
  font-size: 11px;
}

/* ---------- working tree changes ---------- */
.gg-changes-section {
  display: flex;
  flex-direction: column;
  flex: 0 0 auto;
  min-height: 0;
  border-bottom: 1px solid var(--color-border, #3a3a3a);
}
.gg-working-tree-clean {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 10px;
  color: var(--color-textMuted, #8a8a8a);
  font-size: 11px;
}
.gg-clean-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #7ddb88;
  box-shadow: 0 0 0 3px rgba(125, 219, 136, 0.16);
}
.gg-changes-head {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 5px 8px !important;
  border: 0 !important;
  border-radius: 0 !important;
  background: transparent !important;
  text-align: left;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.03em;
  color: var(--color-textSecondary, #b0b0b0);
}
.gg-changes-head:hover {
  background: var(--color-surfaceHover, #303030) !important;
}
.gg-caret {
  flex: 0 0 auto;
  width: 10px;
  color: var(--color-textMuted, #8a8a8a);
  font-size: 9px;
}
.gg-count-badge {
  flex: 0 0 auto;
  min-width: 16px;
  padding: 0 4px;
  border-radius: 8px;
  background: rgba(128, 128, 128, 0.2);
  color: var(--color-textSecondary, #b0b0b0);
  font-size: 10px;
  font-weight: 600;
  text-align: center;
}
.gg-changes-summary {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-textMuted, #8a8a8a);
  font-weight: 400;
  font-size: 10.5px;
}
.gg-changes-body {
  min-height: 0;
  max-height: min(30vh, 220px);
  overflow: auto;
  padding: 0 6px 6px;
}
.gg-status-group {
  display: flex;
  flex-direction: column;
}
.gg-group-head {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 2px 4px !important;
  border: 0 !important;
  border-radius: 3px !important;
  background: transparent !important;
  text-align: left;
  color: var(--color-textSecondary, #b0b0b0);
  font-size: 10.5px;
}
.gg-group-head:hover {
  background: var(--color-surfaceHover, #303030) !important;
}
.gg-group-body {
  display: flex;
  flex-direction: column;
}
.gg-file-row,
.gg-dir-row {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-width: 0;
  min-height: 22px;
  text-align: left;
  border: 0 !important;
  border-radius: 3px !important;
  background: transparent !important;
  padding: 1px 4px !important;
  padding-left: var(--gg-indent, 4px) !important;
}
.gg-file-row:hover,
.gg-dir-row:hover {
  background: var(--color-surfaceHover, #303030) !important;
}
.gg-file-row.gg-selected,
.gg-dir-row.gg-selected {
  background: rgba(90, 130, 220, 0.24) !important;
}
.gg-file-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1 1 auto;
}
.gg-file-old {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-textMuted, #8a8a8a);
  font-size: 10px;
}
.gg-status-letter {
  flex: 0 0 auto;
  width: 14px;
  text-align: center;
  font-size: 10px;
  font-weight: 700;
  border-radius: 3px;
  background: rgba(140, 140, 140, 0.16);
}
.gg-status-added { color: #7ddb88; }
.gg-status-modified { color: #e6c15a; }
.gg-status-deleted { color: #ff8585; }
.gg-status-renamed,
.gg-status-copied { color: #7fb4ff; }
.gg-status-untracked { color: #8ad9d9; }
.gg-status-conflicted { color: #ff8fcf; }

/* ---------- history table ---------- */
.gg-history {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
}
.gg-history-head {
  display: grid;
  grid-template-columns: var(--gg-history-cols, 152px minmax(0, 1fr) 96px 118px 74px);
  align-items: center;
  flex: 0 0 auto;
  height: 26px;
  border-bottom: 1px solid var(--color-border, #3a3a3a);
  background: var(--color-surface, rgba(128, 128, 128, 0.05));
  color: var(--color-textSecondary, #b0b0b0);
  font-size: 10.5px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.gg-history-head > div {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 0 7px;
}
.gg-col-graph-head {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  overflow: visible !important;
  padding-left: 8px !important;
}
.gg-graph-resize {
  position: absolute;
  top: 0;
  right: -3px;
  bottom: 0;
  width: 6px;
  padding: 0 !important;
  border: 0 !important;
  border-radius: 0 !important;
  background: transparent !important;
  cursor: col-resize;
  z-index: 2;
}
.gg-graph-resize::after {
  content: "";
  position: absolute;
  top: 6px;
  bottom: 6px;
  left: 2px;
  width: 1px;
  background: var(--color-border, #444);
  opacity: 0;
}
.gg-graph-resize:hover::after {
  opacity: 1;
}
.gg-graph-hscroll-row {
  display: flex;
  flex: 0 0 auto;
  min-height: 8px;
  overflow: hidden;
  border-bottom: 1px solid var(--color-border, #3a3a3a);
  background: rgba(0, 0, 0, 0.08);
}
.gg-graph-hscroll {
  flex: 0 0 auto;
  width: var(--gg-graph-column, 152px);
  min-width: 0;
  max-width: var(--gg-graph-column, 152px);
  height: 10px;
  overflow-x: auto;
  overflow-y: hidden;
}
.gg-graph-hscroll::-webkit-scrollbar {
  height: 8px;
}
.gg-graph-hscroll::-webkit-scrollbar-thumb {
  border-radius: 4px;
  background: rgba(140, 140, 140, 0.45);
}
.gg-graph-hspacer {
  height: 1px;
}
.gg-history-scroll {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  overflow-x: hidden;
  overflow-y: auto;
}
.gg-history-spacer {
  position: relative;
  width: 100%;
}
.gg-graph-row {
  position: absolute;
  left: 0;
  right: 0;
  display: grid;
  grid-template-columns: var(--gg-history-cols, 152px minmax(0, 1fr) 96px 118px 74px);
  align-items: center;
  width: 100%;
  height: 28px;
  margin: 0;
  padding: 0 !important;
  border: 0 !important;
  border-radius: 0 !important;
  background: transparent !important;
  text-align: left;
  cursor: pointer;
}
.gg-graph-row.gg-search-match {
  background: rgba(120, 200, 140, 0.1) !important;
}
.gg-graph-row:hover {
  background: var(--color-surfaceHover, rgba(128, 128, 128, 0.16)) !important;
}
.gg-graph-row.gg-selected {
  background: rgba(90, 130, 220, 0.26) !important;
}
.gg-graph-row.gg-search-match.gg-selected {
  background: rgba(90, 130, 220, 0.28) !important;
}
.gg-graph-row.gg-search-dim {
  opacity: 0.34;
}
.git-graph-panel .gg-graph-row:disabled {
  opacity: 1;
  cursor: default;
}
.git-graph-panel .gg-graph-row.gg-search-dim:disabled {
  opacity: 0.34;
}
.git-graph-panel .gg-file-row:disabled,
.git-graph-panel .gg-dir-row:disabled {
  opacity: 0.6;
  cursor: default;
}
.gg-row-graph {
  position: relative;
  align-self: stretch;
  overflow: hidden;
}
.gg-row-graph-inner {
  position: absolute;
  inset: 0;
  transform: translateX(var(--gg-graph-shift, 0px));
  will-change: transform;
}
.gg-graph-svg {
  display: block;
  overflow: visible;
}
.gg-col-desc {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  overflow: hidden;
  padding: 0 8px 0 2px;
}
.gg-subject {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.gg-ref-badge {
  flex: 0 0 auto;
  max-width: 96px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 0 4px;
  border-radius: 3px;
  border: 1px solid hsl(var(--gg-ref-hue, 215) 60% 55% / 0.48);
  background: hsl(var(--gg-ref-hue, 215) 55% 45% / 0.18);
  color: hsl(var(--gg-ref-hue, 215) 80% 78%);
  font-size: 10px;
  line-height: 15px;
}
.gg-ref-more {
  color: var(--color-textMuted, #8a8a8a);
  border-color: var(--color-border, #444);
  background: transparent;
}
.gg-col-date,
.gg-col-author {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 0 7px;
  color: var(--color-textMuted, #8a8a8a);
  font-size: 11px;
}
.gg-col-commit {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 0 7px;
  color: var(--color-textSecondary, #b0b0b0);
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  font-size: 10.5px;
}
.gg-hash {
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
}
.gg-history-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex: 0 0 auto;
  min-height: 28px;
  padding: 3px 8px;
  border-top: 1px solid var(--color-border, #3a3a3a);
  color: var(--color-textMuted, #8a8a8a);
  font-size: 10.5px;
}
.gg-history-footer button {
  padding: 2px 8px;
}

/* ---------- commit details ---------- */
.gg-details {
  display: flex;
  flex-direction: column;
  flex: 0 1 42%;
  min-height: 160px;
  max-height: 56%;
  border-top: 1px solid var(--color-border, #3a3a3a);
  background: var(--color-surface, rgba(128, 128, 128, 0.035));
}
.gg-details-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
  min-width: 0;
  padding: 5px 8px;
  border-bottom: 1px solid var(--color-border, #3a3a3a);
}
.gg-details-title {
  display: flex;
  align-items: baseline;
  gap: 7px;
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
}
.gg-details-subject {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}
.gg-details-hash {
  flex: 0 0 auto;
  color: var(--color-textSecondary, #b0b0b0);
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  font-size: 10.5px;
}
.gg-details-parents,
.gg-details-meta {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-textMuted, #8a8a8a);
  font-size: 10.5px;
}
.gg-details-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
}
.gg-parent-select select {
  max-width: 200px;
  height: 23px;
}
.gg-details-body {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}
.gg-details-body.gg-layout-columns {
  flex-direction: row;
}
.gg-details-body.gg-layout-rows {
  flex-direction: column;
}
.gg-details-files {
  flex: 0 0 auto;
  min-height: 0;
  min-width: 0;
  overflow: auto;
  padding: 4px 4px 6px;
}
.gg-layout-columns .gg-details-files {
  width: 216px;
  border-right: 1px solid var(--color-border, #3a3a3a);
}
.gg-layout-rows .gg-details-files {
  height: 38%;
  max-height: 160px;
  border-bottom: 1px solid var(--color-border, #3a3a3a);
}
.gg-details-diff {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
.gg-diff-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1 1 auto;
  min-height: 0;
  padding: 12px;
  color: var(--color-textMuted, #8a8a8a);
  font-size: 11px;
  text-align: center;
}
.gg-diff-header {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
  min-width: 0;
  padding: 4px 8px;
  border-bottom: 1px solid var(--color-border, #3a3a3a);
  color: var(--color-textMuted, #8a8a8a);
  font-size: 10.5px;
}
.gg-diff-path {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
}
.gg-diff-tag {
  flex: 0 0 auto;
  padding: 0 4px;
  border-radius: 3px;
  background: rgba(128, 128, 128, 0.16);
}
.gg-details-diff .gg-warning,
.gg-details-diff .gg-notice {
  flex: 0 0 auto;
  margin: 4px 6px 0;
}
.gg-diff-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  margin: 4px 6px 6px;
  border: 1px solid var(--color-border, #3a3a3a);
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.1);
}
.gg-diff {
  min-width: max-content;
  padding: 4px 0;
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  font-size: 11px;
  line-height: 1.45;
}
.gg-diff-line {
  padding: 0 8px;
  white-space: pre;
}
.gg-diff-add {
  background: rgba(46, 160, 67, 0.16);
  color: #8ce99a;
}
.gg-diff-remove {
  background: rgba(190, 50, 50, 0.16);
  color: #ff9b9b;
}
.gg-diff-hunk {
  background: rgba(50, 110, 190, 0.16);
  color: #8ec5ff;
}
.gg-diff-meta {
  color: var(--color-textMuted, #8a8a8a);
}
.gg-diff-context {
  color: var(--color-textPrimary, #d4d4d4);
}
.gg-diff-empty {
  color: transparent;
}

/* ---------- file tree in details ---------- */
.gg-tree {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.gg-tree-children {
  display: flex;
  flex-direction: column;
}
.gg-dir-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1 1 auto;
}
.gg-dir-caret {
  flex: 0 0 auto;
  width: 10px;
  color: var(--color-textMuted, #8a8a8a);
  font-size: 9px;
}
.gg-tree .gg-muted {
  flex: 0 0 auto;
  font-size: 10px;
}
`
