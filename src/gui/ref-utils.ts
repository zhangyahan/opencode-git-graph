import type {
  ChangedFile,
  FileDiff,
  GitCommit,
  GitRef,
  GitStatus,
} from "../shared/types.js"

/**
 * GUI-side types and pure helpers for ref badges, ref menus, branch filtering
 * and the mutation contract.
 *
 * The server half of these methods is landing separately. The panel therefore
 * probes the RPC definition/client at runtime and never renders an action the
 * server cannot execute.
 */

export type RefKind = GitRef["kind"]
export type RefBadgeKind = RefKind | "unknown"
export type HistoryOrder = "date" | "topo"

/** Maximum number of explicitly selected refs accepted by `getLog`. */
export const MAX_LOG_REFS = 32
const SELECTABLE_PREFIXES = ["refs/heads/", "refs/remotes/", "refs/tags/"] as const

export interface RefBadgeInfo {
  /** Unique within one commit: same-name branch and tag stay distinct. */
  readonly key: string
  readonly name: string
  readonly kind: RefBadgeKind
  readonly hash: string
  /** Fully-qualified refname, absent for synthetic/unknown badges. */
  readonly canonical?: string
}

/** Fully-qualified refname expected by the server-side ref allowlist. */
export function canonicalRefName(ref: GitRef): string | undefined {
  switch (ref.kind) {
    case "branch":
      return `refs/heads/${ref.name}`
    case "remote":
      return `refs/remotes/${ref.name}`
    case "tag":
      return `refs/tags/${ref.name}`
    case "head":
      return undefined
  }
}

export function refKindLabel(kind: RefBadgeKind): string {
  switch (kind) {
    case "branch":
      return "branch"
    case "remote":
      return "remote branch"
    case "tag":
      return "tag"
    case "head":
      return "HEAD"
    case "unknown":
      return "ref"
  }
}

/** Resolve a badge back to its typed `getRefs` entry for its context menu. */
export function typedRefForBadge(
  refs: readonly GitRef[],
  badge: RefBadgeInfo,
): GitRef | undefined {
  return refs.find(
    (ref) =>
      ref.hash === badge.hash &&
      ref.name === badge.name &&
      ref.kind === badge.kind,
  )
}

/** `HEAD -> main`, `origin/HEAD -> origin/main` and `tag: v1` reduce to names. */
export function decorationRefName(decoration: string): string {
  return decoration
    .replace(/^tag: /, "")
    .replace(/^.+ -> /, "")
}

function badgeKey(kind: RefBadgeKind, name: string): string {
  return `${kind}\0${name}`
}

/**
 * Match a commit's decorations against `getRefs` entries.
 *
 * Decorations are plain names, so a branch and a tag called `main` are
 * indistinguishable in `GitCommit.refs`. This joins by hash + name and keeps
 * the typed kind, producing two clearly labelled badges. When refs have not
 * loaded (or failed), unknown badges preserve the old decoration display.
 */
export function refBadgesForCommit(
  refs: readonly GitRef[],
  commit: GitCommit,
): RefBadgeInfo[] {
  const badges: RefBadgeInfo[] = []
  const seen = new Set<string>()

  const push = (badge: RefBadgeInfo): void => {
    if (seen.has(badge.key)) return
    seen.add(badge.key)
    badges.push(badge)
  }

  for (const decoration of commit.refs) {
    const name = decorationRefName(decoration)
    if (!name) continue

    const typed = refs.filter(
      (ref) => ref.hash === commit.hash && ref.name === name && ref.kind !== "head",
    )
    for (const ref of typed) {
      const canonical = canonicalRefName(ref)
      push({
        key: badgeKey(ref.kind, ref.name),
        name: ref.name,
        kind: ref.kind,
        hash: ref.hash,
        ...(canonical ? { canonical } : {}),
      })
    }

    // Show a synthetic HEAD badge only when no real branch/tag/remote covers
    // the same decoration (attached HEAD also carries the branch name).
    if (typed.length === 0) {
      const head = refs.find(
        (ref) => ref.hash === commit.hash && ref.name === name && ref.kind === "head",
      )
      if (head) {
        push({
          key: badgeKey("head", head.name),
          name: head.name,
          kind: "head",
          hash: head.hash,
        })
      } else {
        push({
          key: badgeKey("unknown", name),
          name,
          kind: "unknown",
          hash: commit.hash,
        })
      }
    }
  }

  return badges
}

export interface HistoryFilterState {
  /**
   * Canonical `refs/heads/...`, `refs/remotes/...` or `refs/tags/...` names.
   * An empty array means "All" and is the default.
   */
  readonly refs: readonly string[]
  readonly showRemotes: boolean
  readonly showTags: boolean
}

export const DEFAULT_HISTORY_FILTER: HistoryFilterState = Object.freeze({
  refs: Object.freeze([]) as readonly string[],
  showRemotes: true,
  showTags: true,
})

export function normalizeRefSelection(refs: readonly string[]): string[] {
  const result: string[] = []
  const seen = new Set<string>()
  for (const ref of refs) {
    if (typeof ref !== "string" || ref.length === 0) continue
    if (!SELECTABLE_PREFIXES.some((prefix) => ref.startsWith(prefix))) continue
    if (seen.has(ref)) continue
    seen.add(ref)
    result.push(ref)
    if (result.length >= MAX_LOG_REFS) break
  }
  return result
}

export interface RefMutationChange {
  readonly kind:
    | "rename-branch"
    | "delete-branch"
    | "delete-tag"
    | "checkout"
    | "create-branch"
    | "create-tag"
  readonly oldName?: string
  readonly newName?: string
  readonly name?: string
}

/** Keep an applied filter valid after a ref write (rename maps, delete drops). */
export function reconcileRefFilter(
  refs: readonly string[],
  change: RefMutationChange,
): string[] {
  if (refs.length === 0) return []
  let next = refs.slice()
  if (change.kind === "rename-branch" && change.oldName && change.newName) {
    const oldRef = `refs/heads/${change.oldName}`
    const newRef = `refs/heads/${change.newName}`
    next = next.map((ref) => (ref === oldRef ? newRef : ref))
  } else if (change.kind === "delete-branch" && change.name) {
    const removed = `refs/heads/${change.name}`
    next = next.filter((ref) => ref !== removed)
  } else if (change.kind === "delete-tag" && change.name) {
    const removed = `refs/tags/${change.name}`
    next = next.filter((ref) => ref !== removed)
  }
  return normalizeRefSelection(next)
}

/** Drop filter entries the refreshed typed refs no longer advertise. */
export function filterRefsToAvailable(
  refs: readonly string[],
  typedRefs: readonly GitRef[],
): string[] {
  if (refs.length === 0) return []
  const available = new Set(
    typedRefs
      .map((ref) => canonicalRefName(ref))
      .filter((ref): ref is string => ref !== undefined),
  )
  return normalizeRefSelection(refs.filter((ref) => available.has(ref)))
}

export function historyFilterFingerprint(
  filter: HistoryFilterState,
  firstParent: boolean,
  order: HistoryOrder,
): string {
  return JSON.stringify({
    refs: normalizeRefSelection(filter.refs).slice().sort(),
    showRemotes: filter.showRemotes,
    showTags: filter.showTags,
    firstParent,
    order,
  })
}

export interface HistoryLogSettings {
  readonly filter: HistoryFilterState
  readonly firstParent: boolean
  readonly order: HistoryOrder
}

export interface ExtendedLogInput {
  readonly repositoryId: string
  readonly limit: number
  readonly skip?: number
  readonly refs?: readonly string[]
  readonly showRemotes?: boolean
  readonly showTags?: boolean
  readonly firstParent?: boolean
  readonly order?: HistoryOrder
}

/**
 * Build one log page. When the server does not yet accept the extended input,
 * only the historical fields are sent, byte-for-byte compatible with the old
 * contract.
 */
export function historyLogInput(
  repositoryId: string,
  limit: number,
  skip: number,
  settings: HistoryLogSettings,
  extended: boolean,
): Record<string, unknown> {
  if (!extended) {
    return skip > 0 ? { repositoryId, limit, skip } : { repositoryId, limit }
  }
  const selection = normalizeRefSelection(settings.filter.refs)
  return {
    repositoryId,
    limit,
    ...(skip > 0 ? { skip } : {}),
    ...(selection.length > 0 ? { refs: selection } : {}),
    showRemotes: settings.filter.showRemotes,
    showTags: settings.filter.showTags,
    ...(settings.firstParent ? { firstParent: true } : {}),
    ...(settings.order === "topo" ? { order: "topo" } : {}),
  }
}

/**
 * Graph input for First-parent mode.
 *
 * `git log --first-parent --parents` still reports a merge's full parent list,
 * which detail views need. Graph layout gets a copy with only the traversed
 * first parent so hidden parents cannot appear as unexplained tracks. The
 * original `GitCommit` objects are never mutated.
 */
export function firstParentGraphCommits(
  commits: readonly GitCommit[],
  firstParent: boolean,
): readonly GitCommit[] {
  if (!firstParent) return commits
  return commits.map((commit) =>
    commit.parents.length > 1
      ? { ...commit, parents: commit.parents.slice(0, 1) }
      : commit,
  )
}

/** Whether the current status blocks a checkout (same branch is a no-op). */
export function checkoutBlockedReason(
  status: GitStatus,
  branch: string,
): string | undefined {  if (!status.detached && status.branch === branch) return undefined
  const dirty =
    status.files.length > 0 ||
    status.counts.staged > 0 ||
    status.counts.unstaged > 0 ||
    status.counts.untracked > 0 ||
    status.counts.conflicted > 0
  if (dirty) {
    return "The working tree has changes. Checkout is refused; commit or stash manually first. Forced discard and auto-stash are not available."
  }
  return undefined
}

export interface MenuAction {
  readonly id: string
  readonly label: string
  readonly destructive?: boolean
  readonly disabled?: boolean
}

export interface RpcCapabilities {
  readonly extendedLog: boolean
  readonly comparison: boolean
  readonly checkout: boolean
  readonly createBranch: boolean
  readonly createTag: boolean
  readonly renameBranch: boolean
  readonly deleteBranch: boolean
  readonly deleteTag: boolean
}

export interface RequestOptionsLike {
  readonly location?: { readonly directory: string }
  readonly signal?: AbortSignal
}

export interface MutationResult {
  readonly status: GitStatus
  readonly changed: boolean
  readonly warning?: string
}

export interface MutationBaseInput {
  readonly repositoryId: string
  /** Full 40/64-character HEAD captured when the dialog opens. */
  readonly expectedHead: string | null
  readonly confirmed: true
}

export interface CheckoutBranchInput extends MutationBaseInput {
  readonly branch: string
}

export interface CreateBranchInput extends MutationBaseInput {
  readonly name: string
  readonly startPoint: string
  readonly checkout?: boolean
}

export interface CreateTagInput extends MutationBaseInput {
  readonly name: string
  readonly target: string
  readonly message?: string
}

export interface RenameBranchInput extends MutationBaseInput {
  readonly oldName: string
  readonly newName: string
}

export interface DeleteBranchInput extends MutationBaseInput {
  readonly name: string
}

export interface DeleteTagInput extends MutationBaseInput {
  readonly name: string
}

export interface ExtendedGitGraphRpc {
  getLog(
    input: ExtendedLogInput,
    options?: RequestOptionsLike,
  ): Promise<{ commits: GitCommit[]; hasMore: boolean }>
  getComparisonFiles(
    input: { repositoryId: string; baseHash: string; headHash: string },
    options?: RequestOptionsLike,
  ): Promise<{ files: ChangedFile[] }>
  getComparisonDiff(
    input: { repositoryId: string; baseHash: string; headHash: string; path: string },
    options?: RequestOptionsLike,
  ): Promise<FileDiff>
  getCommitFileContent?(
    input: GetCommitFileContentInput,
    options?: RequestOptionsLike,
  ): Promise<CommitFileContent>
  checkoutBranch(
    input: CheckoutBranchInput,
    options?: RequestOptionsLike,
  ): Promise<MutationResult>
  createBranch(
    input: CreateBranchInput,
    options?: RequestOptionsLike,
  ): Promise<MutationResult>
  createTag(input: CreateTagInput, options?: RequestOptionsLike): Promise<MutationResult>
  renameBranch?(
    input: RenameBranchInput,
    options?: RequestOptionsLike,
  ): Promise<MutationResult>
  deleteBranch?(
    input: DeleteBranchInput,
    options?: RequestOptionsLike,
  ): Promise<MutationResult>
  deleteTag?(input: DeleteTagInput, options?: RequestOptionsLike): Promise<MutationResult>
}

export function extendedClient(rpc: unknown): ExtendedGitGraphRpc {
  return rpc as ExtendedGitGraphRpc
}

/** Remember the element that opened a portal so it can regain focus on close. */
export function captureTriggerFocus(): HTMLElement | undefined {
  if (typeof document === "undefined") return undefined
  return document.activeElement instanceof HTMLElement
    ? document.activeElement
    : undefined
}

/** Restore focus only when the original trigger is still mounted. */
export function restoreTriggerFocus(element: HTMLElement | undefined): void {
  if (!element || !element.isConnected) return
  if (typeof document !== "undefined") {
    const active = document.activeElement
    if (
      active instanceof HTMLElement &&
      active !== element &&
      active.isConnected &&
      active.closest(".gg-menu, .gg-dialog, .gg-branch-selector")
    ) {
      // A newly opened portal already owns focus; never steal it back.
      return
    }
  }
  element.focus()
}

/**
 * Defer the focus restore until the same reactive update has removed/inserted
 * the portal content, so a trigger that is being unmounted does not steal
 * focus back from a newly opened dialog.
 */
export function scheduleTriggerFocus(element: HTMLElement | undefined): void {
  if (!element) return
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => restoreTriggerFocus(element))
  } else {
    globalThis.setTimeout(() => restoreTriggerFocus(element), 0)
  }
}

interface DefinitionLike {
  readonly methods?: Readonly<Record<string, { readonly input?: unknown }>>
}

function methodPresent(
  client: unknown,
  definition: DefinitionLike | undefined,
  name: string,
): boolean {
  if (definition?.methods && name in definition.methods) return true
  return (
    typeof client === "object" &&
    client !== null &&
    typeof (client as Record<string, unknown>)[name] === "function"
  )
}

function schemaHasField(schema: unknown, field: string): boolean {
  if (!schema || typeof schema !== "object") return false
  try {
    const shape = (schema as { readonly shape?: unknown }).shape
    if (shape && typeof shape === "object") return field in shape
    const def = (schema as { readonly _def?: { readonly shape?: unknown } })._def
    return !!def?.shape && typeof def.shape === "object" && field in def.shape
  } catch {
    return false
  }
}

/**
 * Detect server support without importing an updated contract in this file.
 * `definition` is `GitGraphRpc`; after the backend lands, its `getLog` schema
 * gains `refs` and the client gains the new methods.
 */
export function detectRpcCapabilities(
  client: unknown,
  definition?: DefinitionLike,
): RpcCapabilities {
  const logInput = definition?.methods?.getLog?.input
  return {
    extendedLog: schemaHasField(logInput, "refs"),
    comparison:
      methodPresent(client, definition, "getComparisonFiles") &&
      methodPresent(client, definition, "getComparisonDiff"),
    checkout: methodPresent(client, definition, "checkoutBranch"),
    createBranch: methodPresent(client, definition, "createBranch"),
    createTag: methodPresent(client, definition, "createTag"),
    renameBranch: methodPresent(client, definition, "renameBranch"),
    deleteBranch: methodPresent(client, definition, "deleteBranch"),
    deleteTag: methodPresent(client, definition, "deleteTag"),
  }
}

/** `getCommitFileContent` is landing separately; hide real behavior until then. */
export function detectCommitFileContentSupport(
  client: unknown,
  definition?: DefinitionLike,
): boolean {
  // Require the runtime client method too: a harness can expose an older
  // allowlist while the shared definition already carries the new method.
  if (
    typeof client !== "object" ||
    client === null ||
    typeof (client as Record<string, unknown>).getCommitFileContent !== "function"
  ) {
    return false
  }
  return methodPresent(client, definition, "getCommitFileContent")
}

export interface ChangedFileStats {
  readonly added?: number
  readonly deleted?: number
}

/** True when git reported at least one numeric side of the numstat. */
export function hasFileStats(stats: ChangedFileStats): boolean {
  return stats.added !== undefined || stats.deleted !== undefined
}

/**
 * Read optional `added`/`deleted` counts without changing the shared file type.
 * The backend contract adds them as non-negative integers; malformed values are
 * ignored so the row still renders.
 */
export function changedFileStats(file: ChangedFile): ChangedFileStats {
  const source = file as ChangedFile & {
    readonly added?: unknown
    readonly deleted?: unknown
  }
  const count = (value: unknown): number | undefined =>
    typeof value === "number" && Number.isFinite(value) && value >= 0
      ? Math.trunc(value)
      : undefined
  const added = count(source.added)
  const deleted = count(source.deleted)
  return {
    ...(added !== undefined ? { added } : {}),
    ...(deleted !== undefined ? { deleted } : {}),
  }
}

/**
 * A deleted file has no blob in the commit tree, so its "at commit" view would
 * always be `missing`; leave the eye disabled and keep the diff/parent view.
 */
export function canViewFileAtCommit(file: ChangedFile): boolean {
  return file.status !== "deleted"
}

export type CommitFileContentKind = "text" | "binary" | "symlink" | "missing"

export interface CommitFileContent {
  readonly path: string
  readonly mode: string | null
  readonly kind: CommitFileContentKind
  readonly text: string | null
  readonly size: number | null
  readonly truncated?: boolean
}

/**
 * Very large text blobs are returned metadata-only: kind "text", text null,
 * size present and truncated true. This must not render as an empty file or a
 * binary file.
 */
export function isSizeOnlyFileContent(
  content: CommitFileContent | undefined,
): boolean {
  return (
    content?.kind === "text" &&
    content.text === null &&
    content.truncated === true
  )
}

export interface GetCommitFileContentInput {
  readonly repositoryId: string
  readonly hash: string
  readonly path: string
}

export function refMenuActions(
  ref: GitRef,
  currentBranch: string | null,
  capabilities: RpcCapabilities,
): MenuAction[] {
  const actions: MenuAction[] = []
  if (ref.kind === "tag") {
    actions.push({ id: "view-history", label: "View history" })
    actions.push({ id: "copy-name", label: "Copy tag name" })
    if (capabilities.createBranch) {
      actions.push({ id: "create-branch", label: "Create branch here…" })
    }
    if (capabilities.deleteTag) {
      actions.push({
        id: "delete-tag",
        label: "Delete tag…",
        destructive: true,
      })
    }
    return actions
  }

  if (ref.kind === "remote") {
    actions.push({ id: "view-history", label: "View history" })
    actions.push({ id: "copy-name", label: "Copy remote branch name" })
    if (capabilities.createBranch) {
      actions.push({ id: "create-branch", label: "Create branch from here…" })
    }
    return actions
  }

  // branch (and the synthetic HEAD entry)
  actions.push({ id: "view-history", label: "View history" })
  const isCurrent = ref.kind === "branch" && ref.name === currentBranch
  if (ref.kind === "branch" && capabilities.checkout && !isCurrent) {
    actions.push({ id: "checkout", label: "Checkout" })
  }
  actions.push({ id: "copy-name", label: "Copy branch name" })
  if (capabilities.createBranch) {
    actions.push({ id: "create-branch", label: "Create branch here…" })
  }
  if (ref.kind === "branch" && capabilities.renameBranch) {
    actions.push({ id: "rename-branch", label: "Rename branch…" })
  }
  if (ref.kind === "branch" && capabilities.deleteBranch && !isCurrent) {
    actions.push({
      id: "delete-branch",
      label: "Delete branch…",
      destructive: true,
    })
  }
  return actions
}

export type CompareActivationDecision =
  | { readonly kind: "select-base"; readonly commit: GitCommit }
  | {
      readonly kind: "compare"
      readonly base: GitCommit
      readonly head: GitCommit
    }
  | { readonly kind: "same"; readonly explicitBase: boolean }

/** Ctrl on Windows/Linux, Cmd on macOS, or both together. */
export function isCompareModifier(event: {
  readonly ctrlKey: boolean
  readonly metaKey: boolean
}): boolean {
  return event.ctrlKey || event.metaKey
}

function slashPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+/g, "/")
}

/** Absolute repository file path with forward slashes, for host `file:` tabs. */
export function absoluteRepositoryFilePath(
  repositoryRoot: string,
  filePath: string,
): string {
  const root = slashPath(repositoryRoot).replace(/\/+$/, "")
  const file = slashPath(filePath).replace(/^\/+/, "")
  return root.length > 0 ? `${root}/${file}` : file
}

/**
 * Path to pass to `ctx.layout.open('file:' + path, session)`.
 * Workspace-relative when the repository sits under the session directory;
 * otherwise the absolute normalized path (still safer than inventing `../`).
 */
export function workspaceRelativePath(
  sessionDirectory: string,
  repositoryRoot: string,
  filePath: string,
): string {
  const absolute = absoluteRepositoryFilePath(repositoryRoot, filePath)
  const base = slashPath(sessionDirectory).replace(/\/+$/, "")
  if (!base) return absolute
  if (absolute.toLowerCase() === base.toLowerCase()) return filePath
  const prefix = `${base.toLowerCase()}/`
  if (absolute.toLowerCase().startsWith(prefix)) {
    return absolute.slice(base.length + 1)
  }
  return absolute
}

/**
 * Resolve a Ctrl/Cmd+click (or Ctrl/Cmd+Enter/Space) comparison activation.
 *
 * Git Graph semantics: a plain click selects/expands A; Ctrl/Cmd+click B then
 * compares A (the inline selection) → B. An explicit context-menu base takes
 * priority over the inline selection. A same-hash activation never opens an
 * empty comparison: it only clears an explicit base and keeps the inline slot.
 */
export function decideCompareActivation(input: {
  readonly explicitBase?: GitCommit
  readonly selectedCommit?: GitCommit
  readonly target: GitCommit
}): CompareActivationDecision {
  const base = input.explicitBase ?? input.selectedCommit
  if (!base) return { kind: "select-base", commit: input.target }
  if (base.hash === input.target.hash) {
    return { kind: "same", explicitBase: input.explicitBase !== undefined }
  }
  return { kind: "compare", base, head: input.target }
}

export function commitMenuActions(
  commit: GitCommit,
  options: {
    readonly compareBase?: GitCommit
    readonly capabilities: RpcCapabilities
  },
): MenuAction[] {  const actions: MenuAction[] = [
    { id: "view-changes", label: "View changes" },
    { id: "copy-hash", label: "Copy commit hash" },
    { id: "copy-subject", label: "Copy subject" },
  ]
  if (options.capabilities.comparison) {
    actions.push({ id: "select-compare", label: "Select for comparison" })
    if (options.compareBase && options.compareBase.hash !== commit.hash) {
      actions.push({
        id: "compare-selected",
        label: `Compare with ${options.compareBase.hash.slice(0, 7)}`,
      })
    }
  }
  if (options.capabilities.createBranch) {
    actions.push({ id: "create-branch", label: "Create branch here…" })
  }
  if (options.capabilities.createTag) {
    actions.push({ id: "create-tag", label: "Create tag here…" })
  }
  return actions
}
