/**
 * Release-candidate UI acceptance: FR read-only + isolated TEMP mutation fixture.
 *
 * THIS SCRIPT IS PREPARED FOR THE FROZEN RELEASE BUILD. It is intentionally
 * separate from acceptance.mjs/interactions.mjs and does not modify the product
 * or harness. It never sends a valid confirmed mutation to the FR bridge.
 *
 * Run (after the harness owner confirms both roots):
 *   node dev/ui-test/release.mjs
 *   node dev/ui-test/release.mjs --audit   # selector readiness only, no writes
 *
 * Environment:
 *   GG_FR_URL       default http://127.0.0.1:5178/
 *   GG_TEMP_URL     default http://127.0.0.1:5179/
 *   GG_RELEASE_ARTIFACTS
 *                   default <TEMP>/opencode/gg-ui-release-final
 *   GG_FR_REPO      primary FR fixture (default: first normal repository)
 *   GG_TEMP_REPO    TEMP mutation fixture (default: first repository)
 *   GG_PLAYWRIGHT_CORE / GG_CHROME_PATH as in the other dev UI scripts.
 *
 * Selector names that are still being integrated are listed in SELECTORS below.
 * The --audit mode prints the exact present/missing checklist without running
 * the full flow or mutating anything.
 */

import { createRequire } from "node:module"
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, "../..")
const TEMP_ROOT = process.env.GG_UI_TEMP ?? join(process.env.TEMP ?? tmpdir(), "opencode")
const FR_ORIGIN = (process.env.GG_FR_URL ?? "http://127.0.0.1:5178/").replace(/\/$/, "")
const TEMP_ORIGIN = (process.env.GG_TEMP_URL ?? "http://127.0.0.1:5179/").replace(/\/$/, "")
const FR_BASE = `${FR_ORIGIN}/`
const TEMP_BASE = `${TEMP_ORIGIN}/`
const ARTIFACTS = resolve(
  process.env.GG_RELEASE_ARTIFACTS ?? join(TEMP_ROOT, "gg-ui-release-final"),
)
const FR_REPO_NAME = process.env.GG_FR_REPO
const TEMP_REPO_NAME = process.env.GG_TEMP_REPO
const MUTATION_METHODS = new Set([
  "checkoutBranch",
  "createBranch",
  "createTag",
  "renameBranch",
  "deleteBranch",
  "deleteTag",
])
const COMPARISON_METHODS = new Set(["getComparisonFiles", "getComparisonDiff"])
const SOURCE_FILES = [
  "src/gui/panel.tsx",
  "src/gui/styles.ts",
  "src/gui/column-layout.ts",
  "src/gui/row-layout.ts",
  "src/gui/commit-diff-view.tsx",
  "src/gui/compare-view.tsx",
  "src/gui/pagination.ts",
  "src/gui/branch-selector.tsx",
  "src/gui/ref-menu.tsx",
  "src/gui/ref-utils.ts",
  "src/gui/confirm-dialog.tsx",
  "src/rpc.ts",
  "src/server/repository/manager.ts",
  "src/server/git/compare.ts",
  "src/server/git/log.ts",
]

const screenshots = []
const hmrEvents = []

const SELECTORS = {
  repository: ['[data-testid="repository-select"]'],
  currentBranch: ['[data-testid="current-branch"]'],
  refresh: ['[data-testid="refresh"]'],
  search: ['[data-testid="search-commits"]'],
  history: ['[data-testid="history"]'],
  historyScroll: ['[data-testid="history-scroll"]'],
  row: [".gg-graph-row"],
  dateCell: ['[data-testid="commit-date"]', ".gg-col-date"],
  denseGraph: ['[data-testid="dense-graph"]'],
  graphResize: ['[data-testid="resize-column-graph"]'],
  graphScroll: ['[data-testid="graph-scroll"]'],
  resizeGraph: ['[data-testid="resize-column-graph"]'],
  resizeDescription: ['[data-testid="resize-column-description"]'],
  resizeDate: ['[data-testid="resize-column-date"]'],
  resizeAuthor: ['[data-testid="resize-column-author"]'],
  resizeCommit: ['[data-testid="resize-column-commit"]'],
  branchSelector: ['[data-testid="branch-selector"]'],
  branchSelectorClose: ['[data-testid="branch-selector-close"]'],
  branchFilter: ['[data-testid="branch-filter"]'],
  branchFilterAll: ['[data-testid="branch-filter-all"]'],
  branchFilterSelected: ['[data-testid="branch-filter-selected"]'],
  branchFilterRef: ['[data-testid="branch-filter-ref"]'],
  applyBranchFilter: ['[data-testid="apply-branch-filter"]'],
  showRemotes: ['[data-testid="show-remotes"]', '[data-testid="filter-show-remotes"]'],
  showTags: ['[data-testid="show-tags"]', '[data-testid="filter-show-tags"]'],
  firstParent: ['[data-testid="first-parent"]'],
  historyOrder: ['[data-testid="history-order"]'],
  jumpHead: ['[data-testid="jump-head"]'],
  refBadge: ['[data-testid="ref-badge"]', ".gg-ref-badge:not(.gg-ref-more)"],
  refMenu: ['[data-testid="ref-menu"]', '[data-testid="ref-context-menu"]'],
  commitMenu: ['[data-testid="commit-context-menu"]'],
  checkoutConfirm: ['[data-testid="checkout-confirm"]', '[data-testid="confirm-action"]'],
  checkoutCancel: ['[data-testid="checkout-cancel"]', '[data-testid="confirm-cancel"]'],
  confirmAction: ['[data-testid="confirm-action"]'],
  confirmCancel: ['[data-testid="confirm-cancel"]'],
  dialog: ['[data-testid="confirm-dialog"]'],
  inlineSlot: ['[data-testid="inline-slot"]'],
  inlineFiles: ['[data-testid="inline-files"]'],
  commitDiff: ['[data-testid="commit-diff-page"]'],
  comparisonDiff: ['[data-testid="comparison-page"]', '[data-testid="comparison-diff"]'],
  comparisonBack: ['[data-testid="details-back"][data-comparison-back="true"]', '[data-testid="details-back"]'],
  detailsBack: ['[data-testid="details-back"]'],
  loadMore: ['[data-testid="load-more"]'],
  checkoutRow: ['[data-testid="checkout-branch-row"]'],
}

function loadPlaywright() {
  const candidates = [
    process.env.GG_PLAYWRIGHT_CORE,
    join(TEMP_ROOT, "gg-ui-test", "node_modules", "playwright-core"),
  ].filter(Boolean)
  for (const candidate of candidates) {
    try {
      return require(candidate)
    } catch (error) {
      if (candidate === candidates.at(-1)) throw new Error(`Cannot load playwright-core: ${error.message}`)
    }
  }
  throw new Error("playwright-core is not available")
}

function findChrome() {
  const candidates = [
    process.env.GG_CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Users/yahan/AppData/Local/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  ].filter(Boolean)
  const found = candidates.find((candidate) => existsSync(candidate))
  if (!found) throw new Error("No Chrome/Edge executable found")
  return found
}

async function fetchRpc(origin, method, input) {
  const response = await fetch(`${origin}/__gg/rpc/${method}`, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(input ?? {}),
  })
  let body
  try {
    body = await response.json()
  } catch {
    body = undefined
  }
  return { status: response.status, ok: body?.ok === true, body }
}

function parseInput(request) {
  try {
    return JSON.parse(request.postData() ?? "{}")
  } catch {
    return undefined
  }
}

function sourceMtimes() {
  return Object.fromEntries(
    SOURCE_FILES.filter((file) => existsSync(join(ROOT, file))).map((file) => {
      const stat = statSync(join(ROOT, file))
      return [file, { mtimeMs: stat.mtimeMs, size: stat.size }]
    }),
  )
}

function checkResult(checks, name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail })
}

async function anyLocator(page, selectors) {
  for (const selector of selectors) {
    const locator = page.locator(selector)
    if ((await locator.count()) > 0) return locator.first()
  }
  return null
}

async function waitForAny(page, selectors, timeout = 15_000) {
  for (const selector of selectors) {
    try {
      await page.locator(selector).first().waitFor({ state: "visible", timeout })
      return page.locator(selector).first()
    } catch {
      /* try next */
    }
  }
  throw new Error(`None of the selectors became visible: ${selectors.join(", ")}`)
}

async function waitRaf(page, frames = 2) {
  await page.evaluate(
    (count) =>
      new Promise((resolveFrame) => {
        let left = count
        const tick = () => {
          left -= 1
          if (left <= 0) resolveFrame()
          else requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      }),
    frames,
  )
}

async function waitLoaded(page, count, timeout = 20_000) {
  await page.waitForFunction(
    (expected) => {
      const text = document.querySelector(".gg-history-footer")?.innerText ?? ""
      return new RegExp(`(^|\\D)${expected} loaded`).test(text)
    },
    count,
    { timeout },
  )
}

async function waitRows(page, minimum = 1, timeout = 20_000) {
  await page.waitForFunction(
    (expected) => document.querySelectorAll(".gg-graph-row").length >= expected,
    minimum,
    { timeout },
  )
}

async function waitNotBusy(page, timeout = 20_000) {
  await page.waitForFunction(
    () => {
      const select = document.querySelector('[data-testid="repository-select"]')
      const refresh = document.querySelector('[data-testid="refresh"]')
      return select && !select.disabled && refresh && !refresh.disabled
    },
    null,
    { timeout },
  )
}

async function scrollToBottom(page) {
  await page.locator(SELECTORS.historyScroll[0]).evaluate((element) => {
    element.scrollTop = element.scrollHeight
  })
  await waitRaf(page, 2)
}

async function currentScrollTop(page) {
  return page.locator(SELECTORS.historyScroll[0]).evaluate((element) => element.scrollTop)
}

async function scrollToRowIndex(page, index) {
  await page.evaluate((wanted) => {
    const scroller = document.querySelector('[data-testid="history-scroll"]')
    const rows = [...document.querySelectorAll(".gg-graph-row")]
    const rowHeight =
      rows.length > 1
        ? Number(rows[1].dataset.rowTop) - Number(rows[0].dataset.rowTop)
        : rows[0]?.getBoundingClientRect().height || 28
    scroller.scrollTop = Math.min(
      Math.max(0, wanted * rowHeight),
      Math.max(0, scroller.scrollHeight - scroller.clientHeight),
    )
  }, index)
  await page.waitForFunction(
    (wanted) => Boolean(document.querySelector(`.gg-graph-row[data-index="${wanted}"]`)),
    index,
    { timeout: 20_000 },
  )
  await waitRaf(page, 2)
}

async function firstVisibleHash(page) {
  return page.locator(".gg-graph-row .gg-hash").first().textContent().catch(() => null)
}

async function visibleRowHashes(page) {
  return page.locator(".gg-graph-row").evaluateAll((rows) =>
    rows.map((row) => row.getAttribute("data-commit")),
  )
}

async function refBadgeByName(page, name) {
  const badge = page
    .locator(`${SELECTORS.refBadge.join(",")}`)
    .filter({ hasText: name })
    .first()
  await badge.waitFor({ state: "visible", timeout: 15_000 }).catch(() => {})
  return badge
}

async function layoutSnapshot(page) {
  return page.evaluate(() => {
    const q = (selector, root = document) => root.querySelector(selector)
    const qa = (selector, root = document) => [...root.querySelectorAll(selector)]
    const panel = q(".git-graph-panel")
    const scroller = q('[data-testid="history-scroll"]')
    const rows = qa(".gg-graph-row")
    const firstRow = rows[0]
    const firstDate = firstRow?.querySelector(".gg-col-date")
    const headerCells = qa(".gg-history-head > .gg-col-head")
    const graphCell = firstRow?.querySelector(".gg-row-graph")
    const slot = q('[data-testid="inline-slot"]')
    const spacer = q(".gg-history-spacer")
    const rect = (element) => {
      if (!element) return null
      const r = element.getBoundingClientRect()
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }
    }
    const overflow = (element) => (element ? Math.max(0, element.scrollWidth - element.clientWidth) : 0)
    return {
      viewport: { width: innerWidth, height: innerHeight },
      panel: rect(panel),
      panelOverflowX: overflow(panel),
      doc: { scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth },
      body: { scrollWidth: document.body.scrollWidth, clientWidth: document.body.clientWidth },
      nestedButtons: qa(".git-graph-panel button button").length,
      labels: headerCells.map((cell) => cell.textContent.trim()),
      grids: {
        header: q(".gg-history-head") ? getComputedStyle(q(".gg-history-head")).gridTemplateColumns : null,
        row: firstRow ? getComputedStyle(firstRow).gridTemplateColumns : null,
      },
      graph: {
        headerWidth: headerCells[0]?.getBoundingClientRect().width ?? null,
        rowWidth: graphCell?.getBoundingClientRect().width ?? null,
        scrollWidth: graphCell?.scrollWidth ?? null,
        clientWidth: graphCell?.clientWidth ?? null,
        hasGraphScroll: Boolean(q('[data-testid="graph-scroll"]')),
        hasGraphHandle: Boolean(q('[data-testid="resize-column-graph"]')),
        svgWidth: firstRow?.querySelector(".gg-graph-svg")?.getAttribute("width") ?? null,
      },
      date: firstDate
        ? {
            text: firstDate.textContent.trim(),
            title: firstDate.getAttribute("title"),
            width: firstDate.getBoundingClientRect().width,
            scrollWidth: firstDate.scrollWidth,
            clientWidth: firstDate.clientWidth,
            visible: true,
          }
        : { visible: false },
      rows: rows.map((row) => ({
        index: Number(row.dataset.index),
        top: Number(row.dataset.rowTop),
        hash: row.dataset.commit,
        expanded: row.getAttribute("aria-expanded") === "true",
        paths: row.querySelectorAll(".gg-graph-svg path").length,
      })),
      rowHeight: firstRow ? firstRow.getBoundingClientRect().height : null,
      slot: slot ? { top: Number.parseFloat(slot.style.top), height: Number.parseFloat(slot.style.height) } : null,
      spacer: spacer
        ? {
            height: Number.parseFloat(spacer.style.height),
            slotHeight: Number(spacer.dataset.slotHeight ?? 0),
            expandedIndex: spacer.hasAttribute("data-expanded-index")
              ? Number(spacer.dataset.expandedIndex)
              : null,
          }
        : null,
      inlineFiles: qa('[data-testid="inline-files"] .gg-file-row').length,
      scroller: scroller
        ? { scrollTop: scroller.scrollTop, scrollHeight: scroller.scrollHeight, clientHeight: scroller.clientHeight }
        : null,
      footer: (q(".gg-history-footer")?.innerText ?? "").replace(/\s+/g, " ").trim(),
      errors: qa(".gg-error").map((element) => element.innerText.trim().slice(0, 180)),
      warnings: qa(".gg-warning").map((element) => element.innerText.trim().slice(0, 180)),
      handles: {
        description: Boolean(q('[data-testid="resize-column-description"]')),
        date: Boolean(q('[data-testid="resize-column-date"]')),
        author: Boolean(q('[data-testid="resize-column-author"]')),
        commit: Boolean(q('[data-testid="resize-column-commit"]')),
        graph: Boolean(q('[data-testid="resize-column-graph"]')),
      },
    }
  })
}

async function openBranchSelector(page) {
  const existing = await anyLocator(page, SELECTORS.branchSelector)
  if (existing) return existing
  await page.locator(SELECTORS.currentBranch[0]).click()
  return waitForAny(page, SELECTORS.branchSelector)
}

async function closeBranchSelectorIfOpen(page) {
  if ((await page.locator(SELECTORS.branchSelector[0]).count()) === 0) return
  await closeBranchSelector(page)
}

async function closeBranchSelector(page) {
  const close = await anyLocator(page, SELECTORS.branchSelectorClose)
  if (close) await close.click()
  else await page.keyboard.press("Escape")
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="branch-selector"]'),
    null,
    { timeout: 10_000 },
  )
}

async function triggerHistoryRequest(page, predicate, action) {
  const requestPromise = page.waitForRequest(
    (request) => {
      if (!request.url().endsWith("/__gg/rpc/getLog")) return false
      const input = parseInput(request)
      return Boolean(input) && predicate(input)
    },
    { timeout: 20_000 },
  )
  await action()
  const request = await requestPromise
  await waitRows(page, 1)
  return parseInput(request)
}

async function applyHistoryFilter(page, configure) {
  await openBranchSelector(page)
  const requestPromise = page.waitForRequest(
    (request) => {
      if (!request.url().endsWith("/__gg/rpc/getLog")) return false
      const input = parseInput(request)
      return Boolean(input)
    },
    { timeout: 20_000 },
  )
  await configure(page)
  const apply = await anyLocator(page, SELECTORS.applyBranchFilter)
  if (!apply) throw new Error("apply-branch-filter is missing")
  await apply.click()
  const request = await requestPromise
  await closeBranchSelector(page)
  await waitRows(page, 1)
  return parseInput(request)
}

async function openMenuAt(page, selector, button = "right") {
  const badge = await waitForAny(page, selector)
  const beforeRows = await page.locator(".gg-graph-row").count()
  await badge.click({ button })
  return { badge, beforeRows }
}

async function menuAction(page, menuSelectors, action) {
  const menu = await waitForAny(page, menuSelectors)
  const button = menu.locator(`[data-action="${action}"]`)
  await button.waitFor({ state: "visible", timeout: 10_000 })
  await button.click()
}

function shortHash(hash) {
  return hash ? hash.slice(0, 7) : ""
}

function refsSignature(refs) {
  return refs
    .map((ref) => `${ref.kind}:${ref.name}:${ref.hash}`)
    .sort()
    .join("|")
}

function canonicalRef(ref) {
  if (ref.kind === "branch") return `refs/heads/${ref.name}`
  if (ref.kind === "remote") return `refs/remotes/${ref.name}`
  if (ref.kind === "tag") return `refs/tags/${ref.name}`
  return undefined
}

async function copyFromClipboard(page) {
  return page.evaluate(() => navigator.clipboard.readText())
}

async function waitDialog(page, selectors = SELECTORS.dialog) {
  return waitForAny(page, selectors)
}

async function fillDialog(page, values) {
  const fields = page.locator('[data-testid^="confirm-field-"]')
  const count = await fields.count()
  for (let index = 0; index < count; index += 1) {
    const value = values[index]
    if (value === undefined || value === null) continue
    const field = fields.nth(index)
    await field.fill(String(value))
  }
  return count
}

async function fillFieldIfPresent(page, id, value) {
  const field = page.locator(`[data-testid="confirm-field-${id}"]`)
  if ((await field.count()) === 0) return false
  await field.fill(String(value))
  return true
}

async function confirmDialog(page, confirmSelectors = SELECTORS.confirmAction) {
  const button = await anyLocator(page, confirmSelectors)
  if (!button) throw new Error("confirmation action is missing")
  await button.click()
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="confirm-dialog"]'),
    null,
    { timeout: 30_000 },
  )
}

async function cancelDialog(page, cancelSelectors = SELECTORS.confirmCancel) {
  const button = await anyLocator(page, cancelSelectors)
  if (!button) throw new Error("confirmation cancel is missing")
  await button.click()
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="confirm-dialog"]'),
    null,
    { timeout: 10_000 },
  )
}

async function dragColumn(page, id, delta) {
  const selector = SELECTORS[`resize${id[0].toUpperCase()}${id.slice(1)}`][0]
  const handle = page.locator(selector)
  await handle.waitFor({ state: "visible", timeout: 10_000 })
  const box = await handle.boundingBox()
  if (!box) throw new Error(`No handle box: ${selector}`)
  const before = await columnWidth(page, id)
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + delta, box.y + box.height / 2, { steps: 8 })
  await page.mouse.up()
  await page.waitForFunction(
    ({ column, before: previous }) => {
      const labels = [...document.querySelectorAll(".gg-history-head > .gg-col-head")].map(
        (cell) => cell.textContent.trim(),
      )
      const cell = document.querySelectorAll(".gg-history-head > .gg-col-head")[
        labels.indexOf(column)
      ]
      return cell && Math.abs(cell.getBoundingClientRect().width - previous) > 1
    },
    { column: id[0].toUpperCase() + id.slice(1), before },
    { timeout: 10_000 },
  ).catch(() => {})
  await waitRaf(page, 2)
  return { before, after: await columnWidth(page, id) }
}

async function columnWidth(page, id) {
  return page.evaluate((columnId) => {
    const labels = [...document.querySelectorAll(".gg-history-head > .gg-col-head")].map(
      (cell) => cell.textContent.trim(),
    )
    const cell = document.querySelectorAll(".gg-history-head > .gg-col-head")[
      labels.indexOf(columnId[0].toUpperCase() + columnId.slice(1))
    ]
    return cell ? cell.getBoundingClientRect().width : null
  }, id)
}

function makeGate() {
  let resolveGate
  const promise = new Promise((resolve) => {
    resolveGate = resolve
  })
  return { promise, release: () => resolveGate() }
}

async function withHeldRpc(page, methods, action) {
  let current = makeGate()
  let releaseAll = current
  const routes = methods.map((method) =>
    page.route(`**/__gg/rpc/${method}`, async (route) => {
      await releaseAll.promise
      await route.continue()
    }),
  )
  await Promise.all(routes)
  const result = await action({
    release: () => current.release(),
    rearm: () => {
      current = makeGate()
      releaseAll = current
      return current
    },
  })
  current.release()
  await page.unroute(`**/__gg/rpc/getStatus`).catch(() => {})
  await page.unroute(`**/__gg/rpc/getLog`).catch(() => {})
  return result
}

async function loadingGateScenario(browser, frPrimary, checks, metrics) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "en-US" })
  const page = await context.newPage()
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: FR_ORIGIN })
  const requests = []
  page.on("request", (request) => {
    if (!request.url().includes("/__gg/rpc/")) return
    let input
    try { input = JSON.parse(request.postData() ?? "{}") } catch { input = undefined }
    requests.push({ method: request.url().split("/__gg/rpc/")[1], input })
  })
  let gate = makeGate()
  let routeGate = gate
  await page.route("**/__gg/rpc/getStatus", async (route) => {
    await routeGate.promise
    await route.continue()
  })
  await page.route("**/__gg/rpc/getLog", async (route) => {
    await routeGate.promise
    await route.continue()
  })
  const waitStatus = page.waitForRequest((request) => request.url().endsWith("/__gg/rpc/getStatus"), { timeout: 20_000 })
  const waitLog = page.waitForRequest((request) => request.url().endsWith("/__gg/rpc/getLog"), { timeout: 20_000 })
  await page.goto(FR_BASE, { waitUntil: "domcontentloaded" })
  await waitStatus
  await waitLog
  const controls = [
    SELECTORS.firstParent[0],
    SELECTORS.showRemotes[0],
    SELECTORS.showTags[0],
    SELECTORS.historyOrder[0],
  ]
  const controlStates = []
  for (const selector of controls) {
    const locator = page.locator(selector)
    if ((await locator.count()) === 0) {
      controlStates.push({ selector, present: false })
      continue
    }
    const disabled = await locator.isDisabled().catch(() => false)
    controlStates.push({ selector, present: true, disabled })
  }
  await page.locator(SELECTORS.currentBranch[0]).click().catch(() => {})
  const branchSelectorOpen = await page.locator(SELECTORS.branchSelector[0]).count()
  let applyDisabled = null
  if (branchSelectorOpen) {
    const apply = await anyLocator(page, SELECTORS.applyBranchFilter)
    if (apply) applyDisabled = await apply.isDisabled().catch(() => null)
  }
  const pendingRows = await page.locator(SELECTORS.row[0]).count()
  const pendingStatus = await page.locator('[data-testid="current-branch"]').count()
  for (const selector of controls) {
    const locator = page.locator(selector)
    if ((await locator.count()) === 0) continue
    if (!(await locator.isDisabled().catch(() => false))) {
      await locator.click().catch(() => {})
    }
  }
  if (branchSelectorOpen) await closeBranchSelector(page).catch(() => {})
  await screenshot(page, "12-fr-loading-gate.png", { fullPage: true })
  gate.release()
  await waitLoaded(page, 100, 30_000)
  await waitNotBusy(page, 30_000)
  await waitRows(page, 1)
  const released = await layoutSnapshot(page)
  const refreshDisabled = await page.locator(SELECTORS.refresh[0]).isDisabled()
  const repoDisabled = await page.locator(SELECTORS.repository[0]).isDisabled()
  metrics.loadingGate = { controlStates, branchSelectorOpen, applyDisabled, pendingRows, pendingStatus, released, refreshDisabled, repoDisabled, requests: requests.length }
  checkResult(checks, "FR loading gate keeps controls disabled or guarded while status/log are held", controlStates.every((entry) => !entry.present || entry.disabled) || applyDisabled !== false || branchSelectorOpen, metrics.loadingGate)
  checkResult(checks, "FR repositoryLoading clears after gate release and controls recover", !refreshDisabled && !repoDisabled && released.footer.includes("100 loaded") && released.rows.length > 0, metrics.loadingGate)
  checkResult(checks, "FR header/status/rows are usable after gate release", Boolean(released.footer) && Boolean(released.labels.length) && released.rows.length > 0, metrics.loadingGate)

  // Refresh path while the same two RPCs are held.
  gate = makeGate()
  routeGate = gate
  const refreshStatus = page.waitForRequest((request) => request.url().endsWith("/__gg/rpc/getStatus"), { timeout: 20_000 })
  const refreshLog = page.waitForRequest((request) => request.url().endsWith("/__gg/rpc/getLog"), { timeout: 20_000 })
  await page.locator(SELECTORS.refresh[0]).click()
  await refreshStatus
  await refreshLog
  const refreshDisabledDuring = await page.locator(SELECTORS.refresh[0]).isDisabled()
  const refreshControls = []
  for (const selector of controls) {
    const locator = page.locator(selector)
    if ((await locator.count()) === 0) continue
    refreshControls.push({ selector, disabled: await locator.isDisabled().catch(() => false) })
  }
  gate.release()
  await waitLoaded(page, 100, 30_000)
  await waitNotBusy(page, 30_000)
  await waitRows(page, 1)
  const afterRefresh = await layoutSnapshot(page)
  metrics.refreshGate = { refreshDisabledDuring, refreshControls, afterRefresh }
  checkResult(checks, "FR refresh gate disables controls or keeps them guarded", refreshDisabledDuring || refreshControls.every((entry) => entry.disabled), metrics.refreshGate)
  checkResult(checks, "FR refresh finishes after release without permanent busy state", !(await page.locator(SELECTORS.refresh[0]).isDisabled()) && !(await page.locator(SELECTORS.repository[0]).isDisabled()) && afterRefresh.rows.length > 0, metrics.refreshGate)
  await context.close()
}

async function compareScrollScenario(browser, frPrimary, checks, metrics) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "en-US" })
  const page = await context.newPage()
  const compareRequests = []
  page.on("request", (request) => {
    if (!request.url().includes("/__gg/rpc/")) return
    const method = request.url().split("/__gg/rpc/")[1]
    if (!COMPARISON_METHODS.has(method)) return
    let input
    try { input = JSON.parse(request.postData() ?? "{}") } catch { input = undefined }
    compareRequests.push({ method, input })
  })
  await page.goto(FR_BASE, { waitUntil: "domcontentloaded" })
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid="repository-select"] option').length >= 16,
    null,
    { timeout: 30_000 },
  )
  await page.locator(SELECTORS.repository[0]).selectOption(frPrimary.id)
  await waitLoaded(page, 100)
  await scrollToBottom(page)
  await page.waitForFunction(
    () => (document.querySelector(".gg-history-footer")?.innerText ?? "").includes("200 loaded"),
    null,
    { timeout: 20_000 },
  ).catch(() => {})
  await page.locator(SELECTORS.historyScroll[0]).evaluate((element) => { element.scrollTop = 900 })
  await waitRaf(page, 2)
  const scrollInfo = await page.locator(SELECTORS.historyScroll[0]).evaluate((element) => ({
    scrollTop: element.scrollTop,
    clientHeight: element.clientHeight,
  }))
  const visible = await page.locator(SELECTORS.row[0]).evaluateAll((rows) =>
    rows.map((row) => ({ index: Number(row.dataset.index), top: Number(row.dataset.rowTop) })),
  )
  const rows = visible
    .filter((row) => row.top >= scrollInfo.scrollTop && row.top < scrollInfo.scrollTop + scrollInfo.clientHeight)
    .sort((a, b) => a.index - b.index)
  const first = rows[0]
  const second = rows.find((row) => row.index > first.index)
  if (!first || !second) throw new Error("Not enough visible commits for plain+Ctrl comparison")
  checkResult(checks, "comparison scenario starts with history scrolled past 500px", scrollInfo.scrollTop > 500, scrollInfo)
  const firstRow = page.locator(`.gg-graph-row[data-index="${first.index}"]`)
  const secondRow = page.locator(`.gg-graph-row[data-index="${second.index}"]`)
  await firstRow.locator(".gg-subject").click()
  await waitForAny(page, SELECTORS.inlineSlot)
  await page.waitForFunction(
    () => {
      const tree = document.querySelector('[data-testid="inline-files"]')
      return tree && !tree.querySelector(".gg-status")
    },
    null,
    { timeout: 20_000 },
  ).catch(() => {})
  const before = await layoutSnapshot(page)
  const scrollBeforeCompare = await currentScrollTop(page)
  await secondRow.locator(".gg-subject").click({ modifiers: ["Control"] })
  let compareOpened = false
  try {
    await waitForAny(page, [ '[data-testid="comparison-page"]', '[data-testid="comparison-diff"]' ])
    compareOpened = true
  } catch {
    compareOpened = false
  }
  if (compareOpened) {
    await page.waitForFunction(
      () => {
        const page = document.querySelector('[data-testid="comparison-page"]')
        if (!page) return false
        const loading = page.querySelector(".gg-compare-status")?.textContent?.includes("Loading")
        const files = page.querySelectorAll('[data-testid="comparison-file"]').length
        const empty = page.querySelector(".gg-compare-status")?.textContent?.trim() ?? ""
        return !loading && (files > 0 || /No files differ/.test(empty))
      },
      null,
      { timeout: 20_000 },
    ).catch(() => {})
    const compare = await page.evaluate(() => ({
      page: Boolean(document.querySelector('[data-testid="comparison-page"]')),
      range: document.querySelector('[data-testid="comparison-range"]')?.getAttribute("title") ?? null,
      files: document.querySelectorAll('[data-testid="comparison-file"]').length,
      diff: Boolean(document.querySelector('[data-testid="comparison-diff"]')),
      empty:
        document.querySelector(".gg-compare-status")?.textContent?.trim() ?? null,
    }))
    const compareRequestOk = compareRequests.some(
      (entry) =>
        typeof entry.input?.baseHash === "string" &&
        typeof entry.input?.headHash === "string" &&
        entry.input.baseHash !== entry.input.headHash,
    )
    if (compare.files > 0) {
      await page.locator('[data-testid="comparison-file"]').first().click()
      await page.waitForFunction(
        () => {
          const diff = document.querySelector('[data-testid="comparison-diff"]')
          if (!diff) return false
          const state = diff.querySelector(".gg-commit-diff-state")?.textContent?.trim() ?? ""
          return (
            diff.querySelectorAll(".gg-commit-diff-line").length > 0 ||
            Boolean(diff.querySelector(".gg-commit-diff-warning")) ||
            (state.length > 0 && !/Loading/i.test(state))
          )
        },
        null,
        { timeout: 20_000 },
      ).catch(() => {})
      compare.diff = await page.locator('[data-testid="comparison-diff"]').count() > 0
      compare.diffLines = await page.locator(".gg-commit-diff-line").count()
      compare.diffWarning = await page.locator(".gg-commit-diff-warning").count()
    }
    await screenshot(page, "13-fr-compare-scroll.png", { fullPage: true })
    const back = await anyLocator(page, SELECTORS.comparisonBack)
    if (back) await back.click()
    await page.waitForFunction(
      () =>
        !document.querySelector('[data-testid="comparison-page"]') &&
        Boolean(document.querySelector(".gg-history-spacer")) &&
        Boolean(document.querySelector('[data-testid="inline-slot"]')),
      null,
      { timeout: 20_000 },
    )
    await waitRaf(page, 4)
    const after = await layoutSnapshot(page)
    const viewportTop = after.scroller.scrollTop
    const viewportBottom = viewportTop + after.scroller.clientHeight
    const visibleRows = after.rows.filter(
      (row) => row.top < viewportBottom && row.top + (after.rowHeight ?? 28) > viewportTop,
    )
    const last = visibleRows.at(-1)
    metrics.compareScroll = { before, after, compare, scrollBeforeCompare, compareRequests }
    checkResult(
      checks,
      "plain click + Ctrl/Cmd click opens comparison from a scrolled inline state",
      compareOpened && compare.page && compareRequestOk && (compare.files > 0 || /No files differ/.test(compare.empty ?? "")),
      { ...metrics.compareScroll, compareRequests },
    )
    checkResult(
      checks,
      "comparison file renders real text or a binary warning",
      compare.files === 0 || compare.diffLines > 0 || compare.diffWarning > 0,
      { files: compare.files, diffLines: compare.diffLines, diffWarning: compare.diffWarning },
    )
    checkResult(checks, "comparison Back restores vertical scroll within one pixel", Math.abs(after.scroller.scrollTop - scrollBeforeCompare) <= 1, { before: scrollBeforeCompare, after: after.scroller.scrollTop })
    checkResult(checks, "comparison Back preserves the expanded slot and parent context", Boolean(after.spacer) && after.spacer.expandedIndex === before.spacer.expandedIndex && after.spacer.slotHeight === before.spacer.slotHeight && Boolean(after.slot), { before: before.spacer, after: after.spacer })
    checkResult(
      checks,
      "comparison Back leaves no DOM blank in the viewport",
      Boolean(last) &&
        visibleRows[0].top <= viewportTop + 2 &&
        last.top + (after.rowHeight ?? 28) >= viewportBottom - 4,
      { visibleFirst: visibleRows[0], visibleLast: last, viewportTop, viewportBottom },
    )

    // If the clicked pair is a legitimate empty diff, additionally verify a
    // real API-confirmed differing visible pair through the same UI click path.
    if (compare.files === 0) {
      const log = (await fetchRpc(FR_ORIGIN, "getLog", { repositoryId: frPrimary.id, limit: 40 })).body.result
      let pair = null
      for (let baseIndex = 0; baseIndex < Math.min(25, log.commits.length) && !pair; baseIndex += 1) {
        for (let headIndex = baseIndex + 1; headIndex < Math.min(baseIndex + 6, log.commits.length); headIndex += 1) {
          const files = (await fetchRpc(FR_ORIGIN, "getComparisonFiles", {
            repositoryId: frPrimary.id,
            baseHash: log.commits[baseIndex].hash,
            headHash: log.commits[headIndex].hash,
          })).body.result.files
          if (files.length > 0) {
            pair = { baseIndex, headIndex, baseHash: log.commits[baseIndex].hash, headHash: log.commits[headIndex].hash, files: files.length }
            break
          }
        }
      }
      if (pair) {
        await scrollToRowIndex(page, pair.baseIndex)
        await page.locator(`.gg-graph-row[data-index="${pair.baseIndex}"]`).locator(".gg-subject").click()
        await waitForAny(page, SELECTORS.inlineSlot)
        await scrollToRowIndex(page, pair.headIndex)
        await page.locator(`.gg-graph-row[data-index="${pair.headIndex}"]`).locator(".gg-subject").click({ modifiers: ["Control"] })
        await waitForAny(page, SELECTORS.comparisonDiff)
        await page.waitForFunction(
          () => document.querySelectorAll('[data-testid="comparison-file"]').length > 0,
          null,
          { timeout: 20_000 },
        )
        await page.locator('[data-testid="comparison-file"]').first().click()
        await page.waitForFunction(
          () => Boolean(document.querySelector('[data-testid="comparison-diff"]')),
          null,
          { timeout: 20_000 },
        ).catch(() => {})
        const pairState = await page.evaluate(() => ({
          page: Boolean(document.querySelector('[data-testid="comparison-page"]')),
          files: document.querySelectorAll('[data-testid="comparison-file"]').length,
          diff: Boolean(document.querySelector('[data-testid="comparison-diff"]')),
          lines: document.querySelectorAll(".gg-commit-diff-line").length,
        }))
        const pairRequests = compareRequests.filter(
          (entry) => entry.input?.baseHash === pair.baseHash && entry.input?.headHash === pair.headHash,
        )
        checkResult(
          checks,
          "API-confirmed differing visible pair opens real comparison files and diff",
          pairState.page && pairState.files > 0 && pairState.diff && pairState.lines > 0 && pairRequests.length > 0,
          { pair: { baseIndex: pair.baseIndex, headIndex: pair.headIndex, files: pair.files }, pairState, pairRequests: pairRequests.length },
        )
        await screenshot(page, "13b-fr-compare-scroll-diff.png", { fullPage: true })
      } else {
        checkResult(checks, "API-confirmed differing visible pair exists", false, {})
      }
    }
  } else {
    metrics.compareScroll = { before, compareOpened, scrollBeforeCompare }
    checkResult(checks, "plain click + Ctrl/Cmd click opens comparison from a scrolled inline state", false, metrics.compareScroll)
  }
  await context.close()
}

async function selectedFilterScenario(browser, tempRepo, checks, metrics) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await context.newPage()
  await page.goto(TEMP_BASE, { waitUntil: "domcontentloaded" })
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid="repository-select"] option').length >= 2,
    null,
    { timeout: 30_000 },
  )
  await page.locator(SELECTORS.repository[0]).selectOption(tempRepo.id)
  await waitRows(page, 1)
  const branchName = `gg-filter-${Date.now().toString(36)}`
  const row = page.locator(SELECTORS.row[0]).nth(1)
  await row.locator(".gg-subject").click({ button: "right" })
  await menuAction(page, SELECTORS.commitMenu, "create-branch")
  await fillFieldIfPresent(page, "name", branchName)
  await confirmDialog(page)
  const canonical = `refs/heads/${branchName}`
  await openBranchSelector(page)
  await page.locator(SELECTORS.branchFilterSelected[0]).click()
  const checkbox = page.locator(`${SELECTORS.branchFilterRef[0]}[value="${canonical}"]`)
  await checkbox.waitFor({ state: "visible", timeout: 15_000 })
  const filterRequest = page.waitForRequest(
    (request) => {
      if (!request.url().endsWith("/__gg/rpc/getLog")) return false
      const input = parseInput(request)
      return Array.isArray(input?.refs) && input.refs.includes(canonical)
    },
    { timeout: 20_000 },
  )
  await checkbox.click()
  await page.locator(SELECTORS.applyBranchFilter[0]).click()
  await filterRequest
  await closeBranchSelector(page)
  await page.waitForFunction(
    () => {
      const footer = document.querySelector(".gg-history-footer")?.innerText ?? ""
      return /[1-9]\d* loaded/.test(footer) && document.querySelectorAll(".gg-graph-row").length > 0
    },
    null,
    { timeout: 20_000 },
  ).catch(() => {})
  await waitRaf(page, 2)
  let history = await layoutSnapshot(page)
  checkResult(checks, "selected-ref filter remains usable after create", history.rows.length > 0 && history.errors.length === 0, { rows: history.rows.length, errors: history.errors, footer: history.footer })
  const renamed = `${branchName}-r`
  const badge = await refBadgeByName(page, branchName)
  await badge.click({ button: "right" })
  await menuAction(page, SELECTORS.refMenu, "rename-branch")
  await fillFieldIfPresent(page, "new-name", renamed)
  await confirmDialog(page)
  await waitRaf(page, 2)
  history = await layoutSnapshot(page)
  const refsErrorAfterRename = await page.locator('[data-testid="refs-error"]').count()
  checkResult(checks, "renaming a selected filtered branch leaves no invalid-ref state", history.rows.length > 0 && history.errors.length === 0 && refsErrorAfterRename === 0, { rows: history.rows.length, errors: history.errors, refsErrorAfterRename })
  const renamedBadge = await refBadgeByName(page, renamed)
  await renamedBadge.click({ button: "right" })
  await menuAction(page, SELECTORS.refMenu, "delete-branch")
  await waitDialog(page)
  await confirmDialog(page)
  await waitRaf(page, 2)
  history = await layoutSnapshot(page)
  const refsErrorAfterDelete = await page.locator('[data-testid="refs-error"]').count()
  checkResult(checks, "deleting a selected filtered branch leaves history usable", history.rows.length > 0 && history.errors.length === 0 && refsErrorAfterDelete === 0, { rows: history.rows.length, errors: history.errors, refsErrorAfterDelete })
  const secondary = (await fetchRpc(TEMP_ORIGIN, "listRepositories", {})).body.result.repositories.find((repo) => repo.id !== tempRepo.id)
  if (secondary) {
    await page.locator(SELECTORS.repository[0]).selectOption(secondary.id)
    await waitRows(page, 1)
    const cross = await layoutSnapshot(page)
    const refsErrorCross = await page.locator('[data-testid="refs-error"]').count()
    checkResult(checks, "selected refs do not leak into another repository", cross.rows.length > 0 && cross.errors.length === 0 && refsErrorCross === 0, { rows: cross.rows.length, errors: cross.errors, refsErrorCross })
  } else {
    checkResult(checks, "TEMP secondary repository exists for cross-repo filter check", false, {})
  }
  try {
    let state = (await fetchRpc(TEMP_ORIGIN, "getStatus", { repositoryId: tempRepo.id })).body.result
    if (state.branch !== "main") {
      await fetchRpc(TEMP_ORIGIN, "checkoutBranch", { repositoryId: tempRepo.id, expectedHead: state.head, confirmed: true, branch: "main" })
      state = (await fetchRpc(TEMP_ORIGIN, "getStatus", { repositoryId: tempRepo.id })).body.result
    }
    const cleanupRefs = (await fetchRpc(TEMP_ORIGIN, "getRefs", { repositoryId: tempRepo.id })).body.result.refs
    for (const ref of cleanupRefs) {
      if (ref.kind === "branch" && ref.name.startsWith("gg-filter-")) {
        await fetchRpc(TEMP_ORIGIN, "deleteBranch", { repositoryId: tempRepo.id, expectedHead: state.head, confirmed: true, name: ref.name })
      }
    }
  } catch { /* best-effort TEMP cleanup */ }
  await context.close()
}

async function binaryScenario(browser, tempRepo, checks, metrics) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await context.newPage()
  await page.goto(TEMP_BASE, { waitUntil: "domcontentloaded" })
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid="repository-select"] option').length >= 2,
    null,
    { timeout: 30_000 },
  )
  await page.locator(SELECTORS.repository[0]).selectOption(tempRepo.id)
  await waitRows(page, 1)
  const log = (await fetchRpc(TEMP_ORIGIN, "getLog", { repositoryId: tempRepo.id, limit: 100 })).body.result
  let found = null
  for (let index = 0; index < Math.min(10, log.commits.length) && !found; index += 1) {
    const commit = log.commits[index]
    const files = (await fetchRpc(TEMP_ORIGIN, "getCommitFiles", {
      repositoryId: tempRepo.id,
      hash: commit.hash,
      parentIndex: 0,
    })).body.result.files
    for (const file of files) {
      const diff = (await fetchRpc(TEMP_ORIGIN, "getDiff", {
        repositoryId: tempRepo.id,
        target: { type: "commit", hash: commit.hash, parentIndex: 0 },
        path: file.path,
      })).body.result
      if (diff?.binary) {
        found = { index, commit, path: file.path }
        break
      }
    }
  }
  if (!found) {
    checkResult(checks, "TEMP binary diff fixture exists", false, {})
    await context.close()
    return
  }
  await scrollToRowIndex(page, found.index)
  await page.locator(`.gg-graph-row[data-index="${found.index}"]`).locator(".gg-subject").click()
  await waitForAny(page, SELECTORS.inlineSlot)
  await page.waitForFunction(
    () => {
      const tree = document.querySelector('[data-testid="inline-files"]')
      return tree && !tree.querySelector(".gg-status") && tree.querySelectorAll(".gg-file-row").length > 0
    },
    null,
    { timeout: 20_000 },
  )
  const file = page.locator(`${SELECTORS.inlineFiles[0]} .gg-file-row`).filter({ hasText: found.path.split("/").at(-1) }).first()
  await file.click()
  await waitForAny(page, SELECTORS.commitDiff)
  await page.waitForFunction(
    () => Boolean(document.querySelector(".gg-commit-diff-warning")),
    null,
    { timeout: 20_000 },
  ).catch(() => {})
  const warning = await page.locator(".gg-commit-diff-warning").first().innerText().catch(() => "")
  const lines = await page.locator(".gg-commit-diff-line").count()
  metrics.binaryDiff = { found: { pathKind: "binary", commitIndex: found.index }, warning, lines }
  checkResult(checks, "TEMP binary commit diff shows Binary and no text lines", /binary/i.test(warning) && lines === 0, metrics.binaryDiff)
  await screenshot(page, "14-temp-binary-diff.png", { fullPage: true })
  await context.close()
}

async function warningFaultScenario(browser, tempRepo, checks, metrics) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await context.newPage()
  await page.goto(TEMP_BASE, { waitUntil: "domcontentloaded" })
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid="repository-select"] option').length >= 2,
    null,
    { timeout: 30_000 },
  )
  await page.locator(SELECTORS.repository[0]).selectOption(tempRepo.id)
  await waitRows(page, 1)
  const status = (await fetchRpc(TEMP_ORIGIN, "getStatus", { repositoryId: tempRepo.id })).body.result
  const requests = []
  await page.route("**/__gg/rpc/createBranch", async (route) => {
    requests.push(parseInput(route.request()))
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        result: { status, changed: true, warning: "release warning fixture" },
      }),
    })
  })
  await page.locator(SELECTORS.row[0]).nth(1).locator(".gg-subject").click({ button: "right" })
  await menuAction(page, SELECTORS.commitMenu, "create-branch")
  await fillFieldIfPresent(page, "name", `gg-warning-${Date.now().toString(36)}`)
  await confirmDialog(page)
  await page.waitForFunction(
    () => Boolean(document.querySelector('[data-testid="mutation-warning"]')),
    null,
    { timeout: 20_000 },
  ).catch(() => {})
  await waitRaf(page, 2)
  const warning = await page.locator('[data-testid="mutation-warning"]').innerText().catch(() => "")
  const requestCount = requests.length
  await waitRaf(page, 4)
  metrics.warningFault = { warning, requestCount, afterCount: requests.length, refs: (await fetchRpc(TEMP_ORIGIN, "getRefs", { repositoryId: tempRepo.id })).body.result.refs.length }
  checkResult(checks, "injected mutation warning is shown to the user", /release warning fixture/.test(warning), metrics.warningFault)
  checkResult(checks, "injected mutation warning is not retried automatically", requests.length === requestCount, metrics.warningFault)
  await screenshot(page, "15-temp-warning-fault.png", { fullPage: true })
  await context.close()
}

async function mutationSwitchScenario(browser, tempRepo, checks, metrics) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await context.newPage()
  await page.goto(TEMP_BASE, { waitUntil: "domcontentloaded" })
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid="repository-select"] option').length >= 2,
    null,
    { timeout: 30_000 },
  )
  await page.locator(SELECTORS.repository[0]).selectOption(tempRepo.id)
  await waitRows(page, 1)
  const status = (await fetchRpc(TEMP_ORIGIN, "getStatus", { repositoryId: tempRepo.id })).body.result
  const refs = (await fetchRpc(TEMP_ORIGIN, "getRefs", { repositoryId: tempRepo.id })).body.result.refs
  const target = refs.find((ref) => ref.kind === "branch" && ref.name !== status.branch)
  if (!target) {
    checkResult(checks, "TEMP mutation-switch fixture has a non-current branch", false, {})
    await context.close()
    return
  }
  const gate = makeGate()
  const mutations = []
  await page.route("**/__gg/rpc/checkoutBranch", async (route) => {
    // The real server mutation executes here. Hold the real response until the
    // test has observed the in-flight UI, then release the untouched response.
    const response = await route.fetch()
    mutations.push(parseInput(route.request()))
    await gate.promise
    await route.fulfill({ response })
  })
  await openBranchSelector(page)
  await page.locator(`${SELECTORS.checkoutRow[0]}[data-branch="${target.name}"]`).click()
  await waitDialog(page)
  const requestPromise = page.waitForRequest(
    (request) => request.url().endsWith("/__gg/rpc/checkoutBranch"),
    { timeout: 20_000 },
  )
  await page.locator(SELECTORS.checkoutConfirm[0]).click()
  await requestPromise
  const busy = await page.locator('[data-testid="confirm-dialog"] [data-testid="checkout-confirm"]').isDisabled().catch(() => null)
  const repoDisabled = await page.locator(SELECTORS.repository[0]).isDisabled()
  await screenshot(page, "16-temp-mutation-switch.png", { fullPage: true })
  gate.release()
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="confirm-dialog"]'),
    null,
    { timeout: 30_000 },
  )
  await waitRaf(page, 4)
  const finalRepo = await page.locator(SELECTORS.repository[0]).inputValue()
  const finalBranch = await page.locator('[data-testid="current-branch"]').innerText().catch(() => "")
  // Open a fresh dialog after the mutation has landed; a stale completion
  // generation must not close it or route it to the old repository.
  await closeBranchSelectorIfOpen(page)
  await openBranchSelector(page)
  await page.locator(`${SELECTORS.checkoutRow[0]}[data-branch="${status.branch}"]`).click()
  await waitDialog(page)
  await waitRaf(page, 4)
  const newDialogSurvived = (await page.locator(SELECTORS.dialog[0]).count()) > 0
  if (newDialogSurvived) await cancelDialog(page, SELECTORS.checkoutCancel)
  await closeBranchSelectorIfOpen(page)
  try {
    const now = (await fetchRpc(TEMP_ORIGIN, "getStatus", { repositoryId: tempRepo.id })).body.result
    if (now.branch !== status.branch) {
      await fetchRpc(TEMP_ORIGIN, "checkoutBranch", {
        repositoryId: tempRepo.id,
        expectedHead: now.head,
        confirmed: true,
        branch: status.branch,
      })
    }
  } catch { /* best-effort TEMP cleanup */ }
  metrics.mutationSwitch = {
    busy,
    repoDisabled,
    mutationCount: mutations.length,
    finalRepo,
    finalBranch,
    newDialogSurvived,
  }
  checkResult(checks, "mutation afterServer response held keeps repository dropdown busy-guarded", repoDisabled === true, metrics.mutationSwitch)
  checkResult(checks, "real in-flight mutation is not aborted or retried", mutations.length === 1, metrics.mutationSwitch)
  checkResult(checks, "post-mutation generation does not close a newly opened dialog", newDialogSurvived, metrics.mutationSwitch)
  await context.close()
}

async function auditSelectors(browser, base, label, minimumOptions) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await context.newPage()
  const result = { label, url: base, groups: {}, missing: [] }
  await page.goto(base, { waitUntil: "domcontentloaded" })
  await page.waitForFunction(
    (minimum) => document.querySelectorAll('[data-testid="repository-select"] option').length >= minimum,
    minimumOptions,
    { timeout: 30_000 },
  )
  await waitRows(page, 1)
  const widthButton = page.locator('[data-testid="harness-width-1100"]')
  if (await widthButton.count()) {
    await widthButton.click()
    await page.waitForFunction(
      () => document.querySelector('[data-testid="harness-panel-shell"]')?.dataset.panelWidth === "1100",
      null,
      { timeout: 15_000 },
    )
    await waitRaf(page, 2)
  }
  const auditGroup = async (name, selectors) => {
    const present = []
    for (const selector of selectors) {
      const count = await page.locator(selector).count()
      present.push({ selector, count })
    }
    result.groups[name] = present
  }
  await auditGroup("static", [
    ...SELECTORS.repository,
    ...SELECTORS.currentBranch,
    ...SELECTORS.search,
    ...SELECTORS.history,
    ...SELECTORS.historyScroll,
    ...SELECTORS.row,
    ...SELECTORS.dateCell,
    ...SELECTORS.resizeDescription,
    ...SELECTORS.resizeDate,
    ...SELECTORS.resizeAuthor,
    ...SELECTORS.resizeCommit,
    ...SELECTORS.graphResize,
    ...SELECTORS.graphScroll,
    ...SELECTORS.jumpHead,
    ...SELECTORS.firstParent,
    ...SELECTORS.historyOrder,
    ...SELECTORS.showRemotes,
    ...SELECTORS.showTags,
    ...SELECTORS.denseGraph,
  ])
  await openBranchSelector(page)
  await auditGroup("branch-selector", [
    ...SELECTORS.branchFilter,
    ...SELECTORS.branchFilterAll,
    ...SELECTORS.branchFilterSelected,
    ...SELECTORS.branchFilterRef,
    ...SELECTORS.applyBranchFilter,
    ...SELECTORS.showRemotes,
    ...SELECTORS.showTags,
  ])
  await closeBranchSelector(page)
  const row = page.locator(SELECTORS.row[0]).first()
  await row.locator(".gg-subject").click({ button: "right" })
  await waitForAny(page, SELECTORS.commitMenu).catch(() => null)
  await auditGroup("commit-menu", [...SELECTORS.commitMenu])
  await page.keyboard.press("Escape")
  const badgeCount = await page.locator(SELECTORS.refBadge.join(",")).count()
  if (badgeCount > 0) {
    await page.locator(SELECTORS.refBadge.join(",")).first().click({ button: "right" })
    await waitForAny(page, SELECTORS.refMenu).catch(() => null)
    await auditGroup("ref-menu", [...SELECTORS.refMenu])
    await page.keyboard.press("Escape")
  }
  const expectedAbsent = new Set([
    '[data-testid="graph-scroll"]',
    '[data-testid="resize-column-graph"]',
  ])
  const alternatives = [
    ['[data-testid="commit-date"]', ".gg-col-date"],
    ['[data-testid="show-remotes"]', '[data-testid="filter-show-remotes"]'],
    ['[data-testid="show-tags"]', '[data-testid="filter-show-tags"]'],
    ['[data-testid="ref-menu"]', '[data-testid="ref-context-menu"]'],
  ]
  const allEntries = Object.values(result.groups).flat()
  const alternativeSatisfied = (selector) =>
    alternatives.some(
      (group) =>
        group.includes(selector) &&
        group.some((candidate) => allEntries.some((entry) => entry.selector === candidate && entry.count > 0)),
    )
  result.expectedAbsent = allEntries.filter((entry) => expectedAbsent.has(entry.selector))
  result.missing = Object.entries(result.groups).flatMap(([group, entries]) =>
    entries
      .filter((entry) => entry.count === 0 && !expectedAbsent.has(entry.selector))
      .filter((entry) => !alternativeSatisfied(entry.selector))
      .filter((entry) => entry.selector !== '[data-testid="dense-graph"]')
      .map((entry) => ({ group, selector: entry.selector })),
  )
  await context.close()
  console.log(JSON.stringify(result, null, 2))
}

async function fullRun(browser, executablePath) {
  const startedAt = new Date().toISOString()
  const sourceStart = sourceMtimes()
  const checks = []
  const metrics = {}
  const notes = []
  const events = { fr: { console: [], page: [], requestFailures: [], http: [], aborts: [], rpc: [] }, temp: { console: [], page: [], requestFailures: [], http: [], aborts: [], rpc: [] } }
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "en-US" })
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: FR_ORIGIN })
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: TEMP_ORIGIN })
  const fr = await context.newPage()
  const temp = await context.newPage()
  const attach = (page, bucket) => {
    page.on("console", (message) => {
      const text = message.text()
      if (message.type() === "error") bucket.console.push({ text, location: message.location() })
      if (/hot updated|hot update|page reload/i.test(text)) {
        hmrEvents.push({ text, location: message.location() })
      }
    })
    page.on("pageerror", (error) => bucket.page.push({ message: error.message }))
    page.on("requestfailed", (request) => {
      const failure = request.failure()?.errorText ?? "unknown"
      const entry = { url: request.url(), method: request.method(), failure }
      if (/ERR_ABORTED|NS_BINDING_ABORTED|aborted/i.test(failure)) bucket.aborts.push(entry)
      else bucket.requestFailures.push(entry)
    })
    page.on("response", (response) => {
      if (response.status() >= 400) bucket.http.push({ url: response.url(), status: response.status() })
    })
    page.on("request", (request) => {
      if (!request.url().includes("/__gg/rpc/")) return
      const method = request.url().split("/__gg/rpc/")[1]
      const input = parseInput(request)
      bucket.rpc.push({ method, input })
    })
  }
  attach(fr, events.fr)
  attach(temp, events.temp)
  let fatal = null
  try {
    await fr.goto(FR_BASE, { waitUntil: "domcontentloaded" })
    await fr.reload({ waitUntil: "domcontentloaded" })
    await fr.waitForFunction(
      () => document.querySelectorAll('[data-testid="repository-select"] option').length >= 16,
      null,
      { timeout: 30_000 },
    )
    await waitRows(fr, 1)
    await waitNotBusy(fr)
    const frRepos = (await fetchRpc(FR_ORIGIN, "listRepositories", {})).body.result.repositories
    const frPrimary = FR_REPO_NAME
      ? frRepos.find((repo) => repo.name === FR_REPO_NAME)
      : frRepos.find((repo) => repo.type === "normal")
    if (!frPrimary) throw new Error("FR primary repository was not found")
    metrics.repositories = { count: frRepos.length, worktrees: frRepos.filter((repo) => repo.type === "worktree").length }
    checkResult(checks, "FR picker has 16 repositories and 4 worktrees", frRepos.length === 16 && metrics.repositories.worktrees === 4, metrics.repositories)
    await fr.locator(SELECTORS.repository[0]).selectOption(frPrimary.id)
    await waitLoaded(fr, 100)
    await waitRows(fr, 1)
    await waitNotBusy(fr)
    await fr.locator('[data-testid="harness-width-1100"]').click()
    await fr.waitForFunction(
      () => document.querySelector('[data-testid="harness-panel-shell"]')?.dataset.panelWidth === "1100",
      null,
      { timeout: 15_000 },
    )
    await waitRaf(fr, 2)
    const layout = await layoutSnapshot(fr)
    metrics.layout1100 = layout
    checkResult(checks, "graph is fixed at 240px with no graph handle or horizontal graph scroll", layout.graph.headerWidth === 240 && layout.graph.rowWidth === 240 && !layout.graph.hasGraphHandle && !layout.graph.hasGraphScroll && layout.graph.scrollWidth <= layout.graph.clientWidth, layout.graph)
    checkResult(checks, "Date shows full 19-character seconds, default 150px and an ISO tooltip", layout.date.visible && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(layout.date.text) && Math.abs(layout.date.width - 150) <= 1 && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(layout.date.title ?? ""), layout.date)
    checkResult(checks, "1100px has no body/panel horizontal overflow or nested buttons", layout.doc.scrollWidth <= layout.doc.clientWidth && layout.body.scrollWidth <= layout.body.clientWidth && layout.panelOverflowX <= 1 && layout.nestedButtons === 0, { doc: layout.doc, body: layout.body, panelOverflow: layout.panelOverflowX, nestedButtons: layout.nestedButtons })
    await screenshot(fr, "01-fr-graph-date-1100.png", { fullPage: true })

    const frLog = (await fetchRpc(FR_ORIGIN, "getLog", { repositoryId: frPrimary.id, limit: 100 })).body.result
    const mergeIndex = frLog.commits.findIndex((commit) => commit.parents.length > 1)
    if (mergeIndex >= 0) {
      await scrollToRowIndex(fr, mergeIndex)
      const mergeRow = fr.locator(`.gg-graph-row[data-index="${mergeIndex}"]`)
      const mergeInfo = await mergeRow.evaluate((row) => ({
        paths: row.querySelectorAll(".gg-graph-svg path").length,
        parents: Number(row.getAttribute("data-parents") || 0),
        graphScrollWidth: row.querySelector(".gg-row-graph")?.scrollWidth,
        graphClientWidth: row.querySelector(".gg-row-graph")?.clientWidth,
      }))
      const expectedParents = frLog.commits[mergeIndex].parents.length
      checkResult(checks, "dense graph keeps parent edges and fits the fixed 240px graph column", mergeInfo.paths >= expectedParents && mergeInfo.graphScrollWidth <= mergeInfo.graphClientWidth, { ...mergeInfo, expectedParents })
      await fr.locator(SELECTORS.historyScroll[0]).evaluate((element) => { element.scrollTop = 0 })
      await waitRaf(fr, 2)
    } else {
      checkResult(checks, "dense graph merge fixture exists", false, { commits: frLog.commits.length })
    }

    const nonGraphHandles = ["description", "date", "author", "commit"]
    for (const name of nonGraphHandles) {
      const drag = await dragColumn(fr, name, 12)
      checkResult(checks, `${name} column drag changes width`, Math.abs(drag.after - drag.before) > 1, drag)
    }
    const afterResize = await layoutSnapshot(fr)
    metrics.afterResize = afterResize
    checkResult(checks, "non-graph column drags do not overflow the panel", afterResize.panelOverflowX <= 1 && afterResize.doc.scrollWidth <= afterResize.doc.clientWidth, { panelOverflow: afterResize.panelOverflowX, doc: afterResize.doc })
    await screenshot(fr, "02-fr-columns-after-drag.png", { fullPage: true })

    await fr.locator('[data-testid="harness-width-520"]').click()
    await fr.waitForFunction(
      () => document.querySelector('[data-testid="harness-panel-shell"]')?.dataset.panelWidth === "520",
      null,
      { timeout: 15_000 },
    )
    await waitRaf(fr, 2)
    const narrow = await layoutSnapshot(fr)
    metrics.layout520 = narrow
    checkResult(checks, "520px has no horizontal overflow and no nested buttons", narrow.doc.scrollWidth <= narrow.doc.clientWidth && narrow.body.scrollWidth <= narrow.body.clientWidth && narrow.panelOverflowX <= 1 && narrow.nestedButtons === 0, { doc: narrow.doc, body: narrow.body, panelOverflow: narrow.panelOverflowX, nestedButtons: narrow.nestedButtons })
    checkResult(checks, "520px keeps the fixed 240px graph without graph controls", narrow.graph.headerWidth === 240 && !narrow.graph.hasGraphHandle && !narrow.graph.hasGraphScroll, narrow.graph)
    await screenshot(fr, "03-fr-520.png", { fullPage: true })
    await fr.locator('[data-testid="harness-width-1100"]').click()
    await fr.waitForFunction(
      () => document.querySelector('[data-testid="harness-panel-shell"]')?.dataset.panelWidth === "1100",
      null,
      { timeout: 15_000 },
    )
    await waitRaf(fr, 2)

    const refs = (await fetchRpc(FR_ORIGIN, "getRefs", { repositoryId: frPrimary.id })).body.result.refs
    const localRefs = refs.filter((ref) => ref.kind === "branch")
    const remoteRefs = refs.filter((ref) => ref.kind === "remote")
    const tagRefs = refs.filter((ref) => ref.kind === "tag")
    metrics.refs = { local: localRefs.length, remote: remoteRefs.length, tag: tagRefs.length }
    await openBranchSelector(fr)
    const allModeRefCount = await fr.locator(SELECTORS.branchFilterRef[0]).count()
    await screenshot(fr, "04-fr-branch-filter.png", { fullPage: true })
    const selectedRadio = await anyLocator(fr, SELECTORS.branchFilterSelected)
    if (selectedRadio) await selectedRadio.click()
    const selectedModeChecked = selectedRadio ? await selectedRadio.isChecked() : false
    const selectedModeRefCount = await fr.locator(SELECTORS.branchFilterRef[0]).count()
    await fr.locator(SELECTORS.branchFilterAll[0]).click()
    const allRestoredRefCount = await fr.locator(SELECTORS.branchFilterRef[0]).count()
    await closeBranchSelector(fr)
    checkResult(checks, "branch filter All mode exposes ref checkboxes", allModeRefCount > 0, { allModeRefCount })
    checkResult(checks, "branch filter Selected mode is switchable and keeps refs visible", selectedModeChecked && selectedModeRefCount > 0, { selectedModeChecked, selectedModeRefCount })
    checkResult(checks, "branch filter All restores ref checkboxes", allRestoredRefCount > 0, { allRestoredRefCount })

    const firstRef = localRefs[0] ?? remoteRefs[0] ?? tagRefs[0]
    if (firstRef) {
      const canonical = canonicalRef(firstRef)
      await openBranchSelector(fr)
      const selectedMode = await anyLocator(fr, SELECTORS.branchFilterSelected)
      if (selectedMode) await selectedMode.click()
      const refCheckbox = fr.locator(`${SELECTORS.branchFilterRef[0]}[value="${canonical}"]`)
      if ((await refCheckbox.count()) === 0) {
        checkResult(checks, "branch-filter-ref is reachable for a single ref", false, { canonical, note: "All-refs mode currently hides explicit ref checkboxes" })
        await closeBranchSelector(fr)
      } else {
        const filterPromise = fr.waitForRequest(
          (request) => {
            if (!request.url().endsWith("/__gg/rpc/getLog")) return false
            const input = parseInput(request)
            return Array.isArray(input?.refs) && input.refs.length > 0
          },
          { timeout: 20_000 },
        )
        await refCheckbox.click()
        await fr.locator(SELECTORS.applyBranchFilter[0]).click()
        const filtered = parseInput(await filterPromise)
        await closeBranchSelector(fr)
        await waitRows(fr, 1)
        checkResult(checks, "single-ref branch filter sends the canonical ref", filtered.refs.includes(canonical), { canonical, refs: filtered.refs })
        await applyHistoryFilter(fr, async (page) => {
          await page.locator(SELECTORS.branchFilterAll[0]).click()
        })
      }
    } else {
      checkResult(checks, "branch filter fixture exists", false, { refs: metrics.refs })
    }

    for (const kind of ["remote", "tag"]) {
      const ref = refs.find((entry) => entry.kind === kind)
      if (!ref) {
        checkResult(checks, `${kind} ref fixture exists`, false, {})
        continue
      }
      const canonical = canonicalRef(ref)
      await openBranchSelector(fr)
      const selectedMode = await anyLocator(fr, SELECTORS.branchFilterSelected)
      if (selectedMode) await selectedMode.click()
      const checkbox = fr.locator(`${SELECTORS.branchFilterRef[0]}[data-ref-kind="${kind}"][value="${canonical}"]`)
      if ((await checkbox.count()) === 0) {
        checkResult(checks, `${kind} filter checkbox is reachable`, false, { canonical })
        await closeBranchSelector(fr)
        continue
      }
      const requestPromise = fr.waitForRequest(
        (request) => {
          if (!request.url().endsWith("/__gg/rpc/getLog")) return false
          const input = parseInput(request)
          return Array.isArray(input?.refs) && input.refs.includes(canonical)
        },
        { timeout: 20_000 },
      )
      await checkbox.click()
      await fr.locator(SELECTORS.applyBranchFilter[0]).click()
      const input = parseInput(await requestPromise)
      await closeBranchSelector(fr)
      checkResult(checks, `${kind} filter sends the canonical ref`, input.refs.includes(canonical), { canonical })
      await applyHistoryFilter(fr, async (page) => {
        await page.locator(SELECTORS.branchFilterAll[0]).click()
      })
    }

    const showRemotes = await anyLocator(fr, SELECTORS.showRemotes)
    if (showRemotes) {
      const beforeHashes = await visibleRowHashes(fr)
      const input = await triggerHistoryRequest(fr, (value) => value.showRemotes === false, async () => {
        await fr.locator(SELECTORS.showRemotes[0]).click()
      })
      const afterHashes = await visibleRowHashes(fr)
      checkResult(checks, "showRemotes is sent in the history request", input.showRemotes === false, input)
      checkResult(checks, "showRemotes changes the loaded history", beforeHashes.join(",") !== afterHashes.join(","), { before: beforeHashes.slice(0, 3), after: afterHashes.slice(0, 3) })
      await triggerHistoryRequest(fr, (value) => value.showRemotes !== false, async () => {
        await fr.locator(SELECTORS.showRemotes[0]).click()
      })
    } else {
      checkResult(checks, "showRemotes selector exists", false, { selectors: SELECTORS.showRemotes })
    }
    const showTags = await anyLocator(fr, SELECTORS.showTags)
    if (showTags) {
      const input = await triggerHistoryRequest(fr, (value) => value.showTags === false, async () => {
        await fr.locator(SELECTORS.showTags[0]).click()
      })
      checkResult(checks, "showTags is sent in the history request", input.showTags === false, input)
      await triggerHistoryRequest(fr, (value) => value.showTags !== false, async () => {
        await fr.locator(SELECTORS.showTags[0]).click()
      })
    } else {
      checkResult(checks, "showTags selector exists", false, { selectors: SELECTORS.showTags })
    }
    const order = await anyLocator(fr, SELECTORS.historyOrder)
    if (order) {
      const input = await triggerHistoryRequest(fr, (value) => value.order === "topo", async () => {
        await fr.locator(SELECTORS.historyOrder[0]).selectOption("topo")
      })
      checkResult(checks, "history order is sent in the request", input.order === "topo", input)
      await triggerHistoryRequest(fr, (value) => value.order === "date" || value.order === undefined, async () => {
        await fr.locator(SELECTORS.historyOrder[0]).selectOption("date")
      })
    } else {
      checkResult(checks, "history-order selector exists", false, { selectors: SELECTORS.historyOrder })
    }
    const firstParent = await anyLocator(fr, SELECTORS.firstParent)
    if (firstParent) {
      const input = await triggerHistoryRequest(fr, (value) => value.firstParent === true, async () => {
        await fr.locator(SELECTORS.firstParent[0]).click()
      })
      checkResult(checks, "first-parent is sent in the request", input.firstParent === true, input)
      await triggerHistoryRequest(fr, (value) => value.firstParent !== true, async () => {
        await fr.locator(SELECTORS.firstParent[0]).click()
      })
    } else {
      checkResult(checks, "first-parent selector exists", false, { selectors: SELECTORS.firstParent })
    }

    const badge = await anyLocator(fr, SELECTORS.refBadge)
    if (badge) {
      const rowBefore = await fr.locator(SELECTORS.row[0]).first().getAttribute("aria-expanded")
      await badge.click({ button: "right" })
      const refMenu = await waitForAny(fr, SELECTORS.refMenu)
      const menuRect = await refMenu.boundingBox()
      const menuActionVisible = await refMenu.locator('[role="menuitem"]').count()
      await screenshot(fr, "05-fr-ref-menu.png", { fullPage: true })
      await fr.keyboard.press("Escape")
      await fr.waitForFunction(
        () => !document.querySelector('[data-testid="ref-menu"]') && !document.querySelector('[data-testid="ref-context-menu"]'),
        null,
        { timeout: 10_000 },
      )
      const rowAfter = await fr.locator(SELECTORS.row[0]).first().getAttribute("aria-expanded")
      checkResult(checks, "ref menu opens without expanding the graph row", Boolean(menuRect) && menuActionVisible > 0 && rowBefore === rowAfter, { menuRect, menuActionVisible, rowBefore, rowAfter })
      checkResult(checks, "ref menu is positioned inside the viewport", Boolean(menuRect && menuRect.x >= 0 && menuRect.y >= 0 && menuRect.x + menuRect.width <= 1280 && menuRect.y + menuRect.height <= 900), menuRect)
      await badge.click()
      const leftMenu = await waitForAny(fr, SELECTORS.refMenu)
      checkResult(checks, "left-clicking a ref badge also opens the menu without expanding the row", Boolean(leftMenu) && (await fr.locator(SELECTORS.row[0]).first().getAttribute("aria-expanded")) === rowBefore, {})
      await fr.keyboard.press("Escape")
      await fr.waitForFunction(
        () => !document.querySelector('[data-testid="ref-menu"]') && !document.querySelector('[data-testid="ref-context-menu"]'),
        null,
        { timeout: 10_000 },
      )
      await badge.click({ button: "right" })
      await waitForAny(fr, SELECTORS.refMenu)
      await fr.mouse.click(2, 2)
      await fr.waitForFunction(
        () => !document.querySelector('[data-testid="ref-menu"]') && !document.querySelector('[data-testid="menu-backdrop"]'),
        null,
        { timeout: 10_000 },
      )
      checkResult(checks, "outside click closes the ref menu without expanding the row", (await fr.locator(SELECTORS.row[0]).first().getAttribute("aria-expanded")) === rowBefore, {})
      await badge.click({ button: "right" })
      await menuAction(fr, SELECTORS.refMenu, "copy-name")
      const copiedName = await copyFromClipboard(fr)
      checkResult(checks, "ref copy-name reaches the clipboard", typeof copiedName === "string" && copiedName.length > 0, { length: copiedName?.length ?? 0 })
      await badge.focus()
      await fr.keyboard.press("Enter")
      const enterMenu = await waitForAny(fr, SELECTORS.refMenu)
      const enterRowExpanded = await fr.locator(SELECTORS.row[0]).first().getAttribute("aria-expanded")
      await fr.keyboard.press("Escape")
      await fr.waitForFunction(
        () => !document.querySelector('[data-testid="ref-menu"]'),
        null,
        { timeout: 10_000 },
      )
      const focusReturnedAfterEnter = await fr.evaluate(() => document.activeElement?.getAttribute("data-testid") === "ref-badge")
      checkResult(checks, "Enter on a ref badge opens the menu without expanding the row and returns focus on close", Boolean(enterMenu) && enterRowExpanded === rowBefore && focusReturnedAfterEnter, { rowBefore, enterRowExpanded, focusReturnedAfterEnter })
      await badge.focus()
      await fr.keyboard.press("Space")
      const spaceMenu = await waitForAny(fr, SELECTORS.refMenu)
      await fr.keyboard.press("Escape")
      await fr.waitForFunction(
        () => !document.querySelector('[data-testid="ref-menu"]'),
        null,
        { timeout: 10_000 },
      )
      const focusReturnedAfterSpace = await fr.evaluate(() => document.activeElement?.getAttribute("data-testid") === "ref-badge")
      checkResult(checks, "Space on a ref badge opens the menu and returns focus on close", Boolean(spaceMenu) && focusReturnedAfterSpace, { focusReturnedAfterSpace })

      const remoteBadge = fr.locator('[data-testid="ref-badge"][data-ref-kind="remote"]').first()
      if (await remoteBadge.count()) {
        await remoteBadge.click({ button: "right" })
        const remoteMenu = await waitForAny(fr, SELECTORS.refMenu)
        const remoteActions = await remoteMenu.locator("[data-action]").evaluateAll((items) =>
          items.map((item) => item.getAttribute("data-action")),
        )
        checkResult(checks, "remote ref menu offers create-branch but not checkout", remoteActions.includes("create-branch") && !remoteActions.includes("checkout"), { remoteActions })
        await fr.keyboard.press("Escape")
      } else {
        checkResult(checks, "remote ref badge is visible for menu audit", false, {})
      }
    } else {
      checkResult(checks, "ref-badge selector exists", false, { selectors: SELECTORS.refBadge })
    }

    const rowA = fr.locator(SELECTORS.row[0]).first()
    await rowA.locator(".gg-subject").click({ button: "right" })
    await menuAction(fr, SELECTORS.commitMenu, "copy-hash")
    const copiedHash = await copyFromClipboard(fr)
    const hashA = await rowA.getAttribute("data-commit")
    checkResult(checks, "commit copy-hash reaches the clipboard", copiedHash === hashA, { matches: copiedHash === hashA })
    await rowA.locator(".gg-subject").click({ button: "right" })
    await menuAction(fr, SELECTORS.commitMenu, "select-compare")
    const rows = await fr.locator(SELECTORS.row[0]).count()
    if (rows > 1) {
      const rowB = fr.locator(SELECTORS.row[0]).nth(1)
      const hashB = await rowB.getAttribute("data-commit")
      await rowB.locator(".gg-subject").click({ button: "right" })
      await menuAction(fr, SELECTORS.commitMenu, "compare-selected")
      await waitForAny(fr, SELECTORS.comparisonDiff)
      const compareRequests = events.fr.rpc.filter((entry) => COMPARISON_METHODS.has(entry.method))
      checkResult(checks, "comparison requests carry selected base/head", compareRequests.some((entry) => entry.input?.baseHash === hashA && entry.input?.headHash === hashB) || compareRequests.some((entry) => entry.input?.baseHash === hashB && entry.input?.headHash === hashA), { count: compareRequests.length })
      await screenshot(fr, "06-fr-compare.png", { locator: fr.locator('[data-testid="harness-panel-shell"]') })
      const comparisonBack = await anyLocator(fr, SELECTORS.comparisonBack)
      if (comparisonBack) await comparisonBack.click()
      await fr.waitForFunction(
        () => !document.querySelector('[data-testid="comparison-page"]') && !document.querySelector('[data-testid="comparison-diff"]'),
        null,
        { timeout: 10_000 },
      )
    }
    await fr.locator(SELECTORS.row[0]).first().focus()
    await fr.keyboard.press("Control+f")
    const searchFocused = await fr.evaluate(() => document.activeElement?.getAttribute("data-testid") === "search-commits")
    checkResult(checks, "Ctrl+F focuses commit search", searchFocused, { searchFocused })
    const searchRowHash = await fr.locator(SELECTORS.row[0]).first().getAttribute("data-commit")
    if (searchRowHash) {
      await fr.locator(SELECTORS.search[0]).fill(searchRowHash.slice(0, 7))
      await fr.keyboard.press("Enter")
      await fr.waitForFunction(
        () => Boolean(document.querySelector(".gg-graph-row.gg-search-match")),
        null,
        { timeout: 10_000 },
      ).catch(() => {})
      checkResult(checks, "Ctrl+F + Enter jumps to the matching commit", await fr.locator(".gg-graph-row.gg-search-match").count() > 0, {})
      await fr.locator("button.gg-search-clear").click().catch(() => {})
    }
    await fr.locator(SELECTORS.row[0]).first().focus()
    await fr.keyboard.press("Control+h")
    await fr.keyboard.press("Escape")
    checkResult(checks, "Ctrl+H/Escape leaves no open dialog or menu", (await fr.locator(SELECTORS.dialog.join(",")).count()) === 0 && (await fr.locator(SELECTORS.refMenu.join(",")).count()) === 0 && (await fr.locator(SELECTORS.commitMenu.join(",")).count()) === 0, {})

    const jump = await anyLocator(fr, SELECTORS.jumpHead)
    if (jump) {
      const head = frPrimary.head
      await jump.click()
      await fr.waitForFunction(
        (hash) => Boolean(document.querySelector(`.gg-graph-row[data-commit="${hash}"]`)),
        head,
        { timeout: 20_000 },
      ).catch(() => {})
      checkResult(checks, "Jump HEAD locates the loaded HEAD row", await fr.locator(`.gg-graph-row[data-commit="${head}"]`).count() > 0, {})
    } else {
      checkResult(checks, "jump-head selector exists", false, { selectors: SELECTORS.jumpHead })
    }

    // Core inline/auto/back regression on real FR data.
    await fr.locator(SELECTORS.historyScroll[0]).evaluate((element) => { element.scrollTop = element.scrollHeight })
    await fr.waitForFunction(() => (document.querySelector(".gg-history-footer")?.innerText ?? "").includes("200 loaded"), null, { timeout: 15_000 }).catch(() => {})
    const autoLogs = events.fr.rpc.filter((entry) => entry.method === "getLog")
    const initialLog = autoLogs.find((entry) => !entry.input?.skip || entry.input.skip === 0)
    checkResult(checks, "initial history uses date order", !initialLog || initialLog.input?.order === undefined || initialLog.input?.order === "date", initialLog?.input ?? null)
    checkResult(checks, "FR auto pagination requests skip=100 once", autoLogs.filter((entry) => entry.input?.skip === 100).length === 1, { logs: autoLogs.filter((entry) => entry.input?.skip === 100).length })
    let inlineCandidate = 0
    for (let index = 0; index < Math.min(20, frLog.commits.length); index += 1) {
      const files = await fetchRpc(FR_ORIGIN, "getCommitFiles", {
        repositoryId: frPrimary.id,
        hash: frLog.commits[index].hash,
        parentIndex: 0,
      })
      if ((files.body?.result?.files?.length ?? 0) > 0) {
        inlineCandidate = index
        break
      }
    }
    await scrollToRowIndex(fr, inlineCandidate)
    const visibleRow = fr.locator(`.gg-graph-row[data-index="${inlineCandidate}"]`)
    await visibleRow.locator(".gg-subject").click()
    const inline = await waitForAny(fr, SELECTORS.inlineSlot)
    checkResult(checks, "inline slot opens after clicking a commit", Boolean(inline), {})
    await fr.waitForFunction(
      () => {
        const tree = document.querySelector('[data-testid="inline-files"]')
        if (!tree) return false
        return (
          !tree.querySelector(".gg-status") &&
          (tree.querySelectorAll(".gg-file-row").length > 0 ||
            Boolean(tree.querySelector(".gg-empty")) ||
            Boolean(tree.querySelector(".gg-error")))
        )
      },
      null,
      { timeout: 20_000 },
    ).catch(() => {})
    const scrollBeforeInline = (await layoutSnapshot(fr)).scroller?.scrollTop ?? 0
    const inlineFile = fr.locator(`${SELECTORS.inlineFiles[0]} .gg-file-row`).first()
    if (await inlineFile.count()) {
      await inlineFile.click()
      await waitForAny(fr, SELECTORS.commitDiff)
      await fr.locator(SELECTORS.detailsBack[0]).click()
      await fr.waitForFunction(() => !document.querySelector('[data-testid="commit-diff-page"]'), null, { timeout: 10_000 })
      await fr.waitForFunction(
        () => document.querySelectorAll('[data-testid="inline-files"] .gg-file-row').length > 0,
        null,
        { timeout: 10_000 },
      ).catch(() => {})
      const afterInline = await layoutSnapshot(fr)
      checkResult(checks, "inline commit diff opens and Back returns", true, {})
      checkResult(checks, "inline Back restores scroll within one pixel and keeps the slot", Math.abs((afterInline.scroller?.scrollTop ?? 0) - scrollBeforeInline) <= 1 && Boolean(afterInline.slot), { scrollBeforeInline, scrollAfter: afterInline.scroller?.scrollTop, slot: afterInline.slot })
    } else {
      checkResult(checks, "inline commit diff file exists", false, {})
    }

    // FR read-only mutation guard. No valid confirmed FR mutation is sent.
    const frStatus = (await fetchRpc(FR_ORIGIN, "getStatus", { repositoryId: frPrimary.id })).body.result
    const frRefsBefore = (await fetchRpc(FR_ORIGIN, "getRefs", { repositoryId: frPrimary.id })).body.result.refs
    const frNonCurrent = frRefsBefore.find((ref) => ref.kind === "branch" && ref.name !== frStatus.branch)
    const guardRequests = []
    const guard = async (method, input, label) => {
      const result = await fetchRpc(FR_ORIGIN, method, input)
      guardRequests.push({ label, method, status: result.status, ok: result.ok, error: result.body?.error?.type })
      return result
    }
    await guard("checkoutBranch", { repositoryId: frPrimary.id, expectedHead: frStatus.head, confirmed: false, branch: frStatus.branch }, "confirmed:false")
    await guard("createBranch", { repositoryId: frPrimary.id, expectedHead: frStatus.head, confirmed: false, name: "__gg_release_guard__", startPoint: frStatus.head }, "confirmed:false create")
    await guard("checkoutBranch", { repositoryId: frPrimary.id, expectedHead: frStatus.head, confirmed: true, branch: "__gg_release_guard_unknown__" }, "unknown target")
    await guard("deleteBranch", { repositoryId: frPrimary.id, expectedHead: frStatus.head, confirmed: true, name: "__gg_release_guard_unknown__" }, "unknown delete")
    await guard("deleteTag", { repositoryId: frPrimary.id, expectedHead: frStatus.head, confirmed: true, name: "__gg_release_guard_unknown__" }, "unknown tag")
    if (frNonCurrent) {
      await guard("checkoutBranch", { repositoryId: frPrimary.id, expectedHead: "0".repeat(frStatus.head?.length ?? 40), confirmed: true, branch: frNonCurrent.name }, "stale head")
    }
    const frStatusAfter = (await fetchRpc(FR_ORIGIN, "getStatus", { repositoryId: frPrimary.id })).body.result
    const frRefsAfter = (await fetchRpc(FR_ORIGIN, "getRefs", { repositoryId: frPrimary.id })).body.result.refs
    metrics.guardRequests = guardRequests
    checkResult(checks, "FR rejects every mutation guard request", guardRequests.every((entry) => !entry.ok || entry.status >= 400), guardRequests)
    checkResult(checks, "FR HEAD and refs are unchanged after guard probes", frStatusAfter.head === frStatus.head && refsSignature(frRefsAfter) === refsSignature(frRefsBefore), { headBefore: frStatus.head, headAfter: frStatusAfter.head, refsBefore: frRefsBefore.length, refsAfter: frRefsAfter.length })

    // Isolated refs failure: history must remain usable.
    const refFailContext = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    const refFailPage = await refFailContext.newPage()
    await refFailPage.route("**/__gg/rpc/getRefs", (route) =>
      route.fulfill({
        status: 502,
        contentType: "application/json",
        body: JSON.stringify({ error: { type: "git_failed", message: "injected refs failure" } }),
      }),
    )
    await refFailPage.goto(FR_BASE, { waitUntil: "domcontentloaded" })
    await refFailPage.waitForFunction(
      () => document.querySelectorAll('[data-testid="repository-select"] option').length >= 16,
      null,
      { timeout: 30_000 },
    )
    await refFailPage.locator(SELECTORS.repository[0]).selectOption(frPrimary.id)
    await waitLoaded(refFailPage, 100)
    await waitRows(refFailPage, 1)
    const refFailState = await layoutSnapshot(refFailPage)
    const refsErrorVisible = await refFailPage.locator('[data-testid="refs-error"]').count()
    checkResult(checks, "refs failure does not take down history", refFailState.footer.includes("100 loaded") && refFailState.rows.length > 0, { footer: refFailState.footer, rows: refFailState.rows.length, refsErrorVisible })
    await screenshot(refFailPage, "11-fr-refs-failure.png", { fullPage: true })
    await refFailContext.close()

    try {
      await loadingGateScenario(browser, frPrimary, checks, metrics)
    } catch (error) {
      checkResult(checks, "loading gate scenario executes", false, { error: String(error) })
    }
    try {
      await compareScrollScenario(browser, frPrimary, checks, metrics)
    } catch (error) {
      checkResult(checks, "scrolled inline comparison scenario executes", false, { error: String(error) })
    }

    // TEMP mutation fixture: real write UI flow only here.
    await temp.goto(TEMP_BASE, { waitUntil: "domcontentloaded" })
    await temp.reload({ waitUntil: "domcontentloaded" })
    await temp.waitForFunction(() => document.querySelectorAll('[data-testid="repository-select"] option').length >= 1, null, { timeout: 30_000 })
    await waitRows(temp, 1)
    await waitNotBusy(temp)
    const tempRepos = (await fetchRpc(TEMP_ORIGIN, "listRepositories", {})).body.result.repositories
    const tempRepo = TEMP_REPO_NAME ? tempRepos.find((repo) => repo.name === TEMP_REPO_NAME) : tempRepos[0]
    if (!tempRepo) throw new Error("TEMP mutation repository was not found")
    await temp.locator(SELECTORS.repository[0]).selectOption(tempRepo.id)
    await waitLoaded(temp, 100).catch(() => waitRows(temp, 1))
    await waitRows(temp, 1)
    await waitNotBusy(temp)
    const tempStatus0 = (await fetchRpc(TEMP_ORIGIN, "getStatus", { repositoryId: tempRepo.id })).body.result
    const tempRefs0 = (await fetchRpc(TEMP_ORIGIN, "getRefs", { repositoryId: tempRepo.id })).body.result.refs
    const tempBranches = tempRefs0.filter((ref) => ref.kind === "branch")
    const targetBranch = tempBranches.find((ref) => ref.name !== tempStatus0.branch)
    if (!targetBranch) throw new Error("TEMP fixture has no non-current local branch")
    await openBranchSelector(temp)
    const checkoutRow = temp.locator(`${SELECTORS.checkoutRow[0]}[data-branch="${targetBranch.name}"]`)
    await checkoutRow.click()
    await waitDialog(temp)
    await screenshot(temp, "07-temp-checkout-dialog.png", { fullPage: true })
    const mutationsBeforeCancel = events.temp.rpc.filter((entry) => MUTATION_METHODS.has(entry.method)).length
    await cancelDialog(temp, SELECTORS.checkoutCancel)
    await waitRaf(temp, 2)
    const mutationsAfterCancel = events.temp.rpc.filter((entry) => MUTATION_METHODS.has(entry.method)).length
    const tempStatusCancel = (await fetchRpc(TEMP_ORIGIN, "getStatus", { repositoryId: tempRepo.id })).body.result
    checkResult(checks, "checkout cancel sends no mutation and leaves HEAD unchanged", mutationsAfterCancel === mutationsBeforeCancel && tempStatusCancel.head === tempStatus0.head, { mutationsBeforeCancel, mutationsAfterCancel, headBefore: tempStatus0.head, headAfter: tempStatusCancel.head })
    await openBranchSelector(temp)
    await temp.locator(`${SELECTORS.checkoutRow[0]}[data-branch="${targetBranch.name}"]`).click()
    await waitDialog(temp)
    await confirmDialog(temp, SELECTORS.checkoutConfirm)
    await temp.waitForFunction(
      (branch) => (document.querySelector('[data-testid="current-branch"]')?.innerText ?? "").includes(branch),
      targetBranch.name,
      { timeout: 30_000 },
    )
    const tempStatusCheckedOut = (await fetchRpc(TEMP_ORIGIN, "getStatus", { repositoryId: tempRepo.id })).body.result
    checkResult(checks, "confirmed checkout changes TEMP HEAD to the selected local branch", tempStatusCheckedOut.branch === targetBranch.name, { expected: targetBranch.name, actual: tempStatusCheckedOut.branch })
    await closeBranchSelectorIfOpen(temp)
    await openBranchSelector(temp)
    await temp.locator(`${SELECTORS.checkoutRow[0]}[data-branch="${tempStatus0.branch}"]`).click()
    await waitDialog(temp)
    await confirmDialog(temp, SELECTORS.checkoutConfirm)
    await temp.waitForFunction(
      (branch) => (document.querySelector('[data-testid="current-branch"]')?.innerText ?? "").includes(branch),
      tempStatus0.branch,
      { timeout: 30_000 },
    )
    const tempStatusBack = (await fetchRpc(TEMP_ORIGIN, "getStatus", { repositoryId: tempRepo.id })).body.result
    checkResult(checks, "confirmed checkout returns TEMP HEAD to the original local branch", tempStatusBack.branch === tempStatus0.branch, { expected: tempStatus0.branch, actual: tempStatusBack.branch })
    await closeBranchSelectorIfOpen(temp)
    await screenshot(temp, "08-temp-checkout-success.png", { locator: temp.locator('[data-testid="harness-panel-shell"]') })

    // Create branch from a commit through the real context menu.
    const tempRow = temp.locator(SELECTORS.row[0]).nth(1)
    const tempCommit = await tempRow.getAttribute("data-commit")
    await tempRow.locator(".gg-subject").click({ button: "right" })
    await menuAction(temp, SELECTORS.commitMenu, "create-branch")
    const branchName = `gg-release-${Date.now().toString(36)}`
    await fillFieldIfPresent(temp, "name", branchName)
    await confirmDialog(temp)
    const tempRefsAfterCreate = (await fetchRpc(TEMP_ORIGIN, "getRefs", { repositoryId: tempRepo.id })).body.result.refs
    checkResult(checks, "create branch from commit adds the real ref", tempRefsAfterCreate.some((ref) => ref.kind === "branch" && ref.name === branchName), { branchName: "present" })
    await screenshot(temp, "09-temp-branch-success.png", { locator: temp.locator('[data-testid="harness-panel-shell"]') })
    const branchBadge = await refBadgeByName(temp, branchName)
    if (await branchBadge.count()) {
      // ref-menu.checkout path, then rename the now-current branch.
      await branchBadge.click({ button: "right" })
      await menuAction(temp, SELECTORS.refMenu, "checkout")
      await waitDialog(temp)
      await confirmDialog(temp, SELECTORS.checkoutConfirm)
      await temp.waitForFunction(
        (branch) => (document.querySelector('[data-testid="current-branch"]')?.innerText ?? "").includes(branch),
        branchName,
        { timeout: 30_000 },
      )
      checkResult(checks, "ref-menu checkout can switch to the created branch", (await fetchRpc(TEMP_ORIGIN, "getStatus", { repositoryId: tempRepo.id })).body.result.branch === branchName, {})
      const currentBadge = await refBadgeByName(temp, branchName)
      await currentBadge.click({ button: "right" })
      await menuAction(temp, SELECTORS.refMenu, "rename-branch")
      const oldNameField = temp.locator('[data-testid="confirm-field-old-name"]')
      const oldNameReadOnly = (await oldNameField.count()) > 0 && ((await oldNameField.getAttribute("readonly")) !== null || await oldNameField.isDisabled())
      checkResult(checks, "rename dialog shows current name as read-only", oldNameReadOnly, {})
      const renamed = `${branchName}-r`
      await fillFieldIfPresent(temp, "new-name", renamed)
      await confirmDialog(temp)
      const refsRenamed = (await fetchRpc(TEMP_ORIGIN, "getRefs", { repositoryId: tempRepo.id })).body.result.refs
      checkResult(checks, "rename branch updates the real ref", refsRenamed.some((ref) => ref.name === renamed) && !refsRenamed.some((ref) => ref.name === branchName), {})
      checkResult(checks, "renaming the current branch refreshes the current-branch label", (await temp.locator('[data-testid="current-branch"]').innerText()).includes(renamed), {})
      await openBranchSelector(temp)
      await temp.locator(`${SELECTORS.checkoutRow[0]}[data-branch="${tempStatus0.branch}"]`).click()
      await waitDialog(temp)
      await confirmDialog(temp, SELECTORS.checkoutConfirm)
      await temp.waitForFunction(
        (branch) => (document.querySelector('[data-testid="current-branch"]')?.innerText ?? "").includes(branch),
        tempStatus0.branch,
        { timeout: 30_000 },
      )
      await closeBranchSelectorIfOpen(temp)
      const renamedBadge = await refBadgeByName(temp, renamed)
      await renamedBadge.click({ button: "right" })
      await menuAction(temp, SELECTORS.refMenu, "delete-branch")
      await waitDialog(temp)
      const mutationsBeforeDeleteCancel = events.temp.rpc.filter((entry) => entry.method === "deleteBranch").length
      await cancelDialog(temp)
      const refsAfterDeleteCancel = (await fetchRpc(TEMP_ORIGIN, "getRefs", { repositoryId: tempRepo.id })).body.result.refs
      checkResult(checks, "delete branch cancel does not remove the ref", refsAfterDeleteCancel.some((ref) => ref.name === renamed) && events.temp.rpc.filter((entry) => entry.method === "deleteBranch").length === mutationsBeforeDeleteCancel, {})
      await renamedBadge.click({ button: "right" })
      await menuAction(temp, SELECTORS.refMenu, "delete-branch")
      await waitDialog(temp)
      await confirmDialog(temp)
      const refsAfterDelete = (await fetchRpc(TEMP_ORIGIN, "getRefs", { repositoryId: tempRepo.id })).body.result.refs
      checkResult(checks, "confirmed delete removes the merged branch", !refsAfterDelete.some((ref) => ref.name === renamed), {})
    } else {
      checkResult(checks, "created branch badge is visible for rename/delete", false, {})
    }

    // TEMP light + annotated tag create/delete.
    const createdTags = []
    for (const annotated of [false, true]) {
      await tempRow.locator(".gg-subject").click({ button: "right" })
      await menuAction(temp, SELECTORS.commitMenu, "create-tag")
      const tagName = `gg-release-tag-${annotated ? "a" : "l"}-${Date.now().toString(36)}`
      await fillFieldIfPresent(temp, "name", tagName)
      if (annotated) await fillFieldIfPresent(temp, "message", "release acceptance annotated tag")
      await confirmDialog(temp)
      const refsWithTag = (await fetchRpc(TEMP_ORIGIN, "getRefs", { repositoryId: tempRepo.id })).body.result.refs
      checkResult(checks, `create ${annotated ? "annotated" : "light"} tag adds the real tag ref`, refsWithTag.some((ref) => ref.kind === "tag" && ref.name === tagName), { annotated })
      createdTags.push({ name: tagName, annotated })
    }
    for (const tag of createdTags) {
      const tagBadge = await refBadgeByName(temp, tag.name)
      if (await tagBadge.count()) {
        await tagBadge.click({ button: "right" })
        await menuAction(temp, SELECTORS.refMenu, "delete-tag")
        await waitDialog(temp)
        await confirmDialog(temp)
        const refsAfterTagDelete = (await fetchRpc(TEMP_ORIGIN, "getRefs", { repositoryId: tempRepo.id })).body.result.refs
        checkResult(checks, `delete ${tag.annotated ? "annotated" : "light"} tag removes the real tag ref`, !refsAfterTagDelete.some((ref) => ref.kind === "tag" && ref.name === tag.name), {})
      } else {
        checkResult(checks, `created ${tag.annotated ? "annotated" : "light"} tag badge is visible for delete`, false, {})
      }
    }

    // Root commit read-only regression on the TEMP fixture, after a fresh reload.
    await temp.reload({ waitUntil: "domcontentloaded" })
    await temp.waitForFunction(
      () => document.querySelectorAll('[data-testid="repository-select"] option').length >= 2,
      null,
      { timeout: 30_000 },
    )
    await temp.locator(SELECTORS.repository[0]).selectOption(tempRepo.id)
    await waitRows(temp, 1)
    await waitNotBusy(temp)
    const tempLog = (await fetchRpc(TEMP_ORIGIN, "getLog", { repositoryId: tempRepo.id, limit: 100 })).body.result
    const rootIndex = tempLog.commits.findIndex((commit) => commit.parents.length === 0)
    if (rootIndex >= 0) {
      await scrollToRowIndex(temp, rootIndex)
      await temp.locator(`.gg-graph-row[data-index="${rootIndex}"]`).locator(".gg-subject").click()
      await waitForAny(temp, SELECTORS.inlineSlot)
      await temp.waitForFunction(
        () => {
          const tree = document.querySelector('[data-testid="inline-files"]')
          if (!tree) return false
          return (
            !tree.querySelector(".gg-status") &&
            (tree.querySelectorAll(".gg-file-row").length > 0 ||
              Boolean(tree.querySelector(".gg-empty")) ||
              Boolean(tree.querySelector(".gg-error")))
          )
        },
        null,
        { timeout: 20_000 },
      ).catch(() => {})
      const rootFile = temp.locator(`${SELECTORS.inlineFiles[0]} .gg-file-row`).first()
      if (await rootFile.count()) {
        await rootFile.click()
        await waitForAny(temp, SELECTORS.commitDiff)
        const rootRange = await temp.locator('[data-testid="commit-diff-range"]').getAttribute("title")
        checkResult(checks, "TEMP root commit renders an Empty tree diff", (rootRange ?? "").startsWith("Empty tree"), { range: rootRange })
        await temp.locator(SELECTORS.detailsBack[0]).click()
        await temp.waitForFunction(() => !document.querySelector('[data-testid="commit-diff-page"]'), null, { timeout: 10_000 })
      } else {
        checkResult(checks, "TEMP root commit has a file to open", false, {})
      }
    } else {
      checkResult(checks, "TEMP root commit exists", false, {})
    }

    // TEMP guard/error paths, safely on the synthetic fixture only.
    const tempHead = (await fetchRpc(TEMP_ORIGIN, "getStatus", { repositoryId: tempRepo.id })).body.result.head
    const tempRefsBeforeGuard = (await fetchRpc(TEMP_ORIGIN, "getRefs", { repositoryId: tempRepo.id })).body.result.refs
    const errorChecks = []
    const errorCheck = async (method, input, label) => {
      const result = await fetchRpc(TEMP_ORIGIN, method, input)
      errorChecks.push({ label, method, status: result.status, ok: result.ok, error: result.body?.error?.type })
    }
    await errorCheck("checkoutBranch", { repositoryId: tempRepo.id, expectedHead: tempHead, confirmed: true, branch: "__gg_release_unknown__" }, "unknown checkout")
    await errorCheck("renameBranch", { repositoryId: tempRepo.id, expectedHead: tempHead, confirmed: true, oldName: "__gg_release_unknown__", newName: "__gg_release_unknown_new__" }, "unknown rename")
    await errorCheck("deleteBranch", { repositoryId: tempRepo.id, expectedHead: tempHead, confirmed: true, name: "__gg_release_unknown__" }, "unknown delete")
    await errorCheck("deleteTag", { repositoryId: tempRepo.id, expectedHead: tempHead, confirmed: true, name: "__gg_release_unknown__" }, "unknown tag")
    if (targetBranch) {
      await errorCheck("checkoutBranch", { repositoryId: tempRepo.id, expectedHead: "0".repeat(tempHead?.length ?? 40), confirmed: true, branch: targetBranch.name }, "stale head")
    }
    const tempStatusDirtyCheck = (await fetchRpc(TEMP_ORIGIN, "getStatus", { repositoryId: tempRepo.id })).body.result
    const tempRefsDirtyCheck = (await fetchRpc(TEMP_ORIGIN, "getRefs", { repositoryId: tempRepo.id })).body.result.refs
    const nonCurrentNow = tempRefsDirtyCheck.find((ref) => ref.kind === "branch" && ref.name !== tempStatusDirtyCheck.branch)
    const safeTempRoot = /opencode|temp|fixture|mutation/i.test(tempRepo.rootPath) && !/workspace[\\/]fr/i.test(tempRepo.rootPath)
    if (safeTempRoot && nonCurrentNow) {
      // Checkout refuses tracked changes. Use a real tracked file, then restore
      // its bytes exactly; an untracked marker is intentionally allowed.
      const dirtyPath = join(tempRepo.rootPath, "README.md")
      if (existsSync(dirtyPath)) {
        const original = readFileSync(dirtyPath)
        let dirtyResult
        let tempStatusAfterDirty
        try {
          writeFileSync(dirtyPath, Buffer.concat([original, Buffer.from("\nrelease dirty tracked change\n")]))
          const dirtyStatus = (await fetchRpc(TEMP_ORIGIN, "getStatus", { repositoryId: tempRepo.id })).body.result
          dirtyResult = await fetchRpc(TEMP_ORIGIN, "checkoutBranch", {
            repositoryId: tempRepo.id,
            expectedHead: tempStatusDirtyCheck.head,
            confirmed: true,
            branch: nonCurrentNow.name,
          })
          tempStatusAfterDirty = (await fetchRpc(TEMP_ORIGIN, "getStatus", { repositoryId: tempRepo.id })).body.result
          checkResult(checks, "TEMP dirty checkout is refused without changing HEAD", (!dirtyResult.ok || dirtyResult.status >= 400) && tempStatusAfterDirty.head === tempStatusDirtyCheck.head, { status: dirtyResult.status, error: dirtyResult.body?.error?.type, dirtyFiles: dirtyStatus.files, headBefore: tempStatusDirtyCheck.head, headAfter: tempStatusAfterDirty.head })
        } finally {
          writeFileSync(dirtyPath, original)
          if (dirtyResult?.ok) {
            const now = (await fetchRpc(TEMP_ORIGIN, "getStatus", { repositoryId: tempRepo.id })).body.result
            if (now.branch !== tempStatus0.branch) {
              await fetchRpc(TEMP_ORIGIN, "checkoutBranch", {
                repositoryId: tempRepo.id,
                expectedHead: now.head,
                confirmed: true,
                branch: tempStatus0.branch,
              })
            }
          }
        }
      } else {
        checkResult(checks, "TEMP dirty checkout fixture is available safely", false, { reason: "README.md missing" })
      }
    } else {
      checkResult(checks, "TEMP dirty checkout fixture is available safely", false, { safeTempRoot, hasNonCurrent: Boolean(nonCurrentNow) })
    }
    const tempRefsAfterErrors = (await fetchRpc(TEMP_ORIGIN, "getRefs", { repositoryId: tempRepo.id })).body.result.refs
    checkResult(checks, "TEMP unknown/stale mutation errors are real errors", errorChecks.every((entry) => !entry.ok || entry.status >= 400), errorChecks)
    checkResult(checks, "TEMP refs unchanged after unknown/stale probes", refsSignature(tempRefsAfterErrors) === refsSignature(tempRefsBeforeGuard), { before: tempRefsBeforeGuard.length, after: tempRefsAfterErrors.length })
    await screenshot(temp, "10-temp-error-paths.png", { locator: temp.locator('[data-testid="harness-panel-shell"]') })

    try {
      await selectedFilterScenario(browser, tempRepo, checks, metrics)
    } catch (error) {
      checkResult(checks, "selected-ref filter mutation scenario executes", false, { error: String(error) })
    }
    try {
      await binaryScenario(browser, tempRepo, checks, metrics)
    } catch (error) {
      checkResult(checks, "TEMP binary diff scenario executes", false, { error: String(error) })
    }
    try {
      await warningFaultScenario(browser, tempRepo, checks, metrics)
    } catch (error) {
      checkResult(checks, "mutation warning fault scenario executes", false, { error: String(error) })
    }
    try {
      await mutationSwitchScenario(browser, tempRepo, checks, metrics)
    } catch (error) {
      checkResult(checks, "mutation in-flight switch scenario executes", false, { error: String(error) })
    }
  } catch (error) {
    fatal = error instanceof Error ? error.message : String(error)
    notes.push(`Fatal: ${fatal}`)
  } finally {
    await context.close().catch(() => {})
  }

  const sourceEnd = sourceMtimes()
  checkResult(checks, "production source mtimes are stable during the run", JSON.stringify(sourceStart) === JSON.stringify(sourceEnd), { start: sourceStart, end: sourceEnd })
  const benign = (bucket) =>
    bucket.console.filter((entry) => /favicon|404/.test(entry.text) || /Failed to load resource.*404/.test(entry.text))
  for (const name of ["fr", "temp"]) {
    const bucket = events[name]
    const unexpectedConsole = bucket.console.filter((entry) => !benign(bucket).includes(entry))
    checkResult(checks, `${name} page has no page errors`, bucket.page.length === 0, bucket.page)
    checkResult(checks, `${name} has no unexpected console errors`, unexpectedConsole.length === 0, unexpectedConsole)
    checkResult(checks, `${name} has no non-abort request failures`, bucket.requestFailures.length === 0, bucket.requestFailures)
    const unexpectedHttp = bucket.http.filter((entry) => !entry.url.endsWith("/favicon.ico"))
    checkResult(checks, `${name} has no unexpected HTTP >=400`, unexpectedHttp.length === 0, unexpectedHttp)
  }
  const failed = checks.filter((entry) => !entry.ok)
  const result = {
    startedAt,
    finishedAt: new Date().toISOString(),
    verdict: failed.length === 0 && !fatal ? "PASS" : "FAIL",
    fatal,
    checks,
    failed,
    metrics,
    screenshots,
    events,
    hmrEvents,
    sourceMtimes: { start: sourceStart, end: sourceEnd },
    notes,
    privateDataNote:
      "TEMP result.json may contain private repository/hash/path details. The committed acceptance summary is anonymous.",
    notCovered: [
      "Desktop window/panel chrome, tab strip, drag/resize and side-region rules",
      "MenuItem registration for session.panel",
      "OpenCode session switching, project/sidebar data, host theme injection and host event bus",
      "Network push/fetch/reset clean and other unavailable remote operations",
    ],
  }
  const resultPath = join(ARTIFACTS, "result.json")
  mkdirSync(ARTIFACTS, { recursive: true })
  writeFileSync(resultPath, JSON.stringify(result, null, 2), "utf8")
  console.log(JSON.stringify({ verdict: result.verdict, failed, screenshots, resultPath }, null, 2))
}

async function screenshot(page, name, { fullPage = false, locator } = {}) {
  mkdirSync(ARTIFACTS, { recursive: true })
  const path = join(ARTIFACTS, name)
  if (locator) await locator.screenshot({ path, animations: "disabled" })
  else await page.screenshot({ path, fullPage, animations: "disabled" })
  screenshots.push(path)
  return path
}

async function main() {
  const chromium = loadPlaywright().chromium
  const executablePath = findChrome()
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ["--no-first-run", "--no-default-browser-check", "--disable-background-networking"],
  })
  try {
    if (process.argv.includes("--audit")) {
      await auditSelectors(browser, FR_BASE, "FR", 16)
      await auditSelectors(browser, TEMP_BASE, "TEMP", 1)
      return
    }
    await fullRun(browser, executablePath)
  } finally {
    await browser.close().catch(() => {})
  }
}

await main()









