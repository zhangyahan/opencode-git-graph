import {
  EVENTS_PATH,
  GRAPH_CHANGED_EVENT,
  HARNESS_METHOD_SET,
  RPC_PATH_PREFIX,
  methodsForMode,
  type HarnessMethod,
  type UiMode,
} from "./protocol.js"

/**
 * Browser-side RPC client for the dev harness.
 *
 * It mirrors the production panel contract (`client.rpc(definition)`) and
 * exposes only the methods allowed by the mode injected at build time. FR mode
 * never exposes mutation methods in the browser, even though the bridge also
 * rejects them server-side.
 */

export class GitGraphRpcError extends Error {
  readonly type: string
  readonly data: unknown

  constructor(type: string, message: string, data?: unknown) {
    super(message)
    this.name = "GitGraphRpcError"
    this.type = type
    this.data = data
  }
}

export interface HarnessRpcOptions {
  signal?: AbortSignal
  /** Accepted for API compatibility with the host client; the root is fixed. */
  location?: { directory: string }
}

type RpcPayload = {
  ok?: boolean
  result?: unknown
  error?: { type?: unknown; message?: unknown; data?: unknown }
}

export interface HarnessEventOptions {
  signal?: AbortSignal
}

/**
 * Payload delivered by the harness event channel. It mirrors the production
 * host shape (`location` attached by the host, watcher data in `data`); the
 * wire `type` is the local event name because the bridge is same-origin.
 */
export interface HarnessGraphChangedEvent {
  type: string
  location: { directory: string }
  data: { repositoryId: string; kind?: "refs" | "worktree" }
}

export type HarnessEventHandler = (event: HarnessGraphChangedEvent) => void

/**
 * `rpc.events.on` in the production client takes the local event key
 * (`"graphChanged"`). Accept the fully qualified aliases too so a test can use
 * the raw wire name without changing the panel.
 */
const EVENT_NAMES: ReadonlySet<string> = new Set([
  GRAPH_CHANGED_EVENT,
  `git-graph.${GRAPH_CHANGED_EVENT}`,
  `rpc.git-graph.${GRAPH_CHANGED_EVENT}`,
])

function isMethod(value: string): value is HarnessMethod {
  return HARNESS_METHOD_SET.has(value)
}

function isGraphChangedEvent(value: unknown): value is HarnessGraphChangedEvent {
  if (typeof value !== "object" || value === null) return false
  const record = value as Record<string, unknown>
  if (typeof record.type !== "string") return false
  const location = record.location
  if (typeof location !== "object" || location === null) return false
  if (typeof (location as Record<string, unknown>).directory !== "string") return false
  const data = record.data
  if (typeof data !== "object" || data === null) return false
  return typeof (data as Record<string, unknown>).repositoryId === "string"
}

/**
 * Subscribe to the bridge's read-only SSE stream.
 *
 * `EventSource` reconnects on transport errors. The returned cleanup (also
 * invoked by `signal`) removes the listener and closes the stream; no polling
 * timer exists here.
 */
function subscribeGraphChanged(
  name: string,
  handler: HarnessEventHandler,
  options: HarnessEventOptions = {},
): () => void {
  if (!EVENT_NAMES.has(name)) {
    throw new GitGraphRpcError(
      "invalid_input",
      `Unsupported Git Graph event: ${JSON.stringify(name)}`,
    )
  }

  const source = new EventSource(EVENTS_PATH)
  let disposed = false

  const listener = (message: Event) => {
    const data = (message as MessageEvent<unknown>).data
    if (typeof data !== "string") return
    let payload: unknown
    try {
      payload = JSON.parse(data)
    } catch {
      return
    }
    if (isGraphChangedEvent(payload)) handler(payload)
  }

  source.addEventListener(GRAPH_CHANGED_EVENT, listener)

  const dispose = () => {
    if (disposed) return
    disposed = true
    source.removeEventListener(GRAPH_CHANGED_EVENT, listener)
    source.close()
    options.signal?.removeEventListener("abort", dispose)
  }

  const signal = options.signal
  if (signal) {
    if (signal.aborted) {
      dispose()
    } else {
      signal.addEventListener("abort", dispose, { once: true })
    }
  }

  return dispose
}

function createEvents() {
  return {
    on(name: string, handler: HarnessEventHandler, options?: HarnessEventOptions): () => void {
      return subscribeGraphChanged(name, handler, options)
    },
    subscribe(): AsyncIterable<never> {
      throw new GitGraphRpcError(
        "invalid_input",
        "rpc.events.subscribe is not supported by the dev harness; use events.on instead",
      )
    },
  }
}

async function call(
  method: HarnessMethod,
  input: unknown,
  options: HarnessRpcOptions = {},
): Promise<unknown> {
  const response = await fetch(`${RPC_PATH_PREFIX}${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input ?? {}),
    signal: options.signal,
    credentials: "same-origin",
    cache: "no-store",
  })

  let payload: RpcPayload | undefined
  try {
    payload = (await response.json()) as RpcPayload
  } catch {
    payload = undefined
  }

  if (!response.ok || payload?.ok !== true) {
    const type = typeof payload?.error?.type === "string" ? payload.error.type : "rpc.internal"
    const message =
      typeof payload?.error?.message === "string"
        ? payload.error.message
        : `Git Graph RPC failed with HTTP ${response.status}`
    throw new GitGraphRpcError(type, message, payload?.error?.data)
  }

  return payload.result
}

/**
 * The minimal client shape the production panel reads from
 * `session.server.client`. Unknown or disallowed methods are not exposed.
 */
export function createHarnessClient(mode: UiMode = "fr") {
  const allowed = methodsForMode(mode)
  return {
    rpc(_definition: unknown) {
      const events = createEvents()
      return new Proxy(
        {},
        {
          get(_target, property) {
            // The production panel reads `rpc.events.on(...)` before any method.
            if (property === "events") return events
            if (typeof property !== "string" || !isMethod(property) || !allowed.has(property)) {
              return undefined
            }
            return (input: unknown, options?: HarnessRpcOptions) =>
              call(property, input, options)
          },
        },
      )
    },
  }
}
