import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import type { IncomingMessage, ServerResponse } from "node:http"
import type { Plugin, ViteDevServer } from "vite"
import type { GitGraphManager } from "../src/server/repository/manager.js"
import {
  FIXTURE_BASE,
  FIXTURE_MARKER_KIND,
  FIXTURE_MARKER_NAME,
  FIXTURE_MARKER_VERSION,
  FIXTURE_TEMP_PARENT,
  FR_PORT,
  FR_ROOT,
  LOOPBACK_HOST,
  MAX_BODY_BYTES,
  MUTATION_METHOD_SET,
  RPC_PATH_PREFIX,
  methodsForMode,
  type UiMode,
} from "./protocol.js"

/**
 * Dev-only HTTP bridge for the Git Graph panel harness.
 *
 * The bridge loads the real server modules through Vite's SSR module runner, so
 * the harness exercises the same RepositoryManager, RPC handlers and zod
 * schemas as the plugin. It is never part of the production bundle.
 *
 * Mode isolation is decided by the environment at server startup, never by an
 * HTTP request:
 *
 * - `fr` exposes only the read methods and always uses `FR_ROOT`.
 * - `mutation-fixture` additionally exposes the six mutation methods and uses a
 *   validated marker-owned directory below the approved TEMP subtree.
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
type ManagerConstructor = new (
  root: string,
  options?: { deps?: { mutations?: unknown } },
) => RuntimeManager

type Runtime = {
  manager: RuntimeManager
  handlers: HandlerMap
  definition: RuntimeDefinition
}

type BridgeOptions = {
  projectRoot: string
  mode: UiMode
  /** Exact port used for Host/Origin checks; must match the Vite server port. */
  port: number
  /** Required in mutation-fixture mode; ignored in FR mode. */
  fixtureRoot?: string
}

interface BridgeErrorBody {
  type: string
  message: string
  data?: unknown
}

type OriginGuard = {
  host: string
  origin: string
}

const HANDLER_ERROR = Symbol("git-graph-dev.handler-error")
const MARKER_MAX_BYTES = 64 * 1024

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
    case "mutation_rejected":
      return 409
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

function requestPreview(req: IncomingMessage, guard: OriginGuard): string {
  if (req.method !== "POST") return "method"
  if (req.headers.host !== guard.host) return "host"
  if (req.headers.origin !== guard.origin) return "origin"
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

function samePath(left: string, right: string): boolean {
  const a = path.resolve(left)
  const b = path.resolve(right)
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b
}

function isStrictlyInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child)
  if (relative === "" || path.isAbsolute(relative)) return false
  return relative !== ".." && !relative.startsWith(`..${path.sep}`)
}

function lstatOrThrow(target: string, label: string): fs.Stats {
  try {
    return fs.lstatSync(target)
  } catch {
    throw new Error(`${label} does not exist or is not accessible`)
  }
}

function assertRealDirectory(target: string, label: string): fs.Stats {
  const stat = lstatOrThrow(target, label)
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`${label} must be a real directory (symlinks are rejected)`)
  }
  return stat
}

function assertRealFile(target: string, label: string): fs.Stats {
  const stat = lstatOrThrow(target, label)
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`${label} must be a real regular file`)
  }
  return stat
}

function assertCanonical(target: string, label: string): string {
  const resolved = path.resolve(target)
  const real = fs.realpathSync(resolved)
  if (!samePath(real, resolved)) {
    throw new Error(`${label} resolves through a symlink or junction`)
  }
  return real
}

function safeDirectoryName(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 128) return false
  if (value === "." || value === "..") return false
  if (value.includes("/") || value.includes("\\") || value.includes("\0")) return false
  return true
}

/**
 * Validate and canonicalize the mutation fixture root.
 *
 * This runs synchronously during Vite startup so a bad root aborts the dev
 * server instead of serving a bridge that could write into FR or an arbitrary
 * directory. The only accepted roots are direct children of the fixed TEMP
 * subtree, with no symlink component and a fixture marker that is bound to the
 * canonical root path.
 */
export function resolveMutationFixtureRoot(value: string | undefined): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("GG_UI_FIXTURE_ROOT is required in mutation-fixture mode")
  }
  if (!path.isAbsolute(value)) {
    throw new Error("GG_UI_FIXTURE_ROOT must be an absolute path")
  }

  const tempParent = assertCanonical(FIXTURE_TEMP_PARENT, "The approved TEMP parent")
  assertRealDirectory(tempParent, "The approved TEMP parent")

  const base = assertCanonical(FIXTURE_BASE, "The mutation fixture base")
  assertRealDirectory(base, "The mutation fixture base")
  if (!isStrictlyInside(tempParent, base)) {
    throw new Error("The mutation fixture base is outside the approved TEMP parent")
  }

  const requested = path.resolve(value)
  assertRealDirectory(requested, "GG_UI_FIXTURE_ROOT")
  const root = assertCanonical(requested, "GG_UI_FIXTURE_ROOT")

  if (!samePath(path.dirname(root), base)) {
    throw new Error("GG_UI_FIXTURE_ROOT must be a direct child of the mutation fixture base")
  }
  if (samePath(root, FR_ROOT) || isStrictlyInside(FR_ROOT, root)) {
    throw new Error("GG_UI_FIXTURE_ROOT must never point at FR")
  }

  const markerPath = path.join(root, FIXTURE_MARKER_NAME)
  const markerStat = assertRealFile(markerPath, "The mutation fixture marker")
  if (markerStat.size > MARKER_MAX_BYTES) {
    throw new Error("The mutation fixture marker is too large")
  }
  assertCanonical(markerPath, "The mutation fixture marker")

  let marker: unknown
  try {
    marker = JSON.parse(fs.readFileSync(markerPath, "utf8"))
  } catch {
    throw new Error("The mutation fixture marker is not valid JSON")
  }
  if (typeof marker !== "object" || marker === null) {
    throw new Error("The mutation fixture marker has an invalid shape")
  }
  const record = marker as Record<string, unknown>
  if (record.kind !== FIXTURE_MARKER_KIND || record.version !== FIXTURE_MARKER_VERSION) {
    throw new Error("The mutation fixture marker has the wrong kind or version")
  }
  if (typeof record.root !== "string" || !samePath(record.root, root)) {
    throw new Error("The mutation fixture marker is bound to a different root")
  }
  if (!Array.isArray(record.repositories) || record.repositories.length < 1) {
    throw new Error("The mutation fixture marker does not list its repositories")
  }

  for (const entry of record.repositories) {
    if (typeof entry !== "object" || entry === null) {
      throw new Error("The mutation fixture marker lists an invalid repository")
    }
    const repository = entry as Record<string, unknown>
    if (typeof repository.alias !== "string" || repository.alias.length === 0) {
      throw new Error("The mutation fixture marker repository is missing its alias")
    }
    if (!safeDirectoryName(repository.directory)) {
      throw new Error("The mutation fixture marker repository directory is invalid")
    }
    const repositoryPath = path.join(root, repository.directory)
    assertRealDirectory(repositoryPath, "A mutation fixture repository")
    const canonicalRepository = assertCanonical(repositoryPath, "A mutation fixture repository")
    if (!samePath(path.dirname(canonicalRepository), root)) {
      throw new Error("A mutation fixture repository is outside the fixture root")
    }
  }

  return root
}

const MUTATION_ENGINE_EXPORTS = [
  "checkoutBranch",
  "createBranch",
  "createTag",
  "renameBranch",
  "deleteBranch",
  "deleteTag",
] as const

/**
 * Load the real write engine for the mutation-fixture mode.
 *
 * The production manager lazy-loads `../git/mutations.js`; that specifier is
 * not resolvable by Vite's SSR runner from the TypeScript source tree. The
 * manager already exposes `deps.mutations` for tests, so the harness injects
 * the same production module here instead of mocking any result.
 */
async function loadMutationEngine(
  server: ViteDevServer,
  projectRoot: string,
): Promise<unknown | undefined> {
  try {
    const module = await server.ssrLoadModule(
      pathToFileURL(path.join(projectRoot, "src/server/git/mutations.ts")).href,
    )
    const record = module as Record<string, unknown>
    const complete = MUTATION_ENGINE_EXPORTS.every(
      (name) => typeof record[name] === "function",
    )
    return complete ? module : undefined
  } catch {
    return undefined
  }
}

async function loadModules(
  server: ViteDevServer,
  projectRoot: string,
  root: string,
  mode: UiMode,
): Promise<Runtime & { mutationEngine: boolean }> {
  const [managerModule, rpcModule, mutations] = await Promise.all([
    server.ssrLoadModule(
      pathToFileURL(path.join(projectRoot, "src/server/repository/manager.ts")).href,
    ),
    server.ssrLoadModule(pathToFileURL(path.join(projectRoot, "src/rpc.ts")).href),
    mode === "mutation-fixture" ? loadMutationEngine(server, projectRoot) : undefined,
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
  const managerOptions =
    mode === "mutation-fixture" && mutations ? { deps: { mutations } } : undefined
  const manager = new Manager(root, managerOptions)
  return {
    manager,
    handlers: createHandlers(manager),
    definition,
    mutationEngine: mode === "mutation-fixture" && mutations !== undefined,
  }
}

export function gitGraphDevHarness(options: BridgeOptions): Plugin {
  return {
    name: "git-graph-dev-harness",
    apply: "serve",
    configureServer(server) {
      // Fail startup for an invalid mutation root; the HTTP layer must never be
      // able to choose a root later.
      const root =
        options.mode === "mutation-fixture"
          ? resolveMutationFixtureRoot(options.fixtureRoot)
          : FR_ROOT
      if (options.mode === "fr" && !samePath(root, FR_ROOT)) {
        throw new Error("FR mode must use the fixed read-only root")
      }
      if (options.mode === "fr" && options.port !== FR_PORT) {
        throw new Error("FR mode must use port 5178")
      }

      const guard: OriginGuard = {
        host: `${LOOPBACK_HOST}:${options.port}`,
        origin: `http://${LOOPBACK_HOST}:${options.port}`,
      }
      const allowedMethods = methodsForMode(options.mode)

      let runtime: Runtime | undefined
      let disposed = false
      let definition: RuntimeDefinition | undefined

      const ready = loadModules(server, options.projectRoot, root, options.mode)
        .then((loaded) => {
          if (disposed) {
            loaded.manager.dispose()
            throw new Error("Git Graph bridge was disposed during startup")
          }
          runtime = loaded
          definition = loaded.definition

          const missing = [...allowedMethods].filter(
            (method) =>
              !(method in loaded.definition.methods) ||
              typeof loaded.handlers[method] !== "function",
          )
          server.config.logger.info(
            `[git-graph-dev] ${options.mode} bridge ready (root ${root}, host ${guard.host})`,
          )
          if (missing.length > 0) {
            server.config.logger.info(
              `[git-graph-dev] methods not yet provided by the production RPC: ${missing.join(", ")}`,
            )
          }
          if (options.mode === "mutation-fixture") {
            server.config.logger.info(
              loaded.mutationEngine
                ? "[git-graph-dev] real mutation engine loaded for TEMP fixtures"
                : "[git-graph-dev] mutation engine unavailable; writes will be rejected",
            )
          }
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
        const url = new URL(req.url, guard.origin)
        if (!url.pathname.startsWith(RPC_PATH_PREFIX)) return next()
        void handleRpc(req, res, url, ready, server, () => definition, {
          guard,
          allowedMethods,
          mode: options.mode,
        }).catch(() => {
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
    policy: {
      guard: OriginGuard
      allowedMethods: ReadonlySet<string>
      mode: UiMode
    },
  ): Promise<void> {
    const preview = requestPreview(req, policy.guard)
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
    if (!policy.allowedMethods.has(method)) {
      if (policy.mode === "fr" && MUTATION_METHOD_SET.has(method)) {
        sendError(
          res,
          403,
          "rpc.method_forbidden",
          "Mutation methods are not available in FR read-only mode",
        )
        return
      }
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
    if (!methodDefinition || typeof loaded.handlers[method] !== "function") {
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
