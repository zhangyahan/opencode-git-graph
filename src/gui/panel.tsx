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
  DEFAULT_GRAPH_COLUMN_WIDTH,
  DEFAULT_LANE_PADDING,
  DEFAULT_LANE_SPACING,
  clampGraphColumnWidth,
  graphContentWidth,
  graphLaneX,
  graphLinePath,
  graphRowLines,
} from "./graph-geometry.js"
import {
  createGraphRowViews,
  visibleGraphRowViews,
  type GraphRowView,
} from "./graph-view.js"
import { classifyDiff, type DiffLine } from "./diff.js"
import { mergeCommits } from "./pagination.js"
import { computeVirtualRange } from "./virtual.js"
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
  historyColumnTemplate,
  historyColumns,
  visibleRefCount,
} from "./history-columns.js"
import { formatCommitDate, formatRefLabel, refHue, shortHash } from "./format.js"
import { searchMatches } from "./search.js"
import { repositoryOptionLabel } from "./repository-label.js"
import {
  clampScrollOffset,
  maxScrollOffset,
  scrollTopForRow,
} from "./scroll.js"

const PAGE_SIZE = 100
const ROW_HEIGHT = 28
const OVERSCAN = 6
const LANE_SPACING = DEFAULT_LANE_SPACING
const LANE_PADDING = DEFAULT_LANE_PADDING
const MAX_DIFF_DISPLAY_LINES = 4_000
const SELECTION_CACHE_LIMIT = 16

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
  readonly selected: boolean
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
        props.searchState === "dim" ? "gg-search-dim" : "",
        props.searchState === "match" ? "gg-search-match" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ top: `${props.view.index * props.rowHeight}px`, height: `${props.rowHeight}px` }}
      disabled={props.disabled}
      onClick={() => props.onSelect()}
      title={props.view.commit.subject}
      data-commit={props.view.commit.hash}
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

  const [viewportHeight, setViewportHeight] = createSignal(320)
  const [scrollTop, setScrollTop] = createSignal(0)
  const [panelWidth, setPanelWidth] = createSignal(520)
  const [graphColumnWidth, setGraphColumnWidth] = createSignal(DEFAULT_GRAPH_COLUMN_WIDTH)
  const [graphScrollLeft, setGraphScrollLeft] = createSignal(0)

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

  function clearCommitSelection(): void {
    filesRequest.cancel()
    setSelectedCommit(undefined)
    setSelectedParentIndex(0)
    setCommitFiles([])
    setFilesLoading(false)
    setFilesError(undefined)
    setExpandedDirectories(new Set<string>())
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

    setSelectedFile(undefined)
    setDiff(undefined)
    setDiffLoading(false)
    setDiffError(undefined)

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
    setSelectedCommit(commit)
    setSelectedParentIndex(parentIndex)
    setSelectedFile(undefined)
    setDiff(undefined)
    setDiffError(undefined)
    void loadCommitFiles(commit, parentIndex, restoreFilePath)
  }

  async function loadCommitFiles(
    commit: GitCommit,
    parentIndex: number,
    restoreFilePath?: string,
  ): Promise<void> {
    const repositoryId = selectedRepositoryId()
    if (!repositoryId) return
    const { route, rpc } = currentRpc()
    const { directory } = route
    const key = selectionKey(route.serverId, route.directory)

    filesRequest.cancel()
    diffRequest.cancel()
    setCommitFiles([])
    setFilesLoading(true)
    setFilesError(undefined)
    setSelectedFile(undefined)
    setDiff(undefined)
    setDiffError(undefined)

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
    setSelectedFile(selection)
    void loadDiff(selection)
  }

  function changeParent(parentIndex: number): void {
    const commit = selectedCommit()
    if (!commit) return
    const maxIndex = Math.max(0, commit.parents.length - 1)
    const nextIndex = Math.min(Math.max(0, parentIndex), maxIndex)
    if (nextIndex === selectedParentIndex() && commitFiles().length > 0) return
    selectionGeneration.bump()
    setSelectedParentIndex(nextIndex)
    setSelectedFile(undefined)
    setDiff(undefined)
    setDiffError(undefined)
    void loadCommitFiles(commit, nextIndex)
  }

  function closeDetails(): void {
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
  }

  async function loadMore(): Promise<void> {
    const repositoryId = selectedRepositoryId()
    if (!repositoryId || loadingMore() || !hasMore()) return
    const { route, rpc } = currentRpc()
    const { directory } = route
    const key = selectionKey(route.serverId, route.directory)
    const skip = nextSkip()

    setLoadingMore(true)
    setHistoryError(undefined)

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
      }
      return
    }
    if (key !== activeKey || selectedRepositoryId() !== repositoryId) return

    setLoadingMore(false)
    const page = result.value
    const merged = mergeCommits(commits(), page.commits)
    setCommits(merged)
    setNextSkip(skip + page.commits.length)
    setHasMore(page.hasMore && page.commits.length > 0)
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
    void refreshRepositories(true, snapshot, restoreToken)
  }

  function chooseRepository(repositoryId: string): void {
    if (!repositoryId || repositoryId === selectedRepositoryId()) return
    selectionGeneration.bump()
    pendingRestore = undefined
    setSearchQuery("")
    setGraphScrollLeft(0)
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
    if (typeof ResizeObserver === "undefined") return
    resizeObserver = new ResizeObserver((entries) => {
      const height = entries[0]?.contentRect.height
      if (typeof height === "number" && height > 0) setViewportHeight(height)
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

  function startGraphResize(event: PointerEvent & { currentTarget: HTMLButtonElement }): void {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = graphColumnWidth()
    const move = (moveEvent: PointerEvent) => {
      setGraphColumnWidth(clampGraphColumnWidth(startWidth + moveEvent.clientX - startX))
    }
    const stop = () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", stop)
      window.removeEventListener("pointercancel", stop)
      resizeDragCleanup = undefined
    }
    resizeDragCleanup?.()
    resizeDragCleanup = stop
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", stop)
    window.addEventListener("pointercancel", stop)
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

  const maxLanes = createMemo(() =>
    rows().reduce((maximum, row) => Math.max(maximum, row.lanes), 1),
  )
  const graphWidth = createMemo(() => graphContentWidth(maxLanes(), LANE_SPACING, LANE_PADDING))
  const columns = createMemo(() => historyColumns(panelWidth()))
  const maxRefs = createMemo(() => visibleRefCount(panelWidth()))
  const detailsOrientation = createMemo(() => detailsLayout(panelWidth()))
  const historyTemplate = createMemo(() =>
    historyColumnTemplate({
      graphWidth: graphColumnWidth(),
      date: columns().date,
      author: columns().author,
    }),
  )
  const historyStyle = createMemo(
    () =>
      `--gg-history-cols:${historyTemplate()};--gg-graph-column:${graphColumnWidth()}px;--gg-graph-shift:${-graphScrollLeft()}px;`,
  )
  const detailsBodyClass = createMemo(
    () =>
      `gg-details-body ${
        detailsOrientation() === "columns" ? "gg-layout-columns" : "gg-layout-rows"
      }${selectedCommit() ? "" : " gg-single"}`,
  )
  const detailsVisible = createMemo(() => selectedCommit() !== undefined || selectedFile() !== undefined)
  const range = createMemo(() =>
    computeVirtualRange({
      scrollTop: scrollTop(),
      viewportHeight: viewportHeight(),
      rowHeight: ROW_HEIGHT,
      total: rows().length,
      overscan: OVERSCAN,
    }),
  )
  const rowViews = createMemo(() => createGraphRowViews(rows(), commits()))
  const visibleRows = createMemo(() => visibleGraphRowViews(rowViews(), range()))
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
    // Read the column signal so resizing re-runs this clamp, but use the real
    // element width when it is available: the viewport must never be wider
    // than the graph column, and its scroll range is defined by the browser.
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
    if (!scroller) {
      const top = scrollTopForRow(
        index,
        ROW_HEIGHT,
        rows().length * ROW_HEIGHT,
        viewportHeight(),
      )
      setScrollTop(top)
      return
    }
    // A row near the end maps past the maximum scrollTop. The browser clamps
    // the DOM value and may not emit a scroll event when the value did not
    // actually change, so mirror the real DOM value into the signal or the
    // virtual window can point past the end and render no rows.
    const top = scrollTopForRow(
      index,
      ROW_HEIGHT,
      scroller.scrollHeight,
      scroller.clientHeight,
    )
    scroller.scrollTop = top
    setScrollTop(scroller.scrollTop)
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

      <Show when={selectedRepositoryId()}>
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
            <div class="gg-col-graph-head">
              <span>Graph</span>
              <button
                type="button"
                class="gg-graph-resize"
                aria-label="Resize graph column"
                title="Drag to resize graph column"
                onPointerDown={(event) => startGraphResize(event)}
              />
            </div>
            <div>Description</div>
            <Show when={columns().date}>
              <div>Date</div>
            </Show>
            <Show when={columns().author}>
              <div>Author</div>
            </Show>
            <div>Commit</div>
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
            onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
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
                style={{ height: `${rows().length * ROW_HEIGHT}px` }}
              >
                <For each={visibleRows()}>
                  {(view) => (
                    <GraphRow
                      view={view}
                      laneSpacing={LANE_SPACING}
                      graphWidth={graphWidth()}
                      rowHeight={ROW_HEIGHT}
                      selected={selectedCommit()?.hash === view.commit.hash}
                      disabled={busy()}
                      searchState={searchState(view.commit.hash)}
                      showDate={columns().date}
                      showAuthor={columns().author}
                      maxRefs={maxRefs()}
                      onSelect={() => selectCommit(view.commit)}
                    />
                  )}
                </For>
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
                onClick={() => void loadMore()}
              >
                {loadingMore() ? "Loading…" : "Load more"}
              </button>
            </Show>
          </div>
          <Show when={historyError() || graphError()}>
            {(message) => <div class="gg-error">{message()}</div>}
          </Show>
        </section>
      </Show>

      <Show when={detailsVisible()}>
        <section class="gg-details" data-testid="commit-details" aria-label="Commit details">
          <div class="gg-details-head">
            <div class="gg-details-title">
              <Show
                when={selectedCommit()}
                fallback={
                  <>
                    <span class="gg-details-subject" title={selectedFile()?.path}>
                      {selectedFile()?.path}
                    </span>
                    <span class="gg-details-hash">{selectedFile()?.source}</span>
                  </>
                }
              >
                {(commit) => (
                  <>
                    <span class="gg-details-subject" title={commit().subject}>
                      {commit().subject || "(no subject)"}
                    </span>
                    <span class="gg-details-hash" title={commit().hash}>
                      {shortHash(commit().hash)}
                    </span>
                    <span class="gg-details-parents" title={commit().parents.join(" ")}>
                      {commit().parents.length === 0
                        ? "root commit"
                        : `parents ${commit().parents.map((parent) => shortHash(parent)).join(", ")}`}
                    </span>
                    <span class="gg-details-meta" title={`${commit().author} · ${commit().authorDate}`}>
                      {commit().author}
                    </span>
                  </>
                )}
              </Show>
            </div>
            <div class="gg-details-actions">
              <Show when={selectedCommit()}>
                {(commit) => (
                  <Show when={commit().parents.length > 1}>
                    <label class="gg-parent-select">
                      <span class="gg-sr-only">Diff parent</span>
                      <select
                        aria-label="Diff parent"
                        value={String(selectedParentIndex())}
                        disabled={busy()}
                        onChange={(event) => changeParent(Number(event.currentTarget.value))}
                      >
                        <For each={commit().parents}>
                          {(parent, index) => (
                            <option value={String(index())}>
                              Parent {index() + 1} · {shortHash(parent)}
                            </option>
                          )}
                        </For>
                      </select>
                    </label>
                  </Show>
                )}
              </Show>
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
            <Show when={selectedCommit()}>
              <div class="gg-details-files" aria-label="Changed files">
                <Show when={filesLoading()}>
                  <div class="gg-status">Loading files…</div>
                </Show>
                <Show when={filesError()}>
                  {(message) => (
                    <div class="gg-error">
                      <span>{message()}</span>
                      <button
                        type="button"
                        disabled={busy()}
                        onClick={() =>
                          void loadCommitFiles(selectedCommit()!, selectedParentIndex())
                        }
                      >
                        Retry
                      </button>
                    </div>
                  )}
                </Show>
                <Show when={!filesLoading() && !filesError()}>
                  <Show
                    when={commitFiles().length > 0}
                    fallback={<div class="gg-empty">No files changed relative to this parent.</div>}
                  >
                    <div class="gg-tree">
                      <FileTree
                        nodes={commitTree()}
                        depth={0}
                        expanded={expandedDirectories()}
                        selectedPath={
                          selectedFile()?.source === "commit" ? selectedFile()?.path : undefined
                        }
                        disabled={busy()}
                        onToggle={toggleDirectory}
                        onSelect={(file) => {
                          const commit = selectedCommit()
                          if (commit) selectCommitFile(file, commit, selectedParentIndex())
                        }}
                      />
                    </div>
                  </Show>
                </Show>
              </div>
            </Show>

            <div class="gg-details-diff" data-testid="diff" aria-label="Diff">
              <Show
                when={selectedFile()}
                fallback={
                  <div class="gg-diff-placeholder">
                    {selectedCommit()
                      ? "Select a changed file to view its diff."
                      : "Select a file to view its diff."}
                  </div>
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
    </div>
  )
}
