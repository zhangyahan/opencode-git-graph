#!/usr/bin/env node
/**
 * Create two throwaway git repositories for the mutation UI harness.
 *
 * This script writes only below the approved TEMP subtree:
 *   C:\Users\yahan\AppData\Local\Temp\opencode\gg-mutation-fixtures\<random>
 *
 * It never accepts a root argument, never reads user repositories and never
 * writes inside FR. It prints only the fixture root and repository paths.
 *
 * The bridge accepts the result only when the directory has this script's
 * marker, is not a symlink and is a direct child of the fixed TEMP subtree.
 */

import { execFileSync } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

const FIXTURE_BASE = "C:\\Users\\yahan\\AppData\\Local\\Temp\\opencode\\gg-mutation-fixtures"
const MARKER_NAME = ".gg-mutation-fixture.json"
const MARKER_KIND = "gg-mutation-fixture"
const MARKER_VERSION = 1
const FIXED_DATE = Date.UTC(2024, 0, 1, 0, 0, 0)
let dateOffset = 0

function nextDate() {
  dateOffset += 60
  return new Date(FIXED_DATE + dateOffset * 1000).toISOString()
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
}

function writeBinary(file, version) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const buffer = Buffer.alloc(256)
  for (let index = 0; index < buffer.length; index += 1) {
    buffer[index] = (index * 31 + version * 17) % 256
  }
  // Embedded NUL bytes ensure git treats the file as binary.
  buffer[0] = 0
  buffer[1] = 0
  fs.writeFileSync(file, buffer)
}

function createEnvironment(root) {
  const home = path.join(root, ".gg-home")
  const emptyConfig = path.join(root, ".gg-empty-config")
  const hooks = path.join(root, ".gg-empty-hooks")
  const templates = path.join(root, ".gg-empty-templates")
  fs.mkdirSync(home, { recursive: true })
  fs.mkdirSync(hooks, { recursive: true })
  fs.mkdirSync(templates, { recursive: true })
  fs.writeFileSync(emptyConfig, "")

  return {
    env: {
      ...process.env,
      HOME: home,
      XDG_CONFIG_HOME: path.join(home, ".config"),
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: emptyConfig,
      GIT_CONFIG_SYSTEM: emptyConfig,
      GIT_AUTHOR_NAME: "GG Fixture",
      GIT_AUTHOR_EMAIL: "fixture@example.invalid",
      GIT_COMMITTER_NAME: "GG Fixture",
      GIT_COMMITTER_EMAIL: "fixture@example.invalid",
      GIT_TERMINAL_PROMPT: "0",
      GIT_ASKPASS: "",
      SSH_ASKPASS: "",
      LC_ALL: "C",
    },
    isolatedArgs: [
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
      "-c",
      "protocol.git.allow=never",
    ],
  }
}

function git(environment, cwd, args) {
  try {
    return execFileSync("git", [...environment.isolatedArgs, ...args], {
      cwd,
      env: { ...environment.env, GIT_AUTHOR_DATE: nextDate(), GIT_COMMITTER_DATE: nextDate() },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    }).trim()
  } catch (error) {
    const stderr = typeof error?.stderr === "string" ? error.stderr.trim() : ""
    throw new Error(`git ${args.join(" ")} failed in ${cwd}${stderr ? `: ${stderr}` : ""}`)
  }
}

function commit(environment, cwd, message) {
  git(environment, cwd, ["add", "-A"])
  git(environment, cwd, ["commit", "--no-gpg-sign", "-m", message])
  return git(environment, cwd, ["rev-parse", "HEAD"])
}

function initRepository(environment, repositoryPath) {
  fs.mkdirSync(repositoryPath, { recursive: true })
  git(environment, repositoryPath, ["init"])
  git(environment, repositoryPath, ["symbolic-ref", "HEAD", "refs/heads/main"])
  git(environment, repositoryPath, ["config", "user.name", "GG Fixture"])
  git(environment, repositoryPath, ["config", "user.email", "fixture@example.invalid"])
  git(environment, repositoryPath, ["config", "core.hooksPath", path.join(environment.root, ".gg-empty-hooks")])
}

function addRemoteMetadata(environment, repositoryPath, name, refs) {
  git(environment, repositoryPath, [
    "remote",
    "add",
    "origin",
    `https://fixture.invalid/${name}.git`,
  ])
  for (const [ref, hash] of Object.entries(refs)) {
    git(environment, repositoryPath, ["update-ref", `refs/remotes/origin/${ref}`, hash])
  }
  git(environment, repositoryPath, [
    "symbolic-ref",
    "refs/remotes/origin/HEAD",
    "refs/remotes/origin/main",
  ])
}

function createPrimary(environment, repositoryPath) {
  initRepository(environment, repositoryPath)

  write(path.join(repositoryPath, "README.md"), "# Primary mutation fixture\n")
  write(
    path.join(repositoryPath, "src/app.txt"),
    "export const app = 'v1'\nconsole.log(app)\n",
  )
  write(path.join(repositoryPath, "docs/old-name.md"), "legacy docs\n")
  writeBinary(path.join(repositoryPath, "assets/logo.bin"), 1)
  const rootCommit = commit(environment, repositoryPath, "chore: root fixture commit")

  git(environment, repositoryPath, ["tag", "v0.1.0", rootCommit])
  git(environment, repositoryPath, ["branch", "release", rootCommit])

  write(path.join(repositoryPath, "docs/current.md"), "main notes\n")
  const mainCommit = commit(environment, repositoryPath, "docs: main notes")

  git(environment, repositoryPath, ["checkout", "-b", "feature"])
  write(
    path.join(repositoryPath, "src/app-renamed.txt"),
    "export const app = 'v2'\nconsole.log(app, 'feature')\n",
  )
  fs.rmSync(path.join(repositoryPath, "src/app.txt"))
  write(path.join(repositoryPath, "feature/feature.txt"), "feature payload\n")
  writeBinary(path.join(repositoryPath, "assets/logo.bin"), 2)
  const featureCommit = commit(environment, repositoryPath, "refactor: rename app and update fixture")

  git(environment, repositoryPath, ["checkout", "main"])
  write(path.join(repositoryPath, "docs/main-only.txt"), "main only\n")
  commit(environment, repositoryPath, "chore: main advance")

  git(environment, repositoryPath, [
    "merge",
    "--no-ff",
    "feature",
    "-m",
    "merge: feature into main",
  ])
  const mergeCommit = git(environment, repositoryPath, ["rev-parse", "HEAD"])
  git(environment, repositoryPath, [
    "tag",
    "-a",
    "v1.0.0",
    "-m",
    "annotated fixture release",
    mergeCommit,
  ])

  addRemoteMetadata(environment, repositoryPath, "primary", {
    main: mergeCommit,
    feature: featureCommit,
    release: rootCommit,
  })

  // Leave the primary fixture clean on main.
  git(environment, repositoryPath, ["checkout", "main"])
  const status = git(environment, repositoryPath, ["status", "--porcelain"])
  if (status !== "") throw new Error(`primary fixture is not clean: ${status}`)
  return { rootCommit, mainCommit, featureCommit, mergeCommit }
}

function createSecondary(environment, repositoryPath) {
  initRepository(environment, repositoryPath)

  write(path.join(repositoryPath, "README.md"), "# Secondary mutation fixture\n")
  write(path.join(repositoryPath, "src/main.txt"), "secondary main v1\n")
  writeBinary(path.join(repositoryPath, "assets/icon.bin"), 3)
  const rootCommit = commit(environment, repositoryPath, "chore: secondary root")

  git(environment, repositoryPath, ["tag", "s0.1.0", rootCommit])
  git(environment, repositoryPath, ["branch", "release", rootCommit])

  git(environment, repositoryPath, ["checkout", "-b", "feature"])
  write(path.join(repositoryPath, "src/feature.txt"), "secondary feature\n")
  writeBinary(path.join(repositoryPath, "assets/icon.bin"), 4)
  const featureCommit = commit(environment, repositoryPath, "feat: secondary feature")

  git(environment, repositoryPath, ["checkout", "main"])
  write(path.join(repositoryPath, "docs/notes.md"), "secondary notes\n")
  commit(environment, repositoryPath, "docs: secondary notes")
  git(environment, repositoryPath, [
    "merge",
    "--no-ff",
    "feature",
    "-m",
    "merge: secondary feature",
  ])
  const mergeCommit = git(environment, repositoryPath, ["rev-parse", "HEAD"])
  git(environment, repositoryPath, [
    "tag",
    "-a",
    "s1.0.0",
    "-m",
    "annotated secondary release",
    mergeCommit,
  ])

  addRemoteMetadata(environment, repositoryPath, "secondary", {
    main: mergeCommit,
    feature: featureCommit,
  })

  git(environment, repositoryPath, ["checkout", "main"])
  const status = git(environment, repositoryPath, ["status", "--porcelain"])
  if (status !== "") throw new Error(`secondary fixture is not clean: ${status}`)
  return { rootCommit, featureCommit, mergeCommit }
}

function main() {
  fs.mkdirSync(FIXTURE_BASE, { recursive: true })
  const name = `fixture-${crypto.randomBytes(12).toString("hex")}`
  const root = path.join(FIXTURE_BASE, name)
  fs.mkdirSync(root, { recursive: false })

  try {
    const environment = { ...createEnvironment(root), root }
    const primaryPath = path.join(root, "primary")
    const secondaryPath = path.join(root, "secondary")
    createPrimary(environment, primaryPath)
    createSecondary(environment, secondaryPath)

    const canonicalRoot = fs.realpathSync(root)
    const marker = {
      kind: MARKER_KIND,
      version: MARKER_VERSION,
      root: canonicalRoot,
      createdAt: new Date().toISOString(),
      repositories: [
        { alias: "primary", directory: "primary" },
        { alias: "secondary", directory: "secondary" },
      ],
    }
    fs.writeFileSync(path.join(canonicalRoot, MARKER_NAME), `${JSON.stringify(marker, null, 2)}\n`)

    process.stdout.write(
      `${JSON.stringify(
        {
          root: canonicalRoot,
          repositories: {
            primary: path.join(canonicalRoot, "primary"),
            secondary: path.join(canonicalRoot, "secondary"),
          },
        },
        null,
        2,
      )}\n`,
    )
  } catch (error) {
    // Never leave a half-initialised fixture that could later pass validation.
    fs.rmSync(root, { recursive: true, force: true })
    throw error
  }
}

try {
  main()
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
