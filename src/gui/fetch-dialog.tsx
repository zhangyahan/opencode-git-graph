import { For, Show, createEffect, onCleanup } from "solid-js"
import { Portal } from "solid-js/web"
import { captureTriggerFocus, scheduleTriggerFocus } from "./ref-utils.js"

export interface FetchDialogProps {
  readonly open: boolean
  readonly repositoryLabel: string
  readonly expectedHead: string | null
  readonly remotes: readonly string[]
  readonly selectedRemote: string | null
  readonly prune: boolean
  readonly busy: boolean
  readonly error?: string
  readonly onRemoteChange: (remote: string | null) => void
  readonly onPruneChange: (prune: boolean) => void
  readonly onConfirm: () => void
  readonly onCancel: () => void
}

/**
 * Fetch confirmation dialog. A fetch is a network mutation, so it always asks
 * first and captures the expected HEAD. Remote selection is either All remotes
 * (empty value) or one of the remotes discovered from the loaded refs.
 */
export function FetchDialog(props: FetchDialogProps) {
  let panel: HTMLDivElement | undefined
  let trigger: HTMLElement | undefined

  function close(): void {
    if (props.busy) return
    props.onCancel()
  }

  createEffect(() => {
    if (!props.open) return
    trigger = captureTriggerFocus()
    const frame =
      typeof requestAnimationFrame === "function"
        ? requestAnimationFrame(() => {
            const target =
              panel?.querySelector<HTMLElement>("select, input, button") ?? panel
            target?.focus()
          })
        : undefined
    if (typeof requestAnimationFrame !== "function") {
      panel?.querySelector<HTMLElement>("select, input, button")?.focus()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        close()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    onCleanup(() => {
      if (frame !== undefined && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(frame)
      }
      window.removeEventListener("keydown", onKeyDown)
      scheduleTriggerFocus(trigger)
      trigger = undefined
    })
  })

  return (
    <Show when={props.open}>
      <Portal mount={typeof document === "undefined" ? undefined : document.body}>
        <div
          class="gg-dialog-backdrop"
          data-testid="fetch-backdrop"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) close()
          }}
        >
          <div
            ref={(element) => {
              panel = element
            }}
            class="gg-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Fetch"
            data-testid="fetch-dialog"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div class="gg-dialog-title">Fetch</div>
            <p class="gg-dialog-description">
              Fetch from the selected remote. This updates remote-tracking branches and never
              merges, rebases or changes the working tree.
            </p>

            <dl class="gg-dialog-facts">
              <dt>Repository</dt>
              <dd title={props.repositoryLabel}>{props.repositoryLabel}</dd>
              <dt>Expected HEAD</dt>
              <dd
                data-testid="fetch-expected-head"
                title={props.expectedHead ?? "(unborn HEAD)"}
              >
                {props.expectedHead ?? "(unborn HEAD)"}
              </dd>
            </dl>

            <label class="gg-dialog-field">
              <span>Remote</span>
              <select
                data-testid="fetch-remote-select"
                name="remote"
                aria-label="Remote"
                value={props.selectedRemote ?? ""}
                disabled={props.busy}
                onChange={(event) =>
                  props.onRemoteChange(
                    event.currentTarget.value.length > 0
                      ? event.currentTarget.value
                      : null,
                  )
                }
              >
                <option value="" data-testid="fetch-remote-all">
                  All remotes
                </option>
                <For each={props.remotes}>
                  {(remote) => (
                    <option value={remote} data-testid="fetch-remote-option">
                      {remote}
                    </option>
                  )}
                </For>
              </select>
            </label>

            <label class="gg-check-row">
              <input
                type="checkbox"
                data-testid="fetch-prune"
                checked={props.prune}
                disabled={props.busy}
                onChange={(event) => props.onPruneChange(event.currentTarget.checked)}
              />
              <span>Prune deleted remote-tracking branches</span>
            </label>

            <Show when={props.error}>
              {(text) => (
                <div class="gg-error" role="alert" data-testid="fetch-error">
                  {text()}
                </div>
              )}
            </Show>

            <div class="gg-dialog-actions">
              <button
                type="button"
                data-testid="fetch-cancel"
                disabled={props.busy}
                onClick={() => close()}
              >
                Cancel
              </button>
              <button
                type="button"
                class="gg-primary-button"
                data-testid="fetch-confirm"
                disabled={props.busy}
                onClick={() => props.onConfirm()}
              >
                {props.busy ? "Fetching…" : "Fetch"}
              </button>
            </div>
          </div>
        </div>
      </Portal>
    </Show>
  )
}
