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
  GitRef,
  GitRepository,
  GitStatus,
} from "../shared/types.js"
import { GitGraphRpc } from "../rpc.js"
import { buildCommitGraph } from "./graph.js"
import { graphRowLines } from "./graph-geometry.js"
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
import type { GraphRow } from "../server/graph/layout.js"
import { GG_STYLES } from "./styles.js"

const PAGE_SIZE = 100
const ROW_HEIGHT = 32
const OVERSCAN = 6
const MAX_GRAPH_WIDTH = 220
const LANE_PADDING = 8
const MIN_LANE_SPACING = 2
const MAX_LANE_SPACING = 14
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

function shortHash(hash: string | null | undefined): string {
  return hash ? hash.slice(0, 7) : ""
}

function colourOf(colour: number): string {
  return PALETTE[colour % PALETTE.length]
}

function refLabel(ref: string): string {
  return ref.replace(/^HEAD -> /, "HEAD → ")
}

function laneX(lane: number, spacing: number): number {
  return LANE_PADDING + lane * spacing + spacing / 2
}

function statusClass(status: ChangedFile["status"]): string {
  return `gg-status-letter gg-status-${status}`
}

interface GraphRowProps {
  readonly view: GraphRowView
  readonly laneSpacing: number
  readonly graphWidth: number
  readonly selected: boolean
  readonly disabled: boolean
  readonly onSelect: () => void
}

function GraphRowView(props: GraphRowProps) {
  const x = (lane: number) => laneX(lane, props.laneSpacing)
  const nodeRadius = () => Math.max(2, Math.min(4, props.laneSpacing / 3))
  const lines = () => graphRowLines(props.view.row, props.view.previous)

  return (
    <button
      type="button"
      class={props.selected ? "gg-graph-row gg-selected" : "gg-graph-row"}
      style={{ top: `${props.view.index * ROW_HEIGHT}px`, height: `${ROW_HEIGHT}px` }}
      disabled={props.disabled}
      onClick={() => props.onSelect()}
      title={props.view.commit.subject}
    >
      <svg
        class="gg-graph-svg"
        width={props.graphWidth}
        height={ROW_HEIGHT}
        viewBox={`0 0 ${props.graphWidth} ${ROW_HEIGHT}`}
        aria-hidden="true"
      >
        <For each={lines()}>
          {(line) => (
            <line
              x1={x(line.from.lane)}
              y1={line.from.y * ROW_HEIGHT}
              x2={x(line.to.lane)}
              y2={line.to.y * ROW_HEIGHT}
              stroke={colourOf(line.colour)}
              stroke-width="1.5"
              stroke-linecap="round"
            />
          )}
        </For>
        <circle
          cx={x(props.view.row.lane)}
          cy={ROW_HEIGHT / 2}
          r={nodeRadius()}
          fill={colourOf(props.view.row.colour)}
          stroke="var(--color-background, #111)"
          stroke-width="1"
        />
      </svg>
      <span class="gg-graph-text">
        <span class="gg-subject">{props.view.commit.subject || "(no subject)"}</span>
        <span class="gg-row-meta">
          <span class="gg-hash">{shortHash(props.view.commit.hash)}</span>
          <For each={props.view.commit.refs.slice(0, 3)}>
            {(ref) => (
              <span class="gg-ref" title={ref}>
                {refLabel(ref)}
              </span>
            )}
          </For>
          <Show when={props.view.commit.refs.length > 3}>
            <span class="gg-ref">+{props.view.commit.refs.length - 3}</span>
          </Show>
        </span>
      </span>
    </button>
  )
}

interface StatusGroupSectionProps {
  readonly title: string
  readonly files: readonly ChangedFile[]
  readonly disabled: boolean
  readonly isSelected: (file: ChangedFile) => boolean
  readonly onSelect: (file: ChangedFile) => void
}

function StatusGroupSection(props: StatusGroupSectionProps) {
  return (
    <div>
      <div class="gg-group-title">
        <span>{props.title}</span>
        <span class="gg-group-count">{props.files.length}</span>
      </div>
      <Show when={props.files.length > 0} fallback={<div class="gg-muted">None</div>}>
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
      </Show>
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
                style={{ "padding-left": `${props.depth * 12 + 4}px` }}
                title={node.path}
                disabled={props.disabled}
                onClick={() => props.onToggle(node.path)}
              >
                <span class="gg-dir-caret">{open() ? "▾" : "▸"}</span>
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
            style={{ "padding-left": `${props.depth * 12 + 4}px` }}
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
  const [refs, setRefs] = createSignal<GitRef[]>([])
  const [repositoryLoading, setRepositoryLoading] = createSignal(false)
  const [repositoryError, setRepositoryError] = createSignal<string | undefined>()

  const [commits, setCommits] = createSignal<GitCommit[]>([])
  const [rows, setRows] = createSignal<GraphRow[]>([])
  const [hasMore, setHasMore] = createSignal(false)
  const [nextSkip, setNextSkip] = createSignal(0)
  const [loadingMore, setLoadingMore] = createSignal(false)
  const [graphError, setGraphError] = createSignal<string | undefined>()

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

  const repositoriesRequest = new LatestRequest()
  const graphRequest = new LatestRequest()
  const filesRequest = new LatestRequest()
  const diffRequest = new LatestRequest()

  const selectionCache = SELECTION_CACHE
  const selectionGeneration = new SelectionGeneration()
  let activeKey = ""
  let pendingRestore: SelectionSnapshot | undefined
  let scroller: HTMLDivElement | undefined
  let resizeObserver: ResizeObserver | undefined

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
    setRefs([])
    setCommits([])
    setRows([])
    setHasMore(false)
    setNextSkip(0)
    setLoadingMore(false)
    setGraphError(undefined)
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
      const [nextStatus, log, nextRefs] = await Promise.all([
        rpc.getStatus({ repositoryId }, options),
        rpc.getLog({ repositoryId, limit: PAGE_SIZE }, options),
        rpc.getRefs({ repositoryId }, options),
      ])
      return { status: nextStatus, log, refs: nextRefs.refs }
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
    setRefs(result.value.refs)
    setCommits(nextCommits)
    setNextSkip(nextLog.commits.length)
    setHasMore(nextLog.hasMore)
    const graph = buildCommitGraph(nextCommits)
    setRows(graph.rows)
    setGraphError(graph.error)

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

  async function loadMore(): Promise<void> {
    const repositoryId = selectedRepositoryId()
    if (!repositoryId || loadingMore() || !hasMore()) return
    const { route, rpc } = currentRpc()
    const { directory } = route
    const key = selectionKey(route.serverId, route.directory)
    const skip = nextSkip()

    setLoadingMore(true)
    setGraphError(undefined)

    const result = await graphRequest.run((signal) =>
      rpc.getLog(
        { repositoryId, limit: PAGE_SIZE, skip },
        requestOptions(directory, signal),
      ),
    )

    if (!result.accepted) {
      if (!result.aborted) {
        setLoadingMore(false)
        setGraphError(formatError(result.error))
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

    const graph = buildCommitGraph(merged)
    setRows(graph.rows)
    setGraphError(graph.error)
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

  const selectedRepository = createMemo(() =>
    repositories().find((repository) => repository.id === selectedRepositoryId()),
  )
  const busy = createMemo(() => repositoriesLoading() || repositoryLoading())
  const directoryReady = createMemo(() => currentDirectory().length > 0)
  const groups = createMemo(() => groupStatusFiles(status()?.files ?? []))
  const commitTree = createMemo(() => buildFileTree(commitFiles()))
  const diffLines = createMemo(() => classifyDiff(diff()?.text ?? ""))
  const visibleDiffLines = createMemo(() => diffLines().slice(0, MAX_DIFF_DISPLAY_LINES))
  const maxLanes = createMemo(() =>
    rows().reduce((maximum, row) => Math.max(maximum, row.lanes), 1),
  )
  const laneSpacing = createMemo(() =>
    Math.max(
      MIN_LANE_SPACING,
      Math.min(
        MAX_LANE_SPACING,
        Math.floor((MAX_GRAPH_WIDTH - LANE_PADDING * 2) / Math.max(1, maxLanes())),
      ),
    ),
  )
  const graphWidth = createMemo(() => maxLanes() * laneSpacing() + LANE_PADDING * 2)
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
  const branchLabel = createMemo(() => {
    const current = status()
    if (!current) return ""
    if (current.detached) return `detached @ ${shortHash(current.head)}`
    return current.branch ?? "(no branch)"
  })
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
    if (activeKey) selectionCache.set(activeKey, untrack(() => captureSelection()))
    repositoriesRequest.dispose()
    graphRequest.dispose()
    filesRequest.dispose()
    diffRequest.dispose()
  })

  return (
    <div class="git-graph-panel">
      <style>{GG_STYLES}</style>

      <div class="gg-header">
        <div class="gg-repo-row">
          <select
            aria-label="Repository"
            value={selectedRepositoryId() ?? ""}
            disabled={busy()}
            onChange={(event) => chooseRepository(event.currentTarget.value)}
          >
            <Show when={repositories().length === 0}>
              <option value="">No repositories</option>
            </Show>
            <For each={repositories()}>
              {(repository) => (
                <option value={repository.id}>
                  {repository.name}
                  {repository.branch ? ` — ${repository.branch}` : ""}
                </option>
              )}
            </For>
          </select>
          <button
            type="button"
            disabled={busy()}
            onClick={() => refreshAll()}
          >
            {busy() ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        <Show when={selectedRepository()}>
          {(repository) => (
            <div class="gg-repo-meta" title={repository().rootPath}>
              {repository().type}
              {repository().detached ? " · detached" : ""}
              <Show when={status()}>
                <span> · {branchLabel()}</span>
              </Show>
              <Show when={refs().length > 0}>
                <span> · {refs().length} refs</span>
              </Show>
            </div>
          )}
        </Show>
      </div>

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
        <section class="gg-section">
          <div class="gg-section-title">
            <span>Changes</span>
            <Show when={status()}>
              {(current) => (
                <span class="gg-muted">
                  {current().counts.staged} staged · {current().counts.unstaged} unstaged ·{" "}
                  {current().counts.untracked} untracked · {current().counts.conflicted} conflicted
                </span>
              )}
            </Show>
          </div>

          <Show when={repositoryLoading()}>
            <div class="gg-status">Loading repository…</div>
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

          <Show when={status()}>
            <div class="gg-changes">
              <StatusGroupSection
                title="Staged"
                files={groups().staged}
                disabled={busy()}
                isSelected={selectedFileForStatus}
                onSelect={selectStatusFile}
              />
              <StatusGroupSection
                title="Unstaged"
                files={groups().unstaged}
                disabled={busy()}
                isSelected={selectedFileForStatus}
                onSelect={selectStatusFile}
              />
              <StatusGroupSection
                title="Untracked"
                files={groups().untracked}
                disabled={busy()}
                isSelected={selectedFileForStatus}
                onSelect={selectStatusFile}
              />
              <StatusGroupSection
                title="Conflicted"
                files={groups().conflicted}
                disabled={busy()}
                isSelected={selectedFileForStatus}
                onSelect={selectStatusFile}
              />
            </div>
          </Show>
        </section>

        <section class="gg-section gg-graph-section">
          <div class="gg-section-title">
            <span>History</span>
            <span class="gg-muted">
              {commits().length} loaded{hasMore() ? "+" : ""}
            </span>
          </div>

          <div
            class="gg-graph-scroll"
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
              <div class="gg-graph-spacer" style={{ height: `${rows().length * ROW_HEIGHT}px` }}>
                <For each={visibleRows()}>
                  {(view) => (
                    <GraphRowView
                      view={view}
                      laneSpacing={laneSpacing()}
                      graphWidth={graphWidth()}
                      selected={selectedCommit()?.hash === view.commit.hash}
                      disabled={busy()}
                      onSelect={() => selectCommit(view.commit)}
                    />
                  )}
                </For>
              </div>
            </Show>
          </div>

          <div class="gg-graph-footer">
            <Show when={hasMore()}>
              <button
                type="button"
                disabled={loadingMore() || busy()}
                onClick={() => void loadMore()}
              >
                {loadingMore() ? "Loading…" : "Load more"}
              </button>
            </Show>
            <Show when={rows().length > 0}>
              <span class="gg-muted">
                rows {range().start + 1}–{range().end} / {rows().length}
              </span>
            </Show>
          </div>
          <Show when={graphError()}>
            {(message) => <div class="gg-error">{message()}</div>}
          </Show>
        </section>
      </Show>

      <Show when={selectedCommit()}>
        {(commit) => (
          <section class="gg-section">
            <div class="gg-section-title">
              <span>Commit files</span>
              <span class="gg-diff-title" title={commit().hash}>
                {shortHash(commit().hash)}
              </span>
            </div>

            <div class="gg-parent-row">
              <Show
                when={commit().parents.length > 1}
                fallback={
                  <span class="gg-muted">
                    {commit().parents.length === 0
                      ? "Root commit (empty tree)"
                      : `First parent ${shortHash(commit().parents[0])}`}
                  </span>
                }
              >
                <span class="gg-muted">Parent</span>
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
              </Show>
            </div>

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
                      void loadCommitFiles(commit(), selectedParentIndex())
                    }
                  >
                    Retry
                  </button>
                </div>
              )}
            </Show>

            <Show
              when={commitFiles().length > 0}
              fallback={
                <Show when={!filesLoading() && !filesError()}>
                  <div class="gg-empty">No files changed relative to this parent.</div>
                </Show>
              }
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
                  onSelect={(file) => selectCommitFile(file, commit(), selectedParentIndex())}
                />
              </div>
            </Show>
          </section>
        )}
      </Show>

      <Show when={selectedFile()}>
        {(selection) => (
          <section class="gg-section gg-diff-section">
            <div class="gg-section-title">
              <span>Diff</span>
              <span class="gg-diff-title" title={selection().path}>
                {selection().path}
              </span>
            </div>

            <Show when={diffLoading()}>
              <div class="gg-status">Loading diff…</div>
            </Show>
            <Show when={diffError()}>
              {(message) => (
                <div class="gg-error">
                  <span>{message()}</span>
                  <button type="button" disabled={busy()} onClick={() => void loadDiff(selection())}>
                    Retry
                  </button>
                </div>
              )}
            </Show>

            <Show when={diff()}>
              {(fileDiff) => (
                <>
                  <div class="gg-diff-meta">
                    {fileDiff().status}
                    <Show when={fileDiff().oldPath}>
                      <span> · from {fileDiff().oldPath}</span>
                    </Show>
                    <span> · {selection().target.type}</span>
                  </div>
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
                    <div class="gg-diff">
                      <For each={visibleDiffLines()}>
                        {(line: DiffLine) => (
                          <div class={`gg-diff-line gg-diff-${line.kind}`}>
                            {line.text.length > 0 ? line.text : " "}
                          </div>
                        )}
                      </For>
                    </div>
                    <Show when={diffLines().length > MAX_DIFF_DISPLAY_LINES}>
                      <div class="gg-notice">
                        Showing the first {MAX_DIFF_DISPLAY_LINES} of {diffLines().length} diff
                        lines.
                      </div>
                    </Show>
                  </Show>
                  <Show when={!fileDiff().binary && fileDiff().text.length === 0}>
                    <div class="gg-empty">No textual diff.</div>
                  </Show>
                </>
              )}
            </Show>
          </section>
        )}
      </Show>
    </div>
  )
}
