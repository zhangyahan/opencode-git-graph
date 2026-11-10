import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  untrack,
} from "solid-js"
import { type PanelProps, usePlugin } from "@opencode/plugin/gui"
import type {
  ChangedFile,
  FileDiff,
  GitCommit,
  GitRef,
  GitRepository,
  GitStatus,
} from "../shared/types.js"
import { GitGraphRpc } from "../rpc.js"
import { buildCommitGraph } from "./graph.js"
import {
  DEFAULT_LANE_PADDING,
  graphContentWidth,
  graphLaneSpacing,
  graphLaneX,
  graphLinePath,
  graphRowLines,
  isGraphClipped,
  LANE_SPACING,
  type GraphLine,
} from "./graph-geometry.js"
import {
  createGraphRowViews,
  visibleGraphRowViews,
  type GraphRowView,
} from "./graph-view.js"
import { classifyDiff, type DiffLine } from "./diff.js"
import {
  AUTO_LOAD_THRESHOLD_ROWS,
  INITIAL_AUTO_LOAD_STATE,
  beginAutoLoad,
  completeAutoLoad,
  isNearBottom,
  mergeCommits,
  rearmAutoLoad,
  resolveScrollMetrics,
  shouldAutoLoad,
  type AutoLoadState,
  type ScrollViewportLike,
} from "./pagination.js"
import { createRowLayout } from "./row-layout.js"
import {
  readColumnPreferences,
  resizeColumnPreferences,
  resolveColumnLayout,
  writeColumnPreferences,
  type ColumnId,
  type ColumnPreferences,
} from "./column-layout.js"
import { CommitDiffView } from "./commit-diff-view.js"
import { LatestRequest } from "./requests.js"
import { buildFileTree, collectDirectoryPaths, type FileTreeNode } from "./tree.js"
import {
  findStatusFile,
  groupStatusFiles,
  statusFileTarget,
  statusLetter,
} from "./changes.js"
import {
  BoundedSelectionCache,
  SelectionGeneration,
  selectionKey,
  type FileSelection,
  type SelectionSnapshot,
} from "./selection.js"
import { formatError } from "./errors.js"
import { sessionRoute } from "./routing.js"
import { GG_STYLES } from "./styles.js"
import {
  detailsLayout,
  HISTORY_COLUMN_LABELS,
  refBadgeCountForBudget,
  visibleRefCount,
} from "./history-columns.js"
import { formatCommitDate, formatRefLabel, refHue, shortHash } from "./format.js"
import { searchMatches } from "./search.js"
import { repositoryOptionLabel } from "./repository-label.js"
import { clampScrollOffset } from "./scroll.js"
import {
  DEFAULT_HISTORY_FILTER,
  absoluteRepositoryFilePath,
  canViewFileAtCommit,
  canonicalRefName,
  changedFileStats,
  checkoutBlockedReason,
  commitMenuActions,
  decideCompareActivation,
  detectCommitFileContentSupport,
  detectRpcCapabilities,
  extendedClient,
  filterRefsToAvailable,
  firstParentGraphCommits,
  hasFileStats,
  historyFilterFingerprint,
  historyLogInput,
  isCompareModifier,
  normalizeRefSelection,
  reconcileRefFilter,
  refBadgesForCommit,
  refKindLabel,
  refMenuActions,
  typedRefForBadge,
  workspaceRelativePath,
  type ChangedFileStats,
  type CommitFileContent,
  type ExtendedLogInput,
  type HistoryFilterState,
  type HistoryLogSettings,
  type HistoryOrder,
  type MenuAction,
  type MutationResult,
  type RefBadgeInfo,
  type RpcCapabilities,
} from "./ref-utils.js"
import { ContextMenu } from "./ref-menu.js"
import { BranchSelector } from "./branch-selector.js"
import { ConfirmDialog, type ConfirmFact, type ConfirmField } from "./confirm-dialog.js"
import { ComparisonView } from "./compare-view.js"
import { CommitFileContentView } from "./file-content-view.js"

const PAGE_SIZE = 100
const ROW_HEIGHT = 28
const OVERSCAN = 6
const LANE_PADDING = DEFAULT_LANE_PADDING
const MAX_DIFF_DISPLAY_LINES = 4_000
const SELECTION_CACHE_LIMIT = 16
const MIN_SLOT_HEIGHT = 96
const MAX_SLOT_HEIGHT = 260
const SLOT_TREE_ROW_HEIGHT = 22
const SLOT_TREE_HEADER = 30
/** Bound for the post-reinsert restore loop: one or two layout frames only. */
const RESTORE_MAX_FRAMES = 2

/**
 * Scroll position captured before the history list is replaced by the
 * full-panel commit diff. Restoring waits for the reinserted spacer/slot to be
 * laid out, then applies a clamped value and mirrors the real DOM value back.
 */
interface PendingViewRestore {
  readonly key: string
  readonly repositoryId: string | undefined
  readonly commitHash: string | undefined
  /** Generation captured at Back (or at open), so a later selection aborts. */
  generation: number
  readonly scrollTop: number
}

type MutationDialogState =
  | {
      readonly kind: "checkout"
      readonly branch: string
      readonly expectedHead: string | null
      readonly blocked?: string
    }
  | {
      readonly kind: "create-branch"
      readonly name: string
      readonly startPoint: string
      readonly startLabel: string
      readonly expectedHead: string | null
    }
  | {
      readonly kind: "create-tag"
      readonly name: string
      readonly target: string
      readonly targetLabel: string
      readonly message: string
      readonly expectedHead: string | null
    }
  | {
      readonly kind: "rename-branch"
      readonly oldName: string
      readonly newName: string
      readonly expectedHead: string | null
    }
  | {
      readonly kind: "delete-branch"
      readonly name: string
      readonly expectedHead: string | null
    }
  | {
      readonly kind: "delete-tag"
      readonly name: string
      readonly expectedHead: string | null
    }

interface RefMenuState {
  readonly ref: GitRef
  readonly x: number
  readonly y: number
}

interface OverflowMenuState {
  readonly badges: readonly RefBadgeInfo[]
  readonly x: number
  readonly y: number
}

interface CommitMenuState {
  readonly commit: GitCommit
  readonly x: number
  readonly y: number
}

interface ActiveComparison {
  readonly base: GitCommit
  readonly head: GitCommit
}

/** One bounded cache per window, shared by every mount of this panel. */
const SELECTION_CACHE = new BoundedSelectionCache<SelectionSnapshot>(SELECTION_CACHE_LIMIT)

const PALETTE = [
  "#7aa2f7",
  "#e0af68",
  "#9ece6a",
  "#f7768e",
  "#bb9af7",
  "#7dcfff",
  "#ff9e64",
  "#73daca",
  "#c0caf5",
  "#b4f9f8",
] as const

function colourOf(colour: number): string {
  return PALETTE[colour % PALETTE.length]
}

function statusClass(status: ChangedFile["status"]): string {
  return `gg-status-letter gg-status-${status}`
}

function columnLabel(column: ColumnId): string {
  return HISTORY_COLUMN_LABELS[column]
}

type SearchState = "none" | "match" | "dim"

/* ---------- icons ---------- */

function RefreshIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  )
}

function BranchIcon() {
  return (
    <svg
      class="gg-branch-icon"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <line x1="6" y1="3" x2="6" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg
      class="gg-search-icon"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  )
}

/* ---------- graph row ---------- */

interface GraphRowProps {
  readonly view: GraphRowView
  readonly laneSpacing: number
  readonly graphWidth: number
  readonly rowHeight: number
  readonly top: number
  readonly selected: boolean
  readonly expanded: boolean
  readonly disabled: boolean
  readonly searchState: SearchState
  readonly showDate: boolean
  readonly showAuthor: boolean
  readonly maxRefs: number
  readonly refs: readonly GitRef[]
  readonly compareBase: boolean
  readonly onSelect: (event: MouseEvent) => void
  readonly onRefMenu: (badge: RefBadgeInfo, event: MouseEvent) => void
  readonly onOverflowMenu: (
    badges: readonly RefBadgeInfo[],
    event: MouseEvent,
  ) => void
  readonly onContextMenu: (event: MouseEvent) => void
  readonly onKeyDown: (event: KeyboardEvent) => void
}

function GraphRow(props: GraphRowProps) {
  const lines = () => graphRowLines(props.view.row, props.view.previous)
  const nodeX = () => graphLaneX(props.view.row.lane, props.laneSpacing, LANE_PADDING)
  const badges = () => refBadgesForCommit(props.refs, props.view.commit)
  const visibleBadges = () => badges().slice(0, props.maxRefs)
  const hiddenBadges = () => badges().slice(props.maxRefs)

  return (
    <div
      role="button"
      tabIndex={props.disabled ? -1 : 0}
      class={[
        "gg-graph-row",
        props.selected ? "gg-selected" : "",
        props.expanded ? "gg-expanded" : "",
        props.searchState === "dim" ? "gg-search-dim" : "",
        props.searchState === "match" ? "gg-search-match" : "",
        props.compareBase ? "gg-compare-base" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ top: `${props.top}px`, height: `${props.rowHeight}px` }}
      onClick={(event) => {
        if (!props.disabled) props.onSelect(event)
      }}
      onContextMenu={(event) => {
        if (props.disabled) return
        event.preventDefault()
        props.onContextMenu(event)
      }}
      onKeyDown={(event) => {
        // A ref chip/menu trigger is its own control; Enter/Space there must
        // open the ref menu, not toggle the row.
        if (event.target !== event.currentTarget) return
        props.onKeyDown(event)
      }}
      title={props.view.commit.subject}
      data-commit={props.view.commit.hash}
      data-index={props.view.index}
      data-row-top={props.top}
      data-parents={props.view.commit.parents.length}
      data-compare-base={props.compareBase ? "true" : undefined}
      aria-disabled={props.disabled}
      aria-expanded={props.expanded}
      aria-selected={props.selected}
    >
      <div class="gg-row-graph" aria-hidden="true">
        <div class="gg-row-graph-inner">
          <svg
            class="gg-graph-svg"
            width={props.graphWidth}
            height={props.rowHeight}
            viewBox={`0 0 ${props.graphWidth} ${props.rowHeight}`}
            aria-hidden="true"
          >
            <For each={lines()}>
              {(line) => (
                <path
                  d={graphLinePath(line, {
                    laneSpacing: props.laneSpacing,
                    rowHeight: props.rowHeight,
                    padding: LANE_PADDING,
                  })}
                  fill="none"
                  stroke={colourOf(line.colour)}
                  stroke-width="1.6"
                  stroke-linecap="round"
                  opacity="0.9"
                />
              )}
            </For>
            <circle
              cx={nodeX()}
              cy={props.rowHeight / 2}
              r={3.5}
              fill={colourOf(props.view.row.colour)}
              stroke="var(--color-background, #1e1e1e)"
              stroke-width="1.5"
            />
          </svg>
        </div>
      </div>

      <div class="gg-col-desc">
        <Show when={badges().length > 0}>
          <span class="gg-ref-badges">
            <For each={visibleBadges()}>
              {(badge) => (
                <button
                  type="button"
                  class={`gg-ref-badge gg-ref-kind-${badge.kind}`}
                  style={`--gg-ref-hue:${refHue(badge.name)}`}
                  data-testid="ref-badge"
                  data-ref-kind={badge.kind}
                  data-ref-name={badge.name}
                  title={`${refKindLabel(badge.kind)}: ${badge.name}`}
                  onClick={(event) => {
                    event.stopPropagation()
                    props.onRefMenu(badge, event)
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    props.onRefMenu(badge, event)
                  }}
                >
                  {formatRefLabel(badge.name)}
                </button>
              )}
            </For>
            <Show when={hiddenBadges().length > 0}>
              <button
                type="button"
                class="gg-ref-more gg-ref-badge"
                data-testid="ref-more"
                title={hiddenBadges()
                  .map((badge) => `${refKindLabel(badge.kind)}: ${badge.name}`)
                  .join(", ")}
                onClick={(event) => {
                  event.stopPropagation()
                  props.onOverflowMenu(hiddenBadges(), event)
                }}
                onContextMenu={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  props.onOverflowMenu(hiddenBadges(), event)
                }}
              >
                +{hiddenBadges().length}
              </button>
            </Show>
          </span>
        </Show>
        <span class="gg-subject">{props.view.commit.subject || "(no subject)"}</span>
      </div>

      <Show when={props.showDate}>
        <div
          class="gg-col-date"
          title={props.view.commit.authorDate}
          data-testid="commit-date"
        >
          {formatCommitDate(props.view.commit.authorDate)}
        </div>
      </Show>
      <Show when={props.showAuthor}>
        <div class="gg-col-author" title={props.view.commit.author}>
          {props.view.commit.author}
        </div>
      </Show>
      <div class="gg-col-commit" title={props.view.commit.hash}>
        <span class="gg-hash">{shortHash(props.view.commit.hash)}</span>
      </div>
    </div>
  )
}

/* ---------- inline commit file slot ---------- */

interface CommitFilesSlotProps {
  readonly top: number
  readonly height: number
  readonly row: GraphRowView["row"]
  readonly commit: GitCommit
  readonly graphWidth: number
  readonly columnWidth: number
  readonly laneSpacing: number
  readonly nodes: readonly FileTreeNode[]
  readonly files: readonly ChangedFile[]
  readonly fileCount: number
  readonly expanded: ReadonlySet<string>
  readonly selectedPath: string | undefined
  readonly view: "list" | "tree"
  readonly loading: boolean
  readonly error: string | undefined
  readonly disabled: boolean
  readonly onToggle: (path: string) => void
  readonly onSelect: (file: ChangedFile) => void
  readonly onViewChange: (view: "list" | "tree") => void
  readonly onViewAtCommit: (file: ChangedFile) => void
  readonly onOpenCurrent: (file: ChangedFile) => void
  readonly onRetry: () => void
}

/**
 * One controlled expansion slot, rendered as a sibling of the row buttons so
 * the graph svg can keep its fixed 28px row height. The slot carries the graph
 * tracks that continue below the expanded commit and a fixed-height, internally
 * scrolling file tree.
 */
function CommitFilesSlot(props: CommitFilesSlotProps) {
  const lines = (): GraphLine[] =>
    props.row.segments.map((segment) => ({
      kind: "through",
      from: { lane: segment.to, y: 0 },
      to: { lane: segment.to, y: 1 },
      colour: segment.colour,
    }))

  return (
    <div
      class="gg-row-slot"
      style={{ top: `${props.top}px`, height: `${props.height}px` }}
      data-slot-height={props.height}
      data-testid="inline-slot"
    >
      <div
        class="gg-row-slot-graph"
        style={{ width: `${props.columnWidth}px` }}
        data-testid="inline-graph"
        aria-hidden="true"
      >
        <div class="gg-row-slot-graph-inner">
          <svg
            class="gg-graph-svg"
            width={props.graphWidth}
            height={Math.max(1, props.height)}
            viewBox={`0 0 ${props.graphWidth} ${Math.max(1, props.height)}`}
            aria-hidden="true"
          >
            <For each={lines()}>
              {(line) => (
                <path
                  d={graphLinePath(line, {
                    laneSpacing: props.laneSpacing,
                    rowHeight: Math.max(1, props.height),
                    padding: LANE_PADDING,
                  })}
                  fill="none"
                  stroke={colourOf(line.colour)}
                  stroke-width="1.6"
                  stroke-linecap="round"
                  opacity="0.9"
                />
              )}
            </For>
          </svg>
        </div>
      </div>

      <div class="gg-row-slot-body">
        <div class="gg-inline-info" data-testid="inline-info">
          <div class="gg-inline-info-subject" title={props.commit.subject}>
            {props.commit.subject || "(no subject)"}
          </div>
          <div class="gg-inline-info-row" title={props.commit.author}>
            <span class="gg-inline-info-label">Author</span>
            <span class="gg-inline-info-value">{props.commit.author}</span>
          </div>
          <div class="gg-inline-info-row" title={props.commit.authorDate}>
            <span class="gg-inline-info-label">Date</span>
            <span class="gg-inline-info-value">
              {formatCommitDate(props.commit.authorDate)}
            </span>
          </div>
          <div class="gg-inline-info-row" title={props.commit.hash}>
            <span class="gg-inline-info-label">Commit</span>
            <span class="gg-inline-info-value gg-inline-info-mono">
              {shortHash(props.commit.hash)}
            </span>
          </div>
          <div class="gg-inline-info-row">
            <span class="gg-inline-info-label">Parents</span>
            <span class="gg-inline-info-value gg-inline-parents">
              <Show
                when={props.commit.parents.length > 0}
                fallback={<span class="gg-muted">None</span>}
              >
                <For each={props.commit.parents}>
                  {(parent) => (
                    <span class="gg-inline-parent" title={parent}>
                      {shortHash(parent)}
                    </span>
                  )}
                </For>
              </Show>
            </span>
          </div>
          <details class="gg-inline-info-details">
            <summary>Full details</summary>
            <div class="gg-inline-info-mono" title={props.commit.hash}>
              {props.commit.hash}
            </div>
            <div class="gg-inline-info-mono" title={props.commit.authorDate}>
              {props.commit.authorDate}
            </div>
            <For each={props.commit.parents}>
              {(parent) => (
                <div class="gg-inline-info-mono" title={parent}>
                  {parent}
                </div>
              )}
            </For>
          </details>
        </div>

        <div class="gg-row-slot-files">
          <div class="gg-row-slot-head">
            <span class="gg-row-slot-title">Files changed</span>
            <span class="gg-muted">
              {props.loading ? "loading…" : `${props.fileCount} file${props.fileCount === 1 ? "" : "s"}`}
            </span>
          </div>
          <div class="gg-row-slot-tree inline-files" data-testid="inline-files">
            <Show when={props.loading}>
              <div class="gg-status">Loading files…</div>
            </Show>
            <Show when={props.error}>
              {(message) => (
                <div class="gg-error">
                  <span>{message()}</span>
                  <button
                    type="button"
                    disabled={props.disabled}
                    onClick={() => props.onRetry()}
                  >
                    Retry
                  </button>
                </div>
              )}
            </Show>
            <Show when={!props.loading && !props.error}>
              <Show
                when={props.fileCount > 0}
                fallback={<div class="gg-empty">No files changed relative to this parent.</div>}
              >
                <Show
                  when={props.view === "tree"}
                  fallback={
                    <div class="gg-file-list" data-testid="inline-file-list">
                      <For each={props.files}>
                        {(file) => (
                          <FileRow
                            file={file}
                            label={file.path}
                            indent={4}
                            selected={props.selectedPath === file.path}
                            disabled={props.disabled}
                            onSelect={props.onSelect}
                            onViewAtCommit={props.onViewAtCommit}
                            onOpenCurrent={props.onOpenCurrent}
                          />
                        )}
                      </For>
                    </div>
                  }
                >
                  <div class="gg-tree">
                    <FileTree
                      nodes={props.nodes}
                      depth={0}
                      expanded={props.expanded}
                      selectedPath={props.selectedPath}
                      disabled={props.disabled}
                      onToggle={props.onToggle}
                      onSelect={props.onSelect}
                      onViewAtCommit={props.onViewAtCommit}
                      onOpenCurrent={props.onOpenCurrent}
                    />
                  </div>
                </Show>
              </Show>
            </Show>
          </div>
        </div>

        <div class="gg-inline-view-controls" data-testid="inline-view-controls">
          <button
            type="button"
            class={props.view === "list" ? "gg-inline-view active" : "gg-inline-view"}
            data-testid="view-toggle-list"
            aria-label="List view"
            aria-pressed={props.view === "list"}
            title="Flat list view"
            onClick={() => props.onViewChange("list")}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              stroke-width="2" stroke-linecap="round" aria-hidden="true">
              <path d="M8 6h13M8 12h13M8 18h13" />
              <circle cx="3.5" cy="6" r="1" />
              <circle cx="3.5" cy="12" r="1" />
              <circle cx="3.5" cy="18" r="1" />
            </svg>
          </button>
          <button
            type="button"
            class={props.view === "tree" ? "gg-inline-view active" : "gg-inline-view"}
            data-testid="view-toggle-tree"
            aria-label="Tree view"
            aria-pressed={props.view === "tree"}
            title="Folder tree view"
            onClick={() => props.onViewChange("tree")}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M4 4h6v6H4zM14 14h6v6h-6zM7 10v4h7" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}

/* ---------- working-tree groups ---------- */

interface StatusGroupSectionProps {
  readonly title: string
  readonly files: readonly ChangedFile[]
  readonly disabled: boolean
  readonly expanded: boolean
  readonly onToggle: () => void
  readonly isSelected: (file: ChangedFile) => boolean
  readonly onSelect: (file: ChangedFile) => void
}

function StatusGroupSection(props: StatusGroupSectionProps) {
  return (
    <Show when={props.files.length > 0}>
      <div class="gg-status-group">
        <button
          type="button"
          class="gg-group-head"
          aria-expanded={props.expanded}
          onClick={() => props.onToggle()}
        >
          <span class="gg-caret" aria-hidden="true">
            {props.expanded ? "▾" : "▸"}
          </span>
          <span>{props.title}</span>
          <span class="gg-count-badge">{props.files.length}</span>
        </button>
        <Show when={props.expanded}>
          <div class="gg-group-body">
            <For each={props.files}>
              {(file) => (
                <button
                  type="button"
                  class={props.isSelected(file) ? "gg-file-row gg-selected" : "gg-file-row"}
                  title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
                  disabled={props.disabled}
                  onClick={() => props.onSelect(file)}
                >
                  <span class={statusClass(file.status)}>{statusLetter(file.status)}</span>
                  <span class="gg-file-name">{file.path}</span>
                  <Show when={file.oldPath}>
                    <span class="gg-file-old">← {file.oldPath}</span>
                  </Show>
                </button>
              )}
            </For>
          </div>
        </Show>
      </div>
    </Show>
  )
}

/* ---------- commit file tree ---------- */

function EyeIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function ExternalIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M14 4h6v6" />
      <path d="M20 4 10 14" />
      <path d="M20 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h5" />
    </svg>
  )
}

function FileStats(props: { readonly file: ChangedFile }) {
  const stats = () => changedFileStats(props.file)
  return (
    <span class="gg-file-stats">
      <Show
        when={hasFileStats(stats())}
        fallback={
          <span class="gg-file-stat-none" data-testid="file-stat-none">
            -
          </span>
        }
      >
        <Show when={stats().added !== undefined}>
          <span class="gg-file-stat-add" data-testid="file-stat-add">
            +{stats().added}
          </span>
        </Show>
        <Show when={stats().deleted !== undefined}>
          <span class="gg-file-stat-del" data-testid="file-stat-del">
            -{stats().deleted}
          </span>
        </Show>
      </Show>
    </span>
  )
}

interface FileRowProps {
  readonly file: ChangedFile
  readonly label: string
  readonly indent: number
  readonly selected: boolean
  readonly disabled: boolean
  readonly onSelect: (file: ChangedFile) => void
  readonly onViewAtCommit: (file: ChangedFile) => void
  readonly onOpenCurrent: (file: ChangedFile) => void
}

function FileRow(props: FileRowProps) {
  const canView = () => canViewFileAtCommit(props.file)
  return (
    <div
      role="button"
      tabIndex={props.disabled ? -1 : 0}
      class={props.selected ? "gg-file-row gg-selected" : "gg-file-row"}
      style={`--gg-indent:${props.indent}px`}
      title={props.file.oldPath ? `${props.file.oldPath} → ${props.file.path}` : props.file.path}
      aria-disabled={props.disabled}
      onClick={() => {
        if (!props.disabled) props.onSelect(props.file)
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          if (!props.disabled) props.onSelect(props.file)
        }
      }}
    >
      <span class={statusClass(props.file.status)}>{statusLetter(props.file.status)}</span>
      <span class="gg-file-name">{props.label}</span>
      <Show when={props.file.oldPath}>
        <span class="gg-file-old">← {props.file.oldPath}</span>
      </Show>
      <FileStats file={props.file} />
      <span class="gg-file-actions">
        <button
          type="button"
          class="gg-file-action"
          data-testid="file-view-at-commit"
          aria-label={
            !canView()
              ? `${props.file.path} was deleted; no commit version is available (the parent version is only in the diff)`
              : `View ${props.file.path} at this commit`
          }
          title={
            !canView()
              ? "Deleted at this commit; the parent version is only available in the diff"
              : "View this file at the selected commit"
          }
          disabled={!canView()}
          onClick={(event) => {
            event.stopPropagation()
            props.onViewAtCommit(props.file)
          }}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <EyeIcon />
        </button>
        <button
          type="button"
          class="gg-file-action"
          data-testid="file-open-current"
          aria-label={`Open current workspace file ${props.file.path}`}
          title="Open the current workspace file"
          onClick={(event) => {
            event.stopPropagation()
            props.onOpenCurrent(props.file)
          }}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <ExternalIcon />
        </button>
      </span>
    </div>
  )
}

interface FileTreeProps {
  readonly nodes: readonly FileTreeNode[]
  readonly depth: number
  readonly expanded: ReadonlySet<string>
  readonly selectedPath: string | undefined
  readonly disabled: boolean
  readonly onToggle: (path: string) => void
  readonly onSelect: (file: ChangedFile) => void
  readonly onViewAtCommit: (file: ChangedFile) => void
  readonly onOpenCurrent: (file: ChangedFile) => void
}

function FileTree(props: FileTreeProps) {
  return (
    <For each={props.nodes}>
      {(node) => {
        if (node.kind === "directory") {
          const open = () => props.expanded.has(node.path)
          return (
            <>
              <button
                type="button"
                class="gg-dir-row"
                style={`--gg-indent:${props.depth * 12 + 4}px`}
                title={node.path}
                disabled={props.disabled}
                aria-expanded={open()}
                onClick={() => props.onToggle(node.path)}
              >
                <span class="gg-dir-caret" aria-hidden="true">
                  {open() ? "▾" : "▸"}
                </span>
                <span class="gg-dir-name">{node.name}</span>
                <span class="gg-muted">{node.fileCount}</span>
              </button>
              <Show when={open()}>
                <div class="gg-tree-children">
                  <FileTree
                    nodes={node.children}
                    depth={props.depth + 1}
                    expanded={props.expanded}
                    selectedPath={props.selectedPath}
                    disabled={props.disabled}
                    onToggle={props.onToggle}
                    onSelect={props.onSelect}
                    onViewAtCommit={props.onViewAtCommit}
                    onOpenCurrent={props.onOpenCurrent}
                  />
                </div>
              </Show>
            </>
          )
        }

        return (
          <FileRow
            file={node.file}
            label={node.name}
            indent={props.depth * 12 + 4}
            selected={props.selectedPath === node.path}
            disabled={props.disabled}
            onSelect={props.onSelect}
            onViewAtCommit={props.onViewAtCommit}
            onOpenCurrent={props.onOpenCurrent}
          />
        )
      }}
    </For>
  )
}

/* ---------- panel ---------- */

/**
 * Read-only Git Graph side panel.
 *
 * `props.panel.session` is a reactive getter supplied by the host. Never
 * destructure it: the same render stays mounted while the routed session (and
 * therefore its directory) changes.
 */
export function GitGraphPanel(props: { readonly panel: PanelProps }) {
  // `usePlugin` throws when the harness renders this panel directly rather
  // than through the plugin contribution; host-only actions then degrade to a
  // safe copy-path notice.
  const pluginContext = (() => {
    try {
      return usePlugin()
    } catch {
      return undefined
    }
  })()
  const [repositories, setRepositories] = createSignal<GitRepository[]>([])
  const [repositoriesLoading, setRepositoriesLoading] = createSignal(false)
  const [repositoriesError, setRepositoriesError] = createSignal<string | undefined>()

  const [selectedRepositoryId, setSelectedRepositoryId] = createSignal<string | undefined>()
  const [status, setStatus] = createSignal<GitStatus | undefined>()
  const [repositoryLoading, setRepositoryLoading] = createSignal(false)
  const [repositoryError, setRepositoryError] = createSignal<string | undefined>()

  const [commits, setCommits] = createSignal<GitCommit[]>([])
  const [hasMore, setHasMore] = createSignal(false)
  const [nextSkip, setNextSkip] = createSignal(0)
  const [loadingMore, setLoadingMore] = createSignal(false)
  const [historyError, setHistoryError] = createSignal<string | undefined>()

  /** Typed refs load on their own channel; a failure never blocks history. */
  const [refs, setRefs] = createSignal<GitRef[]>([])
  const [refsLoading, setRefsLoading] = createSignal(false)
  const [refsError, setRefsError] = createSignal<string | undefined>()

  const [filters, setFilters] = createSignal<HistoryFilterState>(DEFAULT_HISTORY_FILTER)
  const [firstParent, setFirstParent] = createSignal(false)
  const [historyOrder, setHistoryOrder] = createSignal<HistoryOrder>("date")
  const [branchSelectorOpen, setBranchSelectorOpen] = createSignal(false)
  const [refMenu, setRefMenu] = createSignal<RefMenuState | undefined>()
  const [overflowMenu, setOverflowMenu] = createSignal<OverflowMenuState | undefined>()
  const [commitMenu, setCommitMenu] = createSignal<CommitMenuState | undefined>()
  const [jumpNotice, setJumpNotice] = createSignal<string | undefined>()

  const [comparisonBase, setComparisonBase] = createSignal<GitCommit | undefined>()
  const [activeComparison, setActiveComparison] = createSignal<ActiveComparison | undefined>()
  const [comparisonFiles, setComparisonFiles] = createSignal<ChangedFile[]>([])
  const [comparisonFilesLoading, setComparisonFilesLoading] = createSignal(false)
  const [comparisonFilesError, setComparisonFilesError] = createSignal<string | undefined>()
  const [comparisonPath, setComparisonPath] = createSignal<string | undefined>()
  const [comparisonDiff, setComparisonDiff] = createSignal<FileDiff | undefined>()
  const [comparisonDiffLoading, setComparisonDiffLoading] = createSignal(false)
  const [comparisonDiffError, setComparisonDiffError] = createSignal<string | undefined>()

  const [mutationDialog, setMutationDialog] = createSignal<MutationDialogState | undefined>()
  const [mutationBusy, setMutationBusy] = createSignal(false)
  const [mutationError, setMutationError] = createSignal<string | undefined>()
  const [mutationWarning, setMutationWarning] = createSignal<string | undefined>()
  const [mutationNotice, setMutationNotice] = createSignal<string | undefined>()

  const [selectedCommit, setSelectedCommit] = createSignal<GitCommit | undefined>()
  const [selectedParentIndex, setSelectedParentIndex] = createSignal(0)
  const [commitFiles, setCommitFiles] = createSignal<ChangedFile[]>([])
  const [filesLoading, setFilesLoading] = createSignal(false)
  const [filesError, setFilesError] = createSignal<string | undefined>()
  const [expandedDirectories, setExpandedDirectories] = createSignal<ReadonlySet<string>>(new Set<string>())

  const [selectedFile, setSelectedFile] = createSignal<FileSelection | undefined>()
  const [diff, setDiff] = createSignal<FileDiff | undefined>()
  const [diffLoading, setDiffLoading] = createSignal(false)
  const [diffError, setDiffError] = createSignal<string | undefined>()
  /** Inline file list mode: Git Graph-style flat list or the existing tree. */
  const [inlineView, setInlineView] = createSignal<"list" | "tree">("tree")
  const [fileContentTarget, setFileContentTarget] = createSignal<
    { readonly hash: string; readonly path: string } | undefined
  >()
  const [fileContent, setFileContent] = createSignal<CommitFileContent | undefined>()
  const [fileContentLoading, setFileContentLoading] = createSignal(false)
  const [fileContentError, setFileContentError] = createSignal<string | undefined>()
  /** Full-panel commit diff view; the history list stays mounted state, not DOM. */
  const [commitDiffOpen, setCommitDiffOpen] = createSignal(false)

  const [viewportHeight, setViewportHeight] = createSignal(320)
  const [scrollTop, setScrollTop] = createSignal(0)
  const [panelWidth, setPanelWidth] = createSignal(520)
  const [columnPreferences, setColumnPreferences] =
    createSignal<ColumnPreferences>(readColumnPreferences())
  const [autoLoadState, setAutoLoadState] =
    createSignal<AutoLoadState>(INITIAL_AUTO_LOAD_STATE)

  const [searchQuery, setSearchQuery] = createSignal("")
  const [changesExpanded, setChangesExpanded] = createSignal(true)
  const [collapsedGroups, setCollapsedGroups] = createSignal<ReadonlySet<string>>(new Set<string>())

  const repositoriesRequest = new LatestRequest()
  const graphRequest = new LatestRequest()
  const filesRequest = new LatestRequest()
  const diffRequest = new LatestRequest()
  const refsRequest = new LatestRequest()
  const comparisonFilesRequest = new LatestRequest()
  const comparisonDiffRequest = new LatestRequest()
  const fileContentRequest = new LatestRequest()

  const selectionCache = SELECTION_CACHE
  const selectionGeneration = new SelectionGeneration()
  let activeKey = ""
  let pendingRestore: SelectionSnapshot | undefined
  let scroller: HTMLDivElement | undefined
  let resizeObserver: ResizeObserver | undefined
  let panelObserver: ResizeObserver | undefined
  let resizeDragCleanup: (() => void) | undefined
  let loadMoreInFlight = false
  let historyVersion = 0
  const repositoryLoadGeneration = new SelectionGeneration()
  const refsLoadGeneration = new SelectionGeneration()
  const mutationGeneration = new SelectionGeneration()
  let searchInput: HTMLInputElement | undefined
  /** Pending two-axis restore across full-panel diff in/out. */
  let pendingViewRestore: PendingViewRestore | undefined
  let restoreFrame: { readonly id: number; readonly timeout: boolean } | undefined
  let restoreAttempt = 0
  let autoSettleFrame: { readonly id: number; readonly timeout: boolean } | undefined

  const currentDirectory = () => props.panel.session.directory

  function currentRpc() {
    const route = sessionRoute(props.panel.session)
    return { route, rpc: route.client.rpc(GitGraphRpc) }
  }

  function requestOptions(directory: string, signal: AbortSignal) {
    return { location: { directory }, signal }
  }

  function logSettings(): HistoryLogSettings {
    return {
      filter: filters(),
      firstParent: firstParent(),
      order: historyOrder(),
    }
  }

  function captureSelection(): SelectionSnapshot {
    const file = selectedFile()
    const commit = selectedCommit()
    return {
      ...(selectedRepositoryId() ? { repositoryId: selectedRepositoryId() } : {}),
      ...(commit ? { commitHash: commit.hash, parentIndex: selectedParentIndex() } : {}),
      ...(file ? { filePath: file.path, fileSource: file.source } : {}),
    }
  }

  /** Graph rows may carry first-parent-only copies; details need the original. */
  function fullCommit(commit: GitCommit): GitCommit {
    return commits().find((candidate) => candidate.hash === commit.hash) ?? commit
  }

  function postFrame(callback: () => void): { readonly id: number; readonly timeout: boolean } {
    if (typeof requestAnimationFrame === "function") {
      return { id: requestAnimationFrame(callback), timeout: false }
    }
    return { id: Number(globalThis.setTimeout(callback, 0)), timeout: true }
  }

  function cancelFrame(frame: { readonly id: number; readonly timeout: boolean } | undefined): void {
    if (!frame) return
    if (frame.timeout) globalThis.clearTimeout(frame.id)
    else if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(frame.id)
  }

  function cancelRestoreFrame(): void {
    cancelFrame(restoreFrame)
    restoreFrame = undefined
    restoreAttempt = 0
  }

  function clearPendingViewRestore(): void {
    pendingViewRestore = undefined
    cancelRestoreFrame()
  }

  function cancelAutoLoadSettle(): void {
    cancelFrame(autoSettleFrame)
    autoSettleFrame = undefined
  }

  function viewRestoreContextCurrent(pending: PendingViewRestore): boolean {
    if (pending.key !== activeKey) return false
    if (selectedRepositoryId() !== pending.repositoryId) return false
    if (pending.commitHash && selectedCommit()?.hash !== pending.commitHash) return false
    return selectionGeneration.isCurrent(pending.generation)
  }

  /**
   * Wait until the reinserted list has real layout: the spacer must match its
   * derived height and, when a commit is expanded, its slot must be mounted.
   * Ref callbacks alone run before that, so reading scrollHeight there would
   * consume the pending restore against zeros.
   */
  function canApplyViewRestore(): boolean {
    if (!scroller) return false
    if (scroller.clientHeight <= 0 || scroller.scrollHeight <= 0) return false
    const spacer = scroller.querySelector(".gg-history-spacer")
    if (!(spacer instanceof HTMLElement)) return false
    const layout = rowLayout()
    if (layout.totalHeight <= 0) return false
    const spacerHeight = spacer.getBoundingClientRect().height
    if (Math.abs(spacerHeight - layout.totalHeight) > 1) return false
    if (scroller.scrollHeight + 1 < layout.totalHeight) return false
    if (expandedRowIndex() !== undefined) {
      // The slot height is derived from the file list; applying at the loading
      // placeholder height and then growing would shift the restored rows.
      if (filesLoading()) return false
      const slot = scroller.querySelector(".gg-row-slot")
      if (!(slot instanceof HTMLElement)) return false
      if (Math.abs(slot.getBoundingClientRect().height - layout.slotHeight) > 1) return false
    }
    return true
  }

  function applyViewRestore(pending: PendingViewRestore): void {
    if (!scroller) return
    // Set the DOM first, then mirror what the browser actually accepted.
    const top = clampScrollOffset(
      pending.scrollTop,
      scroller.scrollHeight,
      scroller.clientHeight,
    )
    scroller.scrollTop = top
    setScrollTop(scroller.scrollTop)
    if (scroller.clientHeight > 0) setViewportHeight(scroller.clientHeight)
  }

  function restoreViewStep(): void {
    restoreFrame = undefined
    const pending = pendingViewRestore
    if (!pending) {
      restoreAttempt = 0
      return
    }
    if (
      !commitDiffOpen() &&
      !activeComparison() &&
      viewRestoreContextCurrent(pending) &&
      canApplyViewRestore()
    ) {
      applyViewRestore(pending)
      pendingViewRestore = undefined
      restoreAttempt = 0
      return
    }
    restoreAttempt += 1
    if (restoreAttempt >= RESTORE_MAX_FRAMES) {
      // Do not consume an invalid measurement. A later attach/resize event may
      // start another bounded batch; never loop here.
      restoreAttempt = 0
      return
    }
    restoreFrame = postFrame(restoreViewStep)
  }

  function scheduleViewRestore(): void {
    if (!pendingViewRestore || commitDiffOpen() || activeComparison()) return
    if (restoreFrame !== undefined) return
    restoreAttempt = 0
    restoreFrame = postFrame(restoreViewStep)
  }

  /** Re-check near-bottom once the appended page's DOM has settled. */
  function scheduleAutoLoadSettle(): void {
    if (autoSettleFrame !== undefined) return
    autoSettleFrame = postFrame(() => {
      autoSettleFrame = undefined
      maybeAutoLoad()
    })
  }

  function clearFileContent(): void {
    fileContentRequest.cancel()
    setFileContentTarget(undefined)
    setFileContent(undefined)
    setFileContentLoading(false)
    setFileContentError(undefined)
  }

  function clearCommitSelection(): void {
    filesRequest.cancel()
    clearFileContent()
    setSelectedCommit(undefined)
    setSelectedParentIndex(0)
    setCommitFiles([])
    setFilesLoading(false)
    setFilesError(undefined)
    setExpandedDirectories(new Set<string>())
    setCommitDiffOpen(false)
    clearPendingViewRestore()
  }

  function clearComparisonState(): void {
    comparisonFilesRequest.cancel()
    comparisonDiffRequest.cancel()
    setActiveComparison(undefined)
    setComparisonFiles([])
    setComparisonFilesLoading(false)
    setComparisonFilesError(undefined)
    setComparisonPath(undefined)
    setComparisonDiff(undefined)
    setComparisonDiffLoading(false)
    setComparisonDiffError(undefined)
  }

  /**
   * Reset everything that belongs to the loaded history list. Used by filter
   * and setting changes before the first page is fetched again.
   */
  function resetHistoryView(resetScroll = true): void {
    graphRequest.cancel()
    filesRequest.cancel()
    diffRequest.cancel()
    comparisonFilesRequest.cancel()
    comparisonDiffRequest.cancel()
    fileContentRequest.cancel()
    setFileContentTarget(undefined)
    setFileContent(undefined)
    setFileContentLoading(false)
    setFileContentError(undefined)
    historyVersion += 1
    loadMoreInFlight = false

    setCommits([])
    setHasMore(false)
    setNextSkip(0)
    setLoadingMore(false)
    setHistoryError(undefined)
    setAutoLoadState(INITIAL_AUTO_LOAD_STATE)
    setJumpNotice(undefined)

    setSelectedCommit(undefined)
    setSelectedParentIndex(0)
    setCommitFiles([])
    setFilesLoading(false)
    setFilesError(undefined)
    setExpandedDirectories(new Set<string>())
    setCommitDiffOpen(false)

    setSelectedFile(undefined)
    setDiff(undefined)
    setDiffLoading(false)
    setDiffError(undefined)

    setActiveComparison(undefined)
    setComparisonFiles([])
    setComparisonFilesLoading(false)
    setComparisonFilesError(undefined)
    setComparisonPath(undefined)
    setComparisonDiff(undefined)
    setComparisonDiffLoading(false)
    setComparisonDiffError(undefined)
    setComparisonBase(undefined)

    setRefMenu(undefined)
    setOverflowMenu(undefined)
    setCommitMenu(undefined)

    clearPendingViewRestore()
    cancelAutoLoadSettle()

    if (resetScroll) {
      setScrollTop(0)
      if (scroller) scroller.scrollTop = 0
    }
  }

  function resetRepositoryState(): void {
    repositoryLoadGeneration.bump()
    resetHistoryView()
    refsRequest.cancel()
    setRefs([])
    setRefsLoading(false)
    setRefsError(undefined)

    setStatus(undefined)
    setRepositoryLoading(false)
    setRepositoryError(undefined)
  }

  function resetAll(): void {
    repositoriesRequest.cancel()
    mutationGeneration.bump()
    resetRepositoryState()
    setRepositories([])
    setRepositoriesLoading(false)
    setRepositoriesError(undefined)
    setSelectedRepositoryId(undefined)
    setSearchQuery("")
    setFilters((current) => ({ ...current, refs: [] }))
    setChangesExpanded(true)
    setCollapsedGroups(new Set<string>())
    setScrollTop(0)
    if (scroller) scroller.scrollTop = 0
    setBranchSelectorOpen(false)
    setMutationDialog(undefined)
    setMutationError(undefined)
    setMutationWarning(undefined)
    setMutationNotice(undefined)
    setJumpNotice(undefined)
  }

  async function refreshRepositories(
    refresh: boolean,
    restore?: SelectionSnapshot,
    restoreToken?: number,
  ) {
    const { route, rpc } = currentRpc()
    const { directory } = route
    const key = selectionKey(route.serverId, route.directory)
    if (!directory || key !== activeKey) return

    setRepositoriesLoading(true)
    setRepositoriesError(undefined)

    const result = await repositoriesRequest.run((signal) =>
      rpc.listRepositories({ refresh }, requestOptions(directory, signal)),
    )

    if (!result.accepted) {
      if (!result.aborted) {
        setRepositoriesLoading(false)
        setRepositoriesError(formatError(result.error))
      }
      return
    }
    if (key !== activeKey) return

    setRepositoriesLoading(false)
    const list = result.value.repositories
    setRepositories(list)

    const canRestore =
      restoreToken === undefined || selectionGeneration.isCurrent(restoreToken)
    const currentRepositoryId = selectedRepositoryId()
    const preferred = canRestore
      ? (restore?.repositoryId ?? currentRepositoryId)
      : currentRepositoryId
    const next = list.find((repository) => repository.id === preferred) ?? list[0]
    if (!next) {
      setSelectedRepositoryId(undefined)
      setFilters((current) => ({ ...current, refs: [] }))
      resetRepositoryState()
      return
    }

    if (currentRepositoryId !== undefined && next.id !== currentRepositoryId) {
      setFilters((current) => ({ ...current, refs: [] }))
    }

    if (!canRestore && currentRepositoryId !== undefined && next.id === currentRepositoryId) {
      // A newer user selection landed while this refresh was in flight. Keep
      // its repository, commit and file selection instead of restoring the
      // snapshot captured when the refresh started.
      return
    }

    const restoreForNext =
      canRestore && restore?.repositoryId === next.id ? restore : undefined
    await loadRepository(next.id, restoreForNext)
  }

  async function loadRepository(
    repositoryId: string,
    restore?: SelectionSnapshot,
    options?: { readonly awaitRefs?: boolean },
  ) {
    const { route, rpc } = currentRpc()
    const { directory } = route
    const key = selectionKey(route.serverId, route.directory)
    if (!directory || key !== activeKey) return

    graphRequest.cancel()
    filesRequest.cancel()
    diffRequest.cancel()
    resetRepositoryState()
    const generation = repositoryLoadGeneration.current()
    setSelectedRepositoryId(repositoryId)
    setRepositoryLoading(true)
    const version = historyVersion
    const caps = capabilities()

    const refsPromise = loadRefs(repositoryId)

    try {
      const result = await graphRequest.run(async (signal) => {
        const requestOptionsForLoad = requestOptions(directory, signal)
        const input = historyLogInput(
          repositoryId,
          PAGE_SIZE,
          0,
          logSettings(),
          caps.extendedLog,
        )
        const [nextStatus, log] = await Promise.all([
          rpc.getStatus({ repositoryId }, requestOptionsForLoad),
          extendedClient(rpc).getLog(
            input as unknown as ExtendedLogInput,
            requestOptionsForLoad,
          ),
        ])
        return { status: nextStatus, log }
      })

      if (!result.accepted) {
        if (!result.aborted) {
          setRepositoryLoading(false)
          setRepositoryError(formatError(result.error))
        }
        return
      }
      if (
        key !== activeKey ||
        selectedRepositoryId() !== repositoryId ||
        version !== historyVersion
      ) {
        return
      }

      const nextStatus = result.value.status
      const nextLog = result.value.log
      const nextCommits = mergeCommits([], nextLog.commits)

      setStatus(nextStatus)
      setCommits(nextCommits)
      setNextSkip(nextLog.commits.length)
      setHasMore(nextLog.hasMore)

      if (restore) applyRestore(restore, nextStatus, nextCommits)
      // A first screen shorter than the viewport may fetch exactly one
      // supplement; the auto guard prevents it from looping the whole repo.
      maybeAutoLoad()
    } finally {
      // A superseded load must not clear the loading state of its successor.
      if (repositoryLoadGeneration.isCurrent(generation)) {
        setRepositoryLoading(false)
      }
    }

    if (options?.awaitRefs) await refsPromise
  }

  async function loadHistoryFirstPage(repositoryId: string): Promise<void> {
    if (repositoryLoading()) return
    const { route, rpc } = currentRpc()
    const { directory } = route
    const key = selectionKey(route.serverId, route.directory)
    if (!directory || key !== activeKey) return
    const version = historyVersion
    const caps = capabilities()
    const input = historyLogInput(
      repositoryId,
      PAGE_SIZE,
      0,
      logSettings(),
      caps.extendedLog,
    )

    const result = await graphRequest.run((signal) =>
      extendedClient(rpc).getLog(input as unknown as ExtendedLogInput, {
        location: { directory },
        signal,
      }),
    )

    if (!result.accepted) {
      if (!result.aborted) {
        setHistoryError(formatError(result.error))
      }
      return
    }
    if (
      key !== activeKey ||
      selectedRepositoryId() !== repositoryId ||
      version !== historyVersion
    ) {
      return
    }

    setHistoryError(undefined)
    setCommits(mergeCommits([], result.value.commits))
    setNextSkip(result.value.commits.length)
    setHasMore(result.value.hasMore)
    maybeAutoLoad()
  }

  async function loadRefs(repositoryId: string): Promise<void> {
    const { route, rpc } = currentRpc()
    const { directory } = route
    const key = selectionKey(route.serverId, route.directory)
    if (!directory) return
    const generation = refsLoadGeneration.bump()
    setRefsLoading(true)
    setRefsError(undefined)

    try {
      const result = await refsRequest.run((signal) =>
        rpc.getRefs({ repositoryId }, requestOptions(directory, signal)),
      )

      if (!result.accepted) {
        if (!result.aborted) {
          setRefsError(formatError(result.error))
        }
        return
      }
      if (key !== activeKey || selectedRepositoryId() !== repositoryId) return
      setRefs(result.value.refs)
    } finally {
      if (refsLoadGeneration.isCurrent(generation)) {
        setRefsLoading(false)
      }
    }
  }

  function applyRestore(
    restore: SelectionSnapshot,
    nextStatus: GitStatus,
    nextCommits: readonly GitCommit[],
  ): void {
    if (restore.commitHash) {
      const commit = nextCommits.find((candidate) => candidate.hash === restore.commitHash)
      if (commit) {
        void selectCommit(commit, restore.parentIndex ?? 0, restore.filePath)
        return
      }
    }

    if (restore.filePath && (restore.fileSource === "index" || restore.fileSource === "working-tree")) {
      const file = findStatusFile(nextStatus.files, restore.filePath, restore.fileSource)
      if (file) selectStatusFile(file)
    }
  }

  function selectStatusFile(file: ChangedFile): void {
    selectionGeneration.bump()
    clearCommitSelection()
    const selection: FileSelection = {
      path: file.path,
      target: statusFileTarget(file),
      source: statusFileTarget(file).type === "index" ? "index" : "working-tree",
    }
    setSelectedFile(selection)
    void loadDiff(selection)
  }

  async function loadDiff(selection: FileSelection): Promise<void> {
    const repositoryId = selectedRepositoryId()
    if (!repositoryId) return
    const { route, rpc } = currentRpc()
    const { directory } = route
    const key = selectionKey(route.serverId, route.directory)

    setDiff(undefined)
    setDiffError(undefined)
    setDiffLoading(true)

    const result = await diffRequest.run((signal) =>
      rpc.getDiff(
        { repositoryId, target: selection.target, path: selection.path },
        requestOptions(directory, signal),
      ),
    )

    if (!result.accepted) {
      if (!result.aborted) {
        setDiffLoading(false)
        setDiffError(formatError(result.error))
      }
      return
    }
    if (
      key !== activeKey ||
      selectedRepositoryId() !== repositoryId ||
      selectedFile() !== selection
    ) {
      return
    }

    setDiffLoading(false)
    setDiff(result.value)
  }

  function selectCommit(
    requestedCommit: GitCommit,
    requestedParentIndex = 0,
    restoreFilePath?: string,
  ): void {
    const commit = fullCommit(requestedCommit)
    selectionGeneration.bump()
    // A normal commit click leaves comparison mode and cancels its requests.
    clearComparisonState()
    setComparisonBase(undefined)
    const maxIndex = Math.max(0, commit.parents.length - 1)
    const parentIndex = Math.min(Math.max(0, requestedParentIndex), maxIndex)
    setCommitDiffOpen(false)
    clearPendingViewRestore()
    setSelectedCommit(commit)
    setSelectedParentIndex(parentIndex)
    setSelectedFile(undefined)
    setDiff(undefined)
    setDiffError(undefined)
    void loadCommitFiles(commit, parentIndex, restoreFilePath)
  }

  /** Same-row click collapses the inline slot; switching rows replaces it. */
  function toggleCommit(commit: GitCommit): void {
    if (selectedCommit()?.hash === commit.hash) {
      collapseCommit()
      return
    }
    selectCommit(commit)
  }

  function collapseCommit(): void {
    selectionGeneration.bump()
    filesRequest.cancel()
    diffRequest.cancel()
    setSelectedCommit(undefined)
    setSelectedParentIndex(0)
    setCommitFiles([])
    setFilesLoading(false)
    setFilesError(undefined)
    setExpandedDirectories(new Set<string>())
    setSelectedFile(undefined)
    setDiff(undefined)
    setDiffLoading(false)
    setDiffError(undefined)
    setCommitDiffOpen(false)
    clearPendingViewRestore()
  }

  async function loadCommitFiles(
    commit: GitCommit,
    parentIndex: number,
    restoreFilePath?: string,
    options?: { readonly keepFile?: boolean },
  ): Promise<void> {
    const repositoryId = selectedRepositoryId()
    if (!repositoryId) return
    const { route, rpc } = currentRpc()
    const { directory } = route
    const key = selectionKey(route.serverId, route.directory)

    filesRequest.cancel()
    if (!options?.keepFile) diffRequest.cancel()
    setCommitFiles([])
    setFilesLoading(true)
    setFilesError(undefined)
    if (!options?.keepFile) {
      setSelectedFile(undefined)
      setDiff(undefined)
      setDiffLoading(false)
      setDiffError(undefined)
    }

    const result = await filesRequest.run((signal) =>
      rpc.getCommitFiles(
        { repositoryId, hash: commit.hash, parentIndex },
        requestOptions(directory, signal),
      ),
    )

    if (!result.accepted) {
      if (!result.aborted) {
        setFilesLoading(false)
        setFilesError(formatError(result.error))
        if (pendingViewRestore && !commitDiffOpen()) scheduleViewRestore()
      }
      return
    }
    if (
      key !== activeKey ||
      selectedRepositoryId() !== repositoryId ||
      selectedCommit()?.hash !== commit.hash ||
      selectedParentIndex() !== parentIndex
    ) {
      return
    }

    setFilesLoading(false)
    const files = result.value.files
    setCommitFiles(files)
    setExpandedDirectories(new Set(collectDirectoryPaths(buildFileTree(files))))
    if (pendingViewRestore && !commitDiffOpen()) scheduleViewRestore()

    if (restoreFilePath) {
      const file = files.find((candidate) => candidate.path === restoreFilePath)
      if (file) selectCommitFile(file, commit, parentIndex)
    }
  }

  function selectCommitFile(file: ChangedFile, commit: GitCommit, parentIndex: number): void {
    selectionGeneration.bump()
    const selection: FileSelection = {
      path: file.path,
      target: { type: "commit", hash: commit.hash, parentIndex },
      source: "commit",
    }
    if (!commitDiffOpen()) {
      const { route } = currentRpc()
      pendingViewRestore = {
        key: selectionKey(route.serverId, route.directory),
        repositoryId: selectedRepositoryId(),
        commitHash: commit.hash,
        generation: selectionGeneration.current(),
        scrollTop: scroller ? scroller.scrollTop : scrollTop(),
      }
      cancelRestoreFrame()
    }
    setSelectedFile(selection)
    setCommitDiffOpen(true)
    void loadDiff(selection)
  }

  /** Leave the full-panel diff, keeping the expanded commit and scroll state. */
  function closeCommitDiff(): void {
    if (!commitDiffOpen()) return
    if (pendingViewRestore) {
      pendingViewRestore.generation = selectionGeneration.current()
    }
    setCommitDiffOpen(false)
    scheduleViewRestore()
  }

  /**
   * Switching the diff parent inside the full-panel view reloads both the diff
   * and the inline file tree, so Back lands on the matching parent.
   */
  function changeDiffParent(requestedParentIndex: number): void {
    const commit = selectedCommit()
    if (!commit) return
    const maxIndex = Math.max(0, commit.parents.length - 1)
    const nextIndex = Math.min(Math.max(0, requestedParentIndex), maxIndex)
    if (nextIndex === selectedParentIndex()) return
    selectionGeneration.bump()
    setSelectedParentIndex(nextIndex)
    const file = selectedFile()
    void loadCommitFiles(commit, nextIndex, undefined, { keepFile: true })
    if (file?.source === "commit") {
      const selection: FileSelection = {
        path: file.path,
        target: { type: "commit", hash: commit.hash, parentIndex: nextIndex },
        source: "commit",
      }
      setSelectedFile(selection)
      void loadDiff(selection)
    }
  }

  function openCurrentWorkspaceFile(file: ChangedFile): void {
    const repository = selectedRepository()
    if (!repository) {
      setMutationNotice("No repository is selected; the current file path was not opened.")
      return
    }
    const absolute = absoluteRepositoryFilePath(repository.rootPath, file.path)
    let target = workspaceRelativePath(currentDirectory(), repository.rootPath, file.path)
    try {
      // The screen's public file model normalizes into the session workspace
      // and leaves paths outside it absolute.
      target = props.panel.screen.file.resolve(absolute)
    } catch {
      // Keep the pure-helper result when the screen file model is unavailable.
    }

    try {
      if (pluginContext?.layout) {
        pluginContext.layout.open(`file:${target}`, props.panel.session)
        return
      }
    } catch {
      // Fall through to the system default app.
    }

    void (async () => {
      try {
        if (!pluginContext?.desktop) throw new Error("desktop unavailable")
        await pluginContext.desktop.launch(absolute)
      } catch {
        await copyText(file.path, "File path")
        setMutationNotice(
          "This host could not open the current file; the repository-relative path was copied instead.",
        )
      }
    })()
  }

  function viewFileAtCommit(file: ChangedFile, commit: GitCommit): void {
    if (!fileContentSupported()) {
      setMutationNotice(
        "Coming soon: the connected server does not expose getCommitFileContent yet.",
      )
      return
    }
    const repositoryId = selectedRepositoryId()
    if (!repositoryId) return
    setFileContentTarget({ hash: commit.hash, path: file.path })
    setFileContent(undefined)
    setFileContentError(undefined)
    setFileContentLoading(true)
    void loadFileContent(repositoryId, commit.hash, file.path)
  }

  async function loadFileContent(
    repositoryId: string,
    hash: string,
    path: string,
  ): Promise<void> {
    const { route, rpc } = currentRpc()
    const { directory } = route
    if (!directory) return
    const key = selectionKey(route.serverId, route.directory)
    const client = extendedClient(rpc)
    setFileContentLoading(true)
    setFileContentError(undefined)

    const result = await fileContentRequest.run((signal) => {
      if (!client.getCommitFileContent) {
        return Promise.reject(new Error("getCommitFileContent is unavailable"))
      }
      return client.getCommitFileContent(
        { repositoryId, hash, path },
        requestOptions(directory, signal),
      )
    })

    if (!result.accepted) {
      if (!result.aborted) {
        setFileContentLoading(false)
        setFileContentError(formatError(result.error))
      }
      return
    }
    const target = fileContentTarget()
    if (
      key !== activeKey ||
      selectedRepositoryId() !== repositoryId ||
      !target ||
      target.hash !== hash ||
      target.path !== path
    ) {
      return
    }
    setFileContentLoading(false)
    setFileContent(result.value)
  }

  function closeFileContent(): void {
    fileContentRequest.cancel()
    setFileContentTarget(undefined)
    setFileContent(undefined)
    setFileContentLoading(false)
    setFileContentError(undefined)
  }

  function retryFileContent(): void {
    const target = fileContentTarget()
    const repositoryId = selectedRepositoryId()
    if (target && repositoryId) {
      void loadFileContent(repositoryId, target.hash, target.path)
    }
  }

  function closeDetails(): void {
    selectionGeneration.bump()
    diffRequest.cancel()
    setSelectedFile(undefined)
    setDiff(undefined)
    setDiffLoading(false)
    setDiffError(undefined)
  }

  async function loadMore(auto = false): Promise<void> {
    const repositoryId = selectedRepositoryId()
    if (!repositoryId || loadMoreInFlight || loadingMore() || !hasMore()) return
    const { route, rpc } = currentRpc()
    const { directory } = route
    const key = selectionKey(route.serverId, route.directory)
    const skip = nextSkip()
    const version = historyVersion
    const caps = capabilities()
    const settings = logSettings()
    const fingerprint = historyFilterFingerprint(
      settings.filter,
      settings.firstParent,
      settings.order,
    )
    const input = historyLogInput(
      repositoryId,
      PAGE_SIZE,
      skip,
      settings,
      caps.extendedLog,
    )

    loadMoreInFlight = true
    setLoadingMore(true)
    setHistoryError(undefined)

    try {
      const result = await graphRequest.run((signal) =>
        extendedClient(rpc).getLog(input as unknown as ExtendedLogInput, {
          location: { directory },
          signal,
        }),
      )

      if (!result.accepted) {
        if (!result.aborted) {
          setLoadingMore(false)
          setHistoryError(formatError(result.error))
          if (auto) {
            setAutoLoadState((state) =>
              completeAutoLoad(state, { added: 0, failed: true, cancelled: false }),
            )
          }
        }
        return
      }
      const current = logSettings()
      if (
        key !== activeKey ||
        selectedRepositoryId() !== repositoryId ||
        version !== historyVersion ||
        fingerprint !==
          historyFilterFingerprint(current.filter, current.firstParent, current.order)
      ) {
        setLoadingMore(false)
        return
      }

      setLoadingMore(false)
      const page = result.value
      const before = commits().length
      const merged = mergeCommits(commits(), page.commits)
      const added = merged.length - before
      setCommits(merged)
      // nextSkip always advances by the page the server returned, even when
      // every commit was a duplicate, so retrying cannot loop forever.
      setNextSkip(skip + page.commits.length)
      setHasMore(page.hasMore && page.commits.length > 0)
      if (auto) {
        setAutoLoadState((state) =>
          completeAutoLoad(state, { added, failed: false, cancelled: false }),
        )
        // The spacer grows after this commit; re-check once the DOM settles so
        // a user pressing End again does not stay locked on an old bottom.
        scheduleAutoLoadSettle()
      }
      maybeAutoLoad()
    } finally {
      loadMoreInFlight = false
    }
  }

  /**
   * One automatic page per bottom visit. Called from scroll, resize and after a
   * page lands; all guards are synchronous so a burst cannot double-fetch.
   *
   * Measurements come from the live scroll container whenever one is attached.
   * The `viewportHeight` signal is updated by an asynchronous `ResizeObserver`,
   * which a background host tab can freeze, so using it alone would miss a
   * bottom that the DOM already reports.
   */
  function maybeAutoLoad(viewport?: ScrollViewportLike): void {
    const layout = rowLayout()
    const metrics = resolveScrollMetrics(viewport ?? scroller, {
      scrollTop: scrollTop(),
      viewportHeight: viewportHeight(),
      contentHeight: layout.totalHeight,
    })
    if (metrics.viewportHeight > 0 && metrics.viewportHeight !== viewportHeight()) {
      setViewportHeight(metrics.viewportHeight)
    }

    const nearBottom = isNearBottom({
      ...metrics,
      threshold: ROW_HEIGHT * AUTO_LOAD_THRESHOLD_ROWS,
    })
    if (!nearBottom) {
      setAutoLoadState((state) => rearmAutoLoad(state))
      return
    }

    const state = untrack(() => autoLoadState())
    if (
      !shouldAutoLoad({
        state,
        nearBottom,
        hasMore: hasMore(),
        busy: busy(),
        loadingMore: loadingMore() || loadMoreInFlight,
        graphError: graphError() !== undefined,
        historyActive:
          selectedRepositoryId() !== undefined &&
          !commitDiffOpen() &&
          activeComparison() === undefined,
      })
    ) {
      return
    }

    setAutoLoadState(beginAutoLoad(state))
    void loadMore(true)
  }

  function retryAutoLoad(): void {
    setAutoLoadState((state) => rearmAutoLoad(state))
    setHistoryError(undefined)
    const repositoryId = selectedRepositoryId()
    if (!repositoryId || loadingMore() || loadMoreInFlight || !hasMore()) return
    setAutoLoadState((state) => beginAutoLoad(state))
    void loadMore(true)
  }

  function refreshAll(): void {
    const restoreToken = selectionGeneration.current()
    const snapshot = untrack(() => captureSelection())
    pendingRestore = undefined
    repositoriesRequest.cancel()
    graphRequest.cancel()
    filesRequest.cancel()
    diffRequest.cancel()
    refsRequest.cancel()
    comparisonFilesRequest.cancel()
    comparisonDiffRequest.cancel()
    setRepositoryLoading(false)
    setLoadingMore(false)
    setFilesLoading(false)
    setDiffLoading(false)
    setAutoLoadState(INITIAL_AUTO_LOAD_STATE)
    loadMoreInFlight = false
    void refreshRepositories(true, snapshot, restoreToken)
  }

  function chooseRepository(repositoryId: string): void {
    if (!repositoryId || repositoryId === selectedRepositoryId()) return
    selectionGeneration.bump()
    mutationGeneration.bump()
    pendingRestore = undefined
    setSearchQuery("")
    setAutoLoadState(INITIAL_AUTO_LOAD_STATE)
    setFilters((current) => ({ ...current, refs: [] }))
    setComparisonBase(undefined)
    setBranchSelectorOpen(false)
    setMutationDialog(undefined)
    setJumpNotice(undefined)
    void loadRepository(repositoryId)
  }

  function toggleDirectory(path: string): void {
    setExpandedDirectories((previous) => {
      const next = new Set(previous)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  function toggleGroup(key: string): void {
    setCollapsedGroups((previous) => {
      const next = new Set(previous)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function groupExpanded(key: string): boolean {
    return !collapsedGroups().has(key)
  }

  function attachScroller(element: HTMLDivElement): void {
    scroller = element
    resizeObserver?.disconnect()
    resizeObserver = undefined
    if (element.clientHeight > 0) setViewportHeight(element.clientHeight)
    // The element can be attached with its final size while a background host
    // tab never delivers the ResizeObserver callback; evaluate with the live
    // element so a scroll position captured before mount is not missed.
    maybeAutoLoad(element)
    // Ref callbacks run before the spacer/slot children are laid out, so only
    // remember the element here; restoration happens on the next frame(s).
    scheduleViewRestore()
    if (typeof ResizeObserver === "undefined") return
    resizeObserver = new ResizeObserver((entries) => {
      const height = entries[0]?.contentRect.height
      if (typeof height === "number" && height > 0) {
        setViewportHeight(height)
        maybeAutoLoad(entries[0]?.target as HTMLDivElement | undefined)
        if (pendingViewRestore) scheduleViewRestore()
      }
    })
    resizeObserver.observe(element)
  }

  function attachPanel(element: HTMLDivElement): void {
    panelObserver?.disconnect()
    panelObserver = undefined
    if (element.clientWidth > 0) setPanelWidth(element.clientWidth)
    if (typeof ResizeObserver === "undefined") return
    panelObserver = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width
      if (typeof width === "number" && width > 0) setPanelWidth(width)
    })
    panelObserver.observe(element)
  }

  function startColumnResize(
    column: ColumnId,
    event: PointerEvent & { currentTarget: HTMLButtonElement },
  ): void {
    event.preventDefault()
    const startX = event.clientX
    const base = untrack(() => columnPreferences())
    const move = (moveEvent: PointerEvent) => {
      // `resizeColumnPreferences` uses positive delta = wider for this column,
      // which matches dragging the handle to the right for every column.
      setColumnPreferences(
        resizeColumnPreferences(
          base,
          column,
          moveEvent.clientX - startX,
          panelWidth(),
        ),
      )
    }
    const stop = (persist: boolean) => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
      window.removeEventListener("pointercancel", cancel)
      resizeDragCleanup = undefined
      // Persist once after the drag; storage failures are swallowed by the
      // helper and must never break the panel.
      if (persist) writeColumnPreferences(untrack(() => columnPreferences()))
    }
    const up = () => stop(true)
    const cancel = () => stop(false)
    resizeDragCleanup?.()
    resizeDragCleanup = () => stop(false)
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
    window.addEventListener("pointercancel", cancel)
  }

  const selectedRepository = createMemo(() =>
    repositories().find((repository) => repository.id === selectedRepositoryId()),
  )
  const capabilities = createMemo<RpcCapabilities>(() =>
    detectRpcCapabilities(currentRpc().rpc, GitGraphRpc),
  )
  const fileContentSupported = createMemo(() =>
    detectCommitFileContentSupport(currentRpc().rpc, GitGraphRpc),
  )
  const busy = createMemo(
    () => repositoriesLoading() || repositoryLoading() || mutationBusy(),
  )
  const directoryReady = createMemo(() => currentDirectory().length > 0)
  const groups = createMemo(() => groupStatusFiles(status()?.files ?? []))
  const commitTree = createMemo(() => buildFileTree(commitFiles()))
  const diffLines = createMemo(() => classifyDiff(diff()?.text ?? ""))
  const visibleDiffLines = createMemo(() => diffLines().slice(0, MAX_DIFF_DISPLAY_LINES))

  /**
   * `git log --first-parent --parents` still reports every parent hash for the
   * merge's details. Graph layout shows only the traversed first parent, on a
   * copy so the shared commit metadata keeps its full parent list.
   */
  const graphCommits = createMemo(() =>
    firstParentGraphCommits(commits(), firstParent()),
  )

  /** Layout is derived from the loaded commits; search never rewrites it. */
  const graph = createMemo(() => buildCommitGraph(graphCommits()))
  const rows = createMemo(() => graph().rows)
  const graphError = createMemo(() => graph().error)

  const expandedRowIndex = createMemo(() => {
    const commit = selectedCommit()
    if (!commit) return undefined
    const index = rows().findIndex((row) => row.commit.hash === commit.hash)
    return index >= 0 ? index : undefined
  })
  const expandedRow = createMemo(() => {
    const index = expandedRowIndex()
    return index === undefined ? undefined : rows()[index]
  })
  const slotHeight = createMemo(() => {
    if (expandedRowIndex() === undefined) return 0
    const rowsNeeded = commitFiles().length
    return Math.min(
      MAX_SLOT_HEIGHT,
      Math.max(MIN_SLOT_HEIGHT, SLOT_TREE_HEADER + rowsNeeded * SLOT_TREE_ROW_HEIGHT),
    )
  })
  const rowLayout = createMemo(() =>
    createRowLayout({
      count: rows().length,
      rowHeight: ROW_HEIGHT,
      expandedIndex: expandedRowIndex(),
      expandedHeight: slotHeight(),
    }),
  )

  const maxLanes = createMemo(() =>
    rows().reduce((maximum, row) => Math.max(maximum, row.lanes), 1),
  )
  const resolvedColumns = createMemo(() =>
    resolveColumnLayout(panelWidth(), columnPreferences()),
  )
  const graphColumnWidth = createMemo(() => resolvedColumns().widths.graph)
  const graphWidth = createMemo(() =>
    graphContentWidth(maxLanes(), LANE_SPACING, LANE_PADDING),
  )
  const laneSpacing = createMemo(() => graphLaneSpacing())
  const denseGraph = createMemo(() => isGraphClipped(graphWidth(), graphColumnWidth()))
  const maxRefs = createMemo(() =>
    Math.min(
      visibleRefCount(panelWidth()),
      refBadgeCountForBudget(resolvedColumns().widths.description),
    ),
  )
  const detailsOrientation = createMemo(() => detailsLayout(panelWidth()))
  const historyStyle = createMemo(
    () => `--gg-history-cols:${resolvedColumns().gridTemplate};`,
  )
  const detailsBodyClass = createMemo(
    () =>
      `gg-details-body ${
        detailsOrientation() === "columns" ? "gg-layout-columns" : "gg-layout-rows"
      } gg-single`,
  )
  const detailsVisible = createMemo(() => {
    if (commitDiffOpen() || activeComparison()) return false
    const file = selectedFile()
    return file !== undefined && file.source !== "commit"
  })
  const commitDiffSelection = createMemo(() => {
    if (!commitDiffOpen() || activeComparison()) return undefined
    const commit = selectedCommit()
    const file = selectedFile()
    if (!commit || !file || file.source !== "commit") return undefined
    return { commit, path: file.path }
  })
  const range = createMemo(() =>
    rowLayout().range(scrollTop(), viewportHeight(), OVERSCAN),
  )
  const rowViews = createMemo(() => createGraphRowViews(rows(), graphCommits()))
  const visibleRows = createMemo(() => visibleGraphRowViews(rowViews(), range()))
  const inlineSelectedPath = createMemo(() => {
    const file = selectedFile()
    return file?.source === "commit" ? file.path : undefined
  })
  const matches = createMemo(() => searchMatches(commits(), searchQuery()))
  const matchCount = createMemo(() => matches()?.size ?? 0)
  const searchActive = createMemo(() => searchQuery().trim().length > 0)
  const footerText = createMemo(() =>
    searchActive()
      ? `${matchCount()} matches · ${commits().length} loaded${hasMore() ? "+" : ""}`
      : `${commits().length} loaded${hasMore() ? "+" : ""}`,
  )
  const branchLabel = createMemo(() => {
    const current = status()
    if (current) {
      if (current.detached) {
        return current.head ? `detached @ ${shortHash(current.head)}` : "detached HEAD"
      }
      return current.branch ?? "(no branch)"
    }
    const repository = selectedRepository()
    if (repository) {
      if (repository.detached) {
        return repository.head ? `detached @ ${shortHash(repository.head)}` : "detached HEAD"
      }
      return repository.branch ?? "(no branch)"
    }
    return ""
  })
  const detached = createMemo(() => status()?.detached ?? selectedRepository()?.detached ?? false)
  const repositoryOptions = createMemo(() => {
    const directory = currentDirectory()
    const list = repositories()
    return list.map((repository) => ({
      repository,
      label: repositoryOptionLabel(repository, list, directory),
    }))
  })

  const mutationDialogTitle = (): string => {
    const dialog = mutationDialog()
    switch (dialog?.kind) {
      case "checkout":
        return `Checkout ${dialog.branch}`
      case "create-branch":
        return "Create branch"
      case "create-tag":
        return "Create tag"
      case "rename-branch":
        return `Rename branch ${dialog.oldName}`
      case "delete-branch":
        return `Delete branch ${dialog.name}`
      case "delete-tag":
        return `Delete tag ${dialog.name}`
      default:
        return "Confirm"
    }
  }

  const mutationDialogDescription = (): string | undefined => {
    const dialog = mutationDialog()
    switch (dialog?.kind) {
      case "checkout":
        return "Switch the working tree to this local branch. No force, network fetch or auto-stash is used."
      case "create-branch":
        return "Create a local branch at the selected commit. Nothing is pushed or fetched."
      case "create-tag":
        return "Create a tag at the selected commit. Nothing is pushed or fetched."
      case "rename-branch":
        return "Rename a local branch. The server refuses if the expected HEAD no longer matches."
      case "delete-branch":
        return "Delete a local branch. Only merged branches are accepted; there is no force option."
      case "delete-tag":
        return "Delete this tag. Nothing is pushed or fetched."
      default:
        return undefined
    }
  }

  const mutationDialogFacts = createMemo<ConfirmFact[]>(() => {
    const dialog = mutationDialog()
    if (!dialog) return []
    const repository = selectedRepository()
    const facts: ConfirmFact[] = [
      {
        label: "Repository",
        value: repository ? `${repository.name} (${repository.rootPath})` : "—",
      },
      {
        label: "Expected HEAD",
        value: dialog.expectedHead ?? "(unborn HEAD)",
      },
    ]
    switch (dialog.kind) {
      case "checkout":
        facts.push({ label: "Target branch", value: dialog.branch })
        break
      case "create-branch":
        facts.push({ label: "Start point", value: `${dialog.startLabel} (${shortHash(dialog.startPoint)})` })
        break
      case "create-tag":
        facts.push({ label: "Target", value: `${dialog.targetLabel} (${shortHash(dialog.target)})` })
        break
      case "rename-branch":
        facts.push({ label: "Old name", value: dialog.oldName })
        facts.push({ label: "New name", value: dialog.newName || "(required)" })
        break
      case "delete-branch":
        facts.push({ label: "Target branch", value: dialog.name })
        break
      case "delete-tag":
        facts.push({ label: "Target tag", value: dialog.name })
        break
    }
    return facts
  })

  const mutationDialogFields = createMemo<ConfirmField[]>(() => {
    const dialog = mutationDialog()
    switch (dialog?.kind) {
      case "create-branch":
        return [
          {
            id: "name",
            label: "Branch name",
            value: dialog.name,
            placeholder: "feature/my-branch",
            required: true,
          },
        ]
      case "create-tag":
        return [
          {
            id: "name",
            label: "Tag name",
            value: dialog.name,
            placeholder: "v1.0.0",
            required: true,
          },
          {
            id: "message",
            label: "Message (optional)",
            value: dialog.message,
            placeholder: "Annotated tag message",
            multiline: true,
          },
        ]
      case "rename-branch":
        return [
          {
            id: "old-name",
            label: "Current branch name",
            value: dialog.oldName,
            readonly: true,
          },
          {
            id: "new-name",
            label: "New branch name",
            value: dialog.newName,
            required: true,
          },
        ]
      default:
        return []
    }
  })

  const mutationDialogConfirmLabel = (): string => {
    const dialog = mutationDialog()
    switch (dialog?.kind) {
      case "checkout":
        return "Checkout"
      case "create-branch":
        return "Create branch"
      case "create-tag":
        return "Create tag"
      case "rename-branch":
        return "Rename branch"
      case "delete-branch":
        return "Delete branch"
      case "delete-tag":
        return "Delete tag"
      default:
        return "Confirm"
    }
  }

  const mutationDialogDanger = (): boolean => {
    const kind = mutationDialog()?.kind
    return kind === "delete-branch" || kind === "delete-tag"
  }

  const mutationDialogWarning = (): string | undefined => {
    const dialog = mutationDialog()
    if (!dialog) return undefined
    return dialog.kind === "checkout" ? dialog.blocked : undefined
  }

  const mutationDialogConfirmDisabled = (): boolean => {
    const dialog = mutationDialog()
    return dialog?.kind === "checkout" && dialog.blocked !== undefined
  }

  function searchState(hash: string): SearchState {
    const set = matches()
    if (!set) return "none"
    return set.has(hash) ? "match" : "dim"
  }

  function scrollToCommitIndex(index: number): void {
    if (index < 0) return
    const layout = rowLayout()
    const rowTop = layout.rowTop(index)
    if (!scroller) {
      setScrollTop(
        clampScrollOffset(rowTop, layout.totalHeight, viewportHeight()),
      )
      maybeAutoLoad()
      return
    }
    // A row near the end maps past the maximum scrollTop. The browser clamps
    // the DOM value and may not emit a scroll event when the value did not
    // actually change, so mirror the real DOM value into the signal or the
    // virtual window can point past the end and render no rows.
    const top = clampScrollOffset(rowTop, scroller.scrollHeight, scroller.clientHeight)
    scroller.scrollTop = top
    setScrollTop(scroller.scrollTop)
    // Search can programmatically park the viewport at the bottom; the auto
    // guard keeps that from turning into an unbounded fetch loop.
    maybeAutoLoad()
  }

  function jumpToFirstMatch(): void {
    const set = matches()
    if (!set) return
    const index = commits().findIndex((commit) => set.has(commit.hash))
    if (index >= 0) scrollToCommitIndex(index)
  }

  async function jumpToHead(): Promise<void> {
    const head = status()?.head ?? selectedRepository()?.head ?? null
    if (!head) {
      setJumpNotice("No HEAD commit is available (unborn repository).")
      return
    }
    const find = () => commits().findIndex((commit) => commit.hash === head)
    let index = find()
    if (index < 0 && hasMore()) {
      setJumpNotice("HEAD is not loaded yet; loading more commits…")
      await loadMore()
      index = find()
    }
    if (index < 0) {
      setJumpNotice(
        hasMore()
          ? "HEAD is not loaded yet. Load more commits and try again."
          : "HEAD is not in the current history or filter. Refresh, or clear the branch filter.",
      )
      return
    }
    setJumpNotice(undefined)
    scrollToCommitIndex(index)
  }

  function closeMenus(): void {
    setRefMenu(undefined)
    setOverflowMenu(undefined)
    setCommitMenu(undefined)
  }

  function eventPoint(event: MouseEvent): { x: number; y: number } {
    if (event.clientX > 0 || event.clientY > 0) {
      return { x: event.clientX, y: event.clientY }
    }
    const element = event.currentTarget
    if (element instanceof HTMLElement) {
      const rect = element.getBoundingClientRect()
      return { x: rect.left, y: rect.bottom + 2 }
    }
    return { x: 8, y: 8 }
  }

  function openRefMenu(badge: RefBadgeInfo, event: MouseEvent): void {
    const ref = typedRefForBadge(refs(), badge)
    if (!ref) {
      void copyText(badge.name, "Ref name")
      return
    }
    const { x, y } = eventPoint(event)
    closeMenus()
    setRefMenu({ ref, x, y })
  }

  function openOverflowMenu(badges: readonly RefBadgeInfo[], event: MouseEvent): void {
    const { x, y } = eventPoint(event)
    closeMenus()
    setOverflowMenu({ badges, x, y })
  }

  function openCommitMenu(commit: GitCommit, event: MouseEvent): void {
    const { x, y } = eventPoint(event)
    closeMenus()
    setCommitMenu({ commit: fullCommit(commit), x, y })
  }

  async function copyText(text: string, label: string): Promise<void> {
    try {
      if (typeof navigator === "undefined" || !navigator.clipboard) {
        throw new Error("clipboard unavailable")
      }
      await navigator.clipboard.writeText(text)
      setMutationNotice(`${label} copied to the clipboard.`)
    } catch {
      setMutationNotice("Clipboard is unavailable in this host; nothing was copied.")
    }
  }

  function reloadForSettings(): void {
    if (repositoryLoading() || mutationBusy()) {
      setMutationNotice(
        "Repository loading or a write is still in progress; the history filter was not changed.",
      )
      return
    }
    resetHistoryView()
    const repositoryId = selectedRepositoryId()
    if (repositoryId) void loadHistoryFirstPage(repositoryId)
  }

  function applyHistoryFilter(next: HistoryFilterState): void {
    if (repositoryLoading() || mutationBusy()) {
      setMutationNotice(
        "Repository loading or a write is still in progress; the history filter was not changed.",
      )
      return
    }
    if (!capabilities().extendedLog) {
      setMutationNotice("This server does not support ref filters yet.")
      return
    }
    setFilters({
      refs: normalizeRefSelection(next.refs),
      showRemotes: next.showRemotes,
      showTags: next.showTags,
    })
    setBranchSelectorOpen(false)
    reloadForSettings()
  }

  function changeHistorySettings(change: {
    readonly filter?: HistoryFilterState
    readonly firstParent?: boolean
    readonly order?: HistoryOrder
  }): void {
    if (repositoryLoading() || mutationBusy()) {
      setMutationNotice(
        "Repository loading or a write is still in progress; the history setting was not changed.",
      )
      return
    }
    if (!capabilities().extendedLog) {
      setMutationNotice("This server does not support history filters yet.")
      return
    }
    if (change.filter) {
      setFilters({
        refs: normalizeRefSelection(change.filter.refs),
        showRemotes: change.filter.showRemotes,
        showTags: change.filter.showTags,
      })
    }
    if (change.firstParent !== undefined) setFirstParent(change.firstParent)
    if (change.order !== undefined) setHistoryOrder(change.order)
    reloadForSettings()
  }

  function toggleShowRemotes(): void {
    const current = filters()
    changeHistorySettings({
      filter: { ...current, showRemotes: !current.showRemotes },
    })
  }

  function toggleShowTags(): void {
    const current = filters()
    changeHistorySettings({ filter: { ...current, showTags: !current.showTags } })
  }

  function toggleFirstParent(): void {
    changeHistorySettings({ firstParent: !firstParent() })
  }

  function chooseHistoryOrder(order: HistoryOrder): void {
    changeHistorySettings({ order })
  }

  function viewRefHistory(ref: GitRef): void {
    const canonical = ref.kind === "head" ? undefined : canonicalRefName(ref)
    if (!canonical) {
      setMutationNotice("The synthetic HEAD entry has no ref filter of its own.")
      return
    }
    if (!capabilities().extendedLog) {
      setMutationNotice("This server does not support ref filters yet.")
      return
    }
    applyHistoryFilter({ ...filters(), refs: [canonical] })
  }

  function handleRefMenuAction(ref: GitRef, action: string): void {
    setRefMenu(undefined)
    switch (action) {
      case "view-history":
        viewRefHistory(ref)
        break
      case "checkout":
        openCheckoutDialog(ref)
        break
      case "copy-name":
        void copyText(ref.name, ref.kind === "tag" ? "Tag name" : "Branch name")
        break
      case "create-branch": {
        const suggested =
          ref.kind === "remote" ? ref.name.split("/").slice(1).join("/") : ""
        openCreateBranchDialog(ref.hash, `${refKindLabel(ref.kind)} ${ref.name}`, suggested)
        break
      }
      case "rename-branch":
        openRenameBranchDialog(ref)
        break
      case "delete-branch":
        openDeleteBranchDialog(ref)
        break
      case "delete-tag":
        openDeleteTagDialog(ref)
        break
    }
  }

  function handleCommitMenuAction(commit: GitCommit, action: string): void {
    setCommitMenu(undefined)
    switch (action) {
      case "view-changes":
        selectCommit(commit)
        break
      case "copy-hash":
        void copyText(commit.hash, "Commit hash")
        break
      case "copy-subject":
        void copyText(commit.subject, "Commit subject")
        break
      case "select-compare":
        selectComparisonBase(commit)
        break
      case "compare-selected": {
        const base = comparisonBase()
        if (base) void openComparison(base, commit)
        break
      }
      case "create-branch":
        openCreateBranchDialog(commit.hash, `commit ${shortHash(commit.hash)}`)
        break
      case "create-tag":
        openCreateTagDialog(commit.hash, `commit ${shortHash(commit.hash)}`)
        break
    }
  }

  function selectComparisonBase(commit: GitCommit): void {
    if (!capabilities().comparison) {
      setMutationNotice("This server does not support commit comparisons yet.")
      return
    }
    closeMenus()
    setActiveComparison(undefined)
    setComparisonBase(fullCommit(commit))
    setMutationNotice(
      `Selected ${shortHash(commit.hash)} as the comparison base. Ctrl/Cmd+click another commit, or use its context menu.`,
    )
  }

  function handleCompareActivate(commit: GitCommit): void {
    if (!capabilities().comparison) {
      setMutationNotice("This server does not support commit comparisons yet.")
      return
    }
    const decision = decideCompareActivation({
      ...(comparisonBase() ? { explicitBase: comparisonBase() } : {}),
      ...(selectedCommit() ? { selectedCommit: selectedCommit() } : {}),
      target: commit,
    })
    if (decision.kind === "select-base") {
      selectComparisonBase(decision.commit)
      return
    }
    if (decision.kind === "same") {
      if (decision.explicitBase) setComparisonBase(undefined)
      setMutationNotice(
        "The comparison base and target are the same commit; the inline selection was kept.",
      )
      return
    }
    // Base → head order is preserved: explicit context base, else the inline
    // selected/expanded commit, and the newly Ctrl/Cmd-clicked commit is head.
    void openComparison(decision.base, fullCommit(decision.head))
  }

  async function openComparison(base: GitCommit, head: GitCommit): Promise<void> {
    if (!capabilities().comparison) return
    const repositoryId = selectedRepositoryId()
    if (!repositoryId) return
    closeMenus()
    selectionGeneration.bump()
    const { route } = currentRpc()
    // Keep the expanded commit/parent/slot state alive (hidden by the
    // comparison page) and restore the same vertical position on Back.
    pendingViewRestore = {
      key: selectionKey(route.serverId, route.directory),
      repositoryId,
      commitHash: selectedCommit()?.hash,
      generation: selectionGeneration.current(),
      scrollTop: scroller ? scroller.scrollTop : scrollTop(),
    }
    cancelRestoreFrame()
    setCommitDiffOpen(false)
    setComparisonBase(undefined)
    setComparisonFiles([])
    setComparisonFilesLoading(true)
    setComparisonFilesError(undefined)
    setComparisonPath(undefined)
    setComparisonDiff(undefined)
    setComparisonDiffError(undefined)
    setActiveComparison({ base, head })
    await loadComparisonFiles(repositoryId, base, head)
  }

  function comparisonStillActive(base: GitCommit, head: GitCommit): boolean {
    const active = activeComparison()
    return active?.base.hash === base.hash && active.head.hash === head.hash
  }

  async function loadComparisonFiles(
    repositoryId: string,
    base: GitCommit,
    head: GitCommit,
  ): Promise<void> {
    const { route, rpc } = currentRpc()
    const { directory } = route
    const key = selectionKey(route.serverId, route.directory)
    if (!directory) return
    setComparisonFilesLoading(true)
    setComparisonFilesError(undefined)

    const result = await comparisonFilesRequest.run((signal) =>
      extendedClient(rpc).getComparisonFiles(
        { repositoryId, baseHash: base.hash, headHash: head.hash },
        requestOptions(directory, signal),
      ),
    )

    if (!result.accepted) {
      if (!result.aborted) {
        setComparisonFilesLoading(false)
        setComparisonFilesError(formatError(result.error))
      }
      return
    }
    if (
      key !== activeKey ||
      selectedRepositoryId() !== repositoryId ||
      !comparisonStillActive(base, head)
    ) {
      return
    }
    setComparisonFilesLoading(false)
    setComparisonFiles(result.value.files)
    const first = result.value.files[0]
    if (first) selectComparisonFile(first, base, head)
  }

  function selectComparisonFile(
    file: ChangedFile,
    base: GitCommit,
    head: GitCommit,
  ): void {
    setComparisonPath(file.path)
    setComparisonDiff(undefined)
    setComparisonDiffError(undefined)
    setComparisonDiffLoading(true)
    void loadComparisonDiff(file, base, head)
  }

  async function loadComparisonDiff(
    file: ChangedFile,
    base: GitCommit,
    head: GitCommit,
  ): Promise<void> {
    const repositoryId = selectedRepositoryId()
    if (!repositoryId) return
    const { route, rpc } = currentRpc()
    const { directory } = route
    const key = selectionKey(route.serverId, route.directory)
    if (!directory) return

    const result = await comparisonDiffRequest.run((signal) =>
      extendedClient(rpc).getComparisonDiff(
        {
          repositoryId,
          baseHash: base.hash,
          headHash: head.hash,
          path: file.path,
        },
        requestOptions(directory, signal),
      ),
    )

    if (!result.accepted) {
      if (!result.aborted) {
        setComparisonDiffLoading(false)
        setComparisonDiffError(formatError(result.error))
      }
      return
    }
    if (
      key !== activeKey ||
      selectedRepositoryId() !== repositoryId ||
      !comparisonStillActive(base, head) ||
      comparisonPath() !== file.path
    ) {
      return
    }
    setComparisonDiffLoading(false)
    setComparisonDiff(result.value)
  }

  function closeComparison(): void {
    if (pendingViewRestore) {
      pendingViewRestore.generation = selectionGeneration.current()
    }
    clearComparisonState()
    setComparisonBase(undefined)
    // The history section is reinserted by this state change; wait for the
    // spacer/slot layout before applying the captured vertical offset.
    scheduleViewRestore()
  }

  function retryComparisonFiles(): void {
    const active = activeComparison()
    const repositoryId = selectedRepositoryId()
    if (active && repositoryId) {
      void loadComparisonFiles(repositoryId, active.base, active.head)
    }
  }

  function retryComparisonDiff(): void {
    const active = activeComparison()
    const path = comparisonPath()
    const file = comparisonFiles().find((entry) => entry.path === path)
    if (active && file) void loadComparisonDiff(file, active.base, active.head)
  }

  function dialogExpectedHead(): string | null {
    return status()?.head ?? null
  }

  function openCheckoutDialog(ref: GitRef): void {
    if (mutationBusy()) return
    if (!capabilities().checkout) return
    const current = status()
    if (current && !current.detached && current.branch === ref.name) {
      setMutationNotice(`Already on ${ref.name}. Nothing was changed.`)
      return
    }
    closeMenus()
    setBranchSelectorOpen(false)
    setMutationError(undefined)
    setMutationWarning(undefined)
    const blocked = current
      ? checkoutBlockedReason(current, ref.name)
      : "Status has not loaded yet. Refresh before checking out."
    setMutationDialog({
      kind: "checkout",
      branch: ref.name,
      expectedHead: dialogExpectedHead(),
      ...(blocked ? { blocked } : {}),
    })
  }

  function openCreateBranchDialog(
    startPoint: string,
    startLabel: string,
    suggestedName = "",
  ): void {
    if (mutationBusy()) return
    if (!capabilities().createBranch) return
    closeMenus()
    setMutationError(undefined)
    setMutationWarning(undefined)
    setMutationDialog({
      kind: "create-branch",
      name: suggestedName,
      startPoint,
      startLabel,
      expectedHead: dialogExpectedHead(),
    })
  }

  function openCreateTagDialog(target: string, targetLabel: string): void {
    if (mutationBusy()) return
    if (!capabilities().createTag) return
    closeMenus()
    setMutationError(undefined)
    setMutationWarning(undefined)
    setMutationDialog({
      kind: "create-tag",
      name: "",
      target,
      targetLabel,
      message: "",
      expectedHead: dialogExpectedHead(),
    })
  }

  function openRenameBranchDialog(ref: GitRef): void {
    if (mutationBusy()) return
    if (!capabilities().renameBranch) return
    closeMenus()
    setMutationError(undefined)
    setMutationDialog({
      kind: "rename-branch",
      oldName: ref.name,
      newName: ref.name,
      expectedHead: dialogExpectedHead(),
    })
  }

  function openDeleteBranchDialog(ref: GitRef): void {
    if (mutationBusy()) return
    if (!capabilities().deleteBranch) return
    closeMenus()
    setMutationError(undefined)
    setMutationDialog({
      kind: "delete-branch",
      name: ref.name,
      expectedHead: dialogExpectedHead(),
    })
  }

  function openDeleteTagDialog(ref: GitRef): void {
    if (mutationBusy()) return
    if (!capabilities().deleteTag) return
    closeMenus()
    setMutationError(undefined)
    setMutationDialog({
      kind: "delete-tag",
      name: ref.name,
      expectedHead: dialogExpectedHead(),
    })
  }

  function updateDialogField(id: string, value: string): void {
    setMutationDialog((previous) => {
      if (!previous) return previous
      switch (previous.kind) {
        case "create-branch":
          return id === "name" ? { ...previous, name: value } : previous
        case "create-tag":
          if (id === "name") return { ...previous, name: value }
          if (id === "message") return { ...previous, message: value }
          return previous
        case "rename-branch":
          return id === "new-name" ? { ...previous, newName: value } : previous
        default:
          return previous
      }
    })
  }

  function mutationErrorText(error: unknown): string {
    const message = formatError(error)
    if (typeof error !== "object" || error === null) return message
    const type = (error as { readonly type?: unknown }).type
    const data = (error as { readonly data?: { readonly reason?: unknown } }).data
    const reason = data?.reason
    const detail = [type, reason]
      .filter((part): part is string => typeof part === "string" && part.length > 0)
      .join(" / ")
    return detail ? `${message} (${detail})` : message
  }

  /**
   * Rename/delete remove the ref a filter points at. Update the stored filter
   * before the first refresh so the new getLog request cannot be invalid.
   */
  function reconcileFilterForMutation(dialog: MutationDialogState): boolean {
    const current = filters()
    if (current.refs.length === 0) return false
    const next = reconcileRefFilter(
      current.refs,
      dialog.kind === "rename-branch"
        ? {
            kind: "rename-branch",
            oldName: dialog.oldName,
            newName: dialog.newName.trim(),
          }
        : dialog.kind === "delete-branch"
          ? { kind: "delete-branch", name: dialog.name }
          : dialog.kind === "delete-tag"
            ? { kind: "delete-tag", name: dialog.name }
            : { kind: dialog.kind },
    )
    if (
      next.length === current.refs.length &&
      next.every((ref, index) => ref === current.refs[index])
    ) {
      return false
    }
    setFilters({ ...current, refs: next })
    return true
  }

  /**
   * After the refreshed typed refs land, drop any remaining stale names.
   * A failed refs read falls back to All rather than keeping a per-repo filter
   * that cannot be validated.
   */
  async function reconcileFilterWithTypedRefs(repositoryId: string): Promise<void> {
    if (selectedRepositoryId() !== repositoryId) return
    const current = filters()
    if (current.refs.length === 0) return
    if (refsLoading()) return
    if (refsError()) {
      setFilters({ ...current, refs: [] })
      await loadHistoryFirstPage(repositoryId)
      return
    }
    const next = filterRefsToAvailable(current.refs, refs())
    if (next.length === current.refs.length) return
    setFilters({ ...current, refs: next })
    await loadHistoryFirstPage(repositoryId)
  }

  async function confirmMutation(): Promise<void> {
    const dialog = mutationDialog()
    const repositoryId = selectedRepositoryId()
    if (!dialog || !repositoryId || mutationBusy()) return
    if (dialog.kind === "checkout" && dialog.blocked) {
      setMutationError(dialog.blocked)
      return
    }

    const { route, rpc } = currentRpc()
    const { directory } = route
    if (!directory) return
    const client = extendedClient(rpc)
    const options = { location: { directory } }
    const scopeKey = selectionKey(route.serverId, route.directory)
    const repositoryLabel = selectedRepository()?.name ?? repositoryId
    const mutationToken = mutationGeneration.bump()
    const scopeStillCurrent = (): boolean => {
      const now = currentRpc()
      return (
        mutationGeneration.isCurrent(mutationToken) &&
        selectionKey(now.route.serverId, now.route.directory) === scopeKey &&
        selectedRepositoryId() === repositoryId &&
        mutationDialog() === dialog
      )
    }

    setMutationBusy(true)
    setMutationError(undefined)

    try {
      let result: MutationResult
      switch (dialog.kind) {
        case "checkout": {
          if (status() && !status()!.detached && status()!.branch === dialog.branch) {
            setMutationBusy(false)
            setMutationDialog(undefined)
            setMutationNotice(`Already on ${dialog.branch}. Nothing was changed.`)
            return
          }
          result = await client.checkoutBranch(
            {
              repositoryId,
              branch: dialog.branch,
              expectedHead: dialog.expectedHead,
              confirmed: true,
            },
            options,
          )
          break
        }
        case "create-branch": {
          const name = dialog.name.trim()
          if (!name) {
            setMutationBusy(false)
            setMutationError("A branch name is required.")
            return
          }
          result = await client.createBranch(
            {
              repositoryId,
              name,
              startPoint: dialog.startPoint,
              expectedHead: dialog.expectedHead,
              confirmed: true,
            },
            options,
          )
          break
        }
        case "create-tag": {
          const name = dialog.name.trim()
          if (!name) {
            setMutationBusy(false)
            setMutationError("A tag name is required.")
            return
          }
          const message = dialog.message.trim()
          result = await client.createTag(
            {
              repositoryId,
              name,
              target: dialog.target,
              expectedHead: dialog.expectedHead,
              ...(message ? { message } : {}),
              confirmed: true,
            },
            options,
          )
          break
        }
        case "rename-branch": {
          const newName = dialog.newName.trim()
          if (!newName) {
            setMutationBusy(false)
            setMutationError("A new branch name is required.")
            return
          }
          if (!client.renameBranch) throw new Error("renameBranch is unavailable")
          result = await client.renameBranch(
            {
              repositoryId,
              oldName: dialog.oldName,
              newName,
              expectedHead: dialog.expectedHead,
              confirmed: true,
            },
            options,
          )
          break
        }
        case "delete-branch": {
          if (!client.deleteBranch) throw new Error("deleteBranch is unavailable")
          result = await client.deleteBranch(
            {
              repositoryId,
              name: dialog.name,
              expectedHead: dialog.expectedHead,
              confirmed: true,
            },
            options,
          )
          break
        }
        case "delete-tag": {
          if (!client.deleteTag) throw new Error("deleteTag is unavailable")
          result = await client.deleteTag(
            {
              repositoryId,
              name: dialog.name,
              expectedHead: dialog.expectedHead,
              confirmed: true,
            },
            options,
          )
          break
        }
      }

      if (!scopeStillCurrent()) {
        setMutationBusy(false)
        setMutationNotice(
          `The write completed for ${repositoryLabel}, but this view now shows another repository or dialog. Its result was not applied; refresh the current view.`,
        )
        return
      }

      // Rename/delete must not leave the history filter pointing at a dead ref.
      reconcileFilterForMutation(dialog)
      setMutationWarning(result.warning)
      setStatus(result.status)
      if (result.changed || result.warning) {
        // Clear the old list/refs before the refresh so a partial result can
        // never be mistaken for the new state. This reload also refreshes refs.
        setCommits([])
        setRefs([])
        setHasMore(false)
        setNextSkip(0)
        await loadRepository(repositoryId, undefined, { awaitRefs: true })
        await reconcileFilterWithTypedRefs(repositoryId)
      } else {
        await loadRefs(repositoryId)
      }
      if (!scopeStillCurrent()) {
        setMutationBusy(false)
        setMutationNotice(
          `The write completed for ${repositoryLabel}, but this view moved while refreshing. Its result was not applied to the new view.`,
        )
        return
      }
      if (!status()) setStatus(result.status)
      setMutationBusy(false)
      setMutationDialog(undefined)
      setMutationError(undefined)
      maybeAutoLoad()
    } catch (error) {
      setMutationBusy(false)
      if (!scopeStillCurrent()) {
        setMutationNotice(
          `The write for ${repositoryLabel} finished after the view changed. Refresh the current repository to see its state; nothing was retried automatically.`,
        )
        return
      }
      setMutationError(
        `${mutationErrorText(error)} Refresh to see the current state; nothing was retried automatically.`,
      )
    }
  }

  const refMenuItems = (): MenuAction[] => {
    const state = refMenu()
    return state
      ? refMenuActions(
          state.ref,
          status()?.branch ?? selectedRepository()?.branch ?? null,
          capabilities(),
        )
      : []
  }

  const overflowMenuItems = (): MenuAction[] =>
    (overflowMenu()?.badges ?? []).map((badge, index) => ({
      id: `ref:${index}`,
      label: `${refKindLabel(badge.kind)}: ${badge.name}`,
    }))

  const commitMenuItems = (): MenuAction[] => {
    const state = commitMenu()
    return state
      ? commitMenuActions(state.commit, {
          ...(comparisonBase() ? { compareBase: comparisonBase() } : {}),
          capabilities: capabilities(),
        })
      : []
  }

  function handleOverflowMenuAction(id: string): void {
    const state = overflowMenu()
    setOverflowMenu(undefined)
    if (!state) return
    const index = Number(id.replace(/^ref:/, ""))
    const badge = state.badges[index]
    if (!badge) return
    const ref = typedRefForBadge(refs(), badge)
    if (!ref) {
      void copyText(badge.name, "Ref name")
      return
    }
    setRefMenu({ ref, x: state.x, y: state.y })
  }

  function handlePanelKeyDown(event: KeyboardEvent): void {
    const modifier = event.ctrlKey || event.metaKey
    const target = event.target
    const editable =
      target instanceof HTMLElement &&
      (target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable)

    if (modifier && event.key.toLowerCase() === "f") {
      event.preventDefault()
      searchInput?.focus()
      searchInput?.select()
      return
    }
    if (modifier && event.key.toLowerCase() === "r") {
      event.preventDefault()
      refreshAll()
      return
    }
    if (modifier && event.key.toLowerCase() === "h") {
      event.preventDefault()
      void jumpToHead()
      return
    }
    if (event.key === "Escape") {
      if (refMenu() || overflowMenu() || commitMenu()) {
        event.preventDefault()
        closeMenus()
        return
      }
      if (branchSelectorOpen()) {
        event.preventDefault()
        setBranchSelectorOpen(false)
        return
      }
      if (activeComparison()) {
        event.preventDefault()
        closeComparison()
        return
      }
      if (commitDiffOpen()) {
        event.preventDefault()
        closeCommitDiff()
        return
      }
      return
    }
    if (editable) return
  }

  function handleRowKeyDown(commit: GitCommit, event: KeyboardEvent): void {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      if (isCompareModifier(event)) handleCompareActivate(commit)
      else toggleCommit(commit)
    } else if (event.key === "F10" && event.shiftKey) {
      event.preventDefault()
      openCommitMenu(commit, event as unknown as MouseEvent)
    }
  }

  function activateRow(commit: GitCommit, event: MouseEvent): void {
    if (isCompareModifier(event)) {
      event.preventDefault()
      handleCompareActivate(commit)
      return
    }
    setComparisonBase(undefined)
    toggleCommit(commit)
  }

  const selectedFileForStatus = (file: ChangedFile): boolean => {
    const selection = selectedFile()
    if (!selection) return false
    return (
      selection.path === file.path &&
      selection.target.type === statusFileTarget(file).type
    )
  }

  createEffect(() => {
    const route = sessionRoute(props.panel.session)
    const key = selectionKey(route.serverId, route.directory)
    if (key === activeKey) return

    if (activeKey) {
      selectionCache.set(activeKey, untrack(() => captureSelection()))
    }
    activeKey = key
    pendingRestore = selectionCache.get(key)
    const restoreToken = selectionGeneration.current()
    resetAll()
    if (!route.directory) return
    void refreshRepositories(false, pendingRestore, restoreToken)
  })

  onCleanup(() => {
    resizeObserver?.disconnect()
    panelObserver?.disconnect()
    resizeDragCleanup?.()
    cancelRestoreFrame()
    cancelAutoLoadSettle()
    if (activeKey) selectionCache.set(activeKey, untrack(() => captureSelection()))
    repositoriesRequest.dispose()
    graphRequest.dispose()
    filesRequest.dispose()
    diffRequest.dispose()
    refsRequest.dispose()
    comparisonFilesRequest.dispose()
    comparisonDiffRequest.dispose()
    fileContentRequest.dispose()
  })

  return (
    <div
      class="git-graph-panel"
      ref={(element) => attachPanel(element)}
      onKeyDown={(event) => handlePanelKeyDown(event)}
    >
      <style>{GG_STYLES}</style>

      <header class="gg-toolbar">
        <select
          class="gg-repo-select"
          aria-label="Repository"
          data-testid="repository-select"
          title={selectedRepository()?.rootPath ?? "Repository"}
          value={selectedRepositoryId() ?? ""}
          disabled={busy()}
          onChange={(event) => chooseRepository(event.currentTarget.value)}
        >
          <Show when={repositories().length === 0}>
            <option value="">No repositories</option>
          </Show>
          <For each={repositoryOptions()}>
            {(option) => <option value={option.repository.id}>{option.label}</option>}
          </For>
        </select>

        <button
          type="button"
          class={busy() ? "gg-icon-button gg-spin" : "gg-icon-button"}
          data-testid="refresh"
          aria-label="Refresh"
          title="Refresh"
          disabled={busy()}
          onClick={() => refreshAll()}
        >
          <RefreshIcon />
        </button>

        <Show when={selectedRepository()}>
          <button
            type="button"
            class={detached() ? "gg-branch gg-branch-detached" : "gg-branch"}
            data-testid="current-branch"
            aria-label={`Current branch: ${branchLabel()}`}
            aria-haspopup="dialog"
            title={`Current branch: ${branchLabel()} — open Branches`}
            disabled={busy()}
            onClick={() => {
              closeMenus()
              setBranchSelectorOpen(true)
            }}
          >
            <BranchIcon />
            <span class="gg-branch-name">{branchLabel()}</span>
            <Show when={detached()}>
              <span class="gg-badge-detached">detached</span>
            </Show>
          </button>
        </Show>

        <label
          class="gg-toolbar-toggle gg-toolbar-check"
          title="Walk remote-tracking branches in All mode"
        >
          <input
            type="checkbox"
            data-testid="show-remotes"
            aria-label="Show remote branches"
            checked={filters().showRemotes}
            disabled={!selectedRepositoryId() || !capabilities().extendedLog || busy()}
            onChange={() => toggleShowRemotes()}
          />
          <span>Remotes</span>
        </label>
        <label
          class="gg-toolbar-toggle gg-toolbar-check"
          title="Walk tags in All mode"
        >
          <input
            type="checkbox"
            data-testid="show-tags"
            aria-label="Show tags"
            checked={filters().showTags}
            disabled={!selectedRepositoryId() || !capabilities().extendedLog || busy()}
            onChange={() => toggleShowTags()}
          />
          <span>Tags</span>
        </label>
        <label
          class="gg-toolbar-toggle gg-toolbar-check"
          title="Follow only first parents; merge details keep every parent"
        >
          <input
            type="checkbox"
            data-testid="first-parent"
            aria-label="First parent only"
            checked={firstParent()}
            disabled={!selectedRepositoryId() || !capabilities().extendedLog || busy()}
            onChange={() => toggleFirstParent()}
          />
          <span>First parent</span>
        </label>
        <label class="gg-toolbar-order" title="History order">
          <span class="gg-sr-only">History order</span>
          <select
            data-testid="history-order"
            aria-label="History order"
            value={historyOrder()}
            disabled={!selectedRepositoryId() || !capabilities().extendedLog || busy()}
            onChange={(event) =>
              chooseHistoryOrder(event.currentTarget.value === "topo" ? "topo" : "date")
            }
          >
            <option value="date">Date</option>
            <option value="topo">Topo</option>
          </select>
        </label>
        <button
          type="button"
          class="gg-toolbar-toggle"
          data-testid="jump-head"
          aria-label="Jump to HEAD"
          title="Jump to the current HEAD commit"
          disabled={!selectedRepositoryId() || !status()?.head || busy()}
          onClick={() => void jumpToHead()}
        >
          HEAD
        </button>

        <div class="gg-search">
          <SearchIcon />
          <input
            ref={(element) => {
              searchInput = element
            }}
            type="search"
            data-testid="search-commits"
            aria-label="Search commits"
            placeholder="Search loaded commits"
            value={searchQuery()}
            disabled={!selectedRepositoryId()}
            title="Search loaded commits (Enter jumps to the first match)"
            onInput={(event) => setSearchQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                jumpToFirstMatch()
              } else if (event.key === "Escape") {
                setSearchQuery("")
              }
            }}
          />
          <Show when={searchQuery().length > 0}>
            <button
              type="button"
              class="gg-search-clear"
              aria-label="Clear search"
              title="Clear search"
              onClick={() => setSearchQuery("")}
            >
              ×
            </button>
          </Show>
        </div>
      </header>

      <Show when={jumpNotice()}>
        {(text) => (
          <div class="gg-mutation-status gg-mutation-notice" data-testid="jump-notice">
            <span>{text()}</span>
            <button type="button" aria-label="Dismiss" onClick={() => setJumpNotice(undefined)}>
              ×
            </button>
          </div>
        )}
      </Show>
      <Show when={mutationWarning()}>
        {(text) => (
          <div class="gg-mutation-status gg-mutation-warning" data-testid="mutation-warning">
            <span>{text()}</span>
            <button
              type="button"
              aria-label="Dismiss warning"
              onClick={() => setMutationWarning(undefined)}
            >
              ×
            </button>
          </div>
        )}
      </Show>
      <Show when={mutationNotice()}>
        {(text) => (
          <div class="gg-mutation-status gg-mutation-notice" data-testid="mutation-notice">
            <span>{text()}</span>
            <button
              type="button"
              aria-label="Dismiss notice"
              onClick={() => setMutationNotice(undefined)}
            >
              ×
            </button>
          </div>
        )}
      </Show>
      <Show when={refsError()}>
        {(message) => (
          <div class="gg-mutation-status gg-mutation-warning" data-testid="refs-error">
            <span>Refs could not be loaded: {message()}</span>
            <button
              type="button"
              onClick={() => {
                const repositoryId = selectedRepositoryId()
                if (repositoryId) void loadRefs(repositoryId)
              }}
            >
              Retry
            </button>
          </div>
        )}
      </Show>

      <Show when={repositoriesLoading()}>
        <div class="gg-status">Loading repositories…</div>
      </Show>
      <Show when={repositoriesError()}>
        {(message) => (
          <div class="gg-error">
            <span>{message()}</span>
            <button type="button" disabled={busy()} onClick={() => refreshAll()}>
              Retry
            </button>
          </div>
        )}
      </Show>
      <Show
        when={
          !repositoriesLoading() &&
          !repositoriesError() &&
          !selectedRepositoryId() &&
          repositories().length === 0
        }
      >
        <div class="gg-empty">
          {directoryReady()
            ? "No Git repositories found below this session directory."
            : "Waiting for the session directory…"}
        </div>
      </Show>

      <Show when={selectedRepositoryId() && !commitDiffOpen() && !activeComparison()}>
        <section class="gg-changes-section" data-testid="changes" aria-label="Working tree changes">
          <Show
            when={status()}
            fallback={
              <Show when={repositoryLoading()}>
                <div class="gg-status">Loading repository…</div>
              </Show>
            }
          >
            {(current) => (
              <Show
                when={current().files.length > 0}
                fallback={
                  <div class="gg-working-tree-clean">
                    <span class="gg-clean-dot" aria-hidden="true" />
                    <span>Working tree clean</span>
                  </div>
                }
              >
                <button
                  type="button"
                  class="gg-changes-head"
                  aria-expanded={changesExpanded()}
                  onClick={() => setChangesExpanded((value) => !value)}
                >
                  <span class="gg-caret" aria-hidden="true">
                    {changesExpanded() ? "▾" : "▸"}
                  </span>
                  <span>Changes</span>
                  <span class="gg-count-badge">{current().files.length}</span>
                  <span class="gg-changes-summary">
                    {current().counts.staged} staged · {current().counts.unstaged} unstaged ·{" "}
                    {current().counts.untracked} untracked · {current().counts.conflicted} conflicted
                  </span>
                </button>
                <Show when={changesExpanded()}>
                  <div class="gg-changes-body">
                    <StatusGroupSection
                      title="Staged"
                      files={groups().staged}
                      disabled={busy()}
                      expanded={groupExpanded("staged")}
                      onToggle={() => toggleGroup("staged")}
                      isSelected={selectedFileForStatus}
                      onSelect={selectStatusFile}
                    />
                    <StatusGroupSection
                      title="Unstaged"
                      files={groups().unstaged}
                      disabled={busy()}
                      expanded={groupExpanded("unstaged")}
                      onToggle={() => toggleGroup("unstaged")}
                      isSelected={selectedFileForStatus}
                      onSelect={selectStatusFile}
                    />
                    <StatusGroupSection
                      title="Untracked"
                      files={groups().untracked}
                      disabled={busy()}
                      expanded={groupExpanded("untracked")}
                      onToggle={() => toggleGroup("untracked")}
                      isSelected={selectedFileForStatus}
                      onSelect={selectStatusFile}
                    />
                    <StatusGroupSection
                      title="Conflicted"
                      files={groups().conflicted}
                      disabled={busy()}
                      expanded={groupExpanded("conflicted")}
                      onToggle={() => toggleGroup("conflicted")}
                      isSelected={selectedFileForStatus}
                      onSelect={selectStatusFile}
                    />
                  </div>
                </Show>
              </Show>
            )}
          </Show>
          <Show when={repositoryError()}>
            {(message) => (
              <div class="gg-error">
                <span>{message()}</span>
                <button type="button" disabled={busy()} onClick={() => refreshAll()}>
                  Retry
                </button>
              </div>
            )}
          </Show>
        </section>

        <section
          class="gg-history"
          data-testid="history"
          aria-label="History"
          style={historyStyle()}
        >
          <div class="gg-history-head">
            <For each={resolvedColumns().visible}>
              {(column) => (
                <div
                  class={
                    column === "graph"
                      ? "gg-col-head gg-col-graph-head"
                      : `gg-col-head gg-col-head-${column}`
                  }
                >
                  <span>{columnLabel(column)}</span>
                  <button
                    type="button"
                    class={column === "graph" ? "gg-column-resize gg-graph-resize" : "gg-column-resize"}
                    data-testid={`resize-column-${column}`}
                    aria-label={`Resize ${column} column`}
                    title={`Drag to resize ${column} column`}
                    onPointerDown={(event) => startColumnResize(column, event)}
                  />
                </div>
              )}
            </For>
          </div>

          <Show when={denseGraph()}>
            <div class="gg-dense-graph" data-testid="dense-graph">
              <span>
                {maxLanes()} lanes; narrow columns hide branches on the right. Drag the column
                wider to reveal them.
              </span>
              <button
                type="button"
                onClick={() => {
                  closeMenus()
                  setBranchSelectorOpen(true)
                }}
              >
                Filter branches…
              </button>
            </div>
          </Show>

          <div
            class="gg-history-scroll"
            data-testid="history-scroll"
            ref={(element) => attachScroller(element)}
            onScroll={(event) => {
              const element = event.currentTarget
              setScrollTop(element.scrollTop)
              // Keep the virtual window honest even when ResizeObserver is
              // frozen in a background host tab.
              if (element.clientHeight > 0 && element.clientHeight !== viewportHeight()) {
                setViewportHeight(element.clientHeight)
              }
              maybeAutoLoad(element)
            }}
          >
            <Show
              when={rows().length > 0}
              fallback={
                <div class="gg-empty">
                  {repositoryLoading()
                    ? "Loading commits…"
                    : graphError()
                      ? "Graph layout failed. See the error below."
                      : commits().length === 0
                        ? "No commits (empty repository)."
                        : "No rows to show."}
                </div>
              }
            >
              <div
                class="gg-history-spacer"
                style={{ height: `${rowLayout().totalHeight}px` }}
                data-slot-height={rowLayout().slotHeight}
                data-expanded-index={
                  expandedRowIndex() === undefined ? undefined : expandedRowIndex()
                }
              >
                <For each={visibleRows()}>
                  {(view) => (
                    <GraphRow
                      view={view}
                      laneSpacing={laneSpacing()}
                      graphWidth={graphWidth()}
                      rowHeight={ROW_HEIGHT}
                      top={rowLayout().rowTop(view.index)}
                      selected={selectedCommit()?.hash === view.commit.hash}
                      expanded={
                        selectedCommit()?.hash === view.commit.hash &&
                        expandedRowIndex() !== undefined
                      }
                      disabled={busy()}
                      searchState={searchState(view.commit.hash)}
                      showDate={resolvedColumns().visibility.date}
                      showAuthor={resolvedColumns().visibility.author}
                      maxRefs={maxRefs()}
                      refs={refs()}
                      compareBase={comparisonBase()?.hash === view.commit.hash}
                      onSelect={(event) => activateRow(view.commit, event)}
                      onRefMenu={(badge, event) => openRefMenu(badge, event)}
                      onOverflowMenu={(badges, event) => openOverflowMenu(badges, event)}
                      onContextMenu={(event) => openCommitMenu(view.commit, event)}
                      onKeyDown={(event) => handleRowKeyDown(view.commit, event)}
                    />
                  )}
                </For>

                <Show when={expandedRow()}>
                  {(row) => (
                    <CommitFilesSlot
                      top={rowLayout().slotTop ?? 0}
                      height={rowLayout().slotHeight}
                      row={row()}
                      commit={selectedCommit()!}
                      graphWidth={graphWidth()}
                      columnWidth={graphColumnWidth()}
                      laneSpacing={laneSpacing()}
                      nodes={commitTree()}
                      files={commitFiles()}
                      fileCount={commitFiles().length}
                      expanded={expandedDirectories()}
                      selectedPath={inlineSelectedPath()}
                      view={inlineView()}
                      loading={filesLoading()}
                      error={filesError()}
                      disabled={busy()}
                      onToggle={toggleDirectory}
                      onSelect={(file) => {
                        const commit = selectedCommit()
                        if (commit) selectCommitFile(file, commit, selectedParentIndex())
                      }}
                      onViewChange={(view) => setInlineView(view)}
                      onViewAtCommit={(file) => {
                        const commit = selectedCommit()
                        if (commit) viewFileAtCommit(file, commit)
                      }}
                      onOpenCurrent={(file) => openCurrentWorkspaceFile(file)}
                      onRetry={() => {
                        const commit = selectedCommit()
                        if (commit) void loadCommitFiles(commit, selectedParentIndex())
                      }}
                    />
                  )}
                </Show>
              </div>
            </Show>
          </div>

          <div class="gg-history-footer">
            <span>{footerText()}</span>
            <Show when={hasMore()}>
              <button
                type="button"
                data-testid="load-more"
                disabled={loadingMore() || busy()}
                onClick={() => void loadMore(false)}
              >
                {loadingMore() ? "Loading…" : "Load more"}
              </button>
            </Show>
          </div>
          <Show when={historyError() || graphError()}>
            {(message) => (
              <div class="gg-error">
                <span>{message()}</span>
                <Show when={!graphError()}>
                  <button
                    type="button"
                    data-testid="retry-load-more"
                    disabled={loadingMore() || busy() || !hasMore()}
                    onClick={() => retryAutoLoad()}
                  >
                    Retry
                  </button>
                </Show>
              </div>
            )}
          </Show>
        </section>
      </Show>

      <Show when={activeComparison()}>
        {(comparison) => (
          <ComparisonView
            base={comparison().base}
            head={comparison().head}
            files={comparisonFiles()}
            filesLoading={comparisonFilesLoading()}
            filesError={comparisonFilesError()}
            selectedPath={comparisonPath()}
            diff={comparisonDiff()}
            diffLoading={comparisonDiffLoading()}
            diffError={comparisonDiffError()}
            orientation={detailsOrientation()}
            onSelectFile={(file) =>
              selectComparisonFile(file, comparison().base, comparison().head)
            }
            onRetryFiles={() => retryComparisonFiles()}
            onRetryDiff={() => retryComparisonDiff()}
            onBack={() => closeComparison()}
          />
        )}
      </Show>

      <Show when={detailsVisible()}>
        <section class="gg-details" data-testid="commit-details" aria-label="Commit details">
          <div class="gg-details-head">
            <div class="gg-details-title">
              <span class="gg-details-subject" title={selectedFile()?.path}>
                {selectedFile()?.path}
              </span>
              <span class="gg-details-hash">{selectedFile()?.source}</span>
            </div>
            <div class="gg-details-actions">
              <button
                type="button"
                class="gg-icon-button"
                data-testid="close-details"
                aria-label="Close details"
                title="Close details"
                onClick={() => closeDetails()}
              >
                ×
              </button>
            </div>
          </div>

          <div class={detailsBodyClass()}>
            <div class="gg-details-diff" data-testid="diff" aria-label="Diff">
              <Show
                when={selectedFile()}
                fallback={
                  <div class="gg-diff-placeholder">Select a file to view its diff.</div>
                }
              >
                {(selection) => (
                  <>
                    <div class="gg-diff-header">
                      <span class="gg-diff-path" title={selection().path}>
                        {selection().path}
                      </span>
                      <Show when={diff()}>
                        {(fileDiff) => (
                          <>
                            <span class="gg-diff-tag">{fileDiff().status}</span>
                            <Show when={fileDiff().oldPath}>
                              <span class="gg-diff-tag">from {fileDiff().oldPath}</span>
                            </Show>
                          </>
                        )}
                      </Show>
                      <span class="gg-diff-tag">{selection().target.type}</span>
                    </div>

                    <Show when={diffLoading()}>
                      <div class="gg-status">Loading diff…</div>
                    </Show>
                    <Show when={diffError()}>
                      {(message) => (
                        <div class="gg-error">
                          <span>{message()}</span>
                          <button
                            type="button"
                            disabled={busy()}
                            onClick={() => void loadDiff(selection())}
                          >
                            Retry
                          </button>
                        </div>
                      )}
                    </Show>

                    <Show when={diff()}>
                      {(fileDiff) => (
                        <>
                          <Show when={fileDiff().binary}>
                            <div class="gg-warning">
                              Binary file. No textual diff is available.
                            </div>
                          </Show>
                          <Show when={fileDiff().truncated}>
                            <div class="gg-warning">
                              Diff truncated by the server: this file is larger than the readable
                              limit. The text below is incomplete.
                            </div>
                          </Show>
                          <Show when={!fileDiff().binary && fileDiff().text.length > 0}>
                            <div class="gg-diff-scroll">
                              <div class="gg-diff">
                                <For each={visibleDiffLines()}>
                                  {(line: DiffLine) => (
                                    <div class={`gg-diff-line gg-diff-${line.kind}`}>
                                      {line.text.length > 0 ? line.text : " "}
                                    </div>
                                  )}
                                </For>
                              </div>
                            </div>
                            <Show when={diffLines().length > MAX_DIFF_DISPLAY_LINES}>
                              <div class="gg-notice">
                                Showing the first {MAX_DIFF_DISPLAY_LINES} of {diffLines().length}{" "}
                                diff lines.
                              </div>
                            </Show>
                          </Show>
                          <Show when={!fileDiff().binary && fileDiff().text.length === 0}>
                            <div class="gg-empty">No textual diff.</div>
                          </Show>
                        </>
                      )}
                    </Show>
                  </>
                )}
              </Show>
            </div>
          </div>
        </section>
      </Show>

      <Show when={commitDiffSelection()}>
        {(selection) => (
          <CommitDiffView
            commit={selection().commit}
            parentIndex={selectedParentIndex()}
            path={selection().path}
            diff={diff()}
            loading={diffLoading()}
            error={diffError()}
            onBack={() => closeCommitDiff()}
            onRetry={() => {
              const file = selectedFile()
              if (file) void loadDiff(file)
            }}
            onParentChange={(index) => changeDiffParent(index)}
          />
        )}
      </Show>

      <BranchSelector
        open={branchSelectorOpen()}
        repositoryLabel={
          selectedRepository()
            ? `${selectedRepository()!.name} — ${selectedRepository()!.rootPath}`
            : "Repository"
        }
        currentBranch={status()?.branch ?? selectedRepository()?.branch ?? null}
        detached={detached()}
        refs={refs()}
        loading={refsLoading()}
        error={refsError()}
        filters={filters()}
        capabilities={capabilities()}
        onApplyFilter={(next) => applyHistoryFilter(next)}
        onCheckout={(ref) => openCheckoutDialog(ref)}
        onClose={() => setBranchSelectorOpen(false)}
      />

      <ConfirmDialog
        open={mutationDialog() !== undefined}
        title={mutationDialogTitle()}
        description={mutationDialogDescription()}
        facts={mutationDialogFacts()}
        fields={mutationDialogFields()}
        warning={mutationDialogWarning()}
        error={mutationError()}
        busy={mutationBusy()}
        danger={mutationDialogDanger()}
        confirmLabel={mutationDialogConfirmLabel()}
        confirmTestId={
          mutationDialog()?.kind === "checkout" ? "checkout-confirm" : "confirm-action"
        }
        cancelTestId={
          mutationDialog()?.kind === "checkout" ? "checkout-cancel" : "confirm-cancel"
        }
        confirmDisabled={mutationDialogConfirmDisabled()}
        onFieldInput={(id, value) => updateDialogField(id, value)}
        onConfirm={() => void confirmMutation()}
        onCancel={() => {
          setMutationDialog(undefined)
          setMutationError(undefined)
        }}
      />

      <ContextMenu
        open={refMenu() !== undefined}
        x={refMenu()?.x ?? 0}
        y={refMenu()?.y ?? 0}
        title={
          refMenu()
            ? `${refKindLabel(refMenu()!.ref.kind)}: ${refMenu()!.ref.name}`
            : undefined
        }
        items={refMenuItems()}
        testId="ref-menu"
        ariaLabel="Ref actions"
        onSelect={(id) => {
          const state = refMenu()
          if (state) handleRefMenuAction(state.ref, id)
        }}
        onClose={() => setRefMenu(undefined)}
      />

      <ContextMenu
        open={overflowMenu() !== undefined}
        x={overflowMenu()?.x ?? 0}
        y={overflowMenu()?.y ?? 0}
        title="Refs on this commit"
        items={overflowMenuItems()}
        testId="ref-overflow-menu"
        ariaLabel="Refs on this commit"
        onSelect={(id) => handleOverflowMenuAction(id)}
        onClose={() => setOverflowMenu(undefined)}
      />

      <ContextMenu
        open={commitMenu() !== undefined}
        x={commitMenu()?.x ?? 0}
        y={commitMenu()?.y ?? 0}
        title={
          commitMenu()
            ? `${shortHash(commitMenu()!.commit.hash)} · ${commitMenu()!.commit.subject}`
            : undefined
        }
        items={commitMenuItems()}
        testId="commit-context-menu"
        ariaLabel="Commit actions"
        onSelect={(id) => {
          const state = commitMenu()
          if (state) handleCommitMenuAction(state.commit, id)
        }}
        onClose={() => setCommitMenu(undefined)}
      />

      <CommitFileContentView
        open={fileContentTarget() !== undefined}
        path={fileContentTarget()?.path ?? ""}
        hash={fileContentTarget()?.hash ?? ""}
        loading={fileContentLoading()}
        content={fileContent()}
        error={fileContentError()}
        onClose={() => closeFileContent()}
        onRetry={() => retryFileContent()}
      />
    </div>
  )
}
