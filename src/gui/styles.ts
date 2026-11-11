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
  flex-wrap: wrap;
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
  max-width: 100%;
  min-height: 24px;
  height: auto;
  padding: 2px 7px;
  border-radius: 12px;
  border: 1px solid var(--color-border, #444);
  background: rgba(90, 130, 220, 0.12);
  color: var(--color-textPrimary, #d4d4d4);
}
.git-graph-panel button.gg-branch {
  padding: 2px 7px;
  cursor: pointer;
}
.git-graph-panel button.gg-branch:hover:not(:disabled) {
  background: rgba(90, 130, 220, 0.22);
}
.gg-toolbar-spacer {
  flex: 1 1 auto;
}
.gg-toolbar-toggle {
  flex: 0 0 auto;
  padding: 2px 7px !important;
  font-size: 10.5px;
}
.gg-toolbar-check {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 7px;
  border: 1px solid var(--color-border, #444);
  border-radius: 4px;
  background: var(--color-surface, #242424);
  cursor: pointer;
  white-space: nowrap;
}
.gg-toolbar-check input {
  margin: 0;
  accent-color: #7aa2f7;
}
.gg-toolbar-check:has(input:checked) {
  border-color: rgba(122, 162, 247, 0.7);
  background: rgba(90, 130, 220, 0.22);
}
.gg-toolbar-check:has(input:disabled) {
  opacity: 0.5;
  cursor: default;
}
.gg-toolbar-toggle[aria-pressed="true"] {
  border-color: rgba(122, 162, 247, 0.7) !important;
  background: rgba(90, 130, 220, 0.22) !important;
  color: var(--color-textPrimary, #d4d4d4);
}
.gg-toolbar-order select {
  height: 24px;
  font-size: 10.5px;
}
.gg-branch-icon {
  display: block;
  flex: 0 0 auto;
  align-self: center;
  color: #7aa2f7;
}
.gg-branch-name {
  min-width: 0;
  overflow: visible;
  text-overflow: clip;
  white-space: normal;
  overflow-wrap: anywhere;
  word-break: break-word;
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
  grid-template-columns: var(--gg-history-cols, 240px minmax(0, 1fr) 150px 118px 74px);
  align-items: center;
  flex: 0 0 auto;
  height: 26px;
  border-bottom: 1px solid var(--color-border, #3a3a3a);
  background: var(--color-surface, rgba(128, 128, 128, 0.05));
  color: var(--color-textSecondary, #b0b0b0);
  font-size: 10.5px;
  letter-spacing: 0.04em;
}
.gg-history-head > div {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 0 7px;
}
.gg-history-head > div + div {
  border-left: 1px solid var(--color-border, #444);
}
.gg-col-graph-head {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  overflow: visible !important;
  padding-left: 8px !important;
}
.gg-col-head {
  position: relative;
  display: flex;
  align-items: center;
  overflow: visible !important;
}
.gg-col-head > span {
  display: block;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* The divider between two header cells is the resize affordance itself: a
   transparent 5px hit strip that ends exactly on the always-visible border.
   There is no separate handle decoration, and the strip never extends past the
   header edge, so the panel can never gain a horizontal scrollbar. */
.gg-column-resize {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 5px;
  padding: 0 !important;
  border: 0 !important;
  border-radius: 0 !important;
  background: transparent !important;
  cursor: col-resize;
  touch-action: none;
  z-index: 2;
}
.gg-column-resize:focus-visible {
  outline: 1px solid rgba(122, 162, 247, 0.75);
  outline-offset: -2px;
}
/* The panel's generic button rule also sets cursor: pointer; keep the drag
   cursor on the divider strips. */
.git-graph-panel button.gg-column-resize {
  cursor: col-resize;
}
/* The commit divider is the panel's last edge and has no border of its own. */
.gg-col-head-commit .gg-column-resize {
  right: 0;
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
.gg-row-slot {
  position: absolute;
  left: 0;
  right: 0;
  display: flex;
  flex-direction: row;
  min-width: 0;
  overflow: hidden;
  border-bottom: 1px solid var(--color-border, #3a3a3a);
  background: color-mix(in srgb, var(--color-surface, #242424) 60%, transparent);
}
.gg-row-slot-graph {
  position: relative;
  align-self: stretch;
  flex: 0 0 auto;
  min-width: 0;
  overflow: hidden;
  border-right: 1px solid var(--color-border, #3a3a3a);
  background: rgba(0, 0, 0, 0.06);
}
.gg-row-slot-graph-inner {
  position: absolute;
  inset: 0;
}
.gg-row-slot-body {
  display: flex;
  flex-direction: row;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
.gg-inline-info {
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex: 0 1 auto;
  /* Fallback before the measured pixel width arrives; the panel sets the
     resolved width inline from the shared split geometry. */
  width: clamp(200px, 40%, 60%);
  min-width: 0;
  max-width: none;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 6px 7px;
  background: rgba(0, 0, 0, 0.06);
  font-size: 10.5px;
}
.gg-inline-info-subject {
  min-width: 0;
  overflow: visible;
  color: var(--color-textPrimary, #d4d4d4);
  font-weight: 600;
  line-height: 1.35;
  text-overflow: clip;
  white-space: normal;
  overflow-wrap: anywhere;
  word-break: break-word;
}
.gg-inline-info-row {
  display: flex;
  align-items: flex-start;
  gap: 5px;
  min-width: 0;
}
.gg-inline-info-label {
  flex: 0 0 42px;
  color: var(--color-textMuted, #8a8a8a);
  font-size: 9.5px;
}
.gg-inline-info-value {
  flex: 1 1 auto;
  min-width: 0;
  overflow: visible;
  color: var(--color-textSecondary, #b0b0b0);
  text-overflow: clip;
  white-space: normal;
  overflow-wrap: anywhere;
  word-break: break-word;
}
.gg-inline-info-mono {
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
}
.gg-inline-parents {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
}
.gg-inline-parent {
  padding: 0 3px;
  border-radius: 3px;
  background: rgba(128, 128, 128, 0.14);
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  font-size: 9.5px;
}
/* Divider between the commit info pane and the file list: the always-visible
   line is the drag affordance (no extra handle decoration). */
.gg-inline-split {
  position: relative;
  flex: 0 0 5px;
  width: 5px;
  min-width: 5px;
  align-self: stretch;
  background: transparent;
  cursor: col-resize;
  touch-action: none;
}
.gg-inline-split::after {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  left: 2px;
  width: 1px;
  background: var(--color-border, #3a3a3a);
}
.gg-inline-split:hover::after,
.gg-inline-split:focus-visible::after {
  background: rgba(122, 162, 247, 0.85);
}
.gg-inline-split:focus-visible {
  outline: 1px solid rgba(122, 162, 247, 0.75);
  outline-offset: -2px;
}
.gg-inline-info-details {
  margin-top: 2px;
  color: var(--color-textMuted, #8a8a8a);
  font-size: 9.5px;
}
.gg-inline-info-details summary {
  cursor: pointer;
}
.gg-inline-info-details .gg-inline-info-mono {
  overflow-wrap: anywhere;
  white-space: normal;
}
.gg-row-slot-files {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
.gg-inline-view-controls {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  flex: 0 0 28px;
  width: 28px;
  padding: 4px 2px;
  border-left: 1px solid var(--color-border, #3a3a3a);
  background: rgba(0, 0, 0, 0.06);
}
.gg-inline-view {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0 !important;
  border: 1px solid transparent !important;
  border-radius: 3px !important;
  background: transparent !important;
  color: var(--color-textMuted, #8a8a8a);
}
.gg-inline-view:hover {
  background: var(--color-surfaceHover, #303030) !important;
  color: var(--color-textPrimary, #d4d4d4);
}
.gg-inline-view.active {
  border-color: rgba(122, 162, 247, 0.6) !important;
  background: rgba(90, 130, 220, 0.22) !important;
  color: var(--color-textPrimary, #d4d4d4);
}
.gg-file-list {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.gg-file-stats {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex: 0 0 auto;
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  font-size: 9.5px;
}
.gg-file-stat-add {
  color: #7ddb88;
}
.gg-file-stat-del {
  color: #ff8585;
}
.gg-file-stat-none {
  color: var(--color-textMuted, #8a8a8a);
}
.gg-file-actions {
  display: inline-flex;
  align-items: center;
  gap: 1px;
  flex: 0 0 auto;
}
.gg-file-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0 !important;
  border: 0 !important;
  border-radius: 3px !important;
  background: transparent !important;
  color: var(--color-textMuted, #8a8a8a);
}
.gg-file-action:hover:not(:disabled) {
  background: var(--color-surfaceHover, #303030) !important;
  color: var(--color-textPrimary, #d4d4d4);
}
.gg-file-action:disabled {
  opacity: 0.35;
  cursor: default;
}
.gg-row-slot-head {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
  min-width: 0;
  padding: 4px 8px;
  border-bottom: 1px solid var(--color-border, #3a3a3a);
  color: var(--color-textSecondary, #b0b0b0);
  font-size: 10.5px;
  letter-spacing: 0.03em;
}
.gg-row-slot-title {
  font-weight: 600;
}
.gg-row-slot-tree {
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  overflow: auto;
  padding: 2px 6px 4px;
}
.gg-graph-row.gg-expanded {
  background: rgba(90, 130, 220, 0.18) !important;
}
.gg-graph-row {
  position: absolute;
  left: 0;
  right: 0;
  display: grid;
  grid-template-columns: var(--gg-history-cols, 240px minmax(0, 1fr) 150px 118px 74px);
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
  user-select: none;
}
.gg-graph-row:focus-visible {
  outline: 2px solid rgba(122, 162, 247, 0.75);
  outline-offset: -2px;
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
.git-graph-panel .gg-file-row[aria-disabled="true"] {
  opacity: 0.6;
  cursor: default;
}
.gg-row-graph {
  position: relative;
  align-self: stretch;
  min-width: 0;
  overflow: hidden;
}
.gg-row-graph-inner {
  position: absolute;
  inset: 0;
}
.gg-graph-svg {
  display: block;
  overflow: hidden;
}
.gg-col-desc {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  overflow: hidden;
  padding: 0 8px 0 2px;
}
.gg-ref-badges {
  display: flex;
  align-items: center;
  gap: 3px;
  flex: 0 1 auto;
  min-width: 0;
  max-width: 60%;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
}
.gg-ref-badges::-webkit-scrollbar {
  display: none;
}
.gg-subject {
  flex: 1 1 auto;
  min-width: 48px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.git-graph-panel button.gg-ref-badge {
  flex: 0 0 auto;
  min-width: 0;
  max-width: none;
  overflow: visible;
  text-overflow: clip;
  white-space: nowrap;
  padding: 0 4px;
  border-radius: 3px;
  border: 1px solid hsl(var(--gg-ref-hue, 215) 60% 55% / 0.48);
  background: hsl(var(--gg-ref-hue, 215) 55% 45% / 0.18);
  color: hsl(var(--gg-ref-hue, 215) 80% 78%);
  font-size: 10px;
  line-height: 15px;
}
.git-graph-panel button.gg-ref-badge:hover:not(:disabled) {
  background: hsl(var(--gg-ref-hue, 215) 55% 45% / 0.3);
}
.gg-ref-kind-tag {
  border-style: dashed !important;
}
.gg-ref-kind-remote {
  border-radius: 2px !important;
}
.git-graph-panel button.gg-ref-more {
  flex: 0 0 auto;
  padding: 0 4px;
  border-radius: 3px;
  border: 1px solid var(--color-border, #444);
  background: transparent;
  color: var(--color-textMuted, #8a8a8a);
  font-size: 10px;
  line-height: 15px;
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
.gg-col-date {
  font-variant-numeric: tabular-nums;
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
.gg-details-back {
  padding: 2px 8px !important;
  font-size: 10.5px;
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

/* ---------- mutation / refs status ---------- */
.gg-mutation-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex: 0 0 auto;
  padding: 4px 8px;
  border-bottom: 1px solid var(--color-border, #3a3a3a);
  font-size: 10.5px;
}
.gg-mutation-warning {
  color: #e6c15a;
  background: rgba(230, 193, 90, 0.1);
}
.gg-mutation-notice {
  color: var(--color-textSecondary, #b0b0b0);
  background: rgba(90, 120, 180, 0.12);
}
.gg-mutation-status button {
  flex: 0 0 auto;
  padding: 1px 6px;
  font-size: 10px;
}

/* ---------- portal menus ---------- */
.gg-menu-backdrop {
  position: fixed;
  inset: 0;
  z-index: 12000;
}
.gg-menu {
  position: fixed;
  z-index: 12001;
  display: flex;
  flex-direction: column;
  min-width: 168px;
  max-width: min(320px, calc(100vw - 16px));
  max-height: min(70vh, 440px);
  overflow: auto;
  padding: 4px;
  border: 1px solid var(--color-border, #444);
  border-radius: 6px;
  background: var(--color-surface, #242424);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
  color: var(--color-textPrimary, #d4d4d4);
  font-size: 11.5px;
}
.gg-menu-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 3px 7px 5px;
  color: var(--color-textMuted, #8a8a8a);
  font-size: 10px;
  letter-spacing: 0.03em;
  text-transform: uppercase;
}
.gg-menu-item {
  display: block;
  width: 100%;
  padding: 5px 8px !important;
  border: 0 !important;
  border-radius: 4px !important;
  background: transparent !important;
  text-align: left;
  white-space: nowrap;
}
.gg-menu-item:hover:not(:disabled),
.gg-menu-item:focus-visible {
  outline: none;
  background: rgba(90, 130, 220, 0.26) !important;
}
.gg-menu-item-danger {
  color: #ff9b9b !important;
}
.gg-menu-item-danger:hover:not(:disabled),
.gg-menu-item-danger:focus-visible {
  background: rgba(190, 50, 50, 0.2) !important;
}

/* ---------- dialogs and branch selector ---------- */
.gg-dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 13000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(0, 0, 0, 0.5);
}
.gg-dialog-backdrop.gg-branch-selector-backdrop {
  pointer-events: none;
  background: rgba(0, 0, 0, 0.32);
}
.gg-branch-selector-backdrop .gg-branch-selector {
  pointer-events: auto;
}
.gg-dialog,
.gg-branch-selector {
  display: flex;
  flex-direction: column;
  width: min(460px, 100%);
  max-height: min(82vh, 620px);
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--color-border, #444);
  border-radius: 8px;
  background: var(--color-background, #1e1e1e);
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.5);
  color: var(--color-textPrimary, #d4d4d4);
  font-size: 12px;
}
.gg-dialog {
  padding: 14px;
  gap: 10px;
}
.gg-branch-selector {
  width: min(560px, 100%);
}
.gg-dialog-title {
  flex: 0 0 auto;
  font-size: 14px;
  font-weight: 600;
}
.gg-dialog-description {
  margin: 0;
  color: var(--color-textSecondary, #b0b0b0);
  font-size: 11.5px;
  line-height: 1.45;
}
.gg-dialog-hint {
  color: var(--color-textMuted, #8a8a8a);
  font-size: 10.5px;
}
.gg-dialog-facts {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 3px 10px;
  margin: 0;
  padding: 8px;
  border: 1px solid var(--color-border, #3a3a3a);
  border-radius: 4px;
  background: var(--color-surface, rgba(128, 128, 128, 0.06));
  font-size: 11px;
}
.gg-dialog-facts dt {
  color: var(--color-textMuted, #8a8a8a);
}
.gg-dialog-facts dd {
  min-width: 0;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
}
.gg-dialog-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
}
.gg-dialog-field input,
.gg-dialog-field textarea {
  width: 100%;
  min-width: 0;
  padding: 5px 7px;
  border: 1px solid var(--color-border, #444);
  border-radius: 4px;
  background: var(--color-surface, #242424);
  color: inherit;
  font: inherit;
}
.gg-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  flex: 0 0 auto;
  padding-top: 2px;
}
.gg-dialog-actions button {
  padding: 4px 10px !important;
}
.gg-primary-button {
  border-color: rgba(122, 162, 247, 0.7) !important;
  background: rgba(90, 130, 220, 0.28) !important;
}
.gg-danger-button {
  border-color: rgba(190, 50, 50, 0.6) !important;
  background: rgba(190, 50, 50, 0.22) !important;
  color: #ff9b9b !important;
}
.gg-dialog .gg-warning,
.gg-dialog .gg-error,
.gg-branch-selector .gg-warning,
.gg-branch-selector .gg-notice {
  margin: 0;
}
.gg-branch-selector-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  flex: 0 0 auto;
  padding: 12px 14px 8px;
  border-bottom: 1px solid var(--color-border, #3a3a3a);
}
.gg-branch-selector-search {
  flex: 0 0 auto;
  padding: 8px 14px;
  border-bottom: 1px solid var(--color-border, #3a3a3a);
}
.gg-branch-selector-search input {
  width: 100%;
  min-width: 0;
  padding: 5px 7px;
  border: 1px solid var(--color-border, #444);
  border-radius: 4px;
  background: var(--color-surface, #242424);
  color: inherit;
  font: inherit;
}
.gg-branch-selector-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: 8px 14px 12px;
}
.gg-selector-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 0 12px;
}
.gg-selector-group + .gg-selector-group {
  border-top: 1px solid var(--color-border, #3a3a3a);
  padding-top: 10px;
}
.gg-selector-heading {
  color: var(--color-textSecondary, #b0b0b0);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.gg-selector-subheading {
  margin-top: 5px;
  color: var(--color-textMuted, #8a8a8a);
  font-size: 10px;
}
.gg-check-row {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  padding: 2px 3px;
  border-radius: 3px;
  font-size: 11px;
}
.gg-check-row:hover {
  background: var(--color-surfaceHover, #303030);
}
.gg-check-row input {
  flex: 0 0 auto;
}
.gg-check-row-nested {
  flex-wrap: wrap;
  gap: 12px;
  padding-left: 18px;
}
.gg-check-row-nested label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.gg-ref-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  font-size: 10.5px;
}
.gg-branch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  min-width: 0;
  padding: 4px 6px !important;
  border: 0 !important;
  border-radius: 4px !important;
  background: transparent !important;
  text-align: left;
}
.gg-branch-row:hover:not(:disabled) {
  background: var(--color-surfaceHover, #303030) !important;
}
.gg-selector-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 4px;
}

/* ---------- historical file content ---------- */
.gg-file-content {
  display: flex;
  flex-direction: column;
  width: min(900px, 92vw);
  height: min(80vh, 720px);
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--color-border, #444);
  border-radius: 8px;
  background: var(--color-background, #1e1e1e);
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.5);
  color: var(--color-textPrimary, #d4d4d4);
  font-family: var(--font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif);
  font-size: 12px;
  pointer-events: auto;
}
.gg-file-content-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex: 0 0 auto;
  min-width: 0;
  padding: 8px 10px;
  border-bottom: 1px solid var(--color-border, #3a3a3a);
}
.gg-file-content-title {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.gg-file-content-path {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  font-size: 11.5px;
}
.gg-file-content-hash {
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
}
.gg-file-content-body {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow: auto;
}
.gg-file-content-text {
  margin: 0;
  padding: 8px 10px;
  white-space: pre;
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  font-size: 11.5px;
  line-height: 1.45;
}
.gg-file-content-notice {
  padding: 14px;
  color: var(--color-textMuted, #8a8a8a);
  font-size: 11.5px;
}
.gg-file-content .gg-dialog-actions {
  padding: 8px 10px;
  border-top: 1px solid var(--color-border, #3a3a3a);
}
.gg-file-content .gg-warning,
.gg-file-content .gg-error,
.gg-file-content .gg-status {
  margin: 8px;
}
.gg-file-content button {
  font: inherit;
  color: inherit;
}

/* Portals live outside .git-graph-panel, so they cannot rely on a host global
   reset. State font and colour explicitly for every interactive descendant. */
.gg-menu,
.gg-dialog,
.gg-branch-selector {
  font-family: var(--font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif);
  color: var(--color-textPrimary, #d4d4d4);
}
.gg-menu button,
.gg-dialog button,
.gg-dialog input,
.gg-dialog textarea,
.gg-dialog select,
.gg-branch-selector button,
.gg-branch-selector input {
  font: inherit;
  color: inherit;
}

/* ---------- uncommitted history row + resizable slots ---------- */
.gg-uncommitted-row {
  background: color-mix(in srgb, var(--color-surface, #242424) 78%, transparent) !important;
  border-bottom: 1px solid var(--color-border, #3a3a3a);
}
.gg-uncommitted-row:hover {
  background: var(--color-surfaceHover, #303030) !important;
}
.gg-uncommitted-row.gg-selected {
  background: rgba(90, 130, 220, 0.2) !important;
}
.gg-uncommitted-title {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  font-weight: 600;
}
.gg-uncommitted-total {
  color: var(--color-textMuted, #8a8a8a);
  font-weight: 500;
}
.gg-uncommitted-badges {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex: 0 0 auto;
  margin-left: 6px;
}
.gg-uncommitted-badge {
  min-width: 15px;
  padding: 0 4px;
  border-radius: 8px;
  background: rgba(128, 128, 128, 0.2);
  color: var(--color-textSecondary, #b0b0b0);
  font-size: 9.5px;
  font-weight: 700;
  line-height: 15px;
  text-align: center;
}
.gg-uncommitted-staged { color: #7ddb88; background: rgba(125, 219, 136, 0.14); }
.gg-uncommitted-unstaged { color: #e6c15a; background: rgba(230, 193, 90, 0.14); }
.gg-uncommitted-untracked { color: #8ad9d9; background: rgba(138, 217, 217, 0.14); }
.gg-uncommitted-conflicted { color: #ff8fcf; background: rgba(255, 143, 207, 0.14); }
.gg-uncommitted-slot {
  border-bottom: 1px solid var(--color-border, #3a3a3a);
}
.gg-uncommitted-slot .gg-row-slot-tree {
  padding-bottom: 10px;
}
/* The slot's bottom divider is the resize affordance itself: one full-width
   hit strip sitting on the always-visible bottom border. There is no separate
   pill/handle decoration. */
.gg-slot-resize {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 4;
  width: 100%;
  height: 5px;
  padding: 0 !important;
  border: 0 !important;
  border-radius: 0 !important;
  background: transparent !important;
  cursor: row-resize;
  touch-action: none;
}
.gg-slot-resize:focus-visible {
  outline: 1px solid rgba(122, 162, 247, 0.75);
  outline-offset: -2px;
}
.git-graph-panel button.gg-slot-resize {
  cursor: row-resize;
}
.gg-history-empty {
  position: absolute;
  left: 0;
  right: 0;
  min-height: 48px;
}
.gg-dialog-field select {
  width: 100%;
  height: 26px;
  border: 1px solid var(--color-border, #444);
  border-radius: 4px;
  background: var(--color-surface, #242424);
  color: var(--color-textPrimary, #d4d4d4);
  padding: 0 6px;
}
.gg-fetch-button {
  font-weight: 600;
}
`
