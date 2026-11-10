import { availableParallelism } from "node:os"
import { defineConfig } from "vitest/config"

// The suite runs hundreds of real `git` processes. On Windows each spawn is
// dominated by process-creation overhead rather than CPU, so scaling the worker
// pool with every logical core makes file-level parallelism contend for OS
// resources and pushes otherwise fast tests past Vitest's default 5s timeout.
// Keep concurrency small (at most 4 workers) regardless of the machine; the
// per-test timeouts themselves stay untouched.
const maxWorkers = Math.max(1, Math.min(4, availableParallelism()))

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    maxWorkers,
  },
})
