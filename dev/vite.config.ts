import path from "node:path"
import { defineConfig, type Plugin } from "vite"
import solid from "vite-plugin-solid"
import { gitGraphDevHarness, resolveMutationFixtureRoot } from "./bridge"
import { FR_PORT, FR_ROOT, normalizeUiMode, portForMode, type UiMode } from "./protocol"

/**
 * Dev-only UI harness. This config is intentionally separate from the
 * production `vite.config.ts`: it renders the real panel in a browser and
 * serves the mode-isolated RPC bridge, without the Desktop `gui()` preset.
 *
 * FR mode (read-only, default):
 *   npm run dev:ui
 *
 * Mutation-fixture mode (write-testing only, TEMP repositories):
 *   $env:GG_UI_MODE = "mutation-fixture"
 *   $env:GG_UI_PORT = "5179"
 *   $env:GG_UI_FIXTURE_ROOT = "<output of create-mutation-fixture.mjs>"
 *   npm run dev:ui
 */
const projectRoot = process.cwd()
const devRoot = path.join(projectRoot, "dev")

function resolveModeAndPort(): { mode: UiMode; port: number } {
  const mode = normalizeUiMode(process.env.GG_UI_MODE)
  const rawPort = process.env.GG_UI_PORT?.trim()
  const defaultPort = portForMode(mode)

  if (mode === "fr" && rawPort !== undefined && rawPort !== "" && rawPort !== String(FR_PORT)) {
    throw new Error("FR mode always binds 127.0.0.1:5178; unset GG_UI_PORT for FR mode")
  }

  if (rawPort === undefined || rawPort === "") {
    return { mode, port: defaultPort }
  }

  if (!/^\d{2,5}$/.test(rawPort)) {
    throw new Error(`GG_UI_PORT must be a numeric port (received ${JSON.stringify(rawPort)})`)
  }
  const port = Number(rawPort)
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error(`GG_UI_PORT must be an integer between 1024 and 65535 (received ${port})`)
  }
  if (mode === "mutation-fixture" && port === FR_PORT) {
    throw new Error("Mutation-fixture mode must not reuse the FR read-only port 5178")
  }
  return { mode, port }
}

const { mode, port } = resolveModeAndPort()

if (mode === "fr" && process.env.GG_UI_FIXTURE_ROOT !== undefined) {
  throw new Error("GG_UI_FIXTURE_ROOT is only valid in mutation-fixture mode")
}

const fixtureRoot =
  mode === "mutation-fixture" ? resolveMutationFixtureRoot(process.env.GG_UI_FIXTURE_ROOT) : undefined
const directory = fixtureRoot ?? FR_ROOT

const uiDefines = {
  __GG_UI_MODE__: JSON.stringify(mode),
  __GG_UI_DIRECTORY__: JSON.stringify(directory),
  __GG_UI_PORT__: JSON.stringify(port),
} as const

/**
 * Vite 7's `define` plugin skips client modules in dev and only applies the
 * replacements during a build. This pre-transform applies the same constants
 * in the dev server so the served module has real values. `protocol.ts` owns
 * the ambient declarations and is skipped.
 */
function devDefineFallback(): Plugin {
  const root = path.resolve(devRoot) + path.sep
  const protocolFile = path.join(path.resolve(devRoot), "protocol.ts")
  return {
    name: "gg-ui-dev-define-fallback",
    enforce: "pre",
    transform(code, id) {
      const file = id.split("?")[0] ?? id
      if (!path.resolve(file).startsWith(root) || path.resolve(file) === protocolFile) {
        return undefined
      }
      let next = code
      let changed = false
      for (const [key, value] of Object.entries(uiDefines)) {
        const pattern = new RegExp(`\\b${key}\\b`, "g")
        if (!pattern.test(next)) continue
        next = next.replace(pattern, value)
        changed = true
      }
      return changed ? { code: next, map: null } : undefined
    },
  }
}

export default defineConfig({
  root: devRoot,
  appType: "spa",
  plugins: [
    devDefineFallback(),
    solid(),
    gitGraphDevHarness({
      projectRoot,
      mode,
      port,
      ...(fixtureRoot ? { fixtureRoot } : {}),
    }),
  ],
  define: uiDefines,
  server: {
    host: "127.0.0.1",
    port,
    strictPort: true,
    cors: false,
    allowedHosts: ["127.0.0.1"],
    fs: {
      allow: [projectRoot],
      deny: [".env", ".env.*", "*.{crt,pem,key}", ".git/**"],
    },
  },
  preview: {
    host: "127.0.0.1",
    port,
    strictPort: true,
  },
  build: {
    outDir: path.join(projectRoot, "dist/dev-ui"),
    emptyOutDir: true,
  },
})
