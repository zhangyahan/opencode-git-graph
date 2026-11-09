/**
 * Latest-only async request sequencing.
 *
 * Each channel owns one in-flight request. Starting a new request aborts the
 * previous `AbortSignal` and bumps a generation counter, so a late reply from
 * the old request is reported as discarded even when the transport ignores the
 * signal. Separate channels keep unrelated work (graph, commit files, diff)
 * from cancelling each other.
 */

export interface LatestSuccess<T> {
  readonly accepted: true
  readonly aborted: false
  readonly value: T
}

export interface LatestDiscarded {
  readonly accepted: false
  readonly aborted: true
}

export interface LatestFailure {
  readonly accepted: false
  readonly aborted: false
  readonly error: unknown
}

export type LatestResult<T> = LatestSuccess<T> | LatestDiscarded | LatestFailure

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { readonly name?: unknown }).name === "AbortError"
  )
}

export class LatestRequest {
  #version = 0
  #controller: AbortController | undefined
  #disposed = false

  /**
   * Run `task` as the newest request. The previous request, if any, is
   * aborted. A result is `accepted` only while this request is still the
   * newest one and the controller has not been aborted.
   */
  run<T>(task: (signal: AbortSignal) => Promise<T>): Promise<LatestResult<T>> {
    if (this.#disposed) {
      return Promise.resolve({ accepted: false, aborted: true })
    }

    const version = ++this.#version
    this.#controller?.abort()
    const controller = new AbortController()
    this.#controller = controller

    return (async (): Promise<LatestResult<T>> => {
      try {
        const value = await task(controller.signal)
        if (this.#isCurrent(version, controller)) {
          return { accepted: true, aborted: false, value }
        }
        return { accepted: false, aborted: true }
      } catch (error) {
        if (this.#isCurrent(version, controller) && !isAbortError(error)) {
          return { accepted: false, aborted: false, error }
        }
        return { accepted: false, aborted: true }
      } finally {
        if (this.#controller === controller) this.#controller = undefined
      }
    })()
  }

  /** Abort the current request and reject any later reply as stale. */
  cancel(): void {
    this.#version += 1
    this.#controller?.abort()
    this.#controller = undefined
  }

  /** Permanently stop this channel and abort the current request. */
  dispose(): void {
    this.#disposed = true
    this.cancel()
  }

  get active(): boolean {
    return this.#controller !== undefined
  }

  #isCurrent(version: number, controller: AbortController): boolean {
    return !this.#disposed && version === this.#version && !controller.signal.aborted
  }
}
