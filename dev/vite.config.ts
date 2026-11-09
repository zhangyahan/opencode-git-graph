import path from "node:path"
import { defineConfig } from "vite"
import solid from "vite-plugin-solid"
import { gitGraphDevHarness } from "./bridge"

/**
 * Dev-only UI harness. This config is intentionally separate from the
 * production `vite.config.ts`: it renders the real panel in a browser and
 * serves the read-only RPC bridge, without the Desktop `gui()` preset.
 *
 * Run from the repository root: `npm run dev:ui`.
 */
const projectRoot = process.cwd()
const devRoot = path.join(projectRoot, "dev")

export default defineConfig({
  root: devRoot,
  appType: "spa",
  plugins: [solid(), gitGraphDevHarness({ projectRoot })],
  server: {
    host: "127.0.0.1",
    port: 5178,
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
    port: 5178,
    strictPort: true,
  },
  build: {
    outDir: path.join(projectRoot, "dist/dev-ui"),
    emptyOutDir: true,
  },
})
