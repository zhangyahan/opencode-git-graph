import path from "node:path"
import { pathToFileURL } from "node:url"
import type { IncomingMessage, ServerResponse } from "node:http"
import type { Plugin, ViteDevServer } from "vite"
import type { GitGraphManager } from "../src/server/repository/manager.js"
import {
  ALLOWED_HOST,
  ALLOWED_ORIGIN,
  FR_ROOT,
  HARNESS_METHOD_SET,
  MAX_BODY_BYTES,
  RPC_PATH_PREFIX,
} from "./protocol.js"

/**
 * Dev-only HTTP bridge for the Git Graph panel harness.
 *
 * The bridge loads the real server modules through Vite's SSR module runner, so
 * the harness exercises the same RepositoryManager, RPC handlers and zod
 * schemas as the plugin. It is never part of the production bundle.
 */

type RuntimeSchema = {
  safeParse(value: unknown):
    | { success: true; data: unknown }
    | { success: false; error: unknown }
}

type RuntimeMethod = {
  input: RuntimeSchema
  output: RuntimeSchema
  errors?: Record<string, RuntimeSchema>
}

type RuntimeDefinition = {
  methods: Record<string, RuntimeMethod>
}

type HandlerContext = {
  signal: AbortSignal
  error: (type: string, message: string, data?: unknown) => unknown
}

type Handler = (input: unknown, context: HandlerContext) => Promise<unknown>
type HandlerMap = Record<string, Handler>
type RuntimeManager = GitGraphManager & { dispose(): void }
type ManagerConstructor = new (root: string) => RuntimeManager

type Runtime = {
  manager: RuntimeManager
  handlers: HandlerMap
  definition: RuntimeDefinition
}

interface BridgeErrorBody {
  type: string
  message: string
  data?: unknown
}

const HANDLER_ERROR = Symbol("git-graph-dev.handler-error")

function makeHandlerError(type: string, message: string, data?: unknown): BridgeErrorBody {
  const error: BridgeErrorBody = { type, message }
  if (data !== undefined) error.data = data
  Object.defineProperty(error, HANDLER_ERROR, { value: true })
  return error
}

function isHandlerError(value: unknown): value is BridgeErrorBody {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<PropertyKey, unknown>)[HANDLER_ERROR] === true
  )
}

function statusForError(type: string): number {
  switch (type) {
    case "repository_not_found":
      return 404
    case "invalid_input":
      return 400
    case "git_failed":
      return 502
    case "disposed":
      return 503
    default:
      return 500
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.writableEnded || res.destroyed) return
  res.statusCode = status
  res.setHeader("content-type", "application/json; charset=utf-8")
  res.setHeader("cache-control", "no-store")
  res.setHeader("x-content-type-options", "nosniff")
  res.end(JSON.stringify(body))
}

function sendError(
  res: ServerResponse,
  status: number,
  type: string,
  message: string,
  data?: unknown,
): void {
  const error: BridgeErrorBody = { type, message }
  if (data !== undefined) error.data = data
  sendJson(res, status, { error })
}

function requestPreview(req: IncomingMessage): string {
  if (req.method !== "POST") return "method"
  if (req.headers.host !== ALLOWED_HOST) return "host"
  if (req.headers.origin !== ALLOWED_ORIGIN) return "origin"
  const fetchSite = req.headers["sec-fetch-site"]
  if (typeof fetchSite === "string" && fetchSite !== "same-origin" && fetchSite !== "none") {
    return "fetch-site"
  }
  const contentType = req.headers["content-type"]
  if (typeof contentType !== "string") return "content-type"
  if (contentType.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    return "content-type"
  }
  return "ok"
}

async function readBody(
  req: IncomingMessage,
): Promise<{ ok: true; text: string } | { ok: false; status: number }> {
  const declared = Number(req.headers["content-length"])
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return { ok: false, status: 413 }
  }

  return await new Promise((resolve) => {
    const chunks: Buffer[] = []
    let total = 0
    let settled = false
    const settle = (value: { ok: true; text: string } | { ok: false; status: number }) => {
      if (settled) return
      settled = true
      resolve(value)
    }

    req.on("data", (chunk: Buffer) => {
      if (settled) return
      total += chunk.length
      if (total > MAX_BODY_BYTES) {
        settle({ ok: false, status: 413 })
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on("end", () => settle({ ok: true, text: Buffer.concat(chunks).toString("utf8") }))
    req.on("error", () => settle({ ok: false, status: 400 }))
    req.on("aborted", () => settle({ ok: false, status: 400 }))
  })
}

function parseBody(text: string): { ok: true; value: unknown } | { ok: false } {
  if (text.trim() === "") return { ok: true, value: {} }
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch {
    return { ok: false }
  }
}

async function loadModules(
  server: ViteDevServer,
  projectRoot: string,
): Promise<Runtime> {
  const [managerModule, rpcModule] = await Promise.all([
    server.ssrLoadModule(
      pathToFileURL(path.join(projectRoot, "src/server/repository/manager.ts")).href,
    ),
    server.ssrLoadModule(pathToFileURL(path.join(projectRoot, "src/rpc.ts")).href),
  ])

  const Manager = managerModule.RepositoryManager as ManagerConstructor | undefined
  const createHandlers = managerModule.createGitGraphHandlers as
    | ((manager: RuntimeManager) => HandlerMap)
    | undefined
  const definition = rpcModule.GitGraphRpc as RuntimeDefinition | undefined

  if (
    typeof Manager !== "function" ||
    typeof createHandlers !== "function" ||
    !definition ||
    typeof definition !== "object"
  ) {
    throw new Error("Git Graph server modules did not export the expected runtime values")
  }

  // The fixed root is the only repository allowlist source. No request can
  // change it or pass a repository path.
  const manager = new Manager(FR_ROOT)
  return { manager, handlers: createHandlers(manager), definition }
}

export function gitGraphDevHarness(options: { projectRoot: string }): Plugin {
  return {
    name: "git-graph-dev-harness",
    apply: "serve",
    configureServer(server) {
      let runtime: Runtime | undefined
      let disposed = false
      let definition: RuntimeDefinition | undefined

      const ready = loadModules(server, options.projectRoot)
        .then((loaded) => {
          if (disposed) {
            loaded.manager.dispose()
            throw new Error("Git Graph bridge was disposed during startup")
          }
          runtime = loaded
          definition = loaded.definition
          server.config.logger.info(
            `[git-graph-dev] read-only bridge ready (root ${FR_ROOT}, host ${ALLOWED_HOST})`,
          )
          return loaded
        })
        .catch((error: unknown) => {
          const name = error instanceof Error ? error.name : "unknown"
          server.config.logger.error(
            `[git-graph-dev] bridge failed to initialise (${name}); inspect the terminal for module errors`,
          )
          throw error
        })
      ready.catch(() => undefined)

      server.middlewares.use((req, res, next) => {
        if (!req.url) return next()
        const url = new URL(req.url, ALLOWED_ORIGIN)
        if (!url.pathname.startsWith(RPC_PATH_PREFIX)) return next()
        void handleRpc(req, res, url, ready, server, () => definition).catch(() => {
          sendError(res, 500, "rpc.internal", "Internal harness error")
        })
      })

      const dispose = () => {
        if (disposed) return
        disposed = true
        runtime?.manager.dispose()
        runtime = undefined
        definition = undefined
      }
      server.httpServer?.once("close", dispose)
    },
  }

  async function handleRpc(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
    ready: Promise<Runtime>,
    server: ViteDevServer,
    getDefinition: () => RuntimeDefinition | undefined,
  ): Promise<void> {
    const preview = requestPreview(req)
    if (preview !== "ok") {
      const status = preview === "method" ? 405 : 403
      sendError(res, status, "rpc.unauthorized", "Request rejected by the harness origin guard")
      return
    }
    if (url.search !== "") {
      sendError(res, 400, "invalid_input", "Query parameters are not supported", {
        reason: "query",
      })
      return
    }

    const method = url.pathname.slice(RPC_PATH_PREFIX.length)
    if (!HARNESS_METHOD_SET.has(method)) {
      sendError(res, 404, "rpc.method_not_found", "Method is not exposed by the dev harness")
      return
    }

    let loaded: Runtime
    try {
      loaded = await ready
    } catch {
      sendError(res, 503, "rpc.unavailable", "Git Graph bridge is not available")
      return
    }

    const methodDefinition = (getDefinition() ?? loaded.definition).methods[method]
    if (!methodDefinition) {
      sendError(res, 404, "rpc.method_not_found", "Method is not defined")
      return
    }

    const body = await readBody(req)
    if (!body.ok) {
      sendError(
        res,
        body.status,
        body.status === 413 ? "invalid_input" : "rpc.invalid_input",
        body.status === 413 ? "Request body is too large" : "Request body could not be read",
        body.status === 413 ? { reason: "body" } : undefined,
      )
      return
    }

    const parsedBody = parseBody(body.text)
    if (!parsedBody.ok) {
      sendError(res, 400, "invalid_input", "Request body is not valid JSON", {
        reason: "json",
      })
      return
    }

    const parsedInput = methodDefinition.input.safeParse(parsedBody.value)
    if (!parsedInput.success) {
      sendError(res, 400, "invalid_input", "Invalid input", { reason: "input" })
      return
    }

    const controller = new AbortController()
    const abort = () => {
      if (!res.writableEnded) controller.abort()
    }
    req.on("aborted", abort)
    res.on("close", abort)

    try {
      const result = await loaded.handlers[method](parsedInput.data, {
        signal: controller.signal,
        error: makeHandlerError,
      })

      if (controller.signal.aborted || res.writableEnded || res.destroyed) return

      if (isHandlerError(result)) {
        const errorDefinition = methodDefinition.errors?.[result.type]
        if (!errorDefinition) {
          sendError(res, 500, "rpc.internal", "Handler returned an unknown error type")
          return
        }
        const errorData = errorDefinition.safeParse(result.data ?? {})
        if (!errorData.success) {
          sendError(res, 500, "rpc.internal", "Handler returned invalid error data")
          return
        }
        sendError(
          res,
          statusForError(result.type),
          result.type,
          result.message,
          errorData.data,
        )
        return
      }

      const output = methodDefinition.output.safeParse(result)
      if (!output.success) {
        server.config.logger.error(
          `[git-graph-dev] invalid output for ${method}; check the RPC schema`,
        )
        sendError(res, 500, "rpc.invalid_output", "Handler produced invalid output")
        return
      }

      sendJson(res, 200, { ok: true, result: output.data })
    } catch {
      sendError(res, 500, "rpc.internal", "Internal harness error")
    } finally {
      req.off("aborted", abort)
      res.off("close", abort)
    }
  }
}
