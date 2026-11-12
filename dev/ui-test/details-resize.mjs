/**
 * Focused real-browser check for the bottom working-tree/index diff pane.
 *
 * It drives the production dev harness against a marker-approved TEMP mutation
 * fixture, makes the fixture dirty with real git commands, then drags the
 * full-width top divider of `[data-testid="commit-details"]`. Height evidence
 * comes from `getBoundingClientRect()` on the details pane and its handle, never
 * from the inline uncommitted slot above.
 *
 * Start the harness first (separate terminal):
 *   $env:GG_UI_MODE = "mutation-fixture"
 *   $env:GG_UI_PORT = "5179"
 *   $env:GG_UI_FIXTURE_ROOT = "<output of create-mutation-fixture.mjs>"
 *   npm run dev:ui
 *
 * Then run:
 *   node dev/ui-test/details-resize.mjs
 *
 * Environment:
 *   GG_TEMP_URL          default http://127.0.0.1:5179/
 *   GG_DETAILS_ARTIFACTS default <TEMP>/opencode/gg-ui-details-resize-<timestamp>
 *   GG_PLAYWRIGHT_CORE / GG_CHROME_PATH as in the other dev UI scripts
 */

import { execFileSync } from "node:child_process"
import { createRequire } from "node:module"
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join, relative, resolve, sep } from "node:path"

const require = createRequire(import.meta.url)
const TEMP_ROOT = resolve(process.env.GG_UI_TEMP ?? join(process.env.TEMP ?? tmpdir(), "opencode"))
const BASE_URL = (process.env.GG_TEMP_URL ?? "http://127.0.0.1:5179/").replace(/\/$/, "")
const STAMP = new Date().toISOString().replace(/[:.]/g, "-")
const ARTIFACTS = resolve(
  process.env.GG_DETAILS_ARTIFACTS ?? join(TEMP_ROOT, `gg-ui-details-resize-${STAMP}`),
)
const DETAILS_HANDLE = '[data-testid="details-resize-handle"]'
const DETAILS = '[data-testid="commit-details"]'
const DIFF_PAGE = '[data-testid="commit-diff-page"]'
const DETAILS_MIN_HEIGHT = 160
const DETAILS_HISTORY_MIN_HEIGHT = 120
const DEFAULT_RATIO = 0.42

const checks = []
const screenshots = []
const pageErrors = []
const consoleErrors = []

function loadPlaywright() {
  const candidates = [
    process.env.GG_PLAYWRIGHT_CORE,
    join(TEMP_ROOT, "gg-ui-test", "node_modules", "playwright-core"),
  ].filter(Boolean)
  for (const candidate of candidates) {
    try {
      return require(candidate)
    } catch (error) {
      if (candidate === candidates.at(-1)) {
        throw new Error(`Cannot load playwright-core: ${error.message}`)
      }
    }
  }
  throw new Error("playwright-core is not available")
}

function findChrome() {
  const candidates = [
    process.env.GG_CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    join(process.env.LOCALAPPDATA ?? "", "Google/Chrome/Application/chrome.exe"),
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  ].filter(Boolean)
  const found = candidates.find((candidate) => existsSync(candidate))
  if (!found) throw new Error("No Chrome/Edge executable found")
  return found
}

function check(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail })
}

function git(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  }).trim()
}

function insidePath(parent, child) {
  const rel = relative(parent, child)
  return rel !== "" && !rel.startsWith("..") && !rel.includes(`..${sep}`)
}

async function settle(page) {
  await page.evaluate(
    () =>
      new Promise((resolveFrame) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolveFrame()))
      }),
  )
  await page.waitForTimeout(60)
}

async function screenshot(page, name) {
  const file = join(ARTIFACTS, name)
  await page.screenshot({ path: file, fullPage: true })
  screenshots.push(file)
  return file
}

async function layout(page) {
  return page.evaluate(() => {
    const rect = (selector) => {
      const element = document.querySelector(selector)
      if (!(element instanceof HTMLElement)) return null
      const box = element.getBoundingClientRect()
      return {
        top: box.top,
        bottom: box.bottom,
        left: box.left,
        right: box.right,
        width: box.width,
        height: box.height,
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        scrollTop: element.scrollTop,
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        overflowY: getComputedStyle(element).overflowY,
      }
    }
    const panel = rect(".git-graph-panel")
    const history = rect(".gg-history")
    const details = rect('[data-testid="commit-details"]')
    const handle = rect('[data-testid="details-resize-handle"]')
    const diffScroll = rect(".gg-details .gg-diff-scroll")
    return {
      panel,
      history,
      details,
      handle,
      diffScroll,
      combined:
        history && details ? Math.round((details.bottom - history.top) * 10) / 10 : 0,
      documentScrollHeight: document.documentElement.scrollHeight,
      innerHeight: window.innerHeight,
      bodyScrollHeight: document.body.scrollHeight,
      diffSource: document
        .querySelector('[data-testid="commit-diff-page"]')
        ?.getAttribute("data-diff-source"),
    }
  })
}

async function dragDetails(page, deltaY) {
  const box = await page.locator(DETAILS_HANDLE).boundingBox()
  if (!box) throw new Error("details resize handle has no bounding box")
  const x = box.x + box.width / 2
  const y = box.y + Math.max(1, box.height / 2)
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x, y + deltaY, { steps: 12 })
  await page.mouse.up()
  await settle(page)
}

async function selectRepository(page, value) {
  await page.locator('[data-testid="repository-select"]').selectOption(value)
  await page.waitForFunction(
    () => {
      const row = document.querySelector('[data-testid="uncommitted-row"]')
      const total = Number(row?.getAttribute("data-uncommitted-total") ?? "0")
      return (
        total >= 2 &&
        document.querySelector('[data-testid="uncommitted-count-staged"]') !== null &&
        document.querySelector('[data-testid="uncommitted-count-unstaged"]') !== null
      )
    },
    undefined,
    { timeout: 15_000 },
  )
}

async function expandUncommitted(page) {
  const slot = page.locator('[data-testid="uncommitted-slot"]')
  if ((await slot.count()) === 0) {
    await page.locator('[data-testid="uncommitted-row"] .gg-col-desc').click()
  }
  await slot.waitFor({ state: "visible", timeout: 10_000 })
}

async function selectDirtyFile(page, groupTitle, filePath) {
  const group = page
    .locator(".gg-status-group")
    .filter({ has: page.locator(".gg-group-head", { hasText: groupTitle }) })
  await group.locator(".gg-file-row", { hasText: filePath }).first().click()
  await page.locator(DETAILS).waitFor({ state: "visible", timeout: 10_000 })
  await page.locator(DIFF_PAGE).waitFor({ state: "visible", timeout: 10_000 })
  await settle(page)
}

function prepareDirty(repositoryPath) {
  const status = git(repositoryPath, ["status", "--porcelain"])
  if (status !== "") {
    throw new Error(
      `TEMP fixture is not clean before details-resize setup: ${repositoryPath}: ${status}`,
    )
  }
  const tracked = git(repositoryPath, ["ls-files"])
    .split(/\r?\n/)
    .filter(Boolean)
  if (tracked.length < 2) throw new Error("TEMP fixture needs two tracked files")
  const preferred = ["README.md", "src/app.txt", "docs/current.md", "docs/main-only.txt"]
  const fileA = preferred.find((path) => tracked.includes(path)) ?? tracked[0]
  const fileB =
    preferred.find((path) => path !== fileA && tracked.includes(path)) ??
    tracked.find((path) => path !== fileA)
  if (!fileA || !fileB) throw new Error("TEMP fixture needs two distinct tracked files")

  const originalA = readFileSync(join(repositoryPath, fileA))
  const originalB = readFileSync(join(repositoryPath, fileB))
  const expand = (buffer, tag) => {
    const text = buffer.toString("utf8")
    const base = text.endsWith("\n") ? text : `${text}\n`
    const lines = Array.from(
      { length: 140 },
      (_, index) => `${tag} fixture line ${index + 1}`,
    )
    return `${base}${lines.join("\n")}\n`
  }

  const restore = () => {
    try {
      writeFileSync(join(repositoryPath, fileA), originalA)
      writeFileSync(join(repositoryPath, fileB), originalB)
      git(repositoryPath, ["reset", "--", fileA, fileB])
    } catch {
      // Cleanup is best-effort; the fixture root itself is throwaway TEMP data.
    }
  }

  try {
    writeFileSync(join(repositoryPath, fileA), expand(originalA, "index"))
    git(repositoryPath, ["add", "--", fileA])
    writeFileSync(join(repositoryPath, fileB), expand(originalB, "worktree"))
    const staged = git(repositoryPath, ["diff", "--cached", "--name-only"])
      .split(/\r?\n/)
      .filter(Boolean)
    const unstaged = git(repositoryPath, ["diff", "--name-only"])
      .split(/\r?\n/)
      .filter(Boolean)
    if (!staged.includes(fileA)) throw new Error("staged fixture file is missing from index")
    if (!unstaged.includes(fileB)) {
      throw new Error("working-tree fixture file is missing from unstaged diff")
    }
    return { fileA, fileB, restore }
  } catch (error) {
    restore()
    throw error
  }
}

async function main() {
  mkdirSync(ARTIFACTS, { recursive: true })
  const { chromium } = loadPlaywright()
  const browser = await chromium.launch({
    headless: true,
    executablePath: findChrome(),
    args: ["--disable-gpu", "--no-first-run", "--no-default-browser-check"],
  })
  let dirty
  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
    })
    const page = await context.newPage()
    page.on("pageerror", (error) => pageErrors.push(String(error)))
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text())
    })

    await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" })
    check(
      "harness runs in mutation-fixture mode",
      (await page.locator('[data-testid="harness-mode"]').getAttribute("data-mode")) ===
        "mutation-fixture",
      await page.locator('[data-testid="harness-mode"]').getAttribute("data-mode"),
    )

    await page.locator('[data-testid="repository-select"]').waitFor({ timeout: 15_000 })
    const options = await page.locator('[data-testid="repository-select"] option').evaluateAll(
      (items) => items.map((item) => ({ value: item.value, text: item.textContent ?? "" })),
    )
    check("TEMP fixture exposes repositories", options.length > 0, options.length)
    const chosen = options.find((option) => /primary/i.test(option.text)) ?? options[0]
    if (!chosen) throw new Error("No TEMP repository option found")

    const tempCanonical = realpathSync(TEMP_ROOT)
    const repoPath = realpathSync(resolve(chosen.value))
    check("selected repository is inside approved TEMP", insidePath(tempCanonical, repoPath), repoPath)
    check("selected repository has a .git directory", existsSync(join(repoPath, ".git")), repoPath)
    const harnessRoot = realpathSync(
      resolve((await page.locator('[data-testid="harness-root"]').textContent()) ?? ""),
    )
    check("harness root is inside approved TEMP", insidePath(tempCanonical, harnessRoot), harnessRoot)
    const markerPath = join(harnessRoot, ".gg-mutation-fixture.json")
    const marker = JSON.parse(readFileSync(markerPath, "utf8"))
    check(
      "fixture marker approves the harness root",
      marker.kind === "gg-mutation-fixture" &&
        realpathSync(resolve(marker.root)) === harnessRoot,
      { kind: marker.kind, root: marker.root },
    )

    dirty = prepareDirty(repoPath)

    await page.reload({ waitUntil: "domcontentloaded" })
    await page.locator('[data-testid="repository-select"]').waitFor({ timeout: 15_000 })
    await selectRepository(page, chosen.value)
    check(
      "fixture has staged and unstaged changes",
      (await page.locator('[data-testid="uncommitted-count-staged"]').count()) > 0 &&
        (await page.locator('[data-testid="uncommitted-count-unstaged"]').count()) > 0,
      {
        staged: await page.locator('[data-testid="uncommitted-count-staged"]').textContent(),
        unstaged: await page.locator('[data-testid="uncommitted-count-unstaged"]').textContent(),
      },
    )

    await expandUncommitted(page)

    // ---------- index file ----------
    await selectDirtyFile(page, "Staged", dirty.fileA)
    let before = await layout(page)
    check(
      "index diff opens in the bottom details pane",
      before.diffSource === "index" && before.details !== null,
      { source: before.diffSource, height: before.details?.height },
    )
    check(
      "top handle spans the whole details width",
      before.handle !== null &&
        before.details !== null &&
        Math.abs(before.handle.width - before.details.width) <= 1 &&
        before.handle.height >= 5 &&
        before.handle.height <= 8,
      { handle: before.handle, detailsWidth: before.details?.width },
    )
    const indexShotBefore = await screenshot(page, "01-index-before-drag.png")

    await dragDetails(page, -90)
    const afterUp = await layout(page)
    check(
      "dragging the top handle up grows the details pane",
      afterUp.details.height >= before.details.height + 40,
      { before: before.details.height, after: afterUp.details.height },
    )
    check(
      "handle stays on the moved top edge",
      Math.abs(afterUp.handle.top - afterUp.details.top) <= 1 &&
        afterUp.details.top < before.details.top - 20,
      { handleTop: afterUp.handle.top, detailsTop: afterUp.details.top },
    )
    const indexShotAfter = await screenshot(page, "02-index-after-up-drag.png")

    await dragDetails(page, 160)
    const afterDown = await layout(page)
    check(
      "dragging the top handle down shrinks the details pane",
      afterDown.details.height <= afterUp.details.height - 40,
      { up: afterUp.details.height, down: afterDown.details.height },
    )

    await dragDetails(page, -4000)
    const atMax = await layout(page)
    const expectedMax = Math.max(0, atMax.combined - DETAILS_HISTORY_MIN_HEIGHT)
    check(
      "details maximum leaves the history minimum and does not overflow",
      Math.abs(atMax.details.height - expectedMax) <= 3 &&
        atMax.details.bottom <= atMax.panel.bottom + 1 &&
        atMax.history.height >= DETAILS_HISTORY_MIN_HEIGHT - 2,
      {
        height: atMax.details.height,
        expectedMax,
        combined: atMax.combined,
        historyHeight: atMax.history.height,
        panelBottom: atMax.panel.bottom,
        detailsBottom: atMax.details.bottom,
      },
    )

    await dragDetails(page, 4000)
    const atMin = await layout(page)
    const expectedMin = Math.min(DETAILS_MIN_HEIGHT, Math.max(0, atMin.combined - DETAILS_HISTORY_MIN_HEIGHT))
    check(
      "details minimum is clamped and the pane still fits",
      Math.abs(atMin.details.height - expectedMin) <= 3 &&
        atMin.details.bottom <= atMin.panel.bottom + 1,
      { height: atMin.details.height, expectedMin, combined: atMin.combined },
    )
    check(
      "diff scrolls internally at the minimum height",
      atMin.diffScroll !== null &&
        atMin.diffScroll.scrollHeight > atMin.diffScroll.clientHeight &&
        /auto|scroll/.test(atMin.diffScroll.overflowY),
      {
        scrollHeight: atMin.diffScroll?.scrollHeight,
        clientHeight: atMin.diffScroll?.clientHeight,
        overflowY: atMin.diffScroll?.overflowY,
      },
    )
    check(
      "page itself never grows while the details pane is resized",
      atMin.documentScrollHeight <= atMin.innerHeight + 1,
      {
        documentScrollHeight: atMin.documentScrollHeight,
        innerHeight: atMin.innerHeight,
      },
    )
    const minShot = await screenshot(page, "03-index-at-minimum.png")

    // ---------- working-tree file ----------
    await selectDirtyFile(page, "Unstaged", dirty.fileB)
    const worktreeBefore = await layout(page)
    check(
      "working-tree diff opens in the same details pane",
      worktreeBefore.diffSource === "working-tree",
      worktreeBefore.diffSource,
    )
    await dragDetails(page, -70)
    const worktreeAfter = await layout(page)
    check(
      "working-tree details pane also resizes from the top edge",
      worktreeAfter.details.height >= worktreeBefore.details.height + 30,
      {
        before: worktreeBefore.details.height,
        after: worktreeAfter.details.height,
      },
    )
    const worktreeShot = await screenshot(page, "04-working-tree-after-drag.png")

    // ---------- close / reopen ----------
    const beforeClose = await layout(page)
    await page.locator('[data-testid="details-back"]').click()
    await page.locator(DETAILS).waitFor({ state: "detached", timeout: 5_000 })
    await selectDirtyFile(page, "Unstaged", dirty.fileB)
    const reopened = await layout(page)
    check(
      "closing and reopening keeps the remembered details height",
      Math.abs(reopened.details.height - beforeClose.details.height) <= 2,
      { beforeClose: beforeClose.details.height, reopened: reopened.details.height },
    )

    // ---------- remount ----------
    const beforeRemount = await layout(page)
    await page.evaluate(() => {
      window.__ggOldPanel = document.querySelector(".git-graph-panel")
    })
    await page.locator('[data-testid="harness-remount-panel"]').click()
    await page.waitForFunction(
      () => {
        const panel = document.querySelector(".git-graph-panel")
        return panel !== null && panel !== window.__ggOldPanel
      },
      undefined,
      { timeout: 10_000 },
    )
    await settle(page)
    await expandUncommitted(page)
    await selectDirtyFile(page, "Unstaged", dirty.fileB)
    const afterRemount = await layout(page)
    check(
      "remount restores the cached details height when the pane is reopened",
      Math.abs(afterRemount.details.height - beforeRemount.details.height) <= 2,
      {
        beforeRemount: beforeRemount.details.height,
        afterRemount: afterRemount.details.height,
      },
    )

    // ---------- keyboard ----------
    const handle = page.locator(DETAILS_HANDLE)
    await handle.focus()
    await handle.press("End")
    await settle(page)
    const keyMax = await layout(page)
    const keyMaxExpected = Math.max(0, keyMax.combined - DETAILS_HISTORY_MIN_HEIGHT)
    check(
      "keyboard End reaches the maximum",
      Math.abs(keyMax.details.height - keyMaxExpected) <= 3,
      { height: keyMax.details.height, expected: keyMaxExpected },
    )
    await handle.press("Home")
    await settle(page)
    const keyMin = await layout(page)
    check(
      "keyboard Home reaches the minimum",
      Math.abs(keyMin.details.height - DETAILS_MIN_HEIGHT) <= 3,
      { height: keyMin.details.height, expected: DETAILS_MIN_HEIGHT },
    )
    await handle.press("ArrowUp")
    await settle(page)
    const keyUp = await layout(page)
    check(
      "keyboard ArrowUp grows the details pane",
      keyUp.details.height >= keyMin.details.height + 10,
      { before: keyMin.details.height, after: keyUp.details.height },
    )

    // ---------- double-click reset (optional but implemented) ----------
    await handle.dblclick()
    await settle(page)
    const reset = await layout(page)
    const resetExpected = Math.max(
      Math.min(DETAILS_MIN_HEIGHT, Math.max(0, reset.combined - DETAILS_HISTORY_MIN_HEIGHT)),
      Math.min(
        Math.max(0, reset.combined - DETAILS_HISTORY_MIN_HEIGHT),
        reset.combined * DEFAULT_RATIO,
      ),
    )
    check(
      "double-click resets to the default share",
      Math.abs(reset.details.height - resetExpected) <= 3,
      { height: reset.details.height, expected: resetExpected },
    )

    // ---------- very short viewport ----------
    await page.setViewportSize({ width: 1000, height: 320 })
    await page.waitForTimeout(300)
    await settle(page)
    const short = await layout(page)
    const shortMax = Math.max(0, short.combined - DETAILS_HISTORY_MIN_HEIGHT)
    check(
      "short viewport clamps the details pane and keeps the page intact",
      short.details.height <= shortMax + 3 &&
        short.details.bottom <= short.panel.bottom + 1 &&
        short.documentScrollHeight <= short.innerHeight + 1 &&
        short.history.height >= 0,
      {
        height: short.details.height,
        shortMax,
        combined: short.combined,
        historyHeight: short.history.height,
        documentScrollHeight: short.documentScrollHeight,
        innerHeight: short.innerHeight,
      },
    )
    const shortShot = await screenshot(page, "05-very-short-viewport.png")

    await page.setViewportSize({ width: 1280, height: 720 })
    await page.waitForTimeout(300)
    await settle(page)

    // ---------- Back / close ----------
    await page.locator('[data-testid="details-back"]').click()
    await page.locator(DETAILS).waitFor({ state: "detached", timeout: 5_000 })
    check("Back closes the diff details pane", (await page.locator(DETAILS).count()) === 0, true)

    check("no page errors", pageErrors.length === 0, pageErrors)

    const result = {
      ok: checks.every((entry) => entry.ok),
      baseUrl: BASE_URL,
      artifacts: ARTIFACTS,
      screenshots,
      checks,
      pageErrors,
      consoleErrors,
      measurements: {
        index: { before, afterUp, afterDown, atMax, atMin },
        workingTree: { before: worktreeBefore, after: worktreeAfter },
        reopened,
        afterRemount,
        keyboard: { keyMax, keyMin, keyUp, reset },
        short,
      },
    }
    writeFileSync(join(ARTIFACTS, "result.json"), `${JSON.stringify(result, null, 2)}\n`)
    for (const entry of checks) {
      process.stdout.write(`${entry.ok ? "PASS" : "FAIL"} ${entry.name} ${JSON.stringify(entry.detail)}\n`)
    }
    process.stdout.write(`\nArtifacts: ${ARTIFACTS}\n`)
    process.stdout.write(`Screenshots:\n${screenshots.map((file) => `  ${file}`).join("\n")}\n`)
    if (!result.ok) process.exitCode = 1
  } finally {
    dirty?.restore()
    await browser.close()
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exitCode = 1
})
