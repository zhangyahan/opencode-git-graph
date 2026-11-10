import { execFileSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { isAbsolute, join, relative, resolve } from "node:path"
import { afterEach, describe, expect, it as vitestIt } from "vitest"
import {
  ALLOWED_ORIGIN,
  FIXTURE_BASE,
  FIXTURE_MARKER_KIND,
  FIXTURE_MARKER_NAME,
  FIXTURE_MARKER_VERSION,
  FIXTURE_TEMP_PARENT,
  FR_PORT,
  FR_READ_METHODS,
  FR_ROOT,
  MUTATION_METHODS,
  MUTATION_PORT,
  methodsForMode,
  normalizeUiMode,
  portForMode,
  type UiMode,
} from "../dev/protocol.js"
import { resolveMutationFixtureRoot } from "../dev/bridge.js"

/**
 * Regression coverage for the dev harness FR read-only / TEMP mutation boundary.
 *
 * This file never touches FR, never starts the bridge or a mutation manager and
 * never writes outside the approved TEMP fixture base. The only filesystem
 * writes are `security-test-*` directories created below `FIXTURE_BASE` and
 * removed again by `afterEach`.
 */

const WRITE_METHODS = [
  "checkoutBranch",
  "createBranch",
  "createTag",
  "renameBranch",
  "deleteBranch",
  "deleteTag",
  // Network write shipped with the mutation engine; gated like the local
  // mutations so FR mode stays strictly read-only.
  "fetchRemote",
] as const

const TEST_TIMEOUT = 20_000
const MARKER_MAX_BYTES = 64 * 1024

function it(name: string, run: () => void | Promise<void>): void {
  vitestIt(name, run, TEST_TIMEOUT)
}

/* ------------------------------------------------------------------ */
/* Pure protocol tests (run on every platform)                         */
/* ------------------------------------------------------------------ */

describe("harness method gating", () => {
  it("exposes only the read methods in FR mode", () => {
    const exposed = methodsForMode("fr")

    expect([...exposed].sort()).toEqual([...FR_READ_METHODS].sort())
    expect(exposed.size).toBe(FR_READ_METHODS.length)
    // fetchRemote is a network write: it must never be part of the FR read set.
    expect(FR_READ_METHODS).not.toContain("fetchRemote")
    expect(exposed.has("fetchRemote")).toBe(false)
    for (const method of WRITE_METHODS) {
      expect(MUTATION_METHODS).toContain(method)
      expect(exposed.has(method)).toBe(false)
    }
  })

  it("never upgrades an unknown runtime mode to write methods", () => {
    // An unrecognised runtime value must fall through to the safe FR set, not
    // to mutation-fixture. The bridge resolves its mode before serving RPCs.
    const unknown = "bogus-runtime-mode" as unknown as UiMode
    const exposed = methodsForMode(unknown)

    expect([...exposed].sort()).toEqual([...FR_READ_METHODS].sort())
    for (const method of WRITE_METHODS) expect(exposed.has(method)).toBe(false)
    expect(portForMode(unknown)).toBe(FR_PORT)
  })

  it("exposes exactly the seven known writes plus the reads in mutation mode", () => {
    const exposed = methodsForMode("mutation-fixture")
    const expected = [...FR_READ_METHODS, ...MUTATION_METHODS]

    expect(MUTATION_METHODS).toEqual([...WRITE_METHODS])
    expect(WRITE_METHODS).toHaveLength(7)
    expect(MUTATION_METHODS).toHaveLength(7)
    expect(exposed.size).toBe(expected.length)
    for (const method of expected) expect(exposed.has(method)).toBe(true)
    // fetchRemote is mutation-only and never leaks into the FR read set.
    expect(exposed.has("fetchRemote")).toBe(true)
    expect(methodsForMode("fr").has("fetchRemote")).toBe(false)
    for (const method of ["push", "reset", "forcePush", "deleteRepository", "rm"]) {
      expect(exposed.has(method)).toBe(false)
    }
  })

  it("defaults an undefined or empty mode to FR and rejects unknown modes", () => {
    expect(normalizeUiMode(undefined)).toBe("fr")
    expect(normalizeUiMode("")).toBe("fr")
    expect(normalizeUiMode("   ")).toBe("fr")
    expect(normalizeUiMode("fr")).toBe("fr")
    expect(normalizeUiMode("mutation-fixture")).toBe("mutation-fixture")

    for (const invalid of ["FR", "mutation", "mutation_fixture", "fr ", "true"]) {
      expect(() => normalizeUiMode(invalid)).toThrow(/GG_UI_MODE must be/)
    }
  })

  it("keeps the FR and TEMP mutation ports isolated", () => {
    expect(portForMode("fr")).toBe(5178)
    expect(portForMode("mutation-fixture")).toBe(5179)
    expect(FR_PORT).toBe(5178)
    expect(MUTATION_PORT).toBe(5179)
    expect(FR_PORT).not.toBe(MUTATION_PORT)
    // The only accepted browser origin is the FR port; TEMP writes cannot be
    // reached through the FR origin.
    expect(ALLOWED_ORIGIN).toBe(`http://127.0.0.1:${FR_PORT}`)
    expect(ALLOWED_ORIGIN).not.toContain(String(MUTATION_PORT))
  })
})

/* ------------------------------------------------------------------ */
/* Filesystem integration (fixed Windows TEMP base only)               */
/* ------------------------------------------------------------------ */

const FILESYSTEM_SKIP_REASON =
  process.platform !== "win32"
    ? "fixed Windows TEMP fixture base is unavailable on POSIX"
    : !existsSync(FIXTURE_BASE) || !existsSync(FIXTURE_TEMP_PARENT)
      ? "approved TEMP fixture base is missing on this machine"
      : null

const createdPaths: string[] = []

/** Refuse to track anything outside the approved base; we must never write FR. */
function remember(target: string): string {
  const rel = relative(FIXTURE_BASE, target)
  if (rel === "" || isAbsolute(rel) || rel === ".." || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) {
    throw new Error(`refusing to create a security test path outside FIXTURE_BASE: ${target}`)
  }
  createdPaths.push(target)
  return target
}

function createRoot(label: string): string {
  return remember(mkdtempSync(join(FIXTURE_BASE, `security-test-${label}-`)))
}

function writeMarker(root: string, content: unknown): string {
  const markerPath = join(root, FIXTURE_MARKER_NAME)
  const text =
    typeof content === "string" ? content : `${JSON.stringify(content, null, 2)}\n`
  writeFileSync(markerPath, text)
  return markerPath
}

function markerFor(
  root: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    kind: FIXTURE_MARKER_KIND,
    version: FIXTURE_MARKER_VERSION,
    root: realpathSync(root),
    repositories: [{ alias: "primary", directory: "primary" }],
    ...overrides,
  }
}

/** Remove only the paths this file created, junction links before their targets. */
function cleanupCreatedPaths(): void {
  for (const target of [...createdPaths].reverse()) {
    try {
      const stat = lstatSync(target)
      if (stat.isSymbolicLink()) rmSync(target, { force: true })
      else rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    } catch {
      // Already gone; never recurse into the base.
    }
  }
  createdPaths.length = 0
}

afterEach(() => {
  cleanupCreatedPaths()
})

type GitEnvironment = {
  env: NodeJS.ProcessEnv
  args: string[]
  hooks: string
  templateHooks: string
}

function createGitEnvironment(root: string): GitEnvironment {
  const home = join(root, ".security-test-home")
  const hooks = join(root, ".security-test-hooks")
  const templates = join(root, ".security-test-templates")
  const templateHooks = join(templates, "hooks")
  const globalConfig = join(root, ".security-test-global.gitconfig")
  mkdirSync(home, { recursive: true })
  mkdirSync(hooks, { recursive: true })
  mkdirSync(templateHooks, { recursive: true })
  writeFileSync(
    globalConfig,
    [
      "[user]",
      "\tname = Security Test",
      "\temail = security-test@example.invalid",
      "[commit]",
      "\tgpgsign = false",
      "[tag]",
      "\tgpgsign = false",
      "",
    ].join("\n"),
  )
  // A template hook would run if core.hooksPath were not overridden.
  writeFileSync(
    join(templateHooks, "pre-commit"),
    `#!/bin/sh\nprintf executed > "${join(root, "hook-ran.txt").replace(/\\/g, "/")}"\n`,
  )

  return {
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      XDG_CONFIG_HOME: join(home, ".config"),
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: globalConfig,
      GIT_CONFIG_SYSTEM: globalConfig,
      GIT_TERMINAL_PROMPT: "0",
      GIT_AUTHOR_NAME: "Security Test",
      GIT_AUTHOR_EMAIL: "security-test@example.invalid",
      GIT_COMMITTER_NAME: "Security Test",
      GIT_COMMITTER_EMAIL: "security-test@example.invalid",
    },
    args: [
      "-c",
      `core.hooksPath=${hooks}`,
      "-c",
      `init.templateDir=${templates}`,
      "-c",
      "commit.gpgsign=false",
      "-c",
      "tag.gpgsign=false",
      "-c",
      "core.autocrlf=false",
      "-c",
      "core.fsmonitor=false",
      "-c",
      "protocol.file.allow=never",
      "-c",
      "protocol.https.allow=never",
      "-c",
      "protocol.ssh.allow=never",
    ],
    hooks,
    templateHooks,
  }
}

function git(environment: GitEnvironment, cwd: string, args: string[]): string {
  return execFileSync("git", [...environment.args, ...args], {
    cwd,
    env: environment.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  }).trim()
}

function initFixtureRepository(
  environment: GitEnvironment,
  repositoryPath: string,
): void {
  mkdirSync(repositoryPath, { recursive: true })
  git(environment, repositoryPath, ["init", "-b", "main"])
  git(environment, repositoryPath, ["config", "user.name", "Security Test"])
  git(environment, repositoryPath, ["config", "user.email", "security-test@example.invalid"])
  git(environment, repositoryPath, ["config", "core.hooksPath", environment.hooks])
  writeFileSync(join(repositoryPath, "README.md"), "# security test fixture\n")
  git(environment, repositoryPath, ["add", "-A"])
  git(environment, repositoryPath, ["commit", "--no-gpg-sign", "-m", "init"])
}

const describeFilesystem = FILESYSTEM_SKIP_REASON === null ? describe : describe.skip

if (FILESYSTEM_SKIP_REASON !== null) {
  console.warn(
    `[dev-harness-security] filesystem integration tests skipped: ${FILESYSTEM_SKIP_REASON}`,
  )
}

describeFilesystem(
  FILESYSTEM_SKIP_REASON === null
    ? "mutation fixture root startup validation (TEMP only)"
    : `mutation fixture root startup validation (skipped: ${FILESYSTEM_SKIP_REASON})`,
  () => {
    it("rejects a missing, empty or relative GG_UI_FIXTURE_ROOT", () => {
      expect(() => resolveMutationFixtureRoot(undefined)).toThrow(
        /GG_UI_FIXTURE_ROOT is required/,
      )
      expect(() => resolveMutationFixtureRoot("")).toThrow(/GG_UI_FIXTURE_ROOT is required/)
      expect(() => resolveMutationFixtureRoot("   ")).toThrow(/GG_UI_FIXTURE_ROOT is required/)
      expect(() => resolveMutationFixtureRoot("security-test-relative")).toThrow(
        /must be an absolute path/,
      )
    })

    it("rejects a root that does not exist", () => {
      const missing = join(FIXTURE_BASE, `security-test-missing-${randomUUID()}`)

      expect(() => resolveMutationFixtureRoot(missing)).toThrow(
        /does not exist or is not accessible/,
      )
    })

    it("rejects a real directory without a fixture marker", () => {
      const root = createRoot("no-marker")

      expect(() => resolveMutationFixtureRoot(root)).toThrow(
        /marker does not exist or is not accessible/,
      )
    })

    it("rejects a marker bound to a different root", () => {
      const root = createRoot("wrong-root")
      const other = createRoot("wrong-root-other")
      writeMarker(root, markerFor(root, { root: realpathSync(other) }))

      expect(() => resolveMutationFixtureRoot(root)).toThrow(
        /marker is bound to a different root/,
      )
    })

    it("rejects a marker with the wrong kind", () => {
      const root = createRoot("wrong-kind")
      writeMarker(root, markerFor(root, { kind: "not-a-mutation-fixture" }))

      expect(() => resolveMutationFixtureRoot(root)).toThrow(/wrong kind or version/)
    })

    it("rejects a marker with the wrong version", () => {
      const root = createRoot("wrong-version")
      writeMarker(root, markerFor(root, { version: FIXTURE_MARKER_VERSION + 1 }))

      expect(() => resolveMutationFixtureRoot(root)).toThrow(/wrong kind or version/)
    })

    it("rejects an oversized marker before parsing it", () => {
      const root = createRoot("oversize-marker")
      writeMarker(root, "x".repeat(MARKER_MAX_BYTES + 1))

      expect(() => resolveMutationFixtureRoot(root)).toThrow(/marker is too large/)
    })

    it("rejects a root that is not a direct child of the fixture base", () => {
      const parent = createRoot("nested-parent")
      const nested = join(parent, "security-test-nested")
      mkdirSync(nested)

      expect(() => resolveMutationFixtureRoot(nested)).toThrow(
        /direct child of the mutation fixture base/,
      )
    })

    it("rejects a junction root even when it points at another TEMP directory", () => {
      const target = createRoot("junction-target")
      const link = remember(join(FIXTURE_BASE, `security-test-junction-${randomUUID()}`))
      symlinkSync(target, link, "junction")

      expect(relative(FIXTURE_BASE, target).startsWith("security-test-")).toBe(true)
      expect(() => resolveMutationFixtureRoot(link)).toThrow(
        /must be a real directory \(symlinks are rejected\)/,
      )
    })

    it("rejects an FR path without touching FR or starting a mutation manager", () => {
      // Only the pure startup validator runs here. FR mode never calls this
      // function; passing an FR path must fail before any manager exists.
      expect(existsSync(FR_ROOT)).toBe(true)
      expect(() => resolveMutationFixtureRoot(FR_ROOT)).toThrow(
        /direct child of the mutation fixture base|never point at FR/,
      )
      expect(existsSync(FR_ROOT)).toBe(true)
    })

    it("accepts a marker-owned root with two real git repositories and no hooks", () => {
      const root = createRoot("valid")
      const environment = createGitEnvironment(root)
      const repositories = [
        { alias: "primary", directory: "primary" },
        { alias: "secondary", directory: "secondary" },
      ]

      for (const repository of repositories) {
        const repositoryPath = join(root, repository.directory)
        initFixtureRepository(environment, repositoryPath)
        expect(git(environment, repositoryPath, ["rev-parse", "--is-inside-work-tree"])).toBe(
          "true",
        )
        expect(git(environment, repositoryPath, ["config", "--get", "user.email"])).toBe(
          "security-test@example.invalid",
        )
        expect(git(environment, repositoryPath, ["config", "--get", "core.hooksPath"])).toBe(
          environment.hooks,
        )
      }
      writeMarker(root, markerFor(root, { repositories }))

      const resolvedRoot = resolveMutationFixtureRoot(root)
      const canonicalRoot = realpathSync(root)

      expect(resolve(resolvedRoot)).toBe(resolve(canonicalRoot))
      expect(relative(realpathSync(FIXTURE_BASE), resolvedRoot).toLowerCase()).toBe(
        relative(realpathSync(FIXTURE_BASE), root).toLowerCase(),
      )
      // The template hook was not executed: core.hooksPath points at an empty
      // directory for every fixture repository.
      expect(existsSync(join(root, "hook-ran.txt"))).toBe(false)
      // The marker only lives inside our own TEMP fixture.
      expect(existsSync(join(root, FIXTURE_MARKER_NAME))).toBe(true)
    })
  },
)
