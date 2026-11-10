import { Show, createEffect, onCleanup } from "solid-js"
import { Portal } from "solid-js/web"
import type { CommitFileContent } from "./ref-utils.js"
import {
  captureTriggerFocus,
  isSizeOnlyFileContent,
  scheduleTriggerFocus,
} from "./ref-utils.js"

export interface CommitFileContentViewProps {
  readonly open: boolean
  readonly path: string
  readonly hash: string
  readonly loading: boolean
  readonly content?: CommitFileContent
  readonly error?: string
  readonly onClose: () => void
  readonly onRetry: () => void
}

function formatSize(size: number | null | undefined): string {
  if (typeof size !== "number" || !Number.isFinite(size) || size < 0) return "—"
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KiB`
  return `${(size / (1024 * 1024)).toFixed(1)} MiB`
}

/** Read-only historical file content, shown in a portal above the panel. */
export function CommitFileContentView(props: CommitFileContentViewProps) {
  let trigger: HTMLElement | undefined

  createEffect(() => {
    if (!props.open) return
    trigger = captureTriggerFocus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        props.onClose()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    onCleanup(() => {
      window.removeEventListener("keydown", onKeyDown)
      scheduleTriggerFocus(trigger)
      trigger = undefined
    })
  })

  const kindLabel = (): string => {
    switch (props.content?.kind) {
      case "text":
        return "Text"
      case "binary":
        return "Binary"
      case "symlink":
        return "Symlink"
      case "missing":
        return "Missing"
      default:
        return "File"
    }
  }

  const isGitlink = (): boolean => props.content?.mode === "160000"

  return (
    <Show when={props.open}>
      <Portal mount={typeof document === "undefined" ? undefined : document.body}>
        <div
          class="gg-dialog-backdrop"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) props.onClose()
          }}
        >
          <div
            class="gg-file-content"
            role="dialog"
            aria-modal="true"
            aria-label="File at commit"
            data-testid="commit-file-content"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <div class="gg-file-content-head">
              <div class="gg-file-content-title">
                <span class="gg-file-content-path" title={props.path}>
                  {props.path}
                </span>
                <span class="gg-muted">
                  {kindLabel()} · {formatSize(props.content?.size)} · at{" "}
                  <span class="gg-file-content-hash">{props.hash.slice(0, 7)}</span>
                  {props.content?.mode ? ` · mode ${props.content.mode}` : ""}
                </span>
              </div>
              <button
                type="button"
                class="gg-icon-button"
                data-testid="commit-file-content-close"
                aria-label="Close file content"
                onClick={() => props.onClose()}
              >
                ×
              </button>
            </div>

            <div class="gg-file-content-body">
              <Show when={props.loading}>
                <div class="gg-status" role="status">
                  Loading file at commit…
                </div>
              </Show>
              <Show when={props.error}>
                {(message) => (
                  <div class="gg-error">
                    <span>{message()}</span>
                    <button type="button" onClick={() => props.onRetry()}>
                      Retry
                    </button>
                  </div>
                )}
              </Show>
              <Show when={!props.loading && !props.error && props.content}>
                {(content) => (
                  <Show
                    when={isSizeOnlyFileContent(content())}
                    fallback={
                      <Show
                        when={content().kind === "text"}
                        fallback={
                          <div class="gg-file-content-notice">
                            {content().kind === "binary"
                              ? "Binary file. No textual content is available."
                              : content().kind === "symlink"
                                ? `Symbolic link: ${content().text ?? ""}`
                                : isGitlink()
                                  ? "Submodule / gitlink has no file content at this commit."
                                  : "This file does not exist at the selected commit."}
                          </div>
                        }
                      >
                        <Show when={content().truncated}>
                          <div class="gg-warning">
                            Content truncated by the server.
                          </div>
                        </Show>
                        <pre class="gg-file-content-text" data-testid="commit-file-content-text">
                          {content().text ?? ""}
                        </pre>
                      </Show>
                    }
                  >
                    <div
                      class="gg-file-content-notice"
                      data-testid="commit-file-content-size-only"
                    >
                      File is larger than 20 MiB; only the size is shown (
                      {formatSize(content().size)}).
                    </div>
                  </Show>
                )}
              </Show>
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
