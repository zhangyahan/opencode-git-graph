import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  untrack,
} from "solid-js"
import { type PanelProps } from "@opencode/plugin/gui"
import type {
  ChangedFile,
  FileDiff,
  GitCommit,
  GitRepository,
  GitStatus,
} from "../shared/types.js"
import { GitGraphRpc } from "../rpc.js"
import { buildCommitGraph } from "./graph.js"
import {
  DEFAULT_LANE_PADDING,
  DEFAULT_LANE_SPACING,
  graphContentWidth,
  graphLaneX,
  graphLinePath,
  graphRowLines,
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
  visibleRefCount,
} from "./history-columns.js"
import { formatCommitDate, formatRefLabel, refHue, shortHash } from "./format.js"
import { searchMatches } from "./search.js"
import { repositoryOptionLabel } from "./repository-label.js"
import {
  clampScrollOffset,
  maxScrollOffset,
} from "./scroll.js"

const PAGE_SIZE = 100
const ROW_HEIGHT = 28
const OVERSCAN = 6
const LANE_SPACING = DEFAULT_LANE_SPACING
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
  readonly graphScrollLeft: number
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
  switch (column) {
    case "graph":
      return "Graph"
    case "description":
      return "Description"
    case "date":
      return "Date"
    case "author":
      return "Author"
    case "commit":
      return "Commit"
  }
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
  readonly onSelect: () => void
}

function GraphRow(props: GraphRowProps) {
  const lines = () => graphRowLines(props.view.row, props.view.previous)
  const nodeX = () => graphLaneX(props.view.row.lane, props.laneSpacing, LANE_PADDING)

  return (
    <button
      type="button"
      class={[
        "gg-graph-row",
        props.selected ? "gg-selected" : "",
        props.expanded ? "gg-expanded" : "",
        props.searchState === "dim" ? "gg-search-dim" : "",
        props.searchState === "match" ? "gg-search-match" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ top: `${props.top}px`, height: `${props.rowHeight}px` }}
      disabled={props.disabled}
      onClick={() => props.onSelect()}
      title={props.view.commit.subject}
      data-commit={props.view.commit.hash}
      data-index={props.view.index}
      data-row-top={props.top}
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
        <For each={props.view.commit.refs.slice(0, props.maxRefs)}>
          {(ref) => (
            <span
              class="gg-ref-badge"
              style={`--gg-ref-hue:${refHue(ref)}`}
              title={ref}
            >
              {formatRefLabel(ref)}
            </span>
          )}
        </For>
        <Show when={props.view.commit.refs.length > props.maxRefs}>
          <span
            class="gg-ref-badge gg-ref-more"
            title={props.view.commit.refs.slice(props.maxRefs).join(", ")}
          >
            +{props.view.commit.refs.length - props.maxRefs}
          </span>
        </Show>
        <span class="gg-subject">{props.view.commit.subject || "(no subject)"}</span>
      </div>

      <Show when={props.showDate}>
        <div class="gg-col-date">{formatCommitDate(props.view.commit.authorDate)}</div>
      </Show>
      <Show when={props.showAuthor}>
        <div class="gg-col-author" title={props.view.commit.author}>
          {props.view.commit.author}
        </div>
      </Show>
      <div class="gg-col-commit" title={props.view.commit.hash}>
        <span class="gg-hash">{shortHash(props.view.commit.hash)}</span>
      </div>
    </button>
  )
}

/* ---------- inline commit file slot ---------- */

interface CommitFilesSlotProps {
  readonly top: number
  readonly height: number
  readonly row: GraphRowView["row"]
  readonly graphWidth: number
  readonly columnWidth: number
  readonly laneSpacing: number
  readonly nodes: readonly FileTreeNode[]
  readonly fileCount: number
  readonly expanded: ReadonlySet<string>
  readonly selectedPath: string | undefined
  readonly loading: boolean
  readonly error: string | undefined
  readonly disabled: boolean
  readonly onToggle: (path: string) => void
  readonly onSelect: (file: ChangedFile) => void
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
              <div class="gg-tree">
                <FileTree
                  nodes={props.nodes}
                  depth={0}
                  expanded={props.expanded}
                  selectedPath={props.selectedPath}
                  disabled={props.disabled}
                  onToggle={props.onToggle}
                  onSelect={props.onSelect}
                />
              </div>
            </Show>
          </Show>
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

interface FileTreeProps {
  readonly nodes: readonly FileTreeNode[]
  readonly depth: number
  readonly expanded: ReadonlySet<string>
  readonly selectedPath: string | undefined
  readonly disabled: boolean
  readonly onToggle: (path: string) => void
  readonly onSelect: (file: ChangedFile) => void
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
                  />
                </div>
              </Show>
            </>
          )
        }

        return (
          <button
            type="button"
            class={props.selectedPath === node.path ? "gg-file-row gg-selected" : "gg-file-row"}
            style={`--gg-indent:${props.depth * 12 + 4}px`}
            title={node.file.oldPath ? `${node.file.oldPath} → ${node.path}` : node.path}
            disabled={props.disabled}
            onClick={() => props.onSelect(node.file)}
          >
            <span class={statusClass(node.file.status)}>{statusLetter(node.file.status)}</span>
            <span class="gg-file-name">{node.name}</span>
            <Show when={node.file.oldPath}>
              <span class="gg-file-old">← {node.file.oldPath}</span>
            </Show>
          </button>
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
  /** Full-panel commit diff view; the history list stays mounted state, not DOM. */
  const [commitDiffOpen, setCommitDiffOpen] = createSignal(false)

  const [viewportHeight, setViewportHeight] = createSignal(320)
  const [scrollTop, setScrollTop] = createSignal(0)
  const [panelWidth, setPanelWidth] = createSignal(520)
  const [columnPreferences, setColumnPreferences] =
    createSignal<ColumnPreferences>(readColumnPreferences())
  const [graphScrollLeft, setGraphScrollLeft] = createSignal(0)
  const [autoLoadState, setAutoLoadState] =
    createSignal<AutoLoadState>(INITIAL_AUTO_LOAD_STATE)

  const [searchQuery, setSearchQuery] = createSignal("")
  const [changesExpanded, setChangesExpanded] = createSignal(true)
  const [collapsedGroups, setCollapsedGroups] = createSignal<ReadonlySet<string>>(new Set<string>())

  const repositoriesRequest = new LatestRequest()
  const graphRequest = new LatestRequest()
  const filesRequest = new LatestRequest()
  const diffRequest = new LatestRequest()

  const selectionCache = SELECTION_CACHE
  const selectionGeneration = new SelectionGeneration()
  let activeKey = ""
  let pendingRestore: SelectionSnapshot | undefined
  let scroller: HTMLDivElement | undefined
  let graphScroller: HTMLDivElement | undefined
  let resizeObserver: ResizeObserver | undefined
  let panelObserver: ResizeObserver | undefined
  let resizeDragCleanup: (() => void) | undefined
  let loadMoreInFlight = false
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

  function captureSelection(): SelectionSnapshot {
    const file = selectedFile()
    const commit = selectedCommit()
    return {
      ...(selectedRepositoryId() ? { repositoryId: selectedRepositoryId() } : {}),
      ...(commit ? { commitHash: commit.hash, parentIndex: selectedParentIndex() } : {}),
      ...(file ? { filePath: file.path, fileSource: file.source } : {}),
    }
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
    if (!scroller || !graphScroller) return false
    if (scroller.clientHeight <= 0 || scroller.scrollHeight <= 0) return false
    if (graphScroller.clientWidth <= 0 || graphScroller.scrollWidth <= 0) return false
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
    if (!scroller || !graphScroller) return
    // Set the DOM first, then mirror what the browser actually accepted.
    const top = clampScrollOffset(
      pending.scrollTop,
      scroller.scrollHeight,
      scroller.clientHeight,
    )
    scroller.scrollTop = top
    setScrollTop(scroller.scrollTop)
    if (scroller.clientHeight > 0) setViewportHeight(scroller.clientHeight)

    const left = clampScrollOffset(
      pending.graphScrollLeft,
      graphScroller.scrollWidth,
      graphScroller.clientWidth,
    )
    graphScroller.scrollLeft = left
    setGraphScrollLeft(graphScroller.scrollLeft)
  }

  function restoreViewStep(): void {
    restoreFrame = undefined
    const pending = pendingViewRestore
    if (!pending) {
      restoreAttempt = 0
      return
    }
    if (!commitDiffOpen() && viewRestoreContextCurrent(pending) && canApplyViewRestore()) {
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
    if (!pendingViewRestore || commitDiffOpen()) return
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

  function clearCommitSelection(): void {
    filesRequest.cancel()
    setSelectedCommit(undefined)
    setSelectedParentIndex(0)
    setCommitFiles([])
    setFilesLoading(false)
    setFilesError(undefined)
    setExpandedDirectories(new Set<string>())
    setCommitDiffOpen(false)
    clearPendingViewRestore()
  }

  function resetRepositoryState(): void {
    graphRequest.cancel()
    filesRequest.cancel()
    diffRequest.cancel()

    setStatus(undefined)
    setCommits([])
    setHasMore(false)
    setNextSkip(0)
    setLoadingMore(false)
    setHistoryError(undefined)
    setAutoLoadState(INITIAL_AUTO_LOAD_STATE)
    loadMoreInFlight = false
    setGraphScrollLeft(0)
    if (graphScroller) graphScroller.scrollLeft = 0
    setRepositoryLoading(false)
    setRepositoryError(undefined)

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
    clearPendingViewRestore()
    cancelAutoLoadSettle()

    setScrollTop(0)
    if (scroller) scroller.scrollTop = 0
  }

  function resetAll(): void {
    repositoriesRequest.cancel()
    resetRepositoryState()
    setRepositories([])
    setRepositoriesLoading(false)
    setRepositoriesError(undefined)
    setSelectedRepositoryId(undefined)
    setSearchQuery("")
    setChangesExpanded(true)
    setCollapsedGroups(new Set<string>())
    setScrollTop(0)
    if (scroller) scroller.scrollTop = 0
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
      resetRepositoryState()
      return
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

  async function loadRepository(repositoryId: string, restore?: SelectionSnapshot) {
    const { route, rpc } = currentRpc()
    const { directory } = route
    const key = selectionKey(route.serverId, route.directory)
    if (!directory || key !== activeKey) return

    graphRequest.cancel()
    filesRequest.cancel()
    diffRequest.cancel()
    resetRepositoryState()
    setSelectedRepositoryId(repositoryId)
    setRepositoryLoading(true)

    const result = await graphRequest.run(async (signal) => {
      const options = requestOptions(directory, signal)
      const [nextStatus, log] = await Promise.all([
        rpc.getStatus({ repositoryId }, options),
        rpc.getLog({ repositoryId, limit: PAGE_SIZE }, options),
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
    if (key !== activeKey || selectedRepositoryId() !== repositoryId) return

    setRepositoryLoading(false)
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
    commit: GitCommit,
    requestedParentIndex = 0,
    restoreFilePath?: string,
  ): void {
    selectionGeneration.bump()
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
        graphScrollLeft: graphScroller ? graphScroller.scrollLeft : graphScrollLeft(),
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

    loadMoreInFlight = true
    setLoadingMore(true)
    setHistoryError(undefined)

    try {
      const result = await graphRequest.run((signal) =>
        rpc.getLog(
          { repositoryId, limit: PAGE_SIZE, skip },
          requestOptions(directory, signal),
        ),
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
      if (key !== activeKey || selectedRepositoryId() !== repositoryId) {
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
        historyActive: selectedRepositoryId() !== undefined && !commitDiffOpen(),
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
    pendingRestore = undefined
    setSearchQuery("")
    setGraphScrollLeft(0)
    setAutoLoadState(INITIAL_AUTO_LOAD_STATE)
    if (graphScroller) graphScroller.scrollLeft = 0
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
  const busy = createMemo(() => repositoriesLoading() || repositoryLoading())
  const directoryReady = createMemo(() => currentDirectory().length > 0)
  const groups = createMemo(() => groupStatusFiles(status()?.files ?? []))
  const commitTree = createMemo(() => buildFileTree(commitFiles()))
  const diffLines = createMemo(() => classifyDiff(diff()?.text ?? ""))
  const visibleDiffLines = createMemo(() => diffLines().slice(0, MAX_DIFF_DISPLAY_LINES))

  /** Layout is derived from the loaded commits; search never rewrites it. */
  const graph = createMemo(() => buildCommitGraph(commits()))
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
  const graphWidth = createMemo(() => graphContentWidth(maxLanes(), LANE_SPACING, LANE_PADDING))
  const resolvedColumns = createMemo(() =>
    resolveColumnLayout(panelWidth(), columnPreferences()),
  )
  const graphColumnWidth = createMemo(() => resolvedColumns().widths.graph)
  const maxRefs = createMemo(() => visibleRefCount(panelWidth()))
  const detailsOrientation = createMemo(() => detailsLayout(panelWidth()))
  const historyStyle = createMemo(
    () =>
      `--gg-history-cols:${resolvedColumns().gridTemplate};--gg-graph-column:${graphColumnWidth()}px;--gg-graph-shift:${-graphScrollLeft()}px;`,
  )
  const detailsBodyClass = createMemo(
    () =>
      `gg-details-body ${
        detailsOrientation() === "columns" ? "gg-layout-columns" : "gg-layout-rows"
      } gg-single`,
  )
  const detailsVisible = createMemo(() => {
    if (commitDiffOpen()) return false
    const file = selectedFile()
    return file !== undefined && file.source !== "commit"
  })
  const commitDiffSelection = createMemo(() => {
    if (!commitDiffOpen()) return undefined
    const commit = selectedCommit()
    const file = selectedFile()
    if (!commit || !file || file.source !== "commit") return undefined
    return { commit, path: file.path }
  })
  const range = createMemo(() =>
    rowLayout().range(scrollTop(), viewportHeight(), OVERSCAN),
  )
  const rowViews = createMemo(() => createGraphRowViews(rows(), commits()))
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

  createEffect(() => {
    // Read the resolved graph width so resizing re-runs this clamp, but use the
    // real element width when available: the viewport must never be wider than
    // the graph column, and its scroll range is defined by the browser.
    const column = graphColumnWidth()
    const viewport =
      graphScroller && graphScroller.clientWidth > 0
        ? graphScroller.clientWidth
        : column
    const maxScroll = maxScrollOffset(graphWidth(), viewport)
    if (graphScrollLeft() <= maxScroll) return
    setGraphScrollLeft(maxScroll)
    if (graphScroller) graphScroller.scrollLeft = maxScroll
  })

  function searchState(hash: string): SearchState {
    const set = matches()
    if (!set) return "none"
    return set.has(hash) ? "match" : "dim"
  }

  function jumpToFirstMatch(): void {
    const set = matches()
    if (!set) return
    const index = commits().findIndex((commit) => set.has(commit.hash))
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
  })

  return (
    <div class="git-graph-panel" ref={(element) => attachPanel(element)}>
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
          <div
            class={detached() ? "gg-branch gg-branch-detached" : "gg-branch"}
            data-testid="current-branch"
            aria-label={`Current branch: ${branchLabel()}`}
            title={`Current branch: ${branchLabel()}`}
          >
            <BranchIcon />
            <span class="gg-branch-name">{branchLabel()}</span>
            <Show when={detached()}>
              <span class="gg-badge-detached">detached</span>
            </Show>
          </div>
        </Show>

        <div class="gg-search">
          <SearchIcon />
          <input
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

      <Show when={selectedRepositoryId() && !commitDiffOpen()}>
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
                    class={
                      column === "graph"
                        ? "gg-graph-resize gg-column-resize"
                        : "gg-column-resize"
                    }
                    data-testid={`resize-column-${column}`}
                    aria-label={`Resize ${column} column`}
                    title={`Drag to resize ${column} column`}
                    onPointerDown={(event) => startColumnResize(column, event)}
                  />
                </div>
              )}
            </For>
          </div>

          <div class="gg-graph-hscroll-row">
            <div
              class="gg-graph-hscroll"
              data-testid="graph-scroll"
              aria-label="Graph scroll"
              title="Scroll graph horizontally"
              tabIndex={0}
              ref={(element) => {
                graphScroller = element
                scheduleViewRestore()
              }}
              onScroll={(event) =>
                setGraphScrollLeft(
                  clampScrollOffset(
                    event.currentTarget.scrollLeft,
                    event.currentTarget.scrollWidth,
                    event.currentTarget.clientWidth,
                  ),
                )
              }
            >
              <div class="gg-graph-hspacer" style={{ width: `${graphWidth()}px` }} />
            </div>
          </div>

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
                      laneSpacing={LANE_SPACING}
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
                      onSelect={() => toggleCommit(view.commit)}
                    />
                  )}
                </For>

                <Show when={expandedRow()}>
                  {(row) => (
                    <CommitFilesSlot
                      top={rowLayout().slotTop ?? 0}
                      height={rowLayout().slotHeight}
                      row={row()}
                      graphWidth={graphWidth()}
                      columnWidth={graphColumnWidth()}
                      laneSpacing={LANE_SPACING}
                      nodes={commitTree()}
                      fileCount={commitFiles().length}
                      expanded={expandedDirectories()}
                      selectedPath={inlineSelectedPath()}
                      loading={filesLoading()}
                      error={filesError()}
                      disabled={busy()}
                      onToggle={toggleDirectory}
                      onSelect={(file) => {
                        const commit = selectedCommit()
                        if (commit) selectCommitFile(file, commit, selectedParentIndex())
                      }}
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
    </div>
  )
}
