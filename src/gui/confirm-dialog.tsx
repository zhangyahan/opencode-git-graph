import { For, Show, createEffect, onCleanup } from "solid-js"
import { Portal } from "solid-js/web"
import { captureTriggerFocus, scheduleTriggerFocus } from "./ref-utils.js"

export interface ConfirmField {
  readonly id: string
  readonly label: string
  readonly value: string
  readonly placeholder?: string
  readonly description?: string
  readonly required?: boolean
  readonly multiline?: boolean
  readonly readonly?: boolean
}

export interface ConfirmFact {
  readonly label: string
  readonly value: string
}

export interface ConfirmDialogProps {
  readonly open: boolean
  readonly title: string
  readonly description?: string
  readonly facts?: readonly ConfirmFact[]
  readonly fields?: readonly ConfirmField[]
  readonly warning?: string
  readonly error?: string
  readonly busy?: boolean
  readonly danger?: boolean
  readonly confirmLabel: string
  readonly cancelLabel?: string
  readonly confirmTestId?: string
  readonly cancelTestId?: string
  readonly confirmDisabled?: boolean
  readonly onFieldInput?: (id: string, value: string) => void
  readonly onConfirm: () => void
  readonly onCancel: () => void
}

/**
 * Solid-owned confirmation dialog. The host may not implement
 * `window.confirm`/`window.prompt`, so every confirmation and every name input
 * goes through this component (also used by the test harness).
 */
export function ConfirmDialog(props: ConfirmDialogProps) {
  let panel: HTMLDivElement | undefined
  let trigger: HTMLElement | undefined

  const requiredMissing = () =>
    (props.fields ?? []).some(
      (field) => field.required && field.value.trim().length === 0,
    )
  const confirmDisabled = () =>
    props.busy === true || props.confirmDisabled === true || requiredMissing()

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
              panel?.querySelector<HTMLElement>("input, textarea, button") ??
              panel
            target?.focus()
          })
        : undefined
    if (typeof requestAnimationFrame !== "function") {
      panel?.querySelector<HTMLElement>("input, textarea, button")?.focus()
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
          data-testid="dialog-backdrop"
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
            aria-label={props.title}
            data-testid="confirm-dialog"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div class="gg-dialog-title">{props.title}</div>
            <Show when={props.description}>
              {(text) => <p class="gg-dialog-description">{text()}</p>}
            </Show>

            <Show when={(props.facts?.length ?? 0) > 0}>
              <dl class="gg-dialog-facts">
                <For each={props.facts}>
                  {(fact) => (
                    <>
                      <dt>{fact.label}</dt>
                      <dd title={fact.value}>{fact.value}</dd>
                    </>
                  )}
                </For>
              </dl>
            </Show>

            <Show when={props.warning}>
              {(text) => <div class="gg-warning">{text()}</div>}
            </Show>

            <For each={props.fields}>
              {(field) => (
                <label class="gg-dialog-field">
                  <span>{field.label}</span>
                  <Show
                    when={field.multiline}
                    fallback={
                      <input
                        type="text"
                        data-testid={`confirm-field-${field.id}`}
                        aria-label={field.label}
                        placeholder={field.placeholder}
                        value={field.value}
                        disabled={props.busy}
                        readOnly={field.readonly}
                        onInput={(event) =>
                          props.onFieldInput?.(field.id, event.currentTarget.value)
                        }
                      />
                    }
                  >
                    <textarea
                      data-testid={`confirm-field-${field.id}`}
                      aria-label={field.label}
                      placeholder={field.placeholder}
                      value={field.value}
                      disabled={props.busy}
                      rows={3}
                      onInput={(event) =>
                        props.onFieldInput?.(field.id, event.currentTarget.value)
                      }
                    />
                  </Show>
                  <Show when={field.description}>
                    {(text) => <span class="gg-dialog-hint">{text()}</span>}
                  </Show>
                </label>
              )}
            </For>

            <Show when={props.error}>
              {(text) => (
                <div class="gg-error" role="alert">
                  {text()}
                </div>
              )}
            </Show>

            <div class="gg-dialog-actions">
              <button
                type="button"
                data-testid={props.cancelTestId ?? "confirm-cancel"}
                disabled={props.busy}
                onClick={() => close()}
              >
                {props.cancelLabel ?? "Cancel"}
              </button>
              <button
                type="button"
                class={props.danger ? "gg-danger-button" : "gg-primary-button"}
                data-testid={props.confirmTestId ?? "confirm-action"}
                disabled={confirmDisabled()}
                onClick={() => props.onConfirm()}
              >
                {props.busy ? "Working…" : props.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      </Portal>
    </Show>
  )
}
