/**
 * Self-contained panel styles. The host supplies the surrounding tokens; every
 * rule has a neutral fallback so the panel is readable in both themes.
 */
export const GG_STYLES = `
.git-graph-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  height: 100%;
  min-height: 0;
  padding: 10px;
  box-sizing: border-box;
  overflow: auto;
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
.git-graph-panel select {
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
  flex: 1 1 auto;
  border: 1px solid var(--color-border, #444);
  border-radius: 4px;
  background: var(--color-surface, #242424);
  padding: 3px 6px;
}
.gg-header {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 0 0 auto;
}
.gg-repo-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.gg-repo-meta,
.gg-muted {
  color: var(--color-textMuted, #8a8a8a);
  font-size: 11px;
}
.gg-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  border-top: 1px solid var(--color-border, #3a3a3a);
  padding-top: 6px;
}
.gg-section-title {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  font-weight: 600;
  font-size: 11px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-textSecondary, #b0b0b0);
}
.gg-status,
.gg-empty,
.gg-error,
.gg-warning,
.gg-notice {
  border-radius: 4px;
  padding: 6px 8px;
  font-size: 11px;
}
.gg-status,
.gg-empty {
  color: var(--color-textMuted, #8a8a8a);
  background: rgba(128, 128, 128, 0.08);
  background: color-mix(in srgb, var(--color-surface, #242424) 70%, transparent);
}
.gg-error {
  color: var(--color-danger, #ff8a8a);
  background: rgba(190, 50, 50, 0.12);
  border: 1px solid rgba(190, 50, 50, 0.35);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
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
.gg-changes {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 190px;
  overflow: auto;
}
.gg-group-title {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 2px 0;
  color: var(--color-textSecondary, #b0b0b0);
  font-size: 11px;
}
.gg-group-count {
  color: var(--color-textMuted, #8a8a8a);
}
.gg-file-row,
.gg-dir-row {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-width: 0;
  text-align: left;
  border: 0 !important;
  background: transparent !important;
  padding: 2px 4px !important;
  border-radius: 3px;
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
  color: var(--color-textMuted, #8a8a8a);
  font-size: 10px;
}
.gg-status-letter {
  flex: 0 0 auto;
  width: 15px;
  text-align: center;
  font-family: var(--font-mono, monospace);
  font-size: 10px;
  border-radius: 3px;
  background: rgba(140, 140, 140, 0.18);
}
.gg-status-added { color: #7ddb88; }
.gg-status-modified { color: #e6c15a; }
.gg-status-deleted { color: #ff8585; }
.gg-status-renamed,
.gg-status-copied { color: #7fb4ff; }
.gg-status-untracked { color: #8ad9d9; }
.gg-status-conflicted { color: #ff8fcf; }
.gg-graph-section {
  min-height: 0;
}
.gg-graph-scroll {
  position: relative;
  height: 320px;
  min-height: 120px;
  overflow: auto;
  border: 1px solid var(--color-border, #3a3a3a);
  border-radius: 4px;
  background: var(--color-surface, rgba(0, 0, 0, 0.08));
}
.gg-graph-spacer {
  position: relative;
  width: 100%;
}
.gg-graph-row {
  position: absolute;
  left: 0;
  right: 0;
  display: flex;
  align-items: stretch;
  gap: 4px;
  width: 100%;
  height: 32px;
  border: 0 !important;
  border-radius: 0 !important;
  background: transparent !important;
  padding: 0 4px 0 0 !important;
  text-align: left;
  cursor: pointer;
}
.gg-graph-row:hover {
  background: var(--color-surfaceHover, #303030) !important;
}
.gg-graph-row.gg-selected {
  background: rgba(90, 130, 220, 0.26) !important;
}
.git-graph-panel .gg-graph-row:disabled {
  opacity: 1;
  cursor: default;
}
.git-graph-panel .gg-file-row:disabled,
.git-graph-panel .gg-dir-row:disabled {
  opacity: 0.6;
  cursor: default;
}
.gg-graph-svg {
  flex: 0 0 auto;
  display: block;
  overflow: hidden;
  align-self: center;
}
.gg-graph-text {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 1px;
  min-width: 0;
  flex: 1 1 auto;
  padding-left: 2px;
}
.gg-subject {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}
.gg-row-meta {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  color: var(--color-textMuted, #8a8a8a);
  font-size: 10px;
}
.gg-hash {
  font-family: var(--font-mono, monospace);
  color: var(--color-textSecondary, #b0b0b0);
}
.gg-ref {
  flex: 0 1 auto;
  max-width: 110px;
  overflow: hidden;
  text-overflow: ellipsis;
  border-radius: 3px;
  padding: 0 4px;
  color: #b8d4ff;
  background: rgba(90, 130, 220, 0.2);
}
.gg-graph-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 24px;
}
.gg-parent-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.gg-parent-row select {
  flex: 0 1 auto;
  max-width: 220px;
}
.gg-tree {
  display: flex;
  flex-direction: column;
  max-height: 210px;
  overflow: auto;
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
  width: 12px;
  color: var(--color-textMuted, #8a8a8a);
  font-family: var(--font-mono, monospace);
  font-size: 10px;
}
.gg-diff-section {
  min-height: 0;
}
.gg-diff-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-transform: none;
  letter-spacing: 0;
  font-weight: 400;
  font-family: var(--font-mono, monospace);
  font-size: 10px;
  color: var(--color-textMuted, #8a8a8a);
}
.gg-diff {
  max-height: 380px;
  overflow: auto;
  border: 1px solid var(--color-border, #3a3a3a);
  border-radius: 4px;
  background: var(--color-surface, rgba(0, 0, 0, 0.1));
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  line-height: 1.4;
}
.gg-diff-line {
  padding: 0 6px;
  white-space: pre;
  min-width: max-content;
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
`
