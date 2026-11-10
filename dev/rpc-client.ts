import {
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

function isMethod(value: string): value is HarnessMethod {
  return HARNESS_METHOD_SET.has(value)
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
      return new Proxy(
        {},
        {
          get(_target, property) {
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
