import { For, Show, createEffect, createSignal, onCleanup } from "solid-js"
import { Portal } from "solid-js/web"
import type { MenuAction } from "./ref-utils.js"
import { captureTriggerFocus, scheduleTriggerFocus } from "./ref-utils.js"

export interface ContextMenuProps {
  readonly open: boolean
  readonly x: number
  readonly y: number
  readonly title?: string
  readonly items: readonly MenuAction[]
  readonly testId: string
  readonly ariaLabel: string
  readonly onSelect: (id: string) => void
  readonly onClose: () => void
}

const EDGE = 8

/**
 * One portal-rendered context menu shared by ref badges and commit rows.
 *
 * It is `position: fixed` inside a full-viewport backdrop so the panel's
 * `overflow: hidden` can never clip it. Escape/outside pointerdown close it and
 * the first enabled item receives focus when it opens.
 */
export function ContextMenu(props: ContextMenuProps) {
  const [left, setLeft] = createSignal(0)
  const [top, setTop] = createSignal(0)
  let menu: HTMLDivElement | undefined
  let trigger: HTMLElement | undefined

  function place(): void {
    if (!menu || typeof window === "undefined") return
    const rect = menu.getBoundingClientRect()
    const maxLeft = Math.max(EDGE, window.innerWidth - rect.width - EDGE)
    const maxTop = Math.max(EDGE, window.innerHeight - rect.height - EDGE)
    setLeft(Math.min(Math.max(EDGE, props.x), maxLeft))
    setTop(Math.min(Math.max(EDGE, props.y), maxTop))
  }

  function focusFirst(): void {
    const first = menu?.querySelector<HTMLButtonElement>(
      "[role='menuitem']:not(:disabled)",
    )
    first?.focus()
  }

  createEffect(() => {
    if (!props.open) return
    trigger = captureTriggerFocus()
    // Wait for the portal content so the measured size is real, then clamp.
    const frame =
      typeof requestAnimationFrame === "function"
        ? requestAnimationFrame(() => {
            place()
            focusFirst()
          })
        : undefined
    if (typeof requestAnimationFrame !== "function") {
      place()
      focusFirst()
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        props.onClose()
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

  function navigate(event: KeyboardEvent, direction: 1 | -1): void {
    if (!menu) return
    const items = Array.from(
      menu.querySelectorAll<HTMLButtonElement>("[role='menuitem']:not(:disabled)"),
    )
    if (items.length === 0) return
    const current = items.indexOf(document.activeElement as HTMLButtonElement)
    let next: number
    if (direction === 1) next = current < 0 ? 0 : (current + 1) % items.length
    else next = current <= 0 ? items.length - 1 : current - 1
    items[next]?.focus()
  }

  return (
    <Show when={props.open}>
      <Portal mount={typeof document === "undefined" ? undefined : document.body}>
        <div
          class="gg-menu-backdrop"
          data-testid="menu-backdrop"
          onPointerDown={(event) => {
            event.preventDefault()
            props.onClose()
          }}
          onContextMenu={(event) => {
            event.preventDefault()
            props.onClose()
          }}
        >
          <div
            ref={(element) => {
              menu = element
              place()
            }}
            class="gg-menu"
            data-testid={props.testId}
            role="menu"
            aria-label={props.ariaLabel}
            style={{ left: `${left()}px`, top: `${top()}px` }}
            onPointerDown={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.preventDefault()}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault()
                navigate(event, 1)
              } else if (event.key === "ArrowUp") {
                event.preventDefault()
                navigate(event, -1)
              } else if (event.key === "Home") {
                event.preventDefault()
                menu
                  ?.querySelector<HTMLButtonElement>(
                    "[role='menuitem']:not(:disabled)",
                  )
                  ?.focus()
              } else if (event.key === "End") {
                event.preventDefault()
                const items = menu?.querySelectorAll<HTMLButtonElement>(
                  "[role='menuitem']:not(:disabled)",
                )
                items?.[items.length - 1]?.focus()
              } else if (event.key === "Escape") {
                event.preventDefault()
                props.onClose()
              }
            }}
          >
            <Show when={props.title}>
              {(title) => <div class="gg-menu-title">{title()}</div>}
            </Show>
            <For each={props.items}>
              {(item) => (
                <button
                  type="button"
                  role="menuitem"
                  class={
                    item.destructive
                      ? "gg-menu-item gg-menu-item-danger"
                      : "gg-menu-item"
                  }
                  disabled={item.disabled}
                  data-action={item.id}
                  onClick={() => {
                    props.onSelect(item.id)
                  }}
                >
                  {item.label}
                </button>
              )}
            </For>
          </div>
        </div>
      </Portal>
    </Show>
  )
}
