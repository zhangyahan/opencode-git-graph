import { For, Show, createEffect, createMemo, createSignal, on, onCleanup } from "solid-js"
import { Portal } from "solid-js/web"
import type { GitRef } from "../shared/types.js"
import {
  type HistoryFilterState,
  type RpcCapabilities,
  canonicalRefName,
  captureTriggerFocus,
  refKindLabel,
  scheduleTriggerFocus,
} from "./ref-utils.js"

export interface BranchSelectorProps {
  readonly open: boolean
  readonly repositoryLabel: string
  readonly currentBranch: string | null
  readonly detached: boolean
  readonly refs: readonly GitRef[]
  readonly loading: boolean
  readonly error?: string
  readonly filters: HistoryFilterState
  readonly capabilities: RpcCapabilities
  readonly onApplyFilter: (filter: HistoryFilterState) => void
  readonly onCheckout: (ref: GitRef) => void
  readonly onClose: () => void
}

/**
 * The top-bar "Branches" selector.
 *
 * Two independent groups:
 * - History filter: All refs or a multi-select of local/remote/tag refs. Apply
 *   only reloads history; it never changes HEAD.
 * - Checkout: local branches only, always through a confirmation dialog.
 */
export function BranchSelector(props: BranchSelectorProps) {
  const [allRefs, setAllRefs] = createSignal(true)
  const [selected, setSelected] = createSignal<ReadonlySet<string>>(new Set())
  const [showRemotes, setShowRemotes] = createSignal(true)
  const [showTags, setShowTags] = createSignal(true)
  const [query, setQuery] = createSignal("")
  let searchInput: HTMLInputElement | undefined
  let dialog: HTMLDivElement | undefined
  let trigger: HTMLElement | undefined

  createEffect(
    on(
      () => props.open,
      (open) => {
        if (!open) return
        trigger = captureTriggerFocus()
        // Reset the draft to the applied filter each time the dialog opens.
        setAllRefs(props.filters.refs.length === 0)
        setSelected(new Set<string>(props.filters.refs))
        setShowRemotes(props.filters.showRemotes)
        setShowTags(props.filters.showTags)
        setQuery("")
        const frame =
          typeof requestAnimationFrame === "function"
            ? requestAnimationFrame(() => searchInput?.focus())
            : undefined
        const onKeyDown = (event: KeyboardEvent) => {
          if (event.key === "Escape") {
            event.preventDefault()
            props.onClose()
          }
        }
        // The toolbar stays usable while the selector is open (Show remotes/tags,
        // First parent and Order reload history without touching HEAD). Clicking
        // anywhere else outside the dialog closes it.
        const onPointerDown = (event: PointerEvent) => {
          const target = event.target
          if (!(target instanceof Element)) return
          if (dialog?.contains(target)) return
          if (target.closest(".gg-toolbar")) return
          props.onClose()
        }
        window.addEventListener("keydown", onKeyDown)
        document.addEventListener("pointerdown", onPointerDown, true)
        onCleanup(() => {
          if (frame !== undefined && typeof cancelAnimationFrame === "function") {
            cancelAnimationFrame(frame)
          }
          window.removeEventListener("keydown", onKeyDown)
          document.removeEventListener("pointerdown", onPointerDown, true)
          scheduleTriggerFocus(trigger)
          trigger = undefined
        })
      },
    ),
  )

  // Toolbar toggles changed while the selector is open: mirror the include
  // flags without discarding a draft ref selection or the search query.
  createEffect(() => {
    if (!props.open) return
    const filter = props.filters
    setShowRemotes(filter.showRemotes)
    setShowTags(filter.showTags)
  })

  const selectable = createMemo(() =>
    props.refs
      .filter((ref) => ref.kind !== "head")
      .map((ref) => ({ ref, canonical: canonicalRefName(ref) }))
      .filter((entry): entry is { ref: GitRef; canonical: string } =>
        entry.canonical !== undefined,
      ),
  )

  const matchesQuery = (ref: GitRef): boolean => {
    const needle = query().trim().toLowerCase()
    if (!needle) return true
    return `${ref.name} ${ref.kind} ${ref.hash}`.toLowerCase().includes(needle)
  }

  const groups = createMemo(() => {
    const visible = selectable().filter((entry) => matchesQuery(entry.ref))
    return {
      branch: visible.filter((entry) => entry.ref.kind === "branch"),
      remote: visible.filter((entry) => entry.ref.kind === "remote"),
      tag: visible.filter((entry) => entry.ref.kind === "tag"),
    }
  })

  const localBranches = createMemo(() =>
    selectable()
      .filter((entry) => entry.ref.kind === "branch" && matchesQuery(entry.ref))
      .map((entry) => entry.ref),
  )

  function toggle(canonical: string): void {
    setAllRefs(false)
    setSelected((previous) => {
      const next = new Set(previous)
      if (next.has(canonical)) next.delete(canonical)
      else next.add(canonical)
      return next
    })
  }

  function apply(): void {
    if (!props.capabilities.extendedLog) return
    props.onApplyFilter({
      refs: allRefs() ? [] : Array.from(selected()),
      showRemotes: showRemotes(),
      showTags: showTags(),
    })
  }

  const canApply = () =>
    props.capabilities.extendedLog && (allRefs() || selected().size > 0)

  return (
    <Show when={props.open}>
      <Portal mount={typeof document === "undefined" ? undefined : document.body}>
        <div
          class="gg-dialog-backdrop gg-branch-selector-backdrop"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) props.onClose()
          }}
        >
          <div
            ref={(element) => {
              dialog = element
            }}
            class="gg-branch-selector"
            role="dialog"
            aria-modal="true"
            aria-label="Branches"
            data-testid="branch-selector"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div class="gg-branch-selector-head">
              <div>
                <div class="gg-dialog-title">Branches</div>
                <div class="gg-dialog-hint" title={props.repositoryLabel}>
                  {props.repositoryLabel}
                </div>
              </div>
              <button
                type="button"
                class="gg-icon-button"
                aria-label="Close branches"
                data-testid="branch-selector-close"
                onClick={() => props.onClose()}
              >
                ×
              </button>
            </div>

            <div class="gg-branch-selector-search">
              <input
                ref={(element) => {
                  searchInput = element
                }}
                type="search"
                aria-label="Search refs"
                data-testid="branch-filter-search"
                placeholder="Filter branches, remotes and tags"
                value={query()}
                onInput={(event) => setQuery(event.currentTarget.value)}
              />
            </div>

            <div class="gg-branch-selector-scroll">
              <Show when={props.loading}>
                <div class="gg-status" role="status">Loading refs…</div>
              </Show>
              <Show when={props.error}>
                {(message) => (
                  <div class="gg-error" role="alert">
                    Refs could not be loaded: {message()}. History is still
                    available.
                  </div>
                )}
              </Show>
              <section
                class="gg-selector-group"
                data-testid="branch-filter"
                aria-label="History filter"
              >
                <div class="gg-selector-heading">History filter</div>
                <label class="gg-check-row">
                  <input
                    type="radio"
                    name="gg-ref-filter-mode"
                    checked={allRefs()}
                    data-testid="branch-filter-all"
                    onChange={() => {
                      setAllRefs(true)
                      setSelected(new Set<string>())
                    }}
                  />
                  <span>All refs</span>
                </label>
                <label class="gg-check-row">
                  <input
                    type="radio"
                    name="gg-ref-filter-mode"
                    checked={!allRefs()}
                    data-testid="branch-filter-selected"
                    onChange={() => setAllRefs(false)}
                  />
                  <span>Selected refs…</span>
                </label>
                <Show when={allRefs()}>
                  <div class="gg-check-row gg-check-row-nested">
                    <label>
                      <input
                        type="checkbox"
                        checked={showRemotes()}
                        data-testid="filter-show-remotes"
                        onChange={(event) =>
                          setShowRemotes(event.currentTarget.checked)
                        }
                      />
                      <span>Include remotes</span>
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={showTags()}
                        data-testid="filter-show-tags"
                        onChange={(event) =>
                          setShowTags(event.currentTarget.checked)
                        }
                      />
                      <span>Include tags</span>
                    </label>
                  </div>
                </Show>

                <For each={(["branch", "remote", "tag"] as const)}>
                  {(kind) => (
                    <Show when={groups()[kind].length > 0}>
                      <div class="gg-selector-subheading">
                        {kind === "branch"
                          ? "Local branches"
                          : kind === "remote"
                            ? "Remote branches"
                            : "Tags"}
                      </div>
                      <For each={groups()[kind]}>
                        {(entry) => (
                          <label class="gg-check-row">
                            <input
                              type="checkbox"
                              data-testid="branch-filter-ref"
                              data-ref-kind={entry.ref.kind}
                              value={entry.canonical}
                              checked={selected().has(entry.canonical)}
                              onChange={() => toggle(entry.canonical)}
                            />
                            <span class="gg-ref-name">{entry.ref.name}</span>
                            <span class="gg-muted">{refKindLabel(entry.ref.kind)}</span>
                          </label>
                        )}
                      </For>
                    </Show>
                  )}
                </For>
                <Show when={!allRefs() && selected().size === 0}>
                  <div class="gg-warning">
                    Select at least one ref, or choose All refs.
                  </div>
                </Show>

                <Show when={!props.capabilities.extendedLog}>
                  <div class="gg-notice">
                    The connected server does not support ref filters yet. The
                    filter is shown but cannot be applied.
                  </div>
                </Show>

                <div class="gg-selector-actions">
                  <button
                    type="button"
                    data-testid="apply-branch-filter"
                    disabled={!canApply()}
                    onClick={() => apply()}
                  >
                    Apply filter
                  </button>
                </div>
              </section>

              <section
                class="gg-selector-group"
                data-testid="checkout-group"
                aria-label="Checkout"
              >
                <div class="gg-selector-heading">Checkout</div>
                <Show
                  when={props.capabilities.checkout}
                  fallback={
                    <div class="gg-notice">
                      Checkout is unavailable until the server exposes the
                      mutation API.
                    </div>
                  }
                >
                  <Show
                    when={!props.detached}
                    fallback={
                      <div class="gg-muted">
                        Detached HEAD: choose a local branch below.
                      </div>
                    }
                  >
                    <div class="gg-muted">
                      Current branch: {props.currentBranch ?? "(none)"}
                    </div>
                  </Show>
                  <Show
                    when={localBranches().length > 0}
                    fallback={<div class="gg-muted">No local branches.</div>}
                  >
                    <For each={localBranches()}>
                      {(branch) => {
                        const current = () =>
                          !props.detached && branch.name === props.currentBranch
                        return (
                          <button
                            type="button"
                            class="gg-branch-row"
                            data-testid="checkout-branch-row"
                            data-branch={branch.name}
                            disabled={current()}
                            title={
                              current()
                                ? "Already checked out"
                                : `Checkout ${branch.name}`
                            }
                            onClick={() => props.onCheckout(branch)}
                          >
                            <span class="gg-ref-name">{branch.name}</span>
                            <span class="gg-muted">
                              {current() ? "current" : "Checkout…"}
                            </span>
                          </button>
                        )
                      }}
                    </For>
                  </Show>
                </Show>
              </section>
            </div>

            <div class="gg-dialog-actions">
              <button type="button" onClick={() => props.onClose()}>
                Close
              </button>
            </div>
          </div>
        </div>
      </Portal>
    </Show>
  )
}
