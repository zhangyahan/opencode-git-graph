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
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs"
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
  "fetchRemote",
])
const FETCH_METHOD = process.env.GG_FETCH_METHOD ?? "fetchRemote"
const COMPARISON_METHODS = new Set(["getComparisonFiles", "getComparisonDiff"])
const SLOT_MIN_HEIGHT = 96
const SLOT_HANDLE_SELECTOR = '[data-testid="slot-resize-handle"]'
const COLUMN_DIVIDER_SELECTOR = (column) => `[data-testid="resize-column-${column}"]`
const COLUMN_DIVIDER_TARGET_WIDTH = 5
const COLUMN_DIVIDER_MIN_WIDTH = 3
const COLUMN_DIVIDER_MAX_WIDTH = 8
const INLINE_INFO_MIN_RATIO = 0.25
const INLINE_INFO_MAX_RATIO = 0.6
/**
 * The left/middle inline divider is part of the upcoming frozen layout. The
 * exact test id is not frozen yet; audit reports which candidate exists.
 */
const INLINE_INFO_DIVIDER_SELECTORS = [
  '[data-testid="inline-split"]',
  '[data-testid="inline-info-resize"]',
  '[data-testid="inline-column-resize"]',
  '[data-testid="inline-info-divider"]',
  '[data-testid="inline-info-splitter"]',
  '[data-testid="inline-resize"]',
  '[data-testid="inline-splitter"]',
  '.gg-inline-split',
  '.gg-inline-info-resize',
  '.gg-inline-splitter',
]
const UNCOMMITTED_ROW_SELECTOR =
  '[data-testid="uncommitted-row"], [data-testid="uncommitted-changes"], .gg-uncommitted-row'
const LEGACY_CHANGES_SELECTOR = '[data-testid="changes"], .gg-changes-section'
const FORBIDDEN_TOOLBAR_SELECTORS = ['[data-testid="first-parent"]', '[data-testid="jump-head"]']
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
  "src/index.ts",
  "src/server/repository/manager.ts",
  "src/server/repository/watcher.ts",
  "src/server/git/compare.ts",
  "src/server/git/log.ts",
  "src/server/git/file-content.ts",
  "src/server/git/diff.ts",
  "src/gui/file-content-view.tsx",
  "src/gui/graph-geometry.ts",
  "src/gui/history-columns.ts",
  "src/gui/format.ts",
  "src/gui/inline-split.ts",
  "src/gui/label.ts",
  "src/gui/graph-events.ts",
  "src/gui/panel-cache.ts",
  "src/gui.tsx",
  "src/gui/changes.ts",
  "src/gui/fetch-dialog.tsx",
  "src/gui/slot-size.ts",
  "src/server/git/mutations.ts",
  "src/server/git/fetch.ts",
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
  row: [".gg-graph-row:not(.gg-uncommitted-row)"],
  dateCell: ['[data-testid="commit-date"]', ".gg-col-date"],
  denseGraph: ['[data-testid="dense-graph"]'],
  resizeHandle: ['[data-testid^="resize-column-"]'],
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
  fetchButton: ['[data-testid="fetch-button"]'],
  fetchConfirm: ['[data-testid="fetch-confirm"]'],
  fetchCancel: ['[data-testid="fetch-cancel"]'],
  fetchDialog: [
    '[data-testid="fetch-dialog"]',
    '[data-testid="fetch-confirm-dialog"]',
    '[data-testid="confirm-dialog"]',
  ],
  fetchRemote: ['[data-testid="fetch-remote-select"]', '[data-testid="fetch-remote"]', 'select[name="remote"]'],
  fetchPrune: ['[data-testid="fetch-prune"]', 'input[name="prune"]'],
  fetchExpectedHead: [
    '[data-testid="fetch-expected-head"]',
    '[data-testid="fetch-head"]',
    '[data-testid="fetch-dialog"] .gg-dialog-facts dd:nth-of-type(2)',
  ],
  fetchError: [
    '[data-testid="fetch-error"]',
    '[data-testid="mutation-warning"]',
    '[data-testid="mutation-notice"]',
    ".gg-mutation-warning",
    ".gg-mutation-notice",
  ],
  slotResizeHandle: [SLOT_HANDLE_SELECTOR],
  remountPanel: ['[data-testid="harness-remount-panel"]'],
  inlineInfoDivider: INLINE_INFO_DIVIDER_SELECTORS,
  inlineBody: [".gg-row-slot-body"],
  inlineInfoResolved: ['[data-testid="inline-info"]'],
  inlineFilesResolved: [".gg-row-slot-files"],
  refMore: ['[data-testid="ref-more"]', ".gg-ref-more"],
  uncommittedRow: [UNCOMMITTED_ROW_SELECTOR],
  uncommittedCounts: [
    '[data-testid="uncommitted-total"]',
    '[data-testid="uncommitted-counts"]',
    '[data-testid="uncommitted-count"]',
    '[data-testid^="uncommitted-count-"]',
  ],
  uncommittedBody: [
    '[data-testid="uncommitted-slot"]',
    '[data-testid="uncommitted-body"]',
    '[data-testid="uncommitted-groups"]',
    '[data-testid="uncommitted-files"]',
    ".gg-uncommitted-body",
  ],
  legacyChanges: [LEGACY_CHANGES_SELECTOR],
  statusDiffPage: [
    '[data-testid="commit-diff-page"]',
    '[data-testid="diff-page"]',
    '[data-testid="status-diff-page"]',
  ],
  refBadge: ['[data-testid="ref-badge"]', ".gg-ref-badge:not(.gg-ref-more)"],
  refMenu: ['[data-testid="ref-menu"]', '[data-testid="ref-context-menu"]'],
  commitMenu: ['[data-testid="commit-context-menu"]'],
  checkoutConfirm: ['[data-testid="checkout-confirm"]', '[data-testid="confirm-action"]'],
  checkoutCancel: ['[data-testid="checkout-cancel"]', '[data-testid="confirm-cancel"]'],
  confirmAction: ['[data-testid="confirm-action"]'],
  confirmCancel: ['[data-testid="confirm-cancel"]'],
  dialog: ['[data-testid="confirm-dialog"]'],
  inlineSlot: ['[data-testid="inline-slot"]'],
  inlineInfo: ['[data-testid="inline-info"]'],
  inlineFiles: ['[data-testid="inline-files"]'],
  fileStatAdd: ['[data-testid="file-stat-add"]'],
  fileStatDel: ['[data-testid="file-stat-del"]'],
  viewToggleList: ['[data-testid="view-toggle-list"]'],
  viewToggleTree: ['[data-testid="view-toggle-tree"]'],
  fileViewAtCommit: ['[data-testid="file-view-at-commit"]'],
  fileOpenCurrent: ['[data-testid="file-open-current"]'],
  fileContentPanel: ['[data-testid="commit-file-content"]', '[data-testid="file-content-panel"]'],
  fileContentClose: ['[data-testid="commit-file-content-close"]', '[data-testid="file-content-close"]', '[data-testid="close-details"]'],
  fileCopyPath: ['[data-testid="file-copy-path"]', '[data-testid="file-copy-path-action"]', '[data-action="copy-path"]'],
  mutationNotice: ['[data-testid="mutation-notice"]', '.gg-mutation-notice'],
  graphHScrollLegacy: [".gg-graph-hscroll"],
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

/**
 * Tab registration lives in `src/gui.tsx`, which the dev harness does not
 * render. This is a source-level readiness check only: it must never be counted
 * as a UI pass. Desktop icon/text rendering remains a manual item.
 */
function sourceRegistrationCheck() {
  const file = "src/gui.tsx"
  const labelFile = "src/gui/label.ts"
  const path = join(ROOT, file)
  const labelPath = join(ROOT, labelFile)
  const text = existsSync(path) ? readFileSync(path, "utf8") : ""
  const label = existsSync(labelPath) ? readFileSync(labelPath, "utf8") : ""
  const titleValue =
    /GIT_GRAPH_TAB_TITLE\s*=\s*"([^"]+)"/.exec(label)?.[1] ??
    /title:\s*"([^"]+)"/.exec(text)?.[1] ??
    null
  const iconValue =
    /GIT_GRAPH_TAB_ICON[^\n=]*=\s*"([^"]+)"/.exec(label)?.[1] ??
    /icon:\s*"([^"]+)"/.exec(text)?.[1] ??
    null
  const labelRendersIconAndText =
    (text.includes("<ctx.ui.Icon name={GIT_GRAPH_TAB_ICON}") &&
      text.includes("<span>{GIT_GRAPH_TAB_TITLE}</span>")) ||
    (/<ctx\.ui\.Icon[^>]*name="branch"/.test(text) &&
      /<span>\{?["']?Git Graph/.test(text))
  const entries = [
    {
      name: "tab/menu title is Git Graph",
      ok: titleValue === "Git Graph",
      detail: { titleFile: label ? labelFile : file, titleValue },
    },
    {
      name: "tab label renders the host branch icon and text",
      ok: labelRendersIconAndText,
      detail: { file, labelFile },
    },
    {
      name: "tab/mobile/menu icon is branch",
      ok: iconValue === "branch" && (text.match(/GIT_GRAPH_TAB_ICON|icon:/g) ?? []).length >= 2,
      detail: { iconValue },
    },
    {
      name: "panel registration is side/wide-safe",
      ok: /ctx\.add\(Panel,[\s\S]*?region:\s*"side"/.test(text),
      detail: { file },
    },
  ]
  return {
    name: "tab label icon + text",
    file,
    labelFile,
    sourceCheck: true,
    desktopManual: true,
    uiPass: false,
    ok: entries.every((entry) => entry.ok),
    entries,
  }
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
    (expected) => document.querySelectorAll(".gg-graph-row:not(.gg-uncommitted-row)").length >= expected,
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
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const state = await page.evaluate((wanted) => {
      const scroller = document.querySelector('[data-testid="history-scroll"]')
      if (!scroller) return { done: false, reason: "no-scroller" }
      const rows = [...document.querySelectorAll(".gg-graph-row:not(.gg-uncommitted-row)")]
        .map((row) => ({
          index: Number(row.dataset.index),
          top: Number(row.dataset.rowTop),
          height: row.getBoundingClientRect().height,
        }))
        .filter((row) => Number.isFinite(row.index) && Number.isFinite(row.top))
      if (rows.length === 0) return { done: false, reason: "no-rows" }
      const viewTop = scroller.scrollTop
      const viewBottom = viewTop + scroller.clientHeight
      const maxTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
      const exact = rows.find((row) => row.index === wanted)
      if (exact) {
        if (exact.top < viewTop || exact.top + exact.height > viewBottom) {
          scroller.scrollTop = Math.max(
            0,
            Math.min(maxTop, exact.top - Math.min(80, scroller.clientHeight / 3)),
          )
          return { done: false, reason: "exact-adjust" }
        }
        return { done: true, reason: "exact-visible" }
      }
      const sorted = [...rows].sort((left, right) => left.index - right.index)
      const nearest = rows.reduce(
        (best, row) =>
          Math.abs(row.index - wanted) < Math.abs(best.index - wanted) ? row : best,
        rows[0],
      )
      const span = sorted.at(-1).index - sorted[0].index
      const average =
        span > 0 ? (sorted.at(-1).top - sorted[0].top) / span : nearest.height || 28
      const delta = wanted - nearest.index
      let next = Math.max(0, Math.min(maxTop, viewTop + delta * (average || 28)))
      if (Math.abs(next - viewTop) < 1) {
        next = Math.max(
          0,
          Math.min(maxTop, viewTop + (delta > 0 ? average || 28 : -(average || 28))),
        )
      }
      scroller.scrollTop = next
      return { done: false, reason: "seek", nearest: nearest.index, average }
    }, index)
    if (state.done) break
    await waitRaf(page, 2)
  }
  await page.waitForFunction(
    (wanted) =>
      [...document.querySelectorAll(".gg-graph-row:not(.gg-uncommitted-row)")].some(
        (row) => Number(row.dataset.index) === wanted,
      ),
    index,
    { timeout: 20_000 },
  )
  await page.evaluate((wanted) => {
    const scroller = document.querySelector('[data-testid="history-scroll"]')
    const row = [...document.querySelectorAll(".gg-graph-row:not(.gg-uncommitted-row)")].find(
      (candidate) => Number(candidate.dataset.index) === wanted,
    )
    if (!scroller || !row) return
    const top = Number(row.dataset.rowTop)
    const height = row.getBoundingClientRect().height
    if (top < scroller.scrollTop || top + height > scroller.scrollTop + scroller.clientHeight) {
      scroller.scrollTop = Math.max(
        0,
        Math.min(
          scroller.scrollHeight - scroller.clientHeight,
          top - Math.min(80, scroller.clientHeight / 3),
        ),
      )
    }
  }, index)
  await waitRaf(page, 2)
}

async function firstVisibleHash(page) {
  return page.locator(".gg-graph-row .gg-hash").first().textContent().catch(() => null)
}

async function visibleRowHashes(page) {
  return page.locator(".gg-graph-row:not(.gg-uncommitted-row)").evaluateAll((rows) =>
    rows.map((row) => row.getAttribute("data-commit")),
  )
}

async function refBadgeByName(page, name) {
  await page
    .waitForFunction(
      (wanted) =>
        [...document.querySelectorAll('[data-testid="ref-badge"]')].some(
          (badge) => badge.getAttribute("data-ref-name") === wanted,
        ),
      name,
      { timeout: 15_000 },
    )
    .catch(() => {})
  const exact = page.locator(
    `[data-testid="ref-badge"][data-ref-name="${String(name).replace(/"/g, '\\"')}"]`,
  )
  if ((await exact.count()) > 0) return exact.first()
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
    const rows = qa(".gg-graph-row:not(.gg-uncommitted-row)")
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
      historyHeadOverflow: overflow(q(".gg-history-head")),
      rowOverflow: overflow(firstRow),
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
        scrollbarWidth: graphCell ? graphCell.offsetWidth - graphCell.clientWidth : null,
        hasGraphScroll: Boolean(q('[data-testid="graph-scroll"]')),
        hasGraphHandle: Boolean(q('[data-testid="resize-column-graph"]')),
        handleCount: qa('[data-testid="resize-column-graph"]').length,
        svgWidth: firstRow?.querySelector(".gg-graph-svg")?.getAttribute("width") ?? null,
        svgMaxX: (() => {
          const cell = firstRow?.querySelector(".gg-row-graph")
          const svg = firstRow?.querySelector(".gg-graph-svg")
          if (!cell || !svg) return null
          const cellRect = cell.getBoundingClientRect()
          let max = 0
          for (const shape of svg.querySelectorAll("path, circle, rect")) {
            const rect = shape.getBoundingClientRect()
            max = Math.max(max, rect.right - cellRect.left)
          }
          return max
        })(),
      },
      denseGraphVisible: Boolean(q('[data-testid="dense-graph"]')),
      date: firstDate
        ? {
            text: firstDate.textContent.trim(),
            title: firstDate.getAttribute("title"),
            width: firstDate.getBoundingClientRect().width,
            scrollWidth: firstDate.scrollWidth,
            clientWidth: firstDate.clientWidth,
            scrollHeight: firstDate.scrollHeight,
            clientHeight: firstDate.clientHeight,
            textOverflow: getComputedStyle(firstDate).textOverflow,
            whiteSpace: getComputedStyle(firstDate).whiteSpace,
            visible: true,
          }
        : { visible: false },
      rows: rows.map((row) => ({
        index: Number(row.dataset.index),
        top: Number(row.dataset.rowTop),
        height: row.getBoundingClientRect().height,
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

async function graphLaneSnapshot(page) {
  return page.evaluate(() => {
    const cells = [...document.querySelectorAll(".gg-graph-row:not(.gg-uncommitted-row) .gg-row-graph")]
    const svgs = [...document.querySelectorAll(".gg-graph-row:not(.gg-uncommitted-row) .gg-graph-svg")]
    const widths = svgs
      .map((svg) => Number(svg.getAttribute("width")))
      .filter((value) => Number.isFinite(value) && value > 0)
    const contentWidth = widths.length > 0 ? Math.max(...widths) : null
    const xs = [
      ...new Set(
        [...document.querySelectorAll(".gg-graph-row:not(.gg-uncommitted-row) .gg-graph-svg circle")]
          .map((circle) => Number(circle.getAttribute("cx")))
          .filter((value) => Number.isFinite(value)),
      ),
    ].sort((a, b) => a - b)
    const uniqueDiffs = xs.slice(1).map((value, index) => value - xs[index])
    const laneAligned = xs.every((value) => {
      const lane = Math.round((value - 15) / 14)
      return Math.abs(value - (15 + lane * 14)) < 0.01
    })
    const spacingAligned = uniqueDiffs.every(
      (diff) => diff > 0 && Math.abs(diff - Math.round(diff / 14) * 14) < 0.01,
    )
    const lanes =
      contentWidth !== null ? Math.round((contentWidth - 16) / 14) : null
    const formulaOk =
      contentWidth !== null &&
      lanes !== null &&
      Math.abs(contentWidth - (lanes * 14 + 16)) < 0.01
    const firstCell = cells[0]
    const cellWidth = firstCell ? firstCell.getBoundingClientRect().width : null
    const maxShapeRight = (() => {
      if (!firstCell) return null
      const cellRect = firstCell.getBoundingClientRect()
      let max = 0
      for (const shape of document.querySelectorAll(
        ".gg-graph-row:not(.gg-uncommitted-row) .gg-graph-svg path, .gg-graph-row:not(.gg-uncommitted-row) .gg-graph-svg circle, .gg-graph-row:not(.gg-uncommitted-row) .gg-graph-svg rect",
      )) {
        const rect = shape.getBoundingClientRect()
        max = Math.max(max, rect.right - cellRect.left)
      }
      return max
    })()
    const dense = document.querySelector('[data-testid="dense-graph"]')
    const denseText = dense?.textContent?.trim() ?? ""
    return {
      svgCount: svgs.length,
      contentWidth,
      lanes,
      formulaOk,
      xs,
      uniqueDiffs,
      laneAligned,
      spacingAligned,
      cellWidth,
      scrollWidth: firstCell?.scrollWidth ?? null,
      clientWidth: firstCell?.clientWidth ?? null,
      maxShapeRight,
      denseVisible: Boolean(dense),
      denseText,
      denseLanes: Number((denseText.match(/(\d+)\s+lanes/i) ?? [])[1] ?? NaN),
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
  const beforeRows = await page.locator(".gg-graph-row:not(.gg-uncommitted-row)").count()
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

/**
 * The frozen layout makes the header divider itself the ~5px drag target.
 * There must be no separate grip/knob: the hit area is transparent and any
 * pseudo-element is at most a one-pixel divider line.
 */
async function columnDividerGeometry(page, id) {
  return page.evaluate(({ columnId, selector }) => {
    const handle = document.querySelector(selector)
    if (!handle) return { present: false, selector }
    const cells = [...document.querySelectorAll(".gg-history-head > .gg-col-head")]
    const label = columnId[0].toUpperCase() + columnId.slice(1)
    const index = cells.findIndex((cell) => cell.textContent.trim() === label)
    const cell = cells[index]
    const next = cells[index + 1]
    const cellRect = cell?.getBoundingClientRect()
    const nextRect = next?.getBoundingClientRect()
    const headRect = document.querySelector(".gg-history-head")?.getBoundingClientRect()
    const handleRect = handle.getBoundingClientRect()
    const style = getComputedStyle(handle)
    const pseudo = (side) => {
      const value = getComputedStyle(handle, side)
      const width = Number.parseFloat(value.width)
      const height = Number.parseFloat(value.height)
      const opacity = Number.parseFloat(value.opacity)
      const visible =
        value.content !== "none" &&
        value.display !== "none" &&
        (Number.isNaN(opacity) || opacity > 0.05) &&
        ((Number.isFinite(width) && width > 0.5) || (Number.isFinite(height) && height > 0.5))
      return {
        content: value.content,
        display: value.display,
        width: Number.isFinite(width) ? width : null,
        height: Number.isFinite(height) ? height : null,
        opacity: Number.isFinite(opacity) ? opacity : null,
        background: value.backgroundColor,
        backgroundImage: value.backgroundImage,
        borderRadius: value.borderRadius,
        visible,
      }
    }
    const before = pseudo("::before")
    const after = pseudo("::after")
    const boundary = nextRect?.left ?? cellRect?.right ?? null
    return {
      present: true,
      selector,
      label,
      width: handleRect.width,
      height: handleRect.height,
      left: handleRect.left,
      right: handleRect.right,
      boundary,
      boundaryDelta:
        boundary === null ? null : Math.abs((handleRect.left + handleRect.right) / 2 - boundary),
      headerHeight: headRect?.height ?? null,
      cursor: style.cursor,
      background: style.backgroundColor,
      borderWidth: style.borderWidth,
      before,
      after,
      // A small centered bar (the old 34px/1px grip) is an independent handle
      // ornament. A 1px full-height divider line is allowed.
      ornament: [before, after].some(
        (entry) =>
          entry.visible &&
          (entry.width === null || entry.width > 2.5) &&
          (entry.height === null || entry.height < Math.max(4, handleRect.height - 2)),
      ),
    }
  }, { columnId: id, selector: COLUMN_DIVIDER_SELECTOR(id) })
}

async function columnSync(page) {
  return page.evaluate(() => {
    const row = document.querySelector(".gg-graph-row:not(.gg-uncommitted-row)")
    const rowCell = {
      Graph: row?.querySelector(".gg-row-graph"),
      Description: row?.querySelector(".gg-col-desc"),
      Date: row?.querySelector(".gg-col-date"),
      Author: row?.querySelector(".gg-col-author"),
      Commit: row?.querySelector(".gg-col-commit"),
    }
    return [...document.querySelectorAll(".gg-history-head > .gg-col-head")].map((cell) => {
      const label = cell.textContent.trim()
      const header = cell.getBoundingClientRect().width
      const rowWidth = rowCell[label]?.getBoundingClientRect().width ?? null
      return {
        label,
        header,
        row: rowWidth,
        delta: rowWidth === null ? null : Math.abs(header - rowWidth),
      }
    })
  })
}

async function hoverDecoration(page, selector) {
  const handle = page.locator(selector).first()
  await handle.waitFor({ state: "visible", timeout: 10_000 })
  await handle.hover().catch(() => {})
  await waitRaf(page, 1)
  return page.evaluate((wanted) => {
    const element = document.querySelector(wanted)
    if (!element) return { present: false }
    const rect = element.getBoundingClientRect()
    const pseudo = (side) => {
      const value = getComputedStyle(element, side)
      const width = Number.parseFloat(value.width)
      const height = Number.parseFloat(value.height)
      const opacity = Number.parseFloat(value.opacity)
      return {
        content: value.content,
        display: value.display,
        width: Number.isFinite(width) ? width : null,
        height: Number.isFinite(height) ? height : null,
        opacity: Number.isFinite(opacity) ? opacity : null,
        background: value.backgroundColor,
        borderRadius: value.borderRadius,
        visible:
          value.content !== "none" &&
          value.display !== "none" &&
          (Number.isNaN(opacity) || opacity > 0.05) &&
          ((Number.isFinite(width) && width > 0.5) || (Number.isFinite(height) && height > 0.5)),
      }
    }
    const before = pseudo("::before")
    const after = pseudo("::after")
    const style = getComputedStyle(element)
    return {
      present: true,
      width: rect.width,
      height: rect.height,
      background: style.backgroundColor,
      borderWidth: style.borderWidth,
      cursor: style.cursor,
      before,
      after,
      // A short bar entirely inside the line is a separate small control.
      smallWidgetInside:
        [before, after].some(
          (entry) =>
            entry.visible &&
            entry.width !== null &&
            entry.width > 2.5 &&
            entry.width < Math.max(8, rect.width - 2) &&
            entry.height !== null &&
            entry.height > 1.5,
        ),
    }
  }, selector)
}

async function fullTextState(page, selector, name) {
  return page.evaluate(({ wanted, expected }) => {
    const elements = [...document.querySelectorAll(wanted)]
    const element =
      elements.find((entry) => entry.getAttribute("data-ref-name") === expected) ??
      elements.find((entry) => (entry.textContent ?? "").includes(expected)) ??
      elements[0]
    if (!element) return { present: false }
    const style = getComputedStyle(element)
    const lineHeight = Number.parseFloat(style.lineHeight)
    const text = (element.textContent ?? "").replace(/\s+/g, " ").trim()
    const descendants = [...element.querySelectorAll("*")]
      .filter((child) => (child.textContent ?? "").trim().length > 0)
      .map((child) => {
        const childStyle = getComputedStyle(child)
        return {
          className: child.className,
          textOverflow: childStyle.textOverflow,
          overflowX: childStyle.overflowX,
          scrollWidth: child.scrollWidth,
          clientWidth: child.clientWidth,
          truncated:
            childStyle.textOverflow === "ellipsis" &&
            childStyle.overflowX !== "visible" &&
            child.scrollWidth > child.clientWidth + 1,
        }
      })
    const descendantEllipsis = descendants.some((child) => child.truncated)
    return {
      present: true,
      text,
      title: element.getAttribute("title"),
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
      textOverflow: style.textOverflow,
      whiteSpace: style.whiteSpace,
      overflow: style.overflow,
      overflowY: style.overflowY,
      lineHeight: Number.isFinite(lineHeight) ? lineHeight : null,
      noEllipsis: style.textOverflow !== "ellipsis" && !descendantEllipsis,
      descendantEllipsis,
      horizontallyFits: element.scrollWidth <= element.clientWidth + 1,
      verticallyFits: element.scrollHeight <= element.clientHeight + 1,
      fullyVisible:
        element.scrollWidth <= element.clientWidth + 1 &&
        element.scrollHeight <= element.clientHeight + 1,
      multiline:
        (style.whiteSpace !== "nowrap" && element.clientHeight > (Number.isFinite(lineHeight) ? lineHeight * 1.6 : 0)) ||
        [...element.getClientRects()].length > 1,
      includesName: expected ? text.includes(expected) : true,
    }
  }, { wanted: selector, expected: name })
}

async function refBadgeSnapshot(page) {
  return page.evaluate(() => {
    const badges = [...document.querySelectorAll('[data-testid="ref-badge"]')].map((badge) => {
      const style = getComputedStyle(badge)
      const lineHeight = Number.parseFloat(style.lineHeight)
      return {
        name: badge.getAttribute("data-ref-name") ?? (badge.textContent ?? "").trim(),
        text: (badge.textContent ?? "").replace(/\s+/g, " ").trim(),
        title: badge.getAttribute("title"),
        scrollWidth: badge.scrollWidth,
        clientWidth: badge.clientWidth,
        scrollHeight: badge.scrollHeight,
        clientHeight: badge.clientHeight,
        textOverflow: style.textOverflow,
        whiteSpace: style.whiteSpace,
        noEllipsis: style.textOverflow !== "ellipsis",
        fullyVisible:
          badge.scrollWidth <= badge.clientWidth + 1 &&
          badge.scrollHeight <= badge.clientHeight + 1,
        multiline:
          style.whiteSpace !== "nowrap" &&
          badge.clientHeight > (Number.isFinite(lineHeight) ? lineHeight * 1.6 : 0),
      }
    })
    const more = [...document.querySelectorAll('[data-testid="ref-more"], .gg-ref-more')]
      .map((element) => (element.textContent ?? "").replace(/\s+/g, " ").trim())
      .find((text) => text.length > 0)
    const containers = [...document.querySelectorAll(".gg-ref-badges")].map((container) => {
      const style = getComputedStyle(container)
      return {
        commit: container.closest(".gg-graph-row")?.getAttribute("data-commit") ?? null,
        count: container.querySelectorAll('[data-testid="ref-badge"]').length,
        names: [...container.querySelectorAll('[data-testid="ref-badge"]')].map(
          (badge) => badge.getAttribute("data-ref-name") ?? (badge.textContent ?? "").trim(),
        ),
        scrollWidth: container.scrollWidth,
        clientWidth: container.clientWidth,
        overflowX: style.overflowX,
        horizontalScroll: container.scrollWidth > container.clientWidth + 1,
      }
    })
    return {
      badges,
      more: more ?? null,
      moreCount: more ? 1 : 0,
      containers,
    }
  })
}


async function rowRefsState(page, hash) {
  return page.evaluate((wanted) => {
    const row = [...document.querySelectorAll(".gg-graph-row[data-commit]")].find(
      (candidate) => candidate.getAttribute("data-commit") === wanted,
    )
    if (!row) return { present: false }
    const rowRect = row.getBoundingClientRect()
    const desc = row.querySelector(".gg-col-desc")
    const descRect = desc?.getBoundingClientRect() ?? null
    const container = row.querySelector(".gg-ref-badges")
    const containerRect = container?.getBoundingClientRect() ?? null
    const badges = [...row.querySelectorAll('[data-testid="ref-badge"]')].map((badge) => {
      const style = getComputedStyle(badge)
      const rect = badge.getBoundingClientRect()
      return {
        name: badge.getAttribute("data-ref-name") ?? (badge.textContent ?? "").trim(),
        text: (badge.textContent ?? "").replace(/\s+/g, " ").trim(),
        scrollWidth: badge.scrollWidth,
        clientWidth: badge.clientWidth,
        scrollHeight: badge.scrollHeight,
        clientHeight: badge.clientHeight,
        textOverflow: style.textOverflow,
        whiteSpace: style.whiteSpace,
        noEllipsis: style.textOverflow !== "ellipsis",
        fullyVisible:
          badge.scrollWidth <= badge.clientWidth + 1 &&
          badge.scrollHeight <= badge.clientHeight + 1,
        rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
        insideRow:
          rect.left >= rowRect.left - 1 &&
          rect.right <= rowRect.right + 1 &&
          rect.top >= rowRect.top - 1 &&
          rect.bottom <= rowRect.bottom + 1,
        insideDescription:
          descRect === null ||
          (rect.left >= descRect.left - 1 &&
            rect.right <= descRect.right + 1 &&
            rect.top >= descRect.top - 1 &&
            rect.bottom <= descRect.bottom + 1),
      }
    })
    const containerStyle = container ? getComputedStyle(container) : null
    const more = row.querySelector('[data-testid="ref-more"]')
    return {
      present: true,
      rowHeight: rowRect.height,
      rowTop: Number(row.dataset.rowTop),
      rowBottom: rowRect.bottom,
      rowScrollWidth: row.scrollWidth,
      rowClientWidth: row.clientWidth,
      rowOverflow: row.scrollWidth > row.clientWidth + 1,
      badges,
      container: container
        ? {
            scrollWidth: container.scrollWidth,
            clientWidth: container.clientWidth,
            scrollHeight: container.scrollHeight,
            clientHeight: container.clientHeight,
            overflowX: containerStyle?.overflowX ?? null,
            horizontalScroll: container.scrollWidth > container.clientWidth + 1,
            rect: containerRect
              ? {
                  left: containerRect.left,
                  top: containerRect.top,
                  right: containerRect.right,
                  bottom: containerRect.bottom,
                }
              : null,
          }
        : null,
      more: more ? (more.textContent ?? "").replace(/\s+/g, " ").trim() : null,
    }
  }, hash)
}

function runGit(cwd, args, { allowFailure = false } = {}) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GIT_ASKPASS: "",
        SSH_ASKPASS: "",
        LC_ALL: "C",
      },
    }).trim()
  } catch (error) {
    if (allowFailure) return { ok: false, stdout: String(error?.stdout ?? ""), stderr: String(error?.stderr ?? "") }
    const stderr = typeof error?.stderr === "string" ? error.stderr.trim() : ""
    throw new Error(`git ${args.join(" ")} failed in ${cwd}${stderr ? `: ${stderr}` : ""}`)
  }
}

function runGitAllowFailure(cwd, args) {
  return runGit(cwd, args, { allowFailure: true })
}

function recordRpcRequests(page) {
  const entries = []
  page.on("request", (request) => {
    if (!request.url().includes("/__gg/rpc/")) return
    entries.push({
      method: request.url().split("/__gg/rpc/")[1],
      input: parseInput(request),
      at: Date.now(),
    })
  })
  return entries
}

function countRpcSince(entries, index, method) {
  return entries.slice(index).filter((entry) => entry.method === method).length
}

async function waitRequestQuiet(entries, quietMs = 700, timeout = 7_000) {
  const started = Date.now()
  let lastLength = entries.length
  let lastChange = Date.now()
  while (Date.now() - started < timeout) {
    if (entries.length !== lastLength) {
      lastLength = entries.length
      lastChange = Date.now()
    }
    if (Date.now() - lastChange >= quietMs) return true
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return false
}

function createTempCommit(repoRoot, prefix) {
  const name = `${prefix}-${Date.now().toString(36)}.txt`
  writeFileSync(join(repoRoot, name), `fixture ${Date.now()}\n`)
  runGit(repoRoot, ["add", "--", name])
  runGit(repoRoot, ["commit", "-m", `${prefix} fixture ${Date.now()}`])
  return { name, head: runGit(repoRoot, ["rev-parse", "HEAD"]) }
}

/**
 * The TEMP branch/tag flow needs at least two commit rows and one real file
 * change. Create throwaway commits in TEMP if the fixture is too small, then
 * let the UI load them. TEMP writes are allowed; FR is never touched.
 */
async function ensureTempHistory(tempRepo, minimum = 2) {
  const readLog = async () =>
    (await fetchRpc(TEMP_ORIGIN, "getLog", { repositoryId: tempRepo.id, limit: 20 })).body.result
  let log = await readLog()
  let hasFiles = false
  for (const commit of log.commits.slice(0, 5)) {
    const files = (await fetchRpc(TEMP_ORIGIN, "getCommitFiles", {
      repositoryId: tempRepo.id,
      hash: commit.hash,
      parentIndex: 0,
    })).body.result.files
    if (files.length > 0) {
      hasFiles = true
      break
    }
  }
  const created = []
  let guard = 0
  while ((log.commits.length < minimum || !hasFiles) && guard < 4) {
    created.push(createTempCommit(tempRepo.rootPath, "gg-history-seed"))
    log = await readLog()
    hasFiles = true
    guard += 1
  }
  return { created, hasFiles, commits: log.commits.length }
}

async function repoHasRemoteOnlyHistory(repo) {
  const local = (await fetchRpc(FR_ORIGIN, "getLog", {
    repositoryId: repo.id,
    limit: 50,
    showRemotes: false,
    showTags: true,
  })).body.result.commits.map((commit) => commit.hash)
  const all = (await fetchRpc(FR_ORIGIN, "getLog", {
    repositoryId: repo.id,
    limit: 50,
    showRemotes: true,
    showTags: true,
  })).body.result.commits.map((commit) => commit.hash)
  const localSet = new Set(local)
  return all.some((hash) => !localSet.has(hash))
}

async function findRepoWithRemoteOnlyHistory(repositories, preferred) {
  const ordered = [
    ...(preferred ? [preferred] : []),
    ...repositories.filter((repo) => repo.id !== preferred?.id),
  ]
  for (const repo of ordered) {
    if (repo.type !== "normal" && repo.type !== "worktree") continue
    if (await repoHasRemoteOnlyHistory(repo)) return repo
  }
  return null
}

async function findRepoWithRefKind(repositories, kind, preferred) {
  const ordered = [
    ...(preferred ? [preferred] : []),
    ...repositories.filter((repo) => repo.id !== preferred?.id),
  ]
  for (const repo of ordered) {
    if (repo.type !== "normal" && repo.type !== "worktree") continue
    const refs = (await fetchRpc(FR_ORIGIN, "getRefs", { repositoryId: repo.id })).body.result.refs
    const ref = refs.find((candidate) => candidate.kind === kind)
    if (ref) return { repo, ref, refs }
  }
  return null
}

/**
 * Fallback for environments where no FR repository has a remote-only commit in
 * the first page. Build a real remote-tracking ref in the isolated TEMP fixture,
 * then verify the same showRemotes behavior through the real UI.
 */
async function runShowRemotesTempFallback(browser) {
  const repositories = (await fetchRpc(TEMP_ORIGIN, "listRepositories", {})).body.result.repositories
  let chosen = null
  let status = null
  for (const repo of repositories) {
    const next = (await fetchRpc(TEMP_ORIGIN, "getStatus", { repositoryId: repo.id })).body.result
    if (
      next.counts.staged === 0 &&
      next.counts.unstaged === 0 &&
      next.counts.untracked === 0 &&
      next.counts.conflicted === 0
    ) {
      chosen = repo
      status = next
      break
    }
  }
  if (!chosen || !status) return null
  const root = chosen.rootPath
  const baseBranch = status.branch
  const baseHead = status.head
  const branch = `gg-show-remotes-${Date.now().toString(36)}`
  const remoteRef = "refs/remotes/origin/gg-show-remotes"
  let created = null
  let context = null
  try {
    runGit(root, ["checkout", "-b", branch])
    created = createTempCommit(root, "gg-show-remotes")
    runGit(root, ["update-ref", remoteRef, created.head])
    runGit(root, ["checkout", baseBranch])
    runGit(root, ["branch", "-D", branch])
    context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "en-US" })
    const page = await context.newPage()
    await page.goto(TEMP_BASE, { waitUntil: "domcontentloaded" })
    await page.waitForFunction(
      () => document.querySelectorAll('[data-testid="repository-select"] option').length >= 1,
      null,
      { timeout: 30_000 },
    )
    await page.locator(SELECTORS.repository[0]).selectOption(chosen.id)
    await waitRows(page, 1)
    await waitNotBusy(page)
    const before = await visibleRowHashes(page)
    const input = await triggerHistoryRequest(page, (value) => value.showRemotes === false, async () => {
      await page.locator(SELECTORS.showRemotes[0]).click()
    })
    const after = await visibleRowHashes(page)
    await triggerHistoryRequest(page, (value) => value.showRemotes !== false, async () => {
      await page.locator(SELECTORS.showRemotes[0]).click()
    })
    return {
      source: "TEMP",
      input,
      before,
      after,
      changed: before.join(",") !== after.join(","),
      remoteRef,
      commit: created.head,
    }
  } finally {
    await context?.close().catch(() => {})
    runGitAllowFailure(root, ["update-ref", "-d", remoteRef])
    runGitAllowFailure(root, ["checkout", baseBranch])
    runGitAllowFailure(root, ["reset", "--hard", baseHead])
    runGitAllowFailure(root, ["branch", "-D", branch])
    if (created) {
      try {
        unlinkSync(join(root, created.name))
      } catch {
        /* best-effort TEMP cleanup */
      }
    }
  }
}

async function waitForVisibleCommit(page, hash, timeout = 10_000) {
  await page.waitForFunction(
    (wanted) =>
      [...document.querySelectorAll(".gg-graph-row[data-commit]")].some(
        (row) => row.getAttribute("data-commit") === wanted,
      ),
    hash,
    { timeout },
  )
}

async function waitForCurrentBranch(page, branch, timeout = 10_000) {
  await page.waitForFunction(
    (wanted) =>
      (document.querySelector('[data-testid="current-branch"]')?.textContent ?? "").includes(wanted),
    branch,
    { timeout },
  )
}

async function waitForRemoteBadge(page, refName, commitHash, timeout = 10_000) {
  await page.waitForFunction(
    ({ wanted, hash }) => {
      const row = document.querySelector(`.gg-graph-row[data-commit="${hash}"]`)
      if (!row) return false
      return [...row.querySelectorAll('[data-testid="ref-badge"]')].some(
        (badge) => badge.getAttribute("data-ref-name") === wanted,
      )
    },
    { wanted: refName, hash: commitHash },
    { timeout },
  )
}

async function remountPanel(page) {
  await page.evaluate(() => {
    window.__ggOldPanel = document.querySelector(".git-graph-panel")
  })
  await page.locator(SELECTORS.remountPanel[0]).click()
  await page.waitForFunction(
    () => {
      const panel = document.querySelector(".git-graph-panel")
      return Boolean(panel && panel !== window.__ggOldPanel)
    },
    null,
    { timeout: 10_000 },
  )
}

async function panelPaintState(page) {
  return page.evaluate(() => {
    const panel = document.querySelector(".git-graph-panel")
    const scroller = document.querySelector('[data-testid="history-scroll"]')
    const expanded = document.querySelector(".gg-graph-row.gg-expanded")
    const text = panel?.innerText ?? ""
    return {
      present: Boolean(panel),
      rows: document.querySelectorAll(".gg-graph-row:not(.gg-uncommitted-row)").length,
      scrollTop: scroller?.scrollTop ?? null,
      expandedHash: expanded?.getAttribute("data-commit") ?? null,
      slotPresent: Boolean(document.querySelector('[data-testid="inline-slot"]')),
      loadingSkeleton:
        /Loading repositories|Loading history|Loading refs|Loading commits/i.test(text) ||
        Boolean(panel?.querySelector(".gg-skeleton, [data-testid=\"repository-skeleton\"]")),
      branch: (document.querySelector('[data-testid="current-branch"]')?.textContent ?? "").trim(),
    }
  })
}


function localFileUrl(path) {
  return `file:///${path.replace(/\\/g, "/").replace(/^\/+/, "")}`
}

/**
 * Create a private bare remote under the approved TEMP tree and point the TEMP
 * fixture at it. The remote starts with one branch pointing at the current HEAD
 * so a successful fetch must update at least one remote-tracking ref.
 */
function setupFetchRemote(tempRepo, tempStatus) {
  const remoteName = `gg-release-${Date.now().toString(36)}`
  const remoteDir = join(TEMP_ROOT, "gg-ui-release-remote", `${remoteName}.git`)
  mkdirSync(remoteDir, { recursive: true })
  runGit(remoteDir, ["init", "--bare"])
  const head = tempStatus.head
  if (!head) throw new Error("TEMP fixture has no HEAD for the fetch remote")
  const previousFileProtocol = runGitAllowFailure(tempRepo.rootPath, ["config", "--get", "protocol.file.allow"])
  runGit(tempRepo.rootPath, ["config", "protocol.file.allow", "always"])
  // A fresh bare repository has no objects, so a ref cannot be created with
  // update-ref. Push the fixture HEAD so the remote owns the commit and the
  // subsequent fetch has a real object to advertise.
  runGit(tempRepo.rootPath, ["push", "--force", localFileUrl(remoteDir), `${head}:refs/heads/fetch-target`])
  runGit(tempRepo.rootPath, ["remote", "add", remoteName, localFileUrl(remoteDir)])
  // The GUI lists remotes from loaded refs, so seed one remote-tracking ref on
  // an older commit. The fetch then visibly advances it to the remote HEAD.
  const previousHead = runGitAllowFailure(tempRepo.rootPath, ["rev-parse", `${head}~1`])
  if (previousHead) {
    runGit(tempRepo.rootPath, ["update-ref", `refs/remotes/${remoteName}/fetch-target`, previousHead])
  }
  return {
    remoteName,
    remoteDir,
    head,
    cleanup() {
      runGitAllowFailure(tempRepo.rootPath, ["remote", "remove", remoteName])
      if (typeof previousFileProtocol === "string" && previousFileProtocol.length > 0) {
        runGitAllowFailure(tempRepo.rootPath, ["config", "protocol.file.allow", previousFileProtocol])
      } else {
        runGitAllowFailure(tempRepo.rootPath, ["config", "--unset", "protocol.file.allow"])
      }
      try {
        rmSync(remoteDir, { recursive: true, force: true })
      } catch {
        /* best-effort TEMP cleanup */
      }
    },
  }
}

async function slotSnapshot(page) {
  return page.evaluate(() => {
    const q = (selector, root = document) => root.querySelector(selector)
    const scroller = q('[data-testid="history-scroll"]')
    const slot = q('[data-testid="inline-slot"]')
    const handle = q('[data-testid="slot-resize-handle"]')
    const spacer = q(".gg-history-spacer")
    const expanded = q(".gg-graph-row.gg-expanded")
    const rect = (element) => {
      if (!element) return null
      const r = element.getBoundingClientRect()
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }
    }
    const visible = [...document.querySelectorAll(".gg-graph-row:not(.gg-uncommitted-row)")].map((row) => row.dataset.commit)
    return {
      slotPresent: Boolean(slot),
      slot: rect(slot),
      handle: rect(handle),
      handleCount: document.querySelectorAll('[data-testid="slot-resize-handle"]').length,
      slotHeight:
        slot ? slot.getBoundingClientRect().height : null,
      slotStyleHeight: slot ? Number.parseFloat(slot.style.height) : null,
      spacerSlotHeight: spacer ? Number(spacer.dataset.slotHeight ?? NaN) : null,
      expandedIndex: expanded ? Number(expanded.dataset.index) : null,
      expandedHash: expanded ? expanded.dataset.commit : null,
      scrollTop: scroller ? scroller.scrollTop : null,
      scrollHeight: scroller ? scroller.scrollHeight : null,
      clientHeight: scroller ? scroller.clientHeight : null,
      distanceToBottom: scroller
        ? scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop
        : null,
      visibleHashes: visible,
    }
  })
}

async function uncommittedSlotSnapshot(page) {
  return page.evaluate(() => {
    const q = (selector, root = document) => root.querySelector(selector)
    const scroller = q('[data-testid="history-scroll"]')
    const row = q('[data-testid="uncommitted-row"], .gg-uncommitted-row')
    const slot = q('[data-testid="uncommitted-slot"]')
    const handle = slot ? slot.querySelector('[data-testid="slot-resize-handle"]') : null
    const spacer = q(".gg-history-spacer")
    const rect = (element) => {
      if (!element) return null
      const r = element.getBoundingClientRect()
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }
    }
    return {
      rowPresent: Boolean(row),
      row: rect(row),
      slotPresent: Boolean(slot),
      slot: rect(slot),
      slotHeight: slot ? slot.getBoundingClientRect().height : null,
      slotStyleHeight: slot ? Number.parseFloat(slot.style.height) : null,
      handle: rect(handle),
      handleCount: slot ? slot.querySelectorAll('[data-testid="slot-resize-handle"]').length : 0,
      spacerLeadingSlotHeight: spacer ? Number(spacer.dataset.leadingSlotHeight ?? NaN) : null,
      expanded: row?.getAttribute("aria-expanded") === "true",
      scrollTop: scroller ? scroller.scrollTop : null,
      scrollHeight: scroller ? scroller.scrollHeight : null,
      clientHeight: scroller ? scroller.clientHeight : null,
      distanceToBottom: scroller
        ? scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop
        : null,
    }
  })
}

async function dragUncommittedSlotHandle(page, deltaY) {
  const selector = '[data-testid="uncommitted-slot"] [data-testid="slot-resize-handle"]'
  const handle = page.locator(selector).first()
  await handle.waitFor({ state: "visible", timeout: 10_000 })
  const box = await handle.boundingBox()
  if (!box) throw new Error("uncommitted slot resize handle has no box")
  const before = await uncommittedSlotSnapshot(page)
  const viewport = page.viewportSize() ?? { width: 1280, height: 900 }
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  const targetY = Math.max(2, Math.min(viewport.height - 2, y + deltaY))
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x, targetY, { steps: 10 })
  await page.mouse.up()
  await page.waitForFunction(
    (previous) => {
      const slot = document.querySelector('[data-testid="uncommitted-slot"]')
      return Boolean(slot && Math.abs(slot.getBoundingClientRect().height - previous) > 0.5)
    },
    before.slotHeight,
    { timeout: 10_000 },
  ).catch(() => {})
  await waitRaf(page, 3)
  const after = await uncommittedSlotSnapshot(page)
  return { before, after, deltaY: targetY - y }
}

async function waitSlotHeightSettled(page, previousHeight) {
  await page.waitForFunction(
    (height) => {
      const slot = document.querySelector('[data-testid="inline-slot"]')
      const spacer = document.querySelector(".gg-history-spacer")
      if (!slot || !spacer) return false
      const current = slot.getBoundingClientRect().height
      return Math.abs(current - height) > 0.5 || Number(spacer.dataset.slotHeight) === current
    },
    previousHeight,
    { timeout: 10_000 },
  ).catch(() => {})
  await waitRaf(page, 3)
}

async function dragSlotHandle(page, deltaY) {
  const handle = page.locator(SLOT_HANDLE_SELECTOR).first()
  await handle.waitFor({ state: "visible", timeout: 10_000 })
  const box = await handle.boundingBox()
  if (!box) throw new Error("slot resize handle has no box")
  const before = await slotSnapshot(page)
  const viewport = page.viewportSize() ?? { width: 1280, height: 900 }
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  const targetY = Math.max(2, Math.min(viewport.height - 2, y + deltaY))
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x, targetY, { steps: 10 })
  await page.mouse.up()
  await waitSlotHeightSettled(page, before.slotHeight)
  const after = await slotSnapshot(page)
  return { before, after, deltaY: targetY - y }
}

async function inlineLayoutSnapshot(page) {
  return page.evaluate((dividerSelectors) => {
    const root = document.querySelector('[data-testid="inline-slot"]')
    const body = root?.querySelector(".gg-row-slot-body")
    const info = root?.querySelector('[data-testid="inline-info"]')
    const files = root?.querySelector(".gg-row-slot-files")
    const controls = root?.querySelector(".gg-inline-view-controls")
    const divider = dividerSelectors
      .map((selector) => document.querySelector(selector))
      .find(Boolean)
    const rect = (element) => {
      if (!element) return null
      const r = element.getBoundingClientRect()
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }
    }
    const box = {
      root: rect(root),
      body: rect(body),
      info: rect(info),
      files: rect(files),
      controls: rect(controls),
      divider: rect(divider),
    }
    const ratio =
      box.info && box.files && box.info.width + box.files.width > 0
        ? box.info.width / (box.info.width + box.files.width)
        : null
    const infoStyle = info ? getComputedStyle(info) : null
    const text = info
      ? [...info.querySelectorAll(".gg-inline-info-subject, .gg-inline-info-value")].map(
          (element) => {
            const style = getComputedStyle(element)
            const lineHeight = Number.parseFloat(style.lineHeight)
            return {
              className: element.className,
              text: (element.textContent ?? "").replace(/\s+/g, " ").trim(),
              title: element.getAttribute("title"),
              scrollWidth: element.scrollWidth,
              clientWidth: element.clientWidth,
              scrollHeight: element.scrollHeight,
              clientHeight: element.clientHeight,
              textOverflow: style.textOverflow,
              whiteSpace: style.whiteSpace,
              lineHeight: Number.isFinite(lineHeight) ? lineHeight : null,
              noEllipsis: style.textOverflow !== "ellipsis",
              lines: Number.isFinite(lineHeight) && lineHeight > 0
                ? Math.round(element.clientHeight / lineHeight)
                : null,
              fullyVisible:
                element.scrollWidth <= element.clientWidth + 1 &&
                element.scrollHeight <= element.clientHeight + 1,
            }
          },
        )
      : []
    const dateRow = info
      ? [...info.querySelectorAll(".gg-inline-info-row")].find(
          (row) => row.querySelector(".gg-inline-info-label")?.textContent?.trim() === "Date",
        )
      : null
    const dateValue = dateRow?.querySelector(".gg-inline-info-value")
    return {
      slotPresent: Boolean(root),
      dividerPresent: Boolean(divider),
      dividerSelector:
        dividerSelectors.find((selector) => document.querySelector(selector)) ?? null,
      dividerWidth: box.divider?.width ?? null,
      dividerHeight: box.divider?.height ?? null,
      dividerAriaNow:
        divider?.getAttribute("aria-valuenow") === null ||
        divider?.getAttribute("aria-valuenow") === undefined
          ? null
          : Number(divider.getAttribute("aria-valuenow")),
      dividerAriaMin:
        divider?.getAttribute("aria-valuemin") === null ||
        divider?.getAttribute("aria-valuemin") === undefined
          ? null
          : Number(divider.getAttribute("aria-valuemin")),
      dividerAriaMax:
        divider?.getAttribute("aria-valuemax") === null ||
        divider?.getAttribute("aria-valuemax") === undefined
          ? null
          : Number(divider.getAttribute("aria-valuemax")),
      box,
      ratio,
      infoStyle: infoStyle
        ? {
            width: infoStyle.width,
            minWidth: infoStyle.minWidth,
            maxWidth: infoStyle.maxWidth,
            flex: infoStyle.flex,
            overflowX: infoStyle.overflowX,
            overflowY: infoStyle.overflowY,
            whiteSpace: infoStyle.whiteSpace,
          }
        : null,
      infoScroll: info
        ? {
            scrollWidth: info.scrollWidth,
            clientWidth: info.clientWidth,
            scrollHeight: info.scrollHeight,
            clientHeight: info.clientHeight,
          }
        : null,
      text,
      date: dateValue
        ? {
            text: (dateValue.textContent ?? "").replace(/\s+/g, " ").trim(),
            title:
              dateValue.getAttribute("title") ??
              dateRow?.getAttribute("title") ??
              null,
            rowTitle: dateRow?.getAttribute("title") ?? null,
          }
        : null,
    }
  }, INLINE_INFO_DIVIDER_SELECTORS)
}

async function dragInlineDivider(page, deltaX) {
  const divider = await anyLocator(page, SELECTORS.inlineInfoDivider)
  if (!divider) throw new Error("inline info/files divider is missing")
  const box = await divider.boundingBox()
  if (!box) throw new Error("inline info/files divider has no box")
  const before = await inlineLayoutSnapshot(page)
  const viewport = page.viewportSize() ?? { width: 1280, height: 900 }
  const x = Math.max(2, Math.min(viewport.width - 2, box.x + box.width / 2))
  const y = box.y + box.height / 2
  const targetX = Math.max(2, Math.min(viewport.width - 2, x + deltaX))
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(targetX, y, { steps: 10 })
  await page.mouse.up()
  await waitRaf(page, 3)
  const after = await inlineLayoutSnapshot(page)
  return { before, after, deltaX: targetX - x }
}


async function uncommittedSnapshot(page) {
  return page.evaluate(() => {
    const row = document.querySelector(
      '[data-testid="uncommitted-row"], [data-testid="uncommitted-changes"], .gg-uncommitted-row',
    )
    if (!row) return { present: false }
    const body = row.querySelector(
      '[data-testid="uncommitted-slot"], [data-testid="uncommitted-body"], [data-testid="uncommitted-groups"], [data-testid="uncommitted-files"], .gg-uncommitted-body',
    )
    const buttons = body ? [...body.querySelectorAll("button")] : []
    const countText = [...row.querySelectorAll(
      '[data-testid="uncommitted-total"], [data-testid="uncommitted-counts"], [data-testid="uncommitted-count"], [data-testid^="uncommitted-count-"]',
    )]
      .map((element) => element.textContent.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .join(" ")
    const countsByKind = Object.fromEntries(
      [...row.querySelectorAll('[data-testid^="uncommitted-count-"]')].map((element) => [
        element.getAttribute("data-testid").replace("uncommitted-count-", ""),
        Number(element.getAttribute("data-count") ?? element.textContent.trim()),
      ]),
    )
    return {
      present: true,
      text: row.textContent.replace(/\s+/g, " ").trim(),
      expanded: row.getAttribute("aria-expanded") === "true",
      isCommitRow: row.hasAttribute("data-commit") || row.hasAttribute("data-index"),
      commitIndexCount: document.querySelectorAll(".gg-graph-row[data-index]").length,
      counts: countText || null,
      countsByKind,
      groups: buttons.map((button) => button.textContent.replace(/\s+/g, " ").trim()),
      files: body ? [...body.querySelectorAll(".gg-file-row")].map((file) => file.textContent.replace(/\s+/g, " ").trim()) : [],
      fileCount: body ? body.querySelectorAll(".gg-file-row").length : 0,
      hasLegacyChanges: Boolean(
        document.querySelector('[data-testid="changes"], .gg-changes-section'),
      ),
    }
  })
}

function uncommittedGroupButton(page, label) {
  return page
    .locator(
      '[data-testid="uncommitted-slot"] button, [data-testid="uncommitted-files"] button, [data-testid="uncommitted-body"] button, [data-testid="uncommitted-groups"] button, .gg-uncommitted-body button',
    )
    .filter({ hasText: new RegExp(`(?:^|[\\s\\u25BE\\u25B8])${label}(?:\\s|\\d|$)`, "i") })
    .first()
}

async function openUncommitted(page) {
  const row = page.locator(UNCOMMITTED_ROW_SELECTOR).first()
  await row.waitFor({ state: "visible", timeout: 15_000 })
  if ((await row.getAttribute("aria-expanded")) !== "true") {
    await row.click()
    await waitRaf(page, 2)
  }
  return row
}

async function prepareDirtyTempFixture(tempRepo) {
  const root = tempRepo.rootPath
  const initialStatus = runGit(root, ["status", "--porcelain"])
  if (initialStatus !== "") {
    return { ok: false, reason: "TEMP fixture is not clean before uncommitted setup", initialStatus }
  }
  const branch = runGit(root, ["rev-parse", "--abbrev-ref", "HEAD"])
  const baseHead = runGit(root, ["rev-parse", "HEAD"])
  const tracked = runGit(root, ["ls-files"]).split(/\r?\n/).filter(Boolean)
  if (tracked.length < 2) return { ok: false, reason: "TEMP fixture needs two tracked files for index/worktree diff coverage" }
  const stagedPath = tracked[0]
  const unstagedPath = tracked[1]
  const readmePath = tracked.find((path) => /readme\.md$/i.test(path)) ?? stagedPath
  const original = new Map()
  for (const path of new Set([stagedPath, unstagedPath, readmePath])) {
    original.set(path, readFileSync(join(root, path)))
  }
  const untrackedName = `gg-release-untracked-${Date.now().toString(36)}.txt`
  const conflictName = `gg-release-conflict-${Date.now().toString(36)}.txt`
  const conflictBranch = `gg-release-conflict-branch-${Date.now().toString(36)}`
  const cleanup = () => {
    runGitAllowFailure(root, ["merge", "--abort"])
    runGitAllowFailure(root, ["checkout", "-f", branch])
    runGitAllowFailure(root, ["reset", "--hard", baseHead])
    runGitAllowFailure(root, ["branch", "-D", conflictBranch])
    try {
      unlinkSync(join(root, untrackedName))
    } catch {
      /* already gone */
    }
    try {
      unlinkSync(join(root, conflictName))
    } catch {
      /* already gone */
    }
    for (const [path, bytes] of original) {
      try {
        writeFileSync(join(root, path), bytes)
      } catch {
        /* best-effort TEMP cleanup */
      }
    }
  }
  try {
    // Real conflicted state: commit the same path on two branches and merge.
    runGit(root, ["checkout", "-b", conflictBranch])
    writeFileSync(join(root, conflictName), "conflict branch\n")
    runGit(root, ["add", "--", conflictName])
    runGit(root, ["commit", "-m", "release conflict branch fixture"])
    runGit(root, ["checkout", branch])
    writeFileSync(join(root, conflictName), "base branch\n")
    runGit(root, ["add", "--", conflictName])
    runGit(root, ["commit", "-m", "release conflict base fixture"])
    runGitAllowFailure(root, ["merge", "--no-edit", conflictBranch])

    // Staged + unstaged + untracked after the conflicted merge state exists.
    writeFileSync(join(root, stagedPath), `${readFileSync(join(root, stagedPath), "utf8")}\nrelease staged fixture\n`)
    runGit(root, ["add", "--", stagedPath])
    writeFileSync(join(root, unstagedPath), `${readFileSync(join(root, unstagedPath), "utf8")}\nrelease unstaged fixture\n`)
    writeFileSync(join(root, untrackedName), "release untracked fixture\n")

    return { ok: true, cleanup, stagedPath, unstagedPath, untrackedName, conflictName, conflictBranch, baseHead }
  } catch (error) {
    cleanup()
    return { ok: false, reason: String(error), cleanup }
  }
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
    () => document.querySelectorAll('[data-testid="repository-select"] option').length >= 1,
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
      (row) => row.top < viewportBottom && row.top + (row.height ?? after.rowHeight ?? 28) > viewportTop,
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
      visibleRows.length > 0 &&
        visibleRows[0].top <= viewportTop + 2 &&
        last.top + (last.height ?? after.rowHeight ?? 28) >= viewportBottom - 4,
      { visibleFirst: visibleRows[0] ?? null, visibleLast: last ?? null, viewportTop, viewportBottom },
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
        if (pair.baseIndex !== before.spacer.expandedIndex) {
          await scrollToRowIndex(page, pair.baseIndex)
          await page.locator(`.gg-graph-row[data-index="${pair.baseIndex}"]`).locator(".gg-subject").click()
          await waitForAny(page, SELECTORS.inlineSlot)
        }
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
        const pairState = await page.evaluate(() => ({
          page: Boolean(document.querySelector('[data-testid="comparison-page"]')),
          files: document.querySelectorAll('[data-testid="comparison-file"]').length,
          diff: Boolean(document.querySelector('[data-testid="comparison-diff"]')),
          lines: document.querySelectorAll(".gg-commit-diff-line").length,
          warning: Boolean(document.querySelector(".gg-commit-diff-warning")),
        }))
        const pairRequests = compareRequests.filter(
          (entry) => entry.input?.baseHash === pair.baseHash && entry.input?.headHash === pair.headHash,
        )
        checkResult(
          checks,
          "API-confirmed differing visible pair opens real comparison files and diff",
          pairState.page && pairState.files > 0 && pairState.diff && (pairState.lines > 0 || pairState.warning) && pairRequests.length > 0,
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

async function graphDragScenario(browser, frPrimary, checks, metrics) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "en-US" })
  const page = await context.newPage()
  await page.goto(FR_BASE, { waitUntil: "domcontentloaded" })
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid="repository-select"] option').length >= 1,
    null,
    { timeout: 30_000 },
  )
  await page.locator(SELECTORS.repository[0]).selectOption(frPrimary.id)
  await waitRows(page, 1)
  await page.locator('[data-testid="harness-width-1100"]').click()
  await page.waitForFunction(
    () => document.querySelector('[data-testid="harness-panel-shell"]')?.dataset.panelWidth === "1100",
    null,
    { timeout: 15_000 },
  )
  await waitRaf(page, 2)
  const initial = await layoutSnapshot(page)
  const headers = await page.evaluate(() => {
    const cells = [...document.querySelectorAll(".gg-history-head > .gg-col-head")]
    return cells.map((cell) => {
      const style = getComputedStyle(cell)
      const after = getComputedStyle(cell, "::after")
      const before = getComputedStyle(cell, "::before")
      const hasBorder = (styleObject, side) =>
        styleObject[`border${side}Style`] !== "none" &&
        styleObject[`border${side}Width`] !== "0px" &&
        styleObject[`border${side}Color`] !== "transparent" &&
        styleObject[`border${side}Color`] !== "rgba(0, 0, 0, 0)"
      const pseudo = (styleObject) => {
        if (styleObject.content === "none" || styleObject.display === "none") return false
        const width = Number.parseFloat(styleObject.width)
        return (
          (Number.isFinite(width) && width > 0) ||
          hasBorder(styleObject, "Right") ||
          hasBorder(styleObject, "Left")
        )
      }
      return {
        text: cell.textContent.trim(),
        borderRight: hasBorder(style, "Right"),
        borderLeft: hasBorder(style, "Left"),
        borderRightWidth: style.borderRightWidth,
        borderLeftWidth: style.borderLeftWidth,
        boxShadow: style.boxShadow,
        afterContent: after.content,
        afterWidth: after.width,
        beforeContent: before.content,
        beforeWidth: before.width,
        afterVisible: pseudo(after),
        beforeVisible: pseudo(before),
      }
    })
  })
  const titleCase = headers.every((header) => /^[A-Z][a-z]+$/.test(header.text))
  const expectedHeaders = ["Graph", "Description", "Date", "Author", "Commit"]
  const headerLabelsOk =
    headers.length === expectedHeaders.length &&
    expectedHeaders.every((label, index) => headers[index]?.text === label)
  const alwaysVisibleDividers = headers
    .slice(0, -1)
    .every((header, index) => {
      const next = headers[index + 1]
      return (
        header.borderRight ||
        header.afterVisible ||
        next.borderLeft ||
        next.beforeVisible ||
        (header.boxShadow && header.boxShadow !== "none") ||
        (next.boxShadow && next.boxShadow !== "none")
      )
    })
  metrics.graphDrag = { initial, headers, titleCase, headerLabelsOk, alwaysVisibleDividers }
  checkResult(checks, "header labels use title case", titleCase, headers.map((header) => header.text))
  checkResult(checks, "header labels are Graph/Description/Date/Author/Commit", headerLabelsOk, headers.map((header) => header.text))
  checkResult(checks, "header column dividers are visible without hover", alwaysVisibleDividers, headers)
  checkResult(checks, "graph starts at 240px with a resize handle", initial.graph.handleCount >= 1 && Math.abs(initial.graph.headerWidth - 240) <= 1, initial.graph)
  const graphDivider = await columnDividerGeometry(page, "graph")
  const graphDecoration = await hoverDecoration(page, COLUMN_DIVIDER_SELECTOR("graph"))
  metrics.graphDrag.divider = { graphDivider, graphDecoration }
  checkResult(
    checks,
    "graph divider is the ~5px header hit area with no separate handle ornament",
    graphDivider.present &&
      graphDivider.width >= COLUMN_DIVIDER_MIN_WIDTH &&
      graphDivider.width <= COLUMN_DIVIDER_MAX_WIDTH &&
      graphDivider.boundaryDelta !== null &&
      graphDivider.boundaryDelta <= 4 &&
      graphDivider.cursor === "col-resize" &&
      !graphDivider.ornament &&
      !graphDecoration.smallWidgetInside,
    { graphDivider, graphDecoration },
  )
  const initialLanes = await graphLaneSnapshot(page)
  metrics.graphDrag.initialLanes = initialLanes
  checkResult(
    checks,
    "graph crop never renders the dense-graph hint",
    !initialLanes.denseVisible && (await page.locator('[data-testid="dense-graph"]').count()) === 0,
    { denseVisible: initialLanes.denseVisible },
  )
  checkResult(
    checks,
    "narrow graph keeps fixed 14px lane spacing (15,29,43...) and content width lanes*14+16",
    initialLanes.svgCount > 0 &&
      initialLanes.formulaOk &&
      initialLanes.laneAligned &&
      initialLanes.spacingAligned &&
      initialLanes.xs[0] === 15,
    initialLanes,
  )
  const expanded = await dragColumn(page, "graph", 80)
  const afterExpand = await layoutSnapshot(page)
  const laneMax = await page.evaluate(() => {
    let max = 0
    for (const row of document.querySelectorAll(".gg-graph-row:not(.gg-uncommitted-row)")) {
      const cell = row.querySelector(".gg-row-graph")
      const svg = row.querySelector(".gg-graph-svg")
      if (!cell || !svg) continue
      const cellRect = cell.getBoundingClientRect()
      for (const shape of svg.querySelectorAll("path, circle, rect")) {
        const rect = shape.getBoundingClientRect()
        max = Math.max(max, rect.right - cellRect.left)
      }
    }
    return max
  })
  const legacyHScroll = await page.locator(".gg-graph-hscroll").count()
  const graphScrollbar = await page.locator('[data-testid="graph-scroll"]').count()
  const expandedLanes = await graphLaneSnapshot(page)
  metrics.graphDrag.expanded = { ...afterExpand, laneMax, legacyHScroll, graphScrollbar, lanes: expandedLanes }
  checkResult(checks, "graph pointer drag widens the graph to about 320px", expanded.after >= 300 && expanded.after <= 340, expanded)
  checkResult(checks, "graph has no graph-scroll or legacy horizontal scrollbar after resize", graphScrollbar === 0 && legacyHScroll === 0, { graphScrollbar, legacyHScroll })
  checkResult(checks, "graph viewport has no internal horizontal scroll", afterExpand.graph.scrollWidth <= afterExpand.graph.clientWidth + 1, afterExpand.graph)
  checkResult(
    checks,
    "resized graph keeps fixed 14px lane spacing and content may exceed the column",
    expandedLanes.formulaOk &&
      expandedLanes.laneAligned &&
      expandedLanes.spacingAligned &&
      expandedLanes.xs[0] === 15 &&
      expandedLanes.scrollWidth <= expandedLanes.clientWidth + 1,
    expandedLanes,
  )
  const expandedClipped = expandedLanes.contentWidth > expandedLanes.cellWidth
  checkResult(
    checks,
    "graph dragged wide enough exposes every lane without clipping or a scrollbar",
    expandedLanes.contentWidth > 0 &&
      !expandedClipped &&
      expandedLanes.maxShapeRight <= expandedLanes.cellWidth + 1 &&
      !expandedLanes.denseVisible &&
      expandedLanes.scrollWidth <= expandedLanes.clientWidth + 1,
    { expandedClipped, expandedLanes },
  )
  checkResult(checks, "resizing graph does not overflow the panel or other columns", afterExpand.panelOverflowX <= 1 && afterExpand.historyHeadOverflow <= 1 && afterExpand.rowOverflow <= 1 && afterExpand.doc.scrollWidth <= afterExpand.doc.clientWidth && afterExpand.body.scrollWidth <= afterExpand.body.clientWidth, { panelOverflowX: afterExpand.panelOverflowX, historyHeadOverflow: afterExpand.historyHeadOverflow, rowOverflow: afterExpand.rowOverflow, doc: afterExpand.doc, body: afterExpand.body, grids: afterExpand.grids })
  const graphSync = await columnSync(page)
  checkResult(
    checks,
    "resized graph header and row widths stay in sync",
    graphSync.length >= 2 && graphSync.every((entry) => entry.row !== null && entry.delta <= 1),
    graphSync,
  )
  await screenshot(page, "17-fr-graph-drag.png", { fullPage: true })
  const narrowTarget = 120
  const narrowed = await dragColumn(page, "graph", narrowTarget - expanded.after)
  const afterNarrow = await layoutSnapshot(page)
  const narrowLanes = await graphLaneSnapshot(page)
  metrics.graphDrag.narrow = { ...afterNarrow, lanes: narrowLanes }
  const graphCellBox = await page.locator(".gg-graph-row .gg-row-graph").first().boundingBox().catch(() => null)
  if (graphCellBox) {
    await page.mouse.move(
      graphCellBox.x + graphCellBox.width / 2,
      graphCellBox.y + graphCellBox.height / 2,
    )
    await page.mouse.wheel(60, 0)
    await waitRaf(page, 2)
  }
  const scrollSemantics = await page.evaluate(() => {
    const cell = document.querySelector(".gg-graph-row .gg-row-graph")
    const row = cell?.closest(".gg-graph-row:not(.gg-uncommitted-row)")
    const inner = cell?.querySelector(".gg-row-graph-inner")
    const history = document.querySelector('[data-testid="history-scroll"]')
    const doc = document.scrollingElement
    const before = {
      cell: cell?.scrollLeft ?? null,
      row: row?.scrollLeft ?? null,
      inner: inner?.scrollLeft ?? null,
      history: history?.scrollLeft ?? null,
      doc: doc?.scrollLeft ?? null,
    }
    if (history) history.scrollLeft = 50
    if (doc) doc.scrollLeft = 50
    const afterSet = {
      history: history?.scrollLeft ?? null,
      doc: doc?.scrollLeft ?? null,
    }
    if (history) history.scrollLeft = before.history ?? 0
    if (doc) doc.scrollLeft = before.doc ?? 0
    let cellProgrammatic = null
    if (cell) {
      cell.scrollLeft = 50
      cellProgrammatic = cell.scrollLeft
      cell.scrollLeft = before.cell ?? 0
    }
    const overflow = (element) =>
      element ? getComputedStyle(element).overflowX : null
    const scrollable = (element) =>
      Boolean(
        element &&
          /(auto|scroll)/.test(overflow(element)) &&
          element.scrollWidth > element.clientWidth + 1,
      )
    return {
      overflowX: {
        cell: overflow(cell),
        row: overflow(row),
        inner: overflow(inner),
        history: overflow(history),
      },
      before,
      afterSet,
      cellProgrammatic,
      cellScrollLeftAfterWheel: before.cell,
      visibleScrollableAncestor:
        scrollable(cell) || scrollable(row) || scrollable(inner) || scrollable(history),
    }
  })
  metrics.graphDrag.narrowScroll = scrollSemantics
  checkResult(
    checks,
    "graph narrowed below content width keeps fixed 14px lane spacing",
    narrowed.after >= 96 &&
      narrowed.after <= 140 &&
      narrowLanes.formulaOk &&
      narrowLanes.laneAligned &&
      narrowLanes.spacingAligned &&
      narrowLanes.xs[0] === 15,
    { narrowed, narrowLanes },
  )
  checkResult(
    checks,
    "narrow graph keeps fixed lanes, no dense hint and no visible/user horizontal scroll",
    narrowLanes.contentWidth > 0 &&
      !narrowLanes.denseVisible &&
      (narrowLanes.contentWidth <= narrowLanes.cellWidth + 1
        ? narrowLanes.maxShapeRight <= narrowLanes.cellWidth + 1
        : narrowLanes.maxShapeRight > narrowLanes.cellWidth + 1) &&
      (await page.locator('[data-testid="dense-graph"]').count()) === 0 &&
      /hidden|clip/.test(scrollSemantics.overflowX.cell ?? "") &&
      /hidden|clip/.test(scrollSemantics.overflowX.history ?? "") &&
      scrollSemantics.cellScrollLeftAfterWheel === 0 &&
      scrollSemantics.afterSet.history === 0 &&
      scrollSemantics.afterSet.doc === 0 &&
      !scrollSemantics.visibleScrollableAncestor &&
      (await page.locator('[data-testid="graph-scroll"]').count()) === 0 &&
      (await page.locator(".gg-graph-hscroll").count()) === 0,
    { narrowLanes, scrollSemantics },
  )
  const rewidened = await dragColumn(page, "graph", 320 - narrowed.after)
  const afterRewiden = await layoutSnapshot(page)
  const rewidenLanes = await graphLaneSnapshot(page)
  metrics.graphDrag.rewidened = { ...afterRewiden, lanes: rewidenLanes }
  checkResult(
    checks,
    "rewidening to 320px reveals every lane without clipping or a scrollbar",
    rewidened.after >= 310 &&
      rewidenLanes.contentWidth <= rewidenLanes.cellWidth + 1 &&
      rewidenLanes.maxShapeRight <= rewidenLanes.cellWidth + 1 &&
      !rewidenLanes.denseVisible &&
      rewidenLanes.scrollWidth <= rewidenLanes.clientWidth + 1,
    { rewidened, rewidenLanes },
  )
  await page.reload({ waitUntil: "domcontentloaded" })
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid="repository-select"] option').length >= 1,
    null,
    { timeout: 30_000 },
  )
  await page.locator('[data-testid="harness-width-1100"]').click()
  await page.locator(SELECTORS.repository[0]).selectOption(frPrimary.id)
  await waitRows(page, 1)
  await waitRaf(page, 2)
  const persisted = await layoutSnapshot(page)
  checkResult(checks, "graph width persists across reload", Math.abs(persisted.graph.headerWidth - rewidened.after) <= 2, { before: rewidened.after, after: persisted.graph.headerWidth })
  const restored = await dragColumn(page, "graph", 240 - persisted.graph.headerWidth)
  const afterRestore = await layoutSnapshot(page)
  const restoredLanes = await graphLaneSnapshot(page)
  checkResult(checks, "graph can be dragged back to 240px or narrower", restored.after >= 160 && restored.after <= 260, restored)
  checkResult(
    checks,
    "restored graph keeps fixed lane spacing, fits its content and has no horizontal scrollbar",
    afterRestore.graph.scrollWidth <= afterRestore.graph.clientWidth + 1 &&
      (await page.locator('[data-testid="graph-scroll"]').count()) === 0 &&
      restoredLanes.formulaOk &&
      restoredLanes.laneAligned &&
      restoredLanes.contentWidth <= restoredLanes.cellWidth + 1 &&
      !restoredLanes.denseVisible,
    { graph: afterRestore.graph, lanes: restoredLanes },
  )
  await page.locator('[data-testid="harness-width-520"]').click()
  await page.waitForFunction(
    () => document.querySelector('[data-testid="harness-panel-shell"]')?.dataset.panelWidth === "520",
    null,
    { timeout: 15_000 },
  )
  await waitRaf(page, 2)
  const narrow = await layoutSnapshot(page)
  const dense520 = await page.locator('[data-testid="dense-graph"]').count()
  checkResult(checks, "520px graph budget shrinks without horizontal overflow or a dense hint", narrow.graph.headerWidth <= 241 && narrow.graph.scrollWidth <= narrow.graph.clientWidth + 1 && narrow.panelOverflowX <= 1 && narrow.doc.scrollWidth <= narrow.doc.clientWidth && !narrow.denseGraphVisible && dense520 === 0, { graph: narrow.graph, panelOverflowX: narrow.panelOverflowX, doc: narrow.doc, dense520 })
  await context.close()
}

async function inlineThreeColumnScenario(browser, frPrimary, checks, metrics) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "en-US" })
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(FR_ORIGIN).origin }).catch(() => {})
  const page = await context.newPage()
  const contentRequests = []
  page.on("request", (request) => {
    if (!request.url().includes("/__gg/rpc/")) return
    const method = request.url().split("/__gg/rpc/")[1]
    if (!/content/i.test(method)) return
    let input
    try { input = JSON.parse(request.postData() ?? "{}") } catch { input = undefined }
    contentRequests.push({ method, input })
  })
  await page.goto(FR_BASE, { waitUntil: "domcontentloaded" })
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid="repository-select"] option').length >= 1,
    null,
    { timeout: 30_000 },
  )
  await page.locator(SELECTORS.repository[0]).selectOption(frPrimary.id)
  await waitRows(page, 1)
  const log = (await fetchRpc(FR_ORIGIN, "getLog", { repositoryId: frPrimary.id, limit: 100 })).body.result
  let chosen = null
  let firstWithFiles = null
  for (let index = 0; index < Math.min(25, log.commits.length); index += 1) {
    const files = (await fetchRpc(FR_ORIGIN, "getCommitFiles", {
      repositoryId: frPrimary.id,
      hash: log.commits[index].hash,
      parentIndex: 0,
    })).body.result.files
    if (files.length === 0) continue
    const candidate = { index, commit: log.commits[index], files }
    firstWithFiles ??= candidate
    if (files.some((file) => typeof file.added === "number" && file.added > 0)) {
      chosen = candidate
      break
    }
  }
  chosen ??= firstWithFiles
  if (!chosen) throw new Error("No FR commit with files for inline scenario")
  await scrollToRowIndex(page, chosen.index)
  await page.locator(`.gg-graph-row[data-index="${chosen.index}"]`).locator(".gg-subject").click()
  await waitForAny(page, SELECTORS.inlineSlot)
  await page.waitForFunction(
    () => {
      const tree = document.querySelector('[data-testid="inline-files"]')
      return tree && !tree.querySelector(".gg-status") && tree.querySelectorAll(".gg-file-row").length > 0
    },
    null,
    { timeout: 20_000 },
  )
  const info = await anyLocator(page, SELECTORS.inlineInfo)
  const infoText = info ? await info.innerText() : ""
  const short = chosen.commit.hash.slice(0, 7)
  metrics.inlineThree = {
    index: chosen.index,
    infoText,
    files: chosen.files.length,
    stats: [],
  }
  checkResult(checks, "inline info shows author, short hash and parents", Boolean(info) && infoText.includes(chosen.commit.author) && infoText.includes(short) && /(parent|root)/i.test(infoText), { infoText, author: chosen.commit.author, short, parents: chosen.commit.parents.length })
  const listToggle = await anyLocator(page, SELECTORS.viewToggleList)
  const treeToggle = await anyLocator(page, SELECTORS.viewToggleTree)
  checkResult(checks, "inline list/tree toggles exist", Boolean(listToggle && treeToggle), { list: Boolean(listToggle), tree: Boolean(treeToggle) })
  if (listToggle) {
    await listToggle.click()
    await waitRaf(page, 2)
    await page.waitForFunction(
      () => document.querySelectorAll('[data-testid="inline-files"] .gg-dir-row').length === 0,
      null,
      { timeout: 5_000 },
    ).catch(() => {})
  }
  const fileRows = page.locator(`${SELECTORS.inlineFiles[0]} .gg-file-row`)
  // Backend contract: added/deleted are optional non-negative integers; binary
  // rows omit both and must render '-' rather than fabricated numbers.
  const titlePath = (title) => (title?.includes(" �� ") ? title.split(" �� ").at(-1) : title)
  const pathOf = (file) => file?.path ?? null
  const statsForRow = async (row) => {
    const addLocator = row.locator(SELECTORS.fileStatAdd[0])
    const delLocator = row.locator(SELECTORS.fileStatDel[0])
    const statsLocator = row.locator(".gg-file-stats")
    return {
      add: (await addLocator.count()) > 0 ? await addLocator.first().innerText().catch(() => null) : null,
      del: (await delLocator.count()) > 0 ? await delLocator.first().innerText().catch(() => null) : null,
      statText: (await statsLocator.count()) > 0 ? (await statsLocator.first().innerText().catch(() => "")).trim() : "",
    }
  }
  const stats = []
  const seenPaths = new Set()
  const collect = async (file, row) => {
    if (!file || !row) return
    const path = pathOf(file)
    if (path && seenPaths.has(path)) return
    if (path) seenPaths.add(path)
    const ui = await statsForRow(row)
    stats.push({
      path,
      apiAdded: file.added,
      apiDeleted: file.deleted,
      ...ui,
    })
  }
  for (let index = 0; index < Math.min(5, await fileRows.count()); index += 1) {
    const row = fileRows.nth(index)
    const path = titlePath(await row.getAttribute("title"))
    const file = chosen.files.find((candidate) => candidate.path === path) ?? null
    await collect(file, row)
  }
  const rowForPath = async (path) => {
    const titles = await fileRows.evaluateAll((rows) => rows.map((row) => row.getAttribute("title")))
    const index = titles.findIndex((title) => titlePath(title) === path)
    return index >= 0 ? fileRows.nth(index) : null
  }
  const positiveFile = chosen.files.find(
    (file) => typeof file.added === "number" && file.added > 0,
  )
  if (positiveFile) await collect(positiveFile, await rowForPath(positiveFile.path))
  const binaryFile = chosen.files.find(
    (file) => file.added === undefined && file.deleted === undefined,
  )
  if (binaryFile) await collect(binaryFile, await rowForPath(binaryFile.path))
  metrics.inlineThree.stats = stats
  const numericRows = stats.filter(
    (entry) => typeof entry.apiAdded === "number" || typeof entry.apiDeleted === "number",
  )
  const numericOk = numericRows.every(
    (entry) =>
      (typeof entry.apiAdded !== "number" || entry.add === `+${entry.apiAdded}`) &&
      (typeof entry.apiDeleted !== "number" || entry.del === `-${entry.apiDeleted}`),
  )
  const binaryRows = stats.filter(
    (entry) => entry.apiAdded === undefined && entry.apiDeleted === undefined,
  )
  const binaryOk = binaryRows.every((entry) => {
    const text = [entry.add, entry.del, entry.statText]
      .filter((value) => value !== null && value !== undefined && value !== "")
      .join(" ")
      .trim()
    if (!text) return true
    if (/\d/.test(text)) return false
    return (
      /^-+$/.test(text.replace(/\s+/g, "")) ||
      /^-+$/.test(entry.statText.replace(/\s+/g, ""))
    )
  })
  checkResult(
    checks,
    "inline file stats match real added/deleted counts and use '-' for binary rows",
    Boolean(positiveFile) &&
      numericRows.some((entry) => typeof entry.apiAdded === "number" && entry.apiAdded > 0) &&
      numericOk &&
      binaryOk,
    { positiveFile: positiveFile?.path, numericRows, binaryRows, stats },
  )
  if (listToggle && treeToggle) {
    await treeToggle.click()
    await waitRaf(page, 2)
    const treeState = await page.evaluate(() => ({
      dirs: document.querySelectorAll('[data-testid="inline-files"] .gg-dir-row').length,
      slot: Boolean(document.querySelector('[data-testid="inline-slot"]')),
      expanded: document.querySelector(".gg-graph-row.gg-expanded") !== null,
      details: Boolean(document.querySelector('[data-testid="commit-details"]')),
    }))
    await listToggle.click()
    await waitRaf(page, 2)
    const listState = await page.evaluate(() => ({
      dirs: document.querySelectorAll('[data-testid="inline-files"] .gg-dir-row').length,
      slot: Boolean(document.querySelector('[data-testid="inline-slot"]')),
      expanded: document.querySelector(".gg-graph-row.gg-expanded") !== null,
      details: Boolean(document.querySelector('[data-testid="commit-details"]')),
    }))
    metrics.inlineThree.views = { treeState, listState }
    const nestedFiles = chosen.files.some((file) => file.path.includes("/"))
    checkResult(checks, "list/tree toggle changes rendering without collapsing the row or selecting a file", treeState.slot && listState.slot && treeState.expanded && listState.expanded && !treeState.details && !listState.details && (!nestedFiles || treeState.dirs > 0) && listState.dirs === 0, { treeState, listState, files: chosen.files.length, nestedFiles })
  }
  await screenshot(page, "18-fr-inline-three.png", { fullPage: true })
  const inlineState = () =>
    page.evaluate((index) => {
      const row = document.querySelector(`.gg-graph-row[data-index="${index}"]`)
      const selected = document.querySelector(
        '[data-testid="inline-files"] .gg-file-row[aria-selected="true"], [data-testid="inline-files"] .gg-file-row.gg-selected',
      )
      return {
        expanded: row?.getAttribute("aria-expanded") ?? null,
        selected: selected?.textContent?.trim() ?? null,
        slot: Boolean(document.querySelector('[data-testid="inline-slot"]')),
      }
    }, chosen.index)
  const noticeText = async () => {
    const element = await anyLocator(page, SELECTORS.mutationNotice)
    return element ? (await element.innerText().catch(() => "")).trim() : ""
  }
  const contentRequestsFor = (file) =>
    contentRequests.filter(
      (entry) =>
        entry.input?.hash === chosen.commit.hash && entry.input?.path === file.path,
    )
  const contentTargets = { text: null, binary: null, symlink: null, missing: null, sizeOnly: null }
  // getCommitFileContent({repositoryId,hash,path}) returns
  // {path,mode,kind:text|binary|symlink|missing,text,size,truncated?}.
  // >20MiB text is transmitted as kind:text, text:null, truncated:true
  // (size-only); it must never be labeled binary. Deleted files do not open
  // the viewer; their eye action stays disabled.
  const deletedFile = chosen.files.find((file) => file.status === "deleted")
  for (const file of chosen.files.slice(0, 40)) {
    if (file.status === "deleted") continue
    const content = await fetchRpc(FR_ORIGIN, "getCommitFileContent", {
      repositoryId: frPrimary.id,
      hash: chosen.commit.hash,
      path: file.path,
    })
      .then((response) => response.body.result)
      .catch(() => null)
    if (!content?.kind) continue
    if (content.kind === "text" && content.text === null) {
      if (content.truncated) contentTargets.sizeOnly ??= { file, content }
      continue
    }
    if (content.kind === "text" && !(content.text ?? "").trim()) continue
    if (contentTargets[content.kind]) continue
    contentTargets[content.kind] = { file, content }
    if (contentTargets.text && contentTargets.binary && contentTargets.symlink) break
  }
  const primaryTarget =
    contentTargets.text ??
    contentTargets.binary ??
    contentTargets.symlink ??
    contentTargets.missing ??
    contentTargets.sizeOnly

  const exerciseContent = async (file) => {
    const row = await rowForPath(file.path)
    if (!row) return { row: false, eye: false }
    const eyeLocator = row.locator(SELECTORS.fileViewAtCommit[0])
    const eyeCount = await eyeLocator.count()
    if (eyeCount === 0) return { row: true, eye: false }
    const disabled = await eyeLocator.first().isDisabled().catch(() => false)
    if (disabled) return { row: true, eye: true, disabled: true }
    const before = await inlineState()
    const beforeNotice = await noticeText()
    await eyeLocator.first().click()
    await page.waitForFunction(
      (previous) => {
        const panel = document.querySelector(
          '[data-testid="commit-file-content"], [data-testid="file-content-panel"]',
        )
        if (panel) return true
        const notice = document.querySelector(
          '[data-testid="mutation-notice"], .gg-mutation-notice',
        )
        return Boolean(notice && (notice.textContent ?? "").trim() !== previous)
      },
      beforeNotice,
      { timeout: 8_000 },
    ).catch(() => {})
    const panelLocator = page.locator(SELECTORS.fileContentPanel.join(","))
    const panelVisible = (await panelLocator.count()) > 0
    if (panelVisible) {
      await page.waitForFunction(
        () => {
          const panel = document.querySelector(
            '[data-testid="commit-file-content"], [data-testid="file-content-panel"]',
          )
          return Boolean(
            panel &&
              (panel.querySelector(
                '.gg-file-content-text, .gg-file-content-notice, .gg-error',
              ) ||
                !panel.querySelector('.gg-status[role="status"]')),
          )
        },
        null,
        { timeout: 20_000 },
      ).catch(() => {})
    }
    const panelText = panelVisible ? await panelLocator.first().innerText().catch(() => "") : ""
    const notice = await noticeText()
    const after = await inlineState()
    let closed = null
    let panelGone = false
    if (panelVisible) {
      const close = await anyLocator(page, SELECTORS.fileContentClose)
      if (close) {
        await close.click()
        await page.waitForFunction(
          () =>
            !document.querySelector(
              '[data-testid="commit-file-content"], [data-testid="file-content-panel"]',
            ),
          null,
          { timeout: 10_000 },
        ).catch(() => {})
      }
      panelGone = (await panelLocator.count()) === 0
      closed = await inlineState()
    }
    return {
      row: true,
      eye: true,
      disabled: false,
      panelVisible,
      panelText,
      notice: notice.slice(0, 240),
      comingSoon: !panelVisible && /coming soon/i.test(notice),
      request: contentRequestsFor(file)[0]?.input ?? null,
      before,
      after,
      closed,
      panelGone,
    }
  }

  const primaryResult = primaryTarget ? await exerciseContent(primaryTarget.file) : null
  metrics.inlineThree.fileContent = {
    targets: Object.fromEntries(
      Object.entries(contentTargets).map(([kind, value]) => [
        kind,
        value ? { path: value.file.path, status: value.file.status, size: value.content.size } : null,
      ]),
    ),
    deletedFile: deletedFile?.path ?? null,
    primary: primaryResult
      ? {
          path: primaryTarget.file.path,
          kind: primaryTarget.content.kind,
          panelVisible: primaryResult.panelVisible,
          panelText: primaryResult.panelText?.slice(0, 240),
          request: primaryResult.request,
          before: primaryResult.before,
          after: primaryResult.after,
          closed: primaryResult.closed,
          panelGone: primaryResult.panelGone,
        }
      : null,
  }
  if (primaryResult) {
    if (primaryResult.panelVisible) {
      checkResult(
        checks,
        "file view opens a real read-only content panel with matching hash/path",
        Boolean(primaryResult.request),
        metrics.inlineThree.fileContent,
      )
      const kind = primaryTarget.content.kind
      const contentText = primaryTarget.content.text ?? ""
      const sizeOnly = kind === "text" && primaryTarget.content.text === null
      const snippet = kind === "text" && !sizeOnly ? contentText.trim().slice(0, 40) : ""
      const markerOk =
        sizeOnly
          ? /larger than 20 MiB|size is shown|content omitted/i.test(primaryResult.panelText) &&
            !/binary/i.test(primaryResult.panelText)
          : kind === "text"
            ? snippet.length > 0 && primaryResult.panelText.includes(snippet)
            : kind === "binary"
              ? /binary/i.test(primaryResult.panelText)
              : kind === "symlink"
                ? /symbolic link/i.test(primaryResult.panelText) &&
                  primaryResult.panelText.includes(contentText.trim())
                : /does not exist/i.test(primaryResult.panelText)
      checkResult(
        checks,
        "file content panel matches the API kind and real content",
        markerOk,
        { kind, sizeOnly, snippet: snippet.slice(0, 40), target: contentText.slice(0, 80), panelText: primaryResult.panelText.slice(0, 240) },
      )
      if (kind === "text" && primaryTarget.content.truncated && !sizeOnly) {
        checkResult(
          checks,
          "truncated text content shows the server truncation warning",
          /truncat/i.test(primaryResult.panelText),
          { panelText: primaryResult.panelText.slice(0, 240), size: primaryTarget.content.size },
        )
      }
      checkResult(
        checks,
        "file view action does not toggle the commit or change the selected file",
        primaryResult.after.expanded === "true" &&
          primaryResult.after.slot &&
          primaryResult.after.selected === primaryResult.before.selected,
        { before: primaryResult.before, after: primaryResult.after },
      )
      checkResult(
        checks,
        "closing file content preserves the inline slot and selection",
        primaryResult.panelGone &&
          primaryResult.closed?.slot &&
          primaryResult.closed?.expanded === "true" &&
          primaryResult.closed?.selected === primaryResult.before.selected,
        { closed: primaryResult.closed, before: primaryResult.before, panelGone: primaryResult.panelGone },
      )
    } else if (primaryResult.disabled) {
      checkResult(
        checks,
        "file view is disabled for a non-deleted file",
        false,
        { kind: primaryTarget.content.kind, path: primaryTarget.file.path, status: primaryTarget.file.status },
      )
    } else {
      checkResult(
        checks,
        "file view is disabled or explicitly coming soon, never fake success",
        primaryResult.comingSoon,
        { notice: primaryResult.notice, eye: primaryResult.eye },
      )
    }
  } else {
    checkResult(checks, "at least one readable file content target exists", false, metrics.inlineThree.fileContent)
  }

  if (deletedFile) {
    const deletedRow = await rowForPath(deletedFile.path)
    const eyeLocator = deletedRow?.locator(SELECTORS.fileViewAtCommit[0])
    const eyeCount = eyeLocator ? await eyeLocator.count() : 0
    const deletedEyeDisabled =
      eyeCount > 0 ? await eyeLocator.first().isDisabled().catch(() => false) : false
    metrics.inlineThree.deletedEye = { path: deletedFile.path, row: Boolean(deletedRow), eyeCount, disabled: deletedEyeDisabled }
    checkResult(
      checks,
      "deleted file eye action is disabled",
      Boolean(deletedRow) && eyeCount > 0 && deletedEyeDisabled,
      metrics.inlineThree.deletedEye,
    )
  }

  for (const kind of ["binary", "symlink", "missing", "sizeOnly"]) {
    const target = contentTargets[kind]
    if (!target || target === primaryTarget) continue
    const result = await exerciseContent(target.file)
    const expected =
      kind === "binary"
        ? /binary/i
        : kind === "symlink"
          ? /symbolic link/i
          : kind === "sizeOnly"
            ? /larger than 20 MiB|size is shown|content omitted/i
            : /does not exist/i
    const textOk =
      kind !== "symlink" || result.panelText?.includes((target.content.text ?? "").trim())
    const notBinary = kind !== "sizeOnly" || !/binary/i.test(result.panelText ?? "")
    metrics.inlineThree[`${kind}Content`] = {
      path: target.file.path,
      panelVisible: result.panelVisible,
      panelText: result.panelText?.slice(0, 240),
      request: result.request,
    }
    checkResult(
      checks,
      `${kind} file content shows the real ${kind} state`,
      Boolean(result.panelVisible && expected.test(result.panelText) && textOk && notBinary && result.request),
      metrics.inlineThree[`${kind}Content`],
    )
  }
  await screenshot(page, "19-fr-file-actions.png", { fullPage: true })
  // Dev harness has no Desktop host: disabled or an explicit copy/open
  // fallback is acceptable here. A real ctx.layout.open file/desktop.launch
  // success remains a manual Desktop acceptance item.
  const currentButton = await anyLocator(page, SELECTORS.fileOpenCurrent)
  const copyPath = await anyLocator(page, SELECTORS.fileCopyPath)
  const currentFilePath = (await fileRows.count()) > 0
    ? titlePath(await fileRows.first().getAttribute("title").catch(() => null))
    : null
  if (currentButton) {
    const disabled = await currentButton.isDisabled().catch(() => false)
    if (disabled) {
      const copyVisible = copyPath ? await copyPath.isVisible().catch(() => false) : false
      const hint = [
        await currentButton.getAttribute("title").catch(() => null),
        await currentButton.getAttribute("aria-label").catch(() => null),
        await currentButton.innerText().catch(() => null),
      ]
        .filter(Boolean)
        .join(" ")
      const disabledHint = /desktop|host|unavailable|not available|disabled|clipboard/i.test(hint)
      metrics.inlineThree.currentFile = { disabled, copyPath: copyVisible, hint: hint.slice(0, 160), disabledHint, path: currentFilePath, hostApi: false, desktopManual: true }
      checkResult(checks, "dev harness current-file action is disabled as allowed (real Desktop remains manual)", disabled, metrics.inlineThree.currentFile)
    } else {
      const before = await noticeText()
      const beforeCurrent = await inlineState()
      await currentButton.click()
      await page.waitForFunction(
        (previous) => {
          const notice = document.querySelector(
            '[data-testid="mutation-notice"], .gg-mutation-notice',
          )
          return Boolean(notice && (notice.textContent ?? "").trim() !== previous)
        },
        before,
        { timeout: 8_000 },
      ).catch(() => {})
      const notice = await noticeText()
      const clipboard = await page
        .evaluate(() => navigator.clipboard?.readText?.() ?? "")
        .catch(() => "")
      const afterCurrent = await inlineState()
      const fallbackReadable = /copied|clipboard|path|open/i.test(notice)
      const normalizePath = (value) => (value ?? "").replace(/\\/g, "/")
      const clipboardMatches =
        !currentFilePath ||
        clipboard === currentFilePath ||
        (clipboard !== "" &&
          normalizePath(currentFilePath).endsWith(normalizePath(clipboard))) ||
        (clipboard === "" && /copied/i.test(notice))
      metrics.inlineThree.currentFile = {
        disabled,
        notice: notice.slice(0, 240),
        clipboard: clipboard.slice(0, 240),
        copyPath: Boolean(copyPath),
        path: currentFilePath,
        hostApi: false,
        desktopManual: true,
        mode: fallbackReadable ? "copy-or-host-fallback" : "no-observable-fallback",
        beforeCurrent,
        afterCurrent,
      }
      checkResult(
        checks,
        "dev harness current-file action is disabled or shows a readable host/copy fallback",
        fallbackReadable && clipboardMatches,
        metrics.inlineThree.currentFile,
      )
      checkResult(
        checks,
        "current-file action does not toggle the commit or change the selected file",
        afterCurrent.expanded === "true" && afterCurrent.slot && afterCurrent.selected === beforeCurrent.selected,
        { beforeCurrent, afterCurrent },
      )
    }
  } else {
    const copyVisible = copyPath ? await copyPath.isVisible().catch(() => false) : false
    checkResult(checks, "current-file action is present or copy-path is available", copyVisible, { copyPath: copyVisible })
  }
  // Collapse and reopen to ensure the new inline view state remains stable.
  const commitRow = page.locator(`.gg-graph-row[data-index="${chosen.index}"]`)
  await commitRow.locator(".gg-subject").click()
  await page.waitForFunction(() => !document.querySelector('[data-testid="inline-slot"]'), null, { timeout: 10_000 })
  await commitRow.locator(".gg-subject").click()
  await waitForAny(page, SELECTORS.inlineSlot)
  checkResult(checks, "inline can be closed and reopened after view toggles", Boolean(await page.locator(SELECTORS.inlineSlot[0]).count()), {})
  await context.close()
}

async function inlineLayoutScenario(browser, frPrimary, checks, metrics) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "en-US" })
  try {
    const page = await context.newPage()
    await page.goto(FR_BASE, { waitUntil: "domcontentloaded" })
    await page.waitForFunction(
      () => document.querySelectorAll('[data-testid="repository-select"] option').length >= 1,
      null,
      { timeout: 30_000 },
    )
    await page.locator('[data-testid="harness-width-1100"]').click()
    await page.waitForFunction(
      () => document.querySelector('[data-testid="harness-panel-shell"]')?.dataset.panelWidth === "1100",
      null,
      { timeout: 15_000 },
    )
    await page.locator(SELECTORS.repository[0]).selectOption(frPrimary.id)
    await waitLoaded(page, 100)
    await waitRows(page, 1)
    await waitNotBusy(page)

    const log = (await fetchRpc(FR_ORIGIN, "getLog", { repositoryId: frPrimary.id, limit: 100 })).body.result
    let candidate = null
    let fallback = null
    for (let index = 0; index < Math.min(60, log.commits.length); index += 1) {
      const commit = log.commits[index]
      const files = (await fetchRpc(FR_ORIGIN, "getCommitFiles", {
        repositoryId: frPrimary.id,
        hash: commit.hash,
        parentIndex: 0,
      })).body.result.files
      if (files.length === 0) continue
      const entry = { index, commit, files }
      if (!fallback || (commit.subject ?? "").length > (fallback.commit.subject ?? "").length) {
        fallback = entry
      }
      if ((commit.subject ?? "").length >= 80) {
        candidate = entry
        break
      }
    }
    candidate ??= fallback
    if (!candidate) {
      checkResult(checks, "inline layout fixture has a commit with files", false, { commits: log.commits.length })
      return
    }

    await scrollToRowIndex(page, candidate.index)
    await page.locator(`.gg-graph-row[data-index="${candidate.index}"] .gg-subject`).click()
    await waitForAny(page, SELECTORS.inlineSlot)
    await page.waitForFunction(
      () => {
        const files = document.querySelector('[data-testid="inline-files"]')
        return Boolean(files) && !files.querySelector(".gg-status")
      },
      null,
      { timeout: 20_000 },
    ).catch(() => {})
    await waitRaf(page, 3)

    const initial = await inlineLayoutSnapshot(page)
    const initialOverflow = await page.evaluate(() => {
      const slot = document.querySelector('[data-testid="inline-slot"]')
      const body = document.querySelector(".gg-row-slot-body")
      return {
        slot: slot ? slot.scrollWidth - slot.clientWidth : null,
        body: body ? body.scrollWidth - body.clientWidth : null,
        doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      }
    })
    const infoWidth = initial.box.info?.width ?? 0
    const filesWidth = initial.box.files?.width ?? 0
    const bodyWidth = initial.box.body?.width ?? 0
    const longestText = [...initial.text].sort((a, b) => b.text.length - a.text.length)[0]
    const wrappingEnabled = initial.text.every((entry) => entry.whiteSpace !== "nowrap")
    const textNoClip = initial.text.every(
      (entry) => entry.scrollWidth <= entry.clientWidth + 1 && entry.fullyVisible,
    )
    const wrappedExercise =
      !longestText || longestText.text.length < 80 || (longestText.lines ?? 0) >= 2
    metrics.inlineLayout = {
      candidate: { index: candidate.index, subject: candidate.commit.subject, files: candidate.files.length },
      initial,
      initialOverflow,
    }
    checkResult(
      checks,
      "inline layout has a real left/middle divider and no horizontal overflow",
      initial.slotPresent &&
        initial.dividerPresent &&
        initial.dividerWidth !== null &&
        initial.dividerWidth >= COLUMN_DIVIDER_MIN_WIDTH &&
        initial.dividerWidth <= COLUMN_DIVIDER_MAX_WIDTH &&
        initialOverflow.slot <= 1 &&
        initialOverflow.body <= 1 &&
        initialOverflow.doc === 0,
      { dividerSelector: initial.dividerSelector, dividerWidth: initial.dividerWidth, initialOverflow },
    )
    checkResult(
      checks,
      "inline left info column is wider and the file column is narrower",
      infoWidth >= 200 &&
        bodyWidth > 0 &&
        initial.ratio >= 0.28 &&
        initial.ratio <= 0.62 &&
        filesWidth <= bodyWidth * 0.72,
      { infoWidth, filesWidth, bodyWidth, ratio: initial.ratio, infoStyle: initial.infoStyle },
    )
    checkResult(
      checks,
      "inline left info text wraps without ellipsis or clipping and shows multiple lines when long",
      initial.infoScroll !== null &&
        initial.infoScroll.scrollWidth <= initial.infoScroll.clientWidth + 1 &&
        wrappingEnabled &&
        textNoClip &&
        wrappedExercise &&
        initial.text.every((entry) => entry.noEllipsis),
      { infoScroll: initial.infoScroll, text: initial.text, longestText, wrappingEnabled, textNoClip, wrappedExercise },
    )
    checkResult(
      checks,
      "inline Date uses YYYY-MM-DD HH:mm with the original ISO tooltip",
      Boolean(initial.date) &&
        /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(initial.date.text) &&
        initial.date.text.length === 16 &&
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(initial.date.title ?? ""),
      initial.date,
    )

    const moved = await dragInlineDivider(page, 110)
    const movedOverflow = await page.evaluate(() => {
      const slot = document.querySelector('[data-testid="inline-slot"]')
      const doc = document.documentElement
      return {
        slot: slot ? slot.scrollWidth - slot.clientWidth : null,
        doc: doc.scrollWidth - doc.clientWidth,
      }
    })
    metrics.inlineLayout.moved = { ...moved, movedOverflow }
    checkResult(
      checks,
      "dragging the inline divider changes the info/files ratio without overflowing",
      moved.after.ratio !== null &&
        moved.before.ratio !== null &&
        Math.abs(moved.after.ratio - moved.before.ratio) >= 0.02 &&
        movedOverflow.slot <= 1 &&
        movedOverflow.doc === 0,
      { before: moved.before.ratio, after: moved.after.ratio, movedOverflow },
    )

    const dividerControl = page.locator('[data-testid="inline-split"]').first()
    await dividerControl.focus()
    await page.keyboard.press("Home")
    await waitRaf(page, 2)
    const minimum = await inlineLayoutSnapshot(page)
    await page.keyboard.press("End")
    await waitRaf(page, 2)
    const maximum = await inlineLayoutSnapshot(page)
    const minRatio = minimum.ratio
    const maxRatio = maximum.ratio
    const minAria = minimum.dividerAriaNow
    const maxAria = maximum.dividerAriaNow
    metrics.inlineLayout.clamp = {
      minRatio,
      maxRatio,
      minAria,
      maxAria,
      ariaMin: maximum.dividerAriaMin,
      ariaMax: maximum.dividerAriaMax,
      min: minimum.box.info,
      max: maximum.box.info,
    }
    checkResult(
      checks,
      "inline divider clamps the info ratio to 25%-60% with Home/End",
      minAria === 25 &&
        maxAria === 60 &&
        maximum.dividerAriaMin === 25 &&
        maximum.dividerAriaMax === 60 &&
        minRatio !== null &&
        maxRatio !== null &&
        minRatio >= INLINE_INFO_MIN_RATIO - 0.03 &&
        minRatio <= INLINE_INFO_MIN_RATIO + 0.08 &&
        maxRatio >= INLINE_INFO_MAX_RATIO - 0.15 &&
        maxRatio <= INLINE_INFO_MAX_RATIO + 0.05 &&
        maxRatio > minRatio,
      { minRatio, maxRatio, minAria, maxAria, ariaMin: maximum.dividerAriaMin, ariaMax: maximum.dividerAriaMax },
    )

    const savedAria = maximum.dividerAriaNow
    const savedWidth = maximum.box.info?.width ?? null
    await page.locator(`.gg-graph-row[data-index="${candidate.index}"] .gg-subject`).click()
    await page.waitForFunction(() => !document.querySelector('[data-testid="inline-slot"]'), null, { timeout: 10_000 })
    await page.locator(`.gg-graph-row[data-index="${candidate.index}"] .gg-subject`).click()
    await waitForAny(page, SELECTORS.inlineSlot)
    await waitRaf(page, 3)
    const reopened = await inlineLayoutSnapshot(page)
    metrics.inlineLayout.reopened = reopened
    checkResult(
      checks,
      "inline info/files ratio persists for the session after collapse/reopen",
      savedAria === 60 &&
        reopened.dividerAriaNow === savedAria &&
        reopened.box.info !== null &&
        reopened.box.info.width > 0 &&
        reopened.box.body !== null &&
        reopened.box.body.width > 0,
      { savedAria, reopenedAria: reopened.dividerAriaNow, savedWidth, reopened: reopened.box.info },
    )
    await screenshot(page, "18b-fr-inline-layout.png", { fullPage: true })
  } catch (error) {
    checkResult(checks, "inline layout scenario executes", false, { error: String(error) })
  } finally {
    await context.close().catch(() => {})
  }
}

async function dynamicRefRowScenario(browser, frPrimary, checks, metrics) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "en-US" })
  try {
    const page = await context.newPage()
    await page.goto(FR_BASE, { waitUntil: "domcontentloaded" })
    await page.waitForFunction(
      () => document.querySelectorAll('[data-testid="repository-select"] option').length >= 1,
      null,
      { timeout: 30_000 },
    )
    await page.locator(SELECTORS.repository[0]).selectOption(frPrimary.id)
    await waitLoaded(page, 100)
    await waitRows(page, 1)
    await waitNotBusy(page)
    await page.locator('[data-testid="harness-width-1100"]').click()
    await page.waitForFunction(
      () => document.querySelector('[data-testid="harness-panel-shell"]')?.dataset.panelWidth === "1100",
      null,
      { timeout: 15_000 },
    )
    await waitRaf(page, 2)

    const refs = (await fetchRpc(FR_ORIGIN, "getRefs", { repositoryId: frPrimary.id })).body.result.refs
    const log = (await fetchRpc(FR_ORIGIN, "getLog", { repositoryId: frPrimary.id, limit: 100 })).body.result
    const refsByHash = new Map()
    for (const ref of refs) {
      if (ref.kind === "head") continue
      const list = refsByHash.get(ref.hash) ?? []
      list.push(ref)
      refsByHash.set(ref.hash, list)
    }
    const ranked = log.commits
      .map((commit, index) => ({ commit, index, refs: refsByHash.get(commit.hash) ?? [] }))
      .sort(
        (left, right) =>
          right.refs.reduce((sum, ref) => sum + ref.name.length, 0) -
          left.refs.reduce((sum, ref) => sum + ref.name.length, 0),
      )
    const preferred = ranked.filter(
      (entry) => entry.refs.length >= 3 && entry.refs.length <= 12,
    )
    let candidate = null
    // Prefer a multi-ref commit that also has files, so the slot/Back checks are real.
    for (const entry of preferred.slice(0, 20)) {
      const files = (await fetchRpc(FR_ORIGIN, "getCommitFiles", {
        repositoryId: frPrimary.id,
        hash: entry.commit.hash,
        parentIndex: 0,
      })).body.result.files
      if (files.length > 0) {
        candidate = entry
        break
      }
    }
    candidate ??= preferred[0] ?? ranked[0]
    if (!candidate) {
      checkResult(checks, "dynamic ref row fixture has refs", false, { refs: refs.length, commits: log.commits.length })
      return
    }
    const expectedNames = [...new Set(candidate.refs.map((ref) => ref.name))]
    await scrollToRowIndex(page, candidate.index)
    await page.waitForFunction(
      (hash) => Boolean(document.querySelector(`.gg-graph-row[data-commit="${hash}"]`)),
      candidate.commit.hash,
      { timeout: 20_000 },
    )
    await waitRaf(page, 2)
    const state = await rowRefsState(page, candidate.commit.hash)
    metrics.dynamicRef = {
      hash: candidate.commit.hash,
      index: candidate.index,
      expectedNames,
      state,
    }
    const allBadgesVisible =
      state.present &&
      state.more === null &&
      state.container !== null &&
      !state.container.horizontalScroll &&
      state.badges.every(
        (badge) =>
          badge.noEllipsis &&
          badge.fullyVisible &&
          badge.insideRow &&
          badge.insideDescription,
      )
    checkResult(
      checks,
      "a multi-ref commit renders every ref name without +N or horizontal scrolling",
      allBadgesVisible &&
        expectedNames.length >= 3 &&
        expectedNames.every((name) =>
          state.badges.some((badge) => badge.name === name && badge.text.includes(name)),
        ) &&
        new Set(state.badges.map((badge) => badge.name)).size === state.badges.length,
      { expectedNames, state },
    )
    checkResult(
      checks,
      "the multi-ref commit row grows beyond the 28px base height",
      state.present && state.rowHeight > 28.5,
      { rowHeight: state.rowHeight, rowTop: state.rowTop },
    )
    const nextRow = await page.evaluate((hash) => {
      const row = [...document.querySelectorAll(".gg-graph-row[data-commit]")].find(
        (candidateRow) => candidateRow.getAttribute("data-commit") === hash,
      )
      const next = [...(row?.parentElement?.querySelectorAll(".gg-graph-row[data-commit]") ?? [])].find(
        (candidateRow) => Number(candidateRow.dataset.index) === Number(row?.dataset.index) + 1,
      )
      if (!row || !next) return null
      return {
        top: Number(next.dataset.rowTop),
        height: next.getBoundingClientRect().height,
      }
    }, candidate.commit.hash)
    checkResult(
      checks,
      "variable row heights keep the virtual prefix sum contiguous",
      nextRow === null ||
        Math.abs(nextRow.top - (state.rowTop + state.rowHeight)) <= 1,
      { rowTop: state.rowTop, rowHeight: state.rowHeight, nextRow },
    )

    // Search by the real short hash, then return to the multi-ref row.
    const searchInput = page.locator(SELECTORS.search[0])
    await searchInput.fill(candidate.commit.hash.slice(0, 7))
    await page.keyboard.press("Enter")
    await page.waitForFunction(
      (hash) =>
        Boolean(document.querySelector(`.gg-graph-row[data-commit="${hash}"].gg-search-match`)),
      candidate.commit.hash,
      { timeout: 10_000 },
    ).catch(() => {})
    const searched = await rowRefsState(page, candidate.commit.hash)
    checkResult(
      checks,
      "search finds the multi-ref commit and keeps all ref badges visible",
      searched.present &&
        searched.more === null &&
        searched.rowHeight > 28.5 &&
        searched.badges.length >= expectedNames.length,
      { searched },
    )
    await searchInput.fill("")
    await page.keyboard.press("Enter")
    await waitRaf(page, 2)
    await scrollToRowIndex(page, candidate.index)

    // Expand the tall row: the slot must start at the row's real bottom.
    const row = page.locator(`.gg-graph-row[data-commit="${candidate.commit.hash}"]`)
    await row.locator(".gg-subject").click()
    await waitForAny(page, SELECTORS.inlineSlot)
    await page.waitForFunction(
      () => {
        const tree = document.querySelector('[data-testid="inline-files"]')
        return Boolean(tree) && !tree.querySelector(".gg-status")
      },
      null,
      { timeout: 20_000 },
    ).catch(() => {})
    await waitRaf(page, 2)
    const expandedLayout = await page.evaluate((hash) => {
      const row = [...document.querySelectorAll(".gg-graph-row[data-commit]")].find(
        (candidateRow) => candidateRow.getAttribute("data-commit") === hash,
      )
      const slot = document.querySelector('[data-testid="inline-slot"]')
      if (!row || !slot) return null
      const rowRect = row.getBoundingClientRect()
      const slotRect = slot.getBoundingClientRect()
      const next = [...row.parentElement.querySelectorAll(".gg-graph-row[data-commit]")].find(
        (candidateRow) => Number(candidateRow.dataset.index) === Number(row.dataset.index) + 1,
      )
      const nextRect = next?.getBoundingClientRect() ?? null
      return {
        rowHeight: rowRect.height,
        rowTop: rowRect.top,
        rowBottom: rowRect.bottom,
        slotTop: slotRect.top,
        slotHeight: slotRect.height,
        nextTop: nextRect?.top ?? null,
      }
    }, candidate.commit.hash)
    checkResult(
      checks,
      "inline slot starts at the tall row bottom and shifts following rows by its height",
      Boolean(expandedLayout) &&
        Math.abs(expandedLayout.slotTop - expandedLayout.rowBottom) <= 1 &&
        (expandedLayout.nextTop === null ||
          Math.abs(expandedLayout.nextTop - (expandedLayout.slotTop + expandedLayout.slotHeight)) <= 1),
      expandedLayout,
    )
    const beforeSlotDrag = await slotSnapshot(page)
    const slotDrag = await dragSlotHandle(page, 36)
    const afterSlotDrag = slotDrag.after
    const afterDragRow = await rowRefsState(page, candidate.commit.hash)
    checkResult(
      checks,
      "slot height drag stays compatible with the variable-height row",
      beforeSlotDrag.slotHeight !== null &&
        afterSlotDrag.slotHeight !== null &&
        Math.abs(afterSlotDrag.slotHeight - beforeSlotDrag.slotHeight) >= 2 &&
        afterDragRow.present &&
        Math.abs(afterDragRow.rowHeight - state.rowHeight) <= 1,
      { before: beforeSlotDrag.slotHeight, after: afterSlotDrag.slotHeight, rowHeight: afterDragRow.rowHeight },
    )

    // Open a real file diff and use Back; the tall row/slot/scroll must survive.
    const fileRow = page.locator(`${SELECTORS.inlineFiles[0]} .gg-file-row`).first()
    if ((await fileRow.count()) > 0) {
      const scrollBeforeDiff = await currentScrollTop(page)
      await fileRow.click()
      await waitForAny(page, [SELECTORS.commitDiff[0], '[data-testid="commit-diff-page"]'])
      await page.waitForFunction(
        () => Boolean(document.querySelector('[data-testid="details-back"]')),
        null,
        { timeout: 10_000 },
      )
      await page.locator(SELECTORS.detailsBack[0]).click()
      await page.waitForFunction(
        () => !document.querySelector('[data-testid="commit-diff-page"]') && Boolean(document.querySelector('[data-testid="inline-slot"]')),
        null,
        { timeout: 20_000 },
      )
      await waitRaf(page, 3)
      const backState = await rowRefsState(page, candidate.commit.hash)
      checkResult(
        checks,
        "Back from a tall-row file diff restores the row, slot and scroll",
        backState.present &&
          backState.rowHeight > 28.5 &&
          backState.more === null &&
          Math.abs((await currentScrollTop(page)) - scrollBeforeDiff) <= 1,
        { backState, scrollBeforeDiff, scrollAfter: await currentScrollTop(page) },
      )
    } else {
      checkResult(checks, "tall-row file diff Back is exercisable", false, { hash: candidate.commit.hash })
    }

    // Collapse before resizing so the width check measures the row, not the slot.
    await row.locator(".gg-subject").click()
    await page.waitForFunction(
      () => !document.querySelector('[data-testid="inline-slot"]'),
      null,
      { timeout: 10_000 },
    ).catch(() => {})
    await waitRaf(page, 2)

    const widthStates = {}
    for (const width of [520, 1100]) {
      await page.locator(`[data-testid="harness-width-${width}"]`).click()
      await page.waitForFunction(
        (expected) =>
          document.querySelector('[data-testid="harness-panel-shell"]')?.dataset.panelWidth ===
          String(expected),
        width,
        { timeout: 15_000 },
      )
      await waitRaf(page, 2)
      await scrollToRowIndex(page, candidate.index)
      await page.waitForFunction(
        (hash) => Boolean(document.querySelector(`.gg-graph-row[data-commit="${hash}"]`)),
        candidate.commit.hash,
        { timeout: 20_000 },
      )
      const widthState = await rowRefsState(page, candidate.commit.hash)
      const layout = await layoutSnapshot(page)
      widthStates[width] = { state: widthState, overflow: layout.panelOverflowX, doc: layout.doc }
      checkResult(
        checks,
        `${width}px reflows the multi-ref row without losing badges or overflowing`,
        widthState.present &&
          widthState.rowHeight > 28.5 &&
          widthState.more === null &&
          widthState.container !== null &&
          !widthState.container.horizontalScroll &&
          widthState.badges.length >= expectedNames.length &&
          layout.panelOverflowX <= 1 &&
          layout.doc.scrollWidth <= layout.doc.clientWidth,
        { width, state: widthState, panelOverflow: layout.panelOverflowX, doc: layout.doc },
      )
    }
    metrics.dynamicRef.widths = widthStates
    await screenshot(page, "18c-fr-dynamic-ref-row.png", { fullPage: true })
  } catch (error) {
    checkResult(checks, "dynamic ref row scenario executes", false, { error: String(error) })
  } finally {
    await context.close().catch(() => {})
  }
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
  // Remove residual test branches from interrupted earlier runs so ref badges
  // cannot hide the branch this scenario is about to create.
  try {
    const state = (await fetchRpc(TEMP_ORIGIN, "getStatus", { repositoryId: tempRepo.id })).body.result
    const refs = (await fetchRpc(TEMP_ORIGIN, "getRefs", { repositoryId: tempRepo.id })).body.result.refs
    for (const ref of refs) {
      if (
        ref.kind === "branch" &&
        (ref.name.startsWith("gg-filter-") || ref.name.startsWith("gg-release-")) &&
        ref.name !== state.branch
      ) {
        await fetchRpc(TEMP_ORIGIN, "deleteBranch", {
          repositoryId: tempRepo.id,
          expectedHead: state.head,
          confirmed: true,
          name: ref.name,
        })
      }
    }
  } catch {
    /* best-effort pre-clean */
  }
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
      return /[1-9]\d* loaded/.test(footer) && document.querySelectorAll(".gg-graph-row:not(.gg-uncommitted-row)").length > 0
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
  const contentRequests = []
  page.on("request", (request) => {
    if (!request.url().includes("/__gg/rpc/getCommitFileContent")) return
    const input = parseInput(request)
    if (input) contentRequests.push(input)
  })
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
  const statText = await file.locator(".gg-file-stats").innerText().catch(() => "")
  const statNone = await file.locator('[data-testid="file-stat-none"]').innerText().catch(() => "")
  const combinedStats = `${statText} ${statNone}`.replace(/\s+/g, " ").trim()
  const binaryStatsOk = !/\d/.test(combinedStats) && (statNone.trim() === "-" || combinedStats === "-" || combinedStats === "")
  metrics.binaryContent = { pathKind: "binary", statText: combinedStats, statNone: statNone.trim(), binaryStatsOk }
  checkResult(checks, "TEMP binary file row shows '-' or an empty stats placeholder without fabricated counts", binaryStatsOk, metrics.binaryContent)
  const eye = file.locator(SELECTORS.fileViewAtCommit[0]).first()
  const eyeCount = await eye.count()
  const eyeDisabled = eyeCount > 0 ? await eye.isDisabled().catch(() => false) : null
  if (eyeCount > 0 && !eyeDisabled) {
    await eye.click()
    const panel = page.locator(SELECTORS.fileContentPanel.join(",")).first()
    await panel.waitFor({ state: "visible", timeout: 20_000 }).catch(() => {})
    const panelVisible = (await panel.count()) > 0
    if (panelVisible) {
      await page.waitForFunction(
        () => {
          const panelElement = document.querySelector(
            '[data-testid="commit-file-content"], [data-testid="file-content-panel"]',
          )
          return Boolean(
            panelElement &&
              (panelElement.querySelector(
                '.gg-file-content-text, .gg-file-content-notice, .gg-error',
              ) ||
                !panelElement.querySelector('.gg-status[role="status"]')),
          )
        },
        null,
        { timeout: 20_000 },
      ).catch(() => {})
    }
    const panelText = panelVisible ? await panel.innerText().catch(() => "") : ""
    const request = contentRequests.find(
      (entry) => entry.hash === found.commit.hash && entry.path === found.path,
    )
    metrics.binaryContent = { ...metrics.binaryContent, panelVisible, panelText: panelText.slice(0, 240), request }
    checkResult(checks, "TEMP binary file content panel shows Binary and the real hash/path", panelVisible && /binary/i.test(panelText) && Boolean(request), metrics.binaryContent)
    const close = await anyLocator(page, SELECTORS.fileContentClose)
    if (close) await close.click()
    await page.waitForFunction(
      () => !document.querySelector('[data-testid="commit-file-content"], [data-testid="file-content-panel"]'),
      null,
      { timeout: 10_000 },
    ).catch(() => {})
    checkResult(checks, "TEMP binary content close keeps the inline slot", Boolean(await page.locator(SELECTORS.inlineSlot[0]).count()), {})
    await screenshot(page, "14b-temp-binary-content.png", { fullPage: true })
  } else {
    checkResult(checks, "TEMP binary file eye is enabled for a non-deleted file", false, { eyeCount, eyeDisabled })
  }
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

async function contentFixtureScenario(browser, tempRepo, checks, metrics) {
  const repoPath = tempRepo.rootPath
  const safe =
    /opencode|temp|fixture|mutation/i.test(repoPath) && !/workspace[\\/]fr/i.test(repoPath)
  if (!safe) {
    checkResult(checks, "TEMP content fixture root is safe", false, { repoPath })
    return
  }
  const branch = `gg-content-${Date.now().toString(36)}`
  const indexPath = join(
    TEMP_ROOT,
    `gg-content-index-${process.pid}-${Date.now().toString(36)}.tmp`,
  )
  const runGit = (args, options = {}) =>
    execFileSync("git", ["-C", repoPath, ...args], {
      encoding: "utf8",
      input: options.input,
      env: { ...process.env, ...(options.env ?? {}) },
      maxBuffer: 64 * 1024 * 1024,
      timeout: 120_000,
    }).trim()
  const gitEnv = {
    GIT_INDEX_FILE: indexPath,
    GIT_AUTHOR_NAME: "GG Release",
    GIT_AUTHOR_EMAIL: "gg-release@example.invalid",
    GIT_COMMITTER_NAME: "GG Release",
    GIT_COMMITTER_EMAIL: "gg-release@example.invalid",
  }
  const contentRequests = []
  let context
  try {
    if (existsSync(indexPath)) unlinkSync(indexPath)
    runGit(["read-tree", "main"], { env: gitEnv })
    const blob = (buffer) =>
      runGit(["hash-object", "-w", "--stdin"], { env: gitEnv, input: buffer })
    const largeOid = blob(Buffer.alloc(21 * 1024 * 1024, 0x41))
    const truncatedText = Buffer.from("line\n".repeat(Math.ceil((2 * 1024 * 1024) / 5)))
    const truncatedOid = blob(truncatedText)
    const symlinkOid = blob(Buffer.from("gg-target.txt"))
    const deletedOid = blob(Buffer.from("deleted fixture\n"))
    const mainHead = runGit(["rev-parse", "HEAD"])
    const add = (mode, oid, path) =>
      runGit(["update-index", "--add", "--cacheinfo", `${mode},${oid},${path}`], {
        env: gitEnv,
      })
    add("100644", deletedOid, "gg-deleted.txt")
    const treeA = runGit(["write-tree"], { env: gitEnv })
    const commitA = runGit(
      ["commit-tree", treeA, "-p", mainHead, "-m", "gg content fixture A"],
      { env: gitEnv },
    )
    runGit(["update-index", "--force-remove", "gg-deleted.txt"], { env: gitEnv })
    add("120000", symlinkOid, "gg-symlink")
    add("160000", mainHead, "gg-submodule")
    add("100644", largeOid, "gg-large.txt")
    add("100644", truncatedOid, "gg-truncated.txt")
    const treeB = runGit(["write-tree"], { env: gitEnv })
    const commitB = runGit(
      ["commit-tree", treeB, "-p", commitA, "-m", "gg content fixture B"],
      { env: gitEnv },
    )
    runGit(["update-ref", `refs/heads/${branch}`, commitB])
    metrics.contentFixture = { branch, commitA, commitB, sizes: { large: 21 * 1024 * 1024, truncated: truncatedText.length } }

    context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    const page = await context.newPage()
    page.on("request", (request) => {
      if (!request.url().includes("/__gg/rpc/getCommitFileContent")) return
      const input = parseInput(request)
      if (input) contentRequests.push(input)
    })
    await page.goto(TEMP_BASE, { waitUntil: "domcontentloaded" })
    await page.waitForFunction(
      () => document.querySelectorAll('[data-testid="repository-select"] option').length >= 2,
      null,
      { timeout: 30_000 },
    )
    await page.locator(SELECTORS.repository[0]).selectOption(tempRepo.id)
    await waitRows(page, 1)
    await openBranchSelector(page)
    await page.locator(SELECTORS.branchFilterSelected[0]).click()
    const checkbox = page.locator(
      `${SELECTORS.branchFilterRef[0]}[value="refs/heads/${branch}"]`,
    )
    await checkbox.waitFor({ state: "visible", timeout: 15_000 })
    await checkbox.click()
    await page.locator(SELECTORS.applyBranchFilter[0]).click()
    await closeBranchSelector(page)
    await page.waitForFunction(
      (hash) => Boolean(document.querySelector(`.gg-graph-row[data-commit="${hash}"]`)),
      commitB,
      { timeout: 30_000 },
    ).catch(() => {})
    const fixtureRow = page.locator(`.gg-graph-row[data-commit="${commitB}"]`)
    if ((await fixtureRow.count()) === 0) throw new Error("Synthetic content commit is not visible")
    await fixtureRow.locator(".gg-subject").click()
    await waitForAny(page, SELECTORS.inlineSlot)
    await page.waitForFunction(
      () => {
        const tree = document.querySelector('[data-testid="inline-files"]')
        return tree && !tree.querySelector(".gg-status") && tree.querySelectorAll(".gg-file-row").length >= 5
      },
      null,
      { timeout: 20_000 },
    )
    const listToggle = await anyLocator(page, SELECTORS.viewToggleList)
    if (listToggle) {
      await listToggle.click()
      await waitRaf(page, 2)
    }
    const rowFor = (name) =>
      page
        .locator(`${SELECTORS.inlineFiles[0]} .gg-file-row`)
        .filter({ hasText: name })
        .first()
    const openContent = async (name) => {
      const row = rowFor(name)
      const eye = row.locator(SELECTORS.fileViewAtCommit[0]).first()
      const eyeCount = await eye.count()
      const disabled = eyeCount > 0 ? await eye.isDisabled().catch(() => false) : null
      if (eyeCount === 0 || disabled) return { eyeCount, disabled, panelVisible: false }
      await eye.click()
      const panel = page.locator(SELECTORS.fileContentPanel.join(",")).first()
      await panel.waitFor({ state: "visible", timeout: 20_000 }).catch(() => {})
      const panelVisible = (await panel.count()) > 0
      if (panelVisible) {
        await page.waitForFunction(
          () => {
            const panelElement = document.querySelector(
              '[data-testid="commit-file-content"], [data-testid="file-content-panel"]',
            )
            return Boolean(
              panelElement &&
                (panelElement.querySelector(
                  '.gg-file-content-text, .gg-file-content-notice, .gg-error',
                ) ||
                  !panelElement.querySelector('.gg-status[role="status"]')),
            )
          },
          null,
          { timeout: 20_000 },
        ).catch(() => {})
      }
      const panelText = panelVisible ? await panel.innerText().catch(() => "") : ""
      const request = contentRequests.find(
        (entry) => entry.hash === commitB && entry.path === name,
      )
      const close = await anyLocator(page, SELECTORS.fileContentClose)
      if (close) {
        await close.click()
        await page.waitForFunction(
          () => !document.querySelector('[data-testid="commit-file-content"], [data-testid="file-content-panel"]'),
          null,
          { timeout: 10_000 },
        ).catch(() => {})
      }
      return { eyeCount, disabled, panelVisible, panelText, request, closed: (await page.locator(SELECTORS.inlineSlot[0]).count()) > 0 }
    }

    const symlink = await openContent("gg-symlink")
    metrics.contentFixture.symlink = { panelVisible: symlink.panelVisible, panelText: symlink.panelText?.slice(0, 200), request: symlink.request }
    checkResult(
      checks,
      "synthetic symlink content shows the symlink target",
      Boolean(symlink.panelVisible && /symbolic link/i.test(symlink.panelText) && symlink.panelText.includes("gg-target.txt") && symlink.request && symlink.closed),
      metrics.contentFixture.symlink,
    )

    const sizeOnly = await openContent("gg-large.txt")
    metrics.contentFixture.sizeOnly = { panelVisible: sizeOnly.panelVisible, panelText: sizeOnly.panelText?.slice(0, 200), request: sizeOnly.request }
    checkResult(
      checks,
      "synthetic >20MiB content shows the real size-only notice and not Binary",
      Boolean(
        sizeOnly.panelVisible &&
          /larger than 20 MiB|size is shown/i.test(sizeOnly.panelText) &&
          !/binary/i.test(sizeOnly.panelText) &&
          sizeOnly.request &&
          sizeOnly.closed,
      ),
      metrics.contentFixture.sizeOnly,
    )

    const truncated = await openContent("gg-truncated.txt")
    metrics.contentFixture.truncated = { panelVisible: truncated.panelVisible, panelText: truncated.panelText?.slice(0, 200), request: truncated.request }
    checkResult(
      checks,
      "synthetic 2MiB text shows the server truncation warning",
      Boolean(truncated.panelVisible && /truncated/i.test(truncated.panelText) && truncated.request && truncated.closed),
      metrics.contentFixture.truncated,
    )

    const gitlink = await openContent("gg-submodule")
    metrics.contentFixture.gitlink = { panelVisible: gitlink.panelVisible, panelText: gitlink.panelText?.slice(0, 200), request: gitlink.request }
    checkResult(
      checks,
      "synthetic gitlink content reports no file content at the commit",
      Boolean(gitlink.panelVisible && /submodule|gitlink|no file content/i.test(gitlink.panelText) && gitlink.request && gitlink.closed),
      metrics.contentFixture.gitlink,
    )

    const gitlinkRow = rowFor("gg-submodule")
    const gitlinkStatsText = await gitlinkRow.locator(".gg-file-stats").innerText().catch(() => "")
    const gitlinkStatNone = await gitlinkRow.locator('[data-testid="file-stat-none"]').innerText().catch(() => "")
    const gitlinkStats = `${gitlinkStatsText} ${gitlinkStatNone}`.replace(/\s+/g, " ").trim()
    metrics.contentFixture.gitlinkStats = { text: gitlinkStats, statNone: gitlinkStatNone.trim() }
    checkResult(
      checks,
      "gitlink row shows '-'/empty stats and no fabricated numeric counts",
      !/\d/.test(gitlinkStats) && (gitlinkStats === "" || gitlinkStatNone.trim() === "-" || gitlinkStats === "-"),
      metrics.contentFixture.gitlinkStats,
    )

    const deletedRow = rowFor("gg-deleted.txt")
    const deletedEye = deletedRow.locator(SELECTORS.fileViewAtCommit[0]).first()
    const deletedEyeCount = await deletedEye.count()
    const deletedDisabled = deletedEyeCount > 0 ? await deletedEye.isDisabled().catch(() => false) : false
    metrics.contentFixture.deleted = { row: (await deletedRow.count()) > 0, eyeCount: deletedEyeCount, disabled: deletedDisabled }
    checkResult(
      checks,
      "synthetic deleted file eye is disabled",
      (await deletedRow.count()) > 0 && deletedEyeCount > 0 && deletedDisabled,
      metrics.contentFixture.deleted,
    )
    await screenshot(page, "20-temp-content-fixture.png", { fullPage: true })
  } finally {
    try {
      runGit(["update-ref", "-d", `refs/heads/${branch}`])
    } catch {
      /* best-effort cleanup */
    }
    if (existsSync(indexPath)) {
      try {
        unlinkSync(indexPath)
      } catch {
        /* best-effort cleanup */
      }
    }
    if (context) await context.close().catch(() => {})
  }
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

async function slotResizeScenario(browser, frPrimary, checks, metrics) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "en-US" })
  try {
    const page = await context.newPage()
    await page.goto(FR_BASE, { waitUntil: "domcontentloaded" })
    await page.waitForFunction(
      () => document.querySelectorAll('[data-testid="repository-select"] option').length >= 1,
      null,
      { timeout: 30_000 },
    )
    await page.locator(SELECTORS.repository[0]).selectOption(frPrimary.id)
    await waitLoaded(page, 100)
    await waitRows(page, 1)
    await waitNotBusy(page)

    const frLog = (await fetchRpc(FR_ORIGIN, "getLog", { repositoryId: frPrimary.id, limit: 100 })).body.result
    let candidate = -1
    let fallbackCandidate = -1
    const floor = Math.max(0, frLog.commits.length - 40)
    const startIndex = Math.max(floor, frLog.commits.length - 15)
    for (let index = startIndex; index >= floor; index -= 1) {
      const files = await fetchRpc(FR_ORIGIN, "getCommitFiles", {
        repositoryId: frPrimary.id,
        hash: frLog.commits[index].hash,
        parentIndex: 0,
      })
      const fileCount = files.body?.result?.files?.length ?? 0
      if (fileCount > 0 && fallbackCandidate < 0) fallbackCandidate = index
      if (fileCount >= 4) {
        candidate = index
        break
      }
    }
    if (candidate < 0) candidate = fallbackCandidate
    if (candidate < 0) {
      checkResult(checks, "slot resize fixture has a late commit with files", false, { commits: frLog.commits.length })
      return
    }
    await scrollToRowIndex(page, candidate)
    await page.locator(`.gg-graph-row[data-index="${candidate}"] .gg-subject`).click()
    await waitForAny(page, SELECTORS.inlineSlot)
    await page.waitForFunction(
      () => {
        const tree = document.querySelector('[data-testid="inline-files"]')
        return Boolean(tree) && !tree.querySelector(".gg-status")
      },
      null,
      { timeout: 20_000 },
    ).catch(() => {})
    await waitRaf(page, 2)

    const initial = await slotSnapshot(page)
    const slotDecoration = await hoverDecoration(page, SLOT_HANDLE_SELECTOR)
    metrics.slotResize = { initial, slotDecoration }
    const handleSpansSlot =
      Boolean(initial.handle && initial.slot) &&
      Math.abs(initial.handle.left - initial.slot.left) <= 1.5 &&
      Math.abs(initial.handle.right - initial.slot.right) <= 1.5 &&
      Math.abs(initial.handle.bottom - initial.slot.bottom) <= 1.5 &&
      initial.handle.height >= 1 &&
      initial.handle.height <= 12
    checkResult(
      checks,
      "inline slot bottom divider is the full-line resize hit area with no separate small widget",
      initial.slotPresent &&
        initial.handleCount === 1 &&
        handleSpansSlot &&
        !slotDecoration.smallWidgetInside,
      { slot: initial.slot, handle: initial.handle, slotDecoration },
    )

    const minDrag = await dragSlotHandle(page, -4000)
    const minHeight = minDrag.after.slotHeight
    checkResult(
      checks,
      "slot drag clamps to the 96px minimum height",
      minHeight !== null && minHeight >= SLOT_MIN_HEIGHT - 0.5 && minHeight <= SLOT_MIN_HEIGHT + 1.5,
      { before: minDrag.before.slotHeight, after: minHeight, deltaY: minDrag.deltaY },
    )

    // Return to the expanded commit at the top; this position is away from the
    // bottom, so a small drag must not move the virtual scroll window.
    await scrollToRowIndex(page, candidate)
    await waitRaf(page, 2)
    const preserveBefore = await slotSnapshot(page)
    const preserveDrag = await dragSlotHandle(page, 48)
    const preserveAfter = preserveDrag.after
    checkResult(
      checks,
      "slot drag away from the bottom preserves virtual scroll position",
      preserveBefore.scrollTop !== null &&
        preserveAfter.scrollTop !== null &&
        Math.abs(preserveAfter.scrollTop - preserveBefore.scrollTop) <= 1 &&
        preserveBefore.slot &&
        preserveAfter.slot &&
        Math.abs(preserveAfter.slot.top - preserveBefore.slot.top) <= 1,
      { before: preserveBefore, after: preserveAfter },
    )

    // Move the handle near the top, then drag to the viewport edge to reach the
    // dynamic maximum. No fixed maximum is assumed.
    await page.evaluate(() => {
      const scroller = document.querySelector('[data-testid="history-scroll"]')
      const handle = document.querySelector('[data-testid="slot-resize-handle"]')
      if (!scroller || !handle) return
      const scrollerRect = scroller.getBoundingClientRect()
      const handleRect = handle.getBoundingClientRect()
      const target = handleRect.top - scrollerRect.top + scroller.scrollTop - 80
      scroller.scrollTop = Math.max(0, target)
    })
    await waitRaf(page, 2)
    const maxDrag = await dragSlotHandle(page, 2000)
    const maxHeight = maxDrag.after.slotHeight
    const viewportHeight = maxDrag.after.clientHeight ?? 0
    const expectedMax = Math.max(SLOT_MIN_HEIGHT, Math.min(560, viewportHeight - 80))
    checkResult(
      checks,
      "slot drag grows to the dynamic viewport maximum",
      maxHeight !== null &&
        maxHeight > minHeight + 1 &&
        Math.abs(maxHeight - expectedMax) <= 1,
      { minHeight, maxHeight, expectedMax, viewportHeight, deltaY: maxDrag.deltaY },
    )

    const savedHeight = maxHeight
    await page.locator(`.gg-graph-row[data-index="${candidate}"] .gg-subject`).click()
    await page.waitForFunction(() => !document.querySelector('[data-testid="inline-slot"]'), null, { timeout: 10_000 })
    await page.locator(`.gg-graph-row[data-index="${candidate}"] .gg-subject`).click()
    await waitForAny(page, SELECTORS.inlineSlot)
    await waitRaf(page, 2)
    const reopened = await slotSnapshot(page)
    checkResult(
      checks,
      "slot height persists for the session after collapse/reopen",
      savedHeight !== null && reopened.slotHeight !== null && Math.abs(reopened.slotHeight - savedHeight) <= 1,
      { savedHeight, reopened: reopened.slotHeight },
    )

    metrics.slotResize = {
      candidate,
      initial: initial.slotHeight,
      initialHandle: initial.handle,
      slotDecoration,
      minHeight,
      maxHeight,
      reopened: reopened.slotHeight,
      preserve: { before: preserveBefore, after: preserveAfter },
    }
    await screenshot(page, "17-fr-slot-resize.png", { fullPage: true })
  } catch (error) {
    checkResult(checks, "slot resize scenario executes", false, { error: String(error) })
  } finally {
    await context.close().catch(() => {})
  }
}

/**
 * Real filesystem/git events outside the page must reach the panel without a
 * Refresh click. Each phase records the RPC burst so a coalescing regression
 * (multiple full getLog refreshes per git event) is visible.
 */
async function watcherRefreshScenario(browser, tempRepo, checks, metrics) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "en-US" })
  const page = await context.newPage()
  const requests = recordRpcRequests(page)
  let remote = null
  let baseHead = null
  let baseBranch = "main"
  let createdCommit = null
  try {
    let status0 = (await fetchRpc(TEMP_ORIGIN, "getStatus", { repositoryId: tempRepo.id })).body.result
    if (status0.branch !== "main") {
      runGit(tempRepo.rootPath, ["checkout", "main"])
      status0 = (await fetchRpc(TEMP_ORIGIN, "getStatus", { repositoryId: tempRepo.id })).body.result
    }
    baseHead = status0.head
    baseBranch = status0.branch
    await page.goto(TEMP_BASE, { waitUntil: "domcontentloaded" })
    await page.waitForFunction(
      () => document.querySelectorAll('[data-testid="repository-select"] option').length >= 2,
      null,
      { timeout: 30_000 },
    )
    await page.locator(SELECTORS.repository[0]).selectOption(tempRepo.id)
    await waitRows(page, 1)
    await waitNotBusy(page)
    await waitForCurrentBranch(page, baseBranch, 15_000)
    await waitRequestQuiet(requests)

    // 1) External commit must appear without pressing Refresh.
    const commitPhase = requests.length
    createdCommit = createTempCommit(tempRepo.rootPath, "gg-watch-commit")
    await waitForVisibleCommit(page, createdCommit.head, 10_000)
    await waitNotBusy(page)
    await waitRequestQuiet(requests)
    const commitLogs = countRpcSince(requests, commitPhase, "getLog")
    const commitState = await panelPaintState(page)
    metrics.watcher = {
      baseHead,
      baseBranch,
      createdHead: createdCommit.head,
      commit: { logs: commitLogs, state: commitState },
    }
    checkResult(
      checks,
      "watcher shows an externally created commit without pressing Refresh",
      commitState.rows > 0 && !commitState.loadingSkeleton,
      { logs: commitLogs, state: commitState },
    )
    checkResult(
      checks,
      "external commit refresh coalesces to 1-3 getLog requests",
      commitLogs >= 1 && commitLogs <= 3,
      { getLog: commitLogs },
    )

    // 2) External checkout must update the current-branch label.
    const refs = (await fetchRpc(TEMP_ORIGIN, "getRefs", { repositoryId: tempRepo.id })).body.result.refs
    const feature = refs.find((ref) => ref.kind === "branch" && ref.name === "feature")
    const checkoutPhase = requests.length
    if (feature) {
      runGit(tempRepo.rootPath, ["checkout", "feature"])
      await waitForCurrentBranch(page, "feature", 10_000)
      await waitNotBusy(page)
      await waitRequestQuiet(requests)
    }
    const checkoutLogs = countRpcSince(requests, checkoutPhase, "getLog")
    const checkoutStatus = (await fetchRpc(TEMP_ORIGIN, "getStatus", { repositoryId: tempRepo.id })).body.result
    const checkoutState = await panelPaintState(page)
    metrics.watcher.checkout = { hasFeature: Boolean(feature), logs: checkoutLogs, status: checkoutStatus.branch, state: checkoutState }
    checkResult(
      checks,
      "watcher updates current-branch after an external checkout",
      Boolean(feature) && checkoutStatus.branch === "feature" && checkoutState.branch.includes("feature"),
      metrics.watcher.checkout,
    )
    checkResult(
      checks,
      "external checkout does not create a getLog refresh storm (0-3)",
      checkoutLogs <= 3,
      { getLog: checkoutLogs },
    )

    // 3) External fetch of a local bare remote must update the remote badge.
    const fetchStatus = (await fetchRpc(TEMP_ORIGIN, "getStatus", { repositoryId: tempRepo.id })).body.result
    remote = setupFetchRemote(tempRepo, fetchStatus)
    const fetchPhase = requests.length
    runGit(tempRepo.rootPath, ["fetch", remote.remoteName])
    const remoteRef = `${remote.remoteName}/fetch-target`
    const remoteRefHash = runGit(tempRepo.rootPath, ["rev-parse", `refs/remotes/${remoteRef}`])
    await page.locator(SELECTORS.historyScroll[0]).evaluate((element) => {
      element.scrollTop = 0
    })
    await waitRaf(page, 2)
    await waitForRemoteBadge(page, remoteRef, remoteRefHash, 10_000)
    await waitNotBusy(page)
    await waitRequestQuiet(requests)
    const fetchLogs = countRpcSince(requests, fetchPhase, "getLog")
    const fetchRefs = countRpcSince(requests, fetchPhase, "getRefs")
    const fetchState = await panelPaintState(page)
    metrics.watcher.fetch = { remote: remote.remoteName, remoteRef, remoteRefHash, logs: fetchLogs, refs: fetchRefs, state: fetchState }
    checkResult(
      checks,
      "watcher advances the remote badge after an external local fetch",
      fetchRefs >= 1 && remoteRefHash === fetchStatus.head,
      { getLog: fetchLogs, getRefs: fetchRefs, remoteRefHash, expected: fetchStatus.head, state: fetchState },
    )
    checkResult(
      checks,
      "external fetch does not create a getLog refresh storm (0-3)",
      fetchLogs <= 3,
      { getLog: fetchLogs },
    )
    metrics.watcher.maxGetLogPerEvent = Math.max(commitLogs, checkoutLogs, fetchLogs)
    checkResult(
      checks,
      "watcher coalesces each external event within 3 getLog requests",
      metrics.watcher.maxGetLogPerEvent <= 3 && commitLogs >= 1,
      { commitLogs, checkoutLogs, fetchLogs },
    )
  } catch (error) {
    checkResult(checks, "watcher auto-refresh scenario executes", false, { error: String(error) })
  } finally {
    if (remote) remote.cleanup()
    if (baseHead) {
      runGitAllowFailure(tempRepo.rootPath, ["checkout", baseBranch])
      runGitAllowFailure(tempRepo.rootPath, ["reset", "--hard", baseHead])
    }
    if (createdCommit) {
      try {
        unlinkSync(join(tempRepo.rootPath, createdCommit.name))
      } catch {
        /* best-effort TEMP cleanup */
      }
    }
    await context.close().catch(() => {})
  }
}

/**
 * The host disposes the panel on tab/file switches. The module-level cache must
 * repaint history before any spinner and validate HEAD/refs in the background
 * without re-fetching the commit page when they did not move.
 */
async function remountCacheScenario(browser, tempRepo, checks, metrics) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "en-US" })
  const page = await context.newPage()
  const requests = recordRpcRequests(page)
  let baseHead = null
  let baseBranch = "main"
  let createdCommit = null
  try {
    let status0 = (await fetchRpc(TEMP_ORIGIN, "getStatus", { repositoryId: tempRepo.id })).body.result
    if (status0.branch !== "main") {
      runGit(tempRepo.rootPath, ["checkout", "main"])
      status0 = (await fetchRpc(TEMP_ORIGIN, "getStatus", { repositoryId: tempRepo.id })).body.result
    }
    baseHead = status0.head
    baseBranch = status0.branch
    await page.goto(TEMP_BASE, { waitUntil: "domcontentloaded" })
    await page.waitForFunction(
      () => document.querySelectorAll('[data-testid="repository-select"] option').length >= 2,
      null,
      { timeout: 30_000 },
    )
    await page.locator(SELECTORS.repository[0]).selectOption(tempRepo.id)
    await waitRows(page, 1)
    await waitNotBusy(page)
    await waitForCurrentBranch(page, baseBranch, 15_000)
    await waitRequestQuiet(requests)

    const log = (await fetchRpc(TEMP_ORIGIN, "getLog", { repositoryId: tempRepo.id, limit: 100 })).body.result
    let candidate = -1
    for (let index = 1; index < Math.min(8, log.commits.length); index += 1) {
      const files = (await fetchRpc(TEMP_ORIGIN, "getCommitFiles", {
        repositoryId: tempRepo.id,
        hash: log.commits[index].hash,
        parentIndex: 0,
      })).body.result.files
      if (files.length > 0) {
        candidate = index
        break
      }
    }
    if (candidate < 0) {
      checkResult(checks, "remount fixture has a mid-history commit with files", false, { commits: log.commits.length })
      return
    }
    await scrollToRowIndex(page, candidate)
    await page.locator(`.gg-graph-row[data-index="${candidate}"] .gg-subject`).click()
    await waitForAny(page, SELECTORS.inlineSlot)
    await page.waitForFunction(
      () => {
        const files = document.querySelector('[data-testid="inline-files"]')
        return Boolean(files) && !files.querySelector(".gg-status")
      },
      null,
      { timeout: 20_000 },
    ).catch(() => {})
    await waitRaf(page, 2)

    const before = await panelPaintState(page)
    const rowHeight = await page
      .locator(".gg-graph-row:not(.gg-uncommitted-row)")
      .first()
      .evaluate((row) => row.getBoundingClientRect().height)
      .catch(() => 28)
    const refsBefore = refsSignature(
      (await fetchRpc(TEMP_ORIGIN, "getRefs", { repositoryId: tempRepo.id })).body.result.refs,
    )
    const remountPhase = requests.length
    await page.evaluate(() => {
      const shell = document.querySelector('[data-testid="harness-panel-shell"]')
      const skeletonNow = () => {
        const panel = document.querySelector(".git-graph-panel")
        if (!panel) return false
        const text = panel.innerText ?? ""
        return (
          /Loading repositories|Loading history|Loading refs|Loading commits/i.test(text) ||
          Boolean(panel.querySelector('.gg-skeleton, [data-testid="repository-skeleton"]'))
        )
      }
      window.__ggSkeletonSeen = false
      window.__ggSkeletonObserver?.disconnect?.()
      window.__ggSkeletonObserver = new MutationObserver(() => {
        if (skeletonNow()) window.__ggSkeletonSeen = true
      })
      if (shell) {
        window.__ggSkeletonObserver.observe(shell, {
          childList: true,
          subtree: true,
          characterData: true,
        })
      }
    })
    const remountStarted = Date.now()
    await remountPanel(page)
    await page.waitForFunction(
      () => {
        const panel = document.querySelector(".git-graph-panel")
        const text = panel?.innerText ?? ""
        return Boolean(
          panel &&
            document.querySelectorAll(".gg-graph-row:not(.gg-uncommitted-row)").length > 0 &&
            !/Loading repositories|Loading history|Loading refs|Loading commits/i.test(text) &&
            !panel.querySelector('.gg-skeleton, [data-testid="repository-skeleton"]'),
        )
      },
      null,
      { timeout: 5_000 },
    )
    const paintMs = Date.now() - remountStarted
    const immediate = await panelPaintState(page)
    const skeletonSeen = await page.evaluate(() => {
      const seen = window.__ggSkeletonSeen === true
      window.__ggSkeletonObserver?.disconnect?.()
      return seen
    })
    immediate.skeletonSeen = skeletonSeen
    immediate.paintMs = paintMs
    await page.waitForFunction(
      ({ top, hash }) => {
        const scroller = document.querySelector('[data-testid="history-scroll"]')
        const expanded = document.querySelector(".gg-graph-row.gg-expanded")
        return Boolean(
          scroller &&
            Math.abs(scroller.scrollTop - top) <= 1 &&
            expanded?.getAttribute("data-commit") === hash &&
            document.querySelector('[data-testid="inline-slot"]'),
        )
      },
      { top: before.scrollTop ?? 0, hash: before.expandedHash },
      { timeout: 10_000 },
    )
    await waitRequestQuiet(requests)
    const restored = await panelPaintState(page)
    const remountLogs = countRpcSince(requests, remountPhase, "getLog")
    const remountStatusCalls = countRpcSince(requests, remountPhase, "getStatus")
    const remountRefCalls = countRpcSince(requests, remountPhase, "getRefs")
    const refsAfter = refsSignature(
      (await fetchRpc(TEMP_ORIGIN, "getRefs", { repositoryId: tempRepo.id })).body.result.refs,
    )
    metrics.remount = {
      candidate,
      before,
      immediate,
      restored,
      remountLogs,
      remountStatusCalls,
      remountRefCalls,
      refsUnchanged: refsBefore === refsAfter,
    }
    checkResult(
      checks,
      "panel remount paints cached history immediately without a repository loading skeleton",
      immediate.present &&
        immediate.rows > 0 &&
        !immediate.loadingSkeleton &&
        !immediate.skeletonSeen &&
        immediate.paintMs < 2_000 &&
        immediate.branch.length > 0,
      { immediate },
    )
    checkResult(
      checks,
      "panel remount restores scrollTop and the expanded commit within 1px/same hash",
      restored.scrollTop !== null &&
        before.scrollTop !== null &&
        Math.abs(restored.scrollTop - before.scrollTop) <= 1 &&
        restored.expandedHash === before.expandedHash &&
        restored.slotPresent,
      { before, restored },
    )
    checkResult(
      checks,
      "unchanged HEAD/refs remount validates without re-running getLog",
      remountLogs === 0,
      { getLog: remountLogs, getStatus: remountStatusCalls, getRefs: remountRefCalls },
    )
    checkResult(
      checks,
      "remount keeps refs unchanged and the restored panel remains interactive",
      refsBefore === refsAfter && restored.slotPresent,
      { refsUnchanged: refsBefore === refsAfter, restored },
    )

    const interactionIndex = Math.min(candidate + 1, log.commits.length - 1)
    const interactionRow = page.locator(`.gg-graph-row[data-index="${interactionIndex}"]`)
    if (await interactionRow.count()) {
      await scrollToRowIndex(page, interactionIndex)
      await interactionRow.locator(".gg-subject").click()
      await waitForAny(page, SELECTORS.inlineSlot)
      await waitRaf(page, 2)
      const interacted = await panelPaintState(page)
      checkResult(
        checks,
        "remount cache painting does not block later row interaction",
        interacted.rows > 0 && interacted.slotPresent && !interacted.loadingSkeleton,
        { interacted },
      )
    } else {
      checkResult(checks, "remount cache painting does not block later row interaction", false, { candidate })
    }

    // External commit on TEMP: remount (or the watcher event) must add it
    // without losing the approximate reading position.
    const externalBefore = await panelPaintState(page)
    const externalPhase = requests.length
    createdCommit = createTempCommit(tempRepo.rootPath, "gg-remount-commit")
    await remountPanel(page)
    await waitRaf(page, 2)
    const externalAfter = await panelPaintState(page)
    await page.locator(SELECTORS.historyScroll[0]).evaluate((element) => {
      element.scrollTop = 0
    })
    await waitRaf(page, 2)
    await waitForVisibleCommit(page, createdCommit.head, 10_000)
    await waitNotBusy(page)
    await waitRequestQuiet(requests)
    const externalLogs = countRpcSince(requests, externalPhase, "getLog")
    metrics.remountExternal = {
      head: createdCommit.head,
      before: externalBefore,
      after: externalAfter,
      logs: externalLogs,
    }
    checkResult(
      checks,
      "external commit is visible after remount with the reading position broadly preserved",
      externalAfter.rows > 0 &&
        !externalAfter.loadingSkeleton &&
        externalAfter.scrollTop !== null &&
        externalBefore.scrollTop !== null &&
        Math.abs(externalAfter.scrollTop - externalBefore.scrollTop) <= rowHeight * 3,
      { before: externalBefore, after: externalAfter, rowHeight, logs: externalLogs },
    )
    checkResult(
      checks,
      "external commit remount stays within a bounded getLog refresh",
      externalLogs <= 3,
      { getLog: externalLogs },
    )
  } catch (error) {
    checkResult(checks, "cache remount scenario executes", false, { error: String(error) })
  } finally {
    if (baseHead) {
      runGitAllowFailure(tempRepo.rootPath, ["checkout", baseBranch])
      runGitAllowFailure(tempRepo.rootPath, ["reset", "--hard", baseHead])
    }
    if (createdCommit) {
      try {
        unlinkSync(join(tempRepo.rootPath, createdCommit.name))
      } catch {
        /* best-effort TEMP cleanup */
      }
    }
    await context.close().catch(() => {})
  }
}

/**
 * Bottom-follow needs the expanded slot to actually sit at the real bottom.
 * The FR history auto-paginates, which keeps moving that bottom, so this uses
 * the small TEMP fixture (6 rows, hasMore=false) in a short viewport: the
 * content still overflows, but parking at the bottom is stable.
 */
async function slotBottomFollowScenario(browser, tempRepo, checks, metrics) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 420 }, locale: "en-US" })
  try {
    const page = await context.newPage()
    await page.goto(TEMP_BASE, { waitUntil: "domcontentloaded" })
    await page.waitForFunction(
      () => document.querySelectorAll('[data-testid="repository-select"] option').length >= 1,
      null,
      { timeout: 30_000 },
    )
    await page.locator(SELECTORS.repository[0]).selectOption(tempRepo.id)
    await waitRows(page, 1)
    await waitNotBusy(page)
    const log = (await fetchRpc(TEMP_ORIGIN, "getLog", { repositoryId: tempRepo.id, limit: 100 })).body.result
    let bottomCandidate = -1
    for (let index = log.commits.length - 1; index >= 0; index -= 1) {
      const files = await fetchRpc(TEMP_ORIGIN, "getCommitFiles", {
        repositoryId: tempRepo.id,
        hash: log.commits[index].hash,
        parentIndex: 0,
      })
      if ((files.body?.result?.files?.length ?? 0) > 0) {
        bottomCandidate = index
        break
      }
    }
    checkResult(checks, "bottom-follow fixture has a file-bearing tail commit", bottomCandidate >= 0, { bottomCandidate, commits: log.commits.length })
    if (bottomCandidate < 0) return
    await scrollToRowIndex(page, bottomCandidate)
    await page.locator(`.gg-graph-row[data-index="${bottomCandidate}"] .gg-subject`).click()
    await waitForAny(page, SELECTORS.inlineSlot)
    await page.waitForFunction(
      () => {
        const tree = document.querySelector('[data-testid="inline-files"]')
        return Boolean(tree) && !tree.querySelector(".gg-status")
      },
      null,
      { timeout: 20_000 },
    ).catch(() => {})
    await waitRaf(page, 2)
    await scrollToBottom(page)
    const before = await slotSnapshot(page)
    const minDrag = await dragSlotHandle(page, -4000)
    await scrollToBottom(page)
    const shrunk = await slotSnapshot(page)
    const growDrag = await dragSlotHandle(page, 120)
    const after = growDrag.after
    const viewport = page.viewportSize() ?? { width: 1280, height: 420 }
    const handleVisible =
      Boolean(before.handle) &&
      before.handle.top >= 0 &&
      shrunk.handle !== null &&
      shrunk.handle.top >= 0 &&
      shrunk.handle.bottom <= viewport.height
    const handleFullLine =
      Boolean(before.slot && before.handle) &&
      Math.abs(before.handle.left - before.slot.left) <= 1.5 &&
      Math.abs(before.handle.right - before.slot.right) <= 1.5
    checkResult(checks, "bottom-follow handle is a visible full-line hit area at the scroller bottom", handleVisible && handleFullLine, { before: before.handle, shrunk: shrunk.handle, viewportHeight: viewport.height, handleFullLine })
    checkResult(
      checks,
      "slot drag clamps to the 96px minimum height at the bottom",
      shrunk.slotHeight !== null && shrunk.slotHeight >= SLOT_MIN_HEIGHT - 0.5 && shrunk.slotHeight <= SLOT_MIN_HEIGHT + 1.5,
      { minHeight: shrunk.slotHeight, deltaY: minDrag.deltaY },
    )
    checkResult(
      checks,
      "slot resize at the bottom keeps the scroller pinned to the bottom",
      after.distanceToBottom !== null && Math.abs(after.distanceToBottom) <= 1.5,
      { before: shrunk, after },
    )
    checkResult(
      checks,
      "slot grow at the bottom follows the content instead of jumping",
      after.scrollTop !== null &&
        shrunk.scrollTop !== null &&
        after.scrollTop >= shrunk.scrollTop - 1 &&
        after.scrollHeight > shrunk.scrollHeight,
      { scrollTopBefore: shrunk.scrollTop, scrollTopAfter: after.scrollTop, scrollHeightBefore: shrunk.scrollHeight, scrollHeightAfter: after.scrollHeight },
    )
    metrics.slotBottomFollow = {
      candidate: bottomCandidate,
      before: shrunk.slotHeight,
      after: after.slotHeight,
      scrollTop: { before: shrunk.scrollTop, after: after.scrollTop },
      scrollHeight: { before: shrunk.scrollHeight, after: after.scrollHeight },
      distanceToBottom: after.distanceToBottom,
    }
    await screenshot(page, "17b-temp-slot-bottom-follow.png", { fullPage: true })
  } catch (error) {
    checkResult(checks, "slot bottom-follow scenario executes", false, { error: String(error) })
  } finally {
    await context.close().catch(() => {})
  }
}

async function uncommittedCleanScenario(browser, frPrimary, checks, metrics) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "en-US" })
  try {
    const repositories = (await fetchRpc(FR_ORIGIN, "listRepositories", {})).body.result.repositories
    const isCleanStatus = (value) =>
      value.counts.staged === 0 &&
      value.counts.unstaged === 0 &&
      value.counts.untracked === 0 &&
      value.counts.conflicted === 0
    let cleanRepo = frPrimary
    let status = (await fetchRpc(FR_ORIGIN, "getStatus", { repositoryId: cleanRepo.id })).body.result
    if (!isCleanStatus(status)) {
      for (const candidate of repositories) {
        if (candidate.id === frPrimary.id) continue
        const next = (await fetchRpc(FR_ORIGIN, "getStatus", { repositoryId: candidate.id })).body.result
        if (isCleanStatus(next)) {
          cleanRepo = candidate
          status = next
          break
        }
      }
    }
    const page = await context.newPage()
    await page.goto(FR_BASE, { waitUntil: "domcontentloaded" })
    await page.waitForFunction(
      () => document.querySelectorAll('[data-testid="repository-select"] option').length >= 1,
      null,
      { timeout: 30_000 },
    )
    await page.locator(SELECTORS.repository[0]).selectOption(cleanRepo.id)
    await waitLoaded(page, 100)
    await waitRows(page, 1)
    await waitNotBusy(page)
    const snapshot = await uncommittedSnapshot(page)
    const legacyCount = await page.locator(LEGACY_CHANGES_SELECTOR).count()
    const counts = status.counts
    const clean = counts.staged === 0 && counts.unstaged === 0 && counts.untracked === 0 && counts.conflicted === 0
    checkResult(checks, "FR history exposes an Uncommitted changes row", snapshot.present, snapshot)
    checkResult(
      checks,
      "Uncommitted changes row is outside commit indexing",
      snapshot.present && snapshot.isCommitRow === false && snapshot.commitIndexCount > 0,
      { isCommitRow: snapshot.isCommitRow, commitIndexCount: snapshot.commitIndexCount },
    )
    checkResult(
      checks,
      "clean Uncommitted changes row shows zero counts",
      clean && snapshot.present && /\b0\b/.test(snapshot.text) && snapshot.fileCount === 0,
      { statusCounts: counts, text: snapshot.text, fileCount: snapshot.fileCount },
    )
    checkResult(checks, "legacy standalone Changes section is absent", legacyCount === 0, { legacyCount })
    await openUncommitted(page)
    await waitRaf(page, 2)
    const cleanSlot = await uncommittedSlotSnapshot(page)
    let cleanSlotState = { notPresent: false, slotPresent: cleanSlot.slotPresent }
    if (cleanSlot.slotPresent) {
      const cleanDecoration = await hoverDecoration(
        page,
        '[data-testid="uncommitted-slot"] [data-testid="slot-resize-handle"]',
      )
      const cleanSpans =
        Boolean(cleanSlot.slot && cleanSlot.handle) &&
        Math.abs(cleanSlot.handle.left - cleanSlot.slot.left) <= 1.5 &&
        Math.abs(cleanSlot.handle.right - cleanSlot.slot.right) <= 1.5
      checkResult(
        checks,
        "FR clean uncommitted slot exposes the full-line resize handle",
        cleanSlot.handleCount === 1 && cleanSpans && !cleanDecoration.smallWidgetInside,
        { cleanSlot, cleanDecoration },
      )
      if (cleanSlot.handleCount === 1) {
        const cleanDrag = await dragUncommittedSlotHandle(page, 32)
        cleanSlotState = { ...cleanSlotState, drag: cleanDrag }
        checkResult(
          checks,
          "FR clean uncommitted slot can be resized by pointer",
          cleanDrag.before.slotHeight !== null &&
            cleanDrag.after.slotHeight !== null &&
            Math.abs(cleanDrag.after.slotHeight - cleanDrag.before.slotHeight) >= 2,
          { before: cleanDrag.before.slotHeight, after: cleanDrag.after.slotHeight },
        )
      }
    } else {
      cleanSlotState = { notPresent: true }
      checkResult(
        checks,
        "FR clean uncommitted slot resize is notPresent",
        true,
        { notPresent: true, counts },
      )
    }
    metrics.uncommittedClean = { counts, snapshot, legacyCount, slotResize: cleanSlotState }
    await screenshot(page, "18-fr-uncommitted-clean.png", { fullPage: true })
  } catch (error) {
    checkResult(checks, "clean uncommitted row scenario executes", false, { error: String(error) })
  } finally {
    await context.close().catch(() => {})
  }
}

async function uncommittedScenario(browser, tempRepo, checks, metrics) {
  const fixture = await prepareDirtyTempFixture(tempRepo)
  if (!fixture.ok) {
    checkResult(checks, "TEMP uncommitted fixture can be prepared safely", false, fixture)
    return
  }
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "en-US" })
  try {
    const page = await context.newPage()
    await page.goto(TEMP_BASE, { waitUntil: "domcontentloaded" })
    await page.waitForFunction(
      () => document.querySelectorAll('[data-testid="repository-select"] option').length >= 2,
      null,
      { timeout: 30_000 },
    )
    await page.locator(SELECTORS.repository[0]).selectOption(tempRepo.id)
    await waitRows(page, 1)
    await waitNotBusy(page)
    const status = (await fetchRpc(TEMP_ORIGIN, "getStatus", { repositoryId: tempRepo.id })).body.result
    const counts = status.counts
    const snapshot = await uncommittedSnapshot(page)
    const legacyCount = await page.locator(LEGACY_CHANGES_SELECTOR).count()
    checkResult(
      checks,
      "TEMP dirty fixture reaches all four Uncommitted groups",
      counts.staged > 0 && counts.unstaged > 0 && counts.untracked > 0 && counts.conflicted > 0,
      { counts, files: status.files.map((file) => ({ path: file.path, status: file.status, staged: file.staged })) },
    )
    checkResult(checks, "Uncommitted changes row shows a counts badge", snapshot.present && typeof snapshot.counts === "string" && snapshot.counts.length > 0, snapshot)
    checkResult(
      checks,
      "Uncommitted counts badge matches the real status counts",
      snapshot.present &&
        ["staged", "unstaged", "untracked", "conflicted"].every(
          (kind) => counts[kind] === 0 || snapshot.countsByKind?.[kind] === counts[kind],
        ),
      { counts, countsByKind: snapshot.countsByKind },
    )
    checkResult(checks, "legacy standalone Changes section is absent in TEMP", legacyCount === 0, { legacyCount })
    await openUncommitted(page)
    const opened = await uncommittedSnapshot(page)
    checkResult(
      checks,
      "Uncommitted row expands Staged/Unstaged/Untracked/Conflicted groups",
      ["Staged", "Unstaged", "Untracked", "Conflicted"].every((label) =>
        opened.groups.some((text) => new RegExp(`(?:^|[\\s\\u25BE\\u25B8])${label}(?:\\s|\\d|$)`, "i").test(text)),
      ),
      { groups: opened.groups },
    )
    checkResult(
      checks,
      "Uncommitted group File rows are real changed files",
      opened.fileCount >= 4 && opened.files.some((text) => text.includes(fixture.stagedPath)) && opened.files.some((text) => text.includes(fixture.unstagedPath)),
      { fileCount: opened.fileCount, files: opened.files },
    )

    const verifyDiff = async (label, path, expectedTarget) => {
      const group = uncommittedGroupButton(page, label)
      if ((await group.count()) === 0) {
        checkResult(checks, `Uncommitted ${label} group is reachable`, false, {})
        return
      }
      if ((await group.getAttribute("aria-expanded")) !== "true") {
        await group.click()
        await waitRaf(page, 2)
      }
      const fileRow = page
        .locator(
          '[data-testid="uncommitted-slot"] .gg-file-row, [data-testid="uncommitted-files"] .gg-file-row, [data-testid="uncommitted-body"] .gg-file-row, [data-testid="uncommitted-groups"] .gg-file-row, .gg-uncommitted-body .gg-file-row',
        )
        .filter({ hasText: path })
        .first()
      if ((await fileRow.count()) === 0) {
        checkResult(checks, `Uncommitted ${label} file row is reachable`, false, { path })
        return
      }
      const requestPromise = page.waitForRequest(
        (request) => request.url().endsWith("/__gg/rpc/getDiff"),
        { timeout: 20_000 },
      )
      await fileRow.click()
      const input = parseInput(await requestPromise)
      await waitForAny(page, SELECTORS.statusDiffPage)
      const fullPageSource = await page
        .locator('[data-testid="commit-diff-page"]')
        .getAttribute("data-diff-source")
        .catch(() => null)
      checkResult(
        checks,
        `Uncommitted ${label} file opens the ${expectedTarget} full-page diff`,
        input?.target?.type === expectedTarget &&
          input?.path === path &&
          fullPageSource === expectedTarget,
        { input, fullPageSource },
      )
      await screenshot(page, `19-temp-uncommitted-${expectedTarget}.png`, { fullPage: true })
      const back = await anyLocator(page, SELECTORS.detailsBack)
      if (back) await back.click()
      await page.waitForFunction(
        () => !document.querySelector('[data-testid="commit-diff-page"], [data-testid="diff-page"], [data-testid="status-diff-page"]'),
        null,
        { timeout: 10_000 },
      ).catch(() => {})
      await waitRaf(page, 2)
    }

    await verifyDiff("Staged", fixture.stagedPath, "index")
    await verifyDiff("Unstaged", fixture.unstagedPath, "working-tree")

    // Uncommitted slot uses the same bottom-divider resize contract as commit
    // slots. A short viewport makes the slot content overflow so both bottom and
    // non-bottom drags are meaningful.
    await page.setViewportSize({ width: 1280, height: 420 })
    await waitRaf(page, 3)
    await page.locator(SELECTORS.historyScroll[0]).evaluate((element) => {
      element.scrollTop = 0
    })
    await waitRaf(page, 2)
    await openUncommitted(page)
    const initialSlot = await uncommittedSlotSnapshot(page)
    const slotDecoration = await hoverDecoration(
      page,
      '[data-testid="uncommitted-slot"] [data-testid="slot-resize-handle"]',
    )
    const handleSpansSlot =
      Boolean(initialSlot.slot && initialSlot.handle) &&
      Math.abs(initialSlot.handle.left - initialSlot.slot.left) <= 1.5 &&
      Math.abs(initialSlot.handle.right - initialSlot.slot.right) <= 1.5 &&
      Math.abs(initialSlot.handle.bottom - initialSlot.slot.bottom) <= 1.5 &&
      initialSlot.handle.height >= 1 &&
      initialSlot.handle.height <= 12
    checkResult(
      checks,
      "Uncommitted slot exposes the full-line bottom resize handle",
      initialSlot.slotPresent &&
        initialSlot.handleCount === 1 &&
        handleSpansSlot &&
        !slotDecoration.smallWidgetInside,
      { initialSlot, slotDecoration },
    )
    const grow = await dragUncommittedSlotHandle(page, -36)
    checkResult(
      checks,
      "Uncommitted slot pointer drag changes its height",
      grow.before.slotHeight !== null &&
        grow.after.slotHeight !== null &&
        Math.abs(grow.after.slotHeight - grow.before.slotHeight) >= 2,
      { before: grow.before.slotHeight, after: grow.after.slotHeight },
    )
    checkResult(
      checks,
      "Uncommitted slot drag away from the bottom preserves the scroll position",
      grow.before.scrollTop !== null &&
        grow.after.scrollTop !== null &&
        Math.abs(grow.after.scrollTop - grow.before.scrollTop) <= 1 &&
        grow.before.row &&
        grow.after.row &&
        Math.abs(grow.after.row.top - grow.before.row.top) <= 1,
      { before: grow.before, after: grow.after },
    )
    const minimum = await dragUncommittedSlotHandle(page, -4000)
    checkResult(
      checks,
      "Uncommitted slot drag clamps to the 96px minimum",
      minimum.after.slotHeight !== null &&
        minimum.after.slotHeight >= SLOT_MIN_HEIGHT - 0.5 &&
        minimum.after.slotHeight <= SLOT_MIN_HEIGHT + 1.5,
      { height: minimum.after.slotHeight },
    )
    const maximum = await dragUncommittedSlotHandle(page, 4000)
    const viewportHeight = maximum.after.clientHeight ?? 0
    const expectedMax = Math.max(SLOT_MIN_HEIGHT, Math.min(560, viewportHeight - 80))
    checkResult(
      checks,
      "Uncommitted slot drag grows to the dynamic viewport maximum",
      maximum.after.slotHeight !== null &&
        maximum.after.slotHeight > minimum.after.slotHeight &&
        Math.abs(maximum.after.slotHeight - expectedMax) <= 1,
      { height: maximum.after.slotHeight, expectedMax, viewportHeight },
    )
    const mid = await dragUncommittedSlotHandle(page, -80)
    await page.locator(SELECTORS.historyScroll[0]).evaluate((element) => {
      element.scrollTop = element.scrollHeight
    })
    await waitRaf(page, 2)
    const bottomBefore = await dragUncommittedSlotHandle(page, 20)
    checkResult(
      checks,
      "Uncommitted slot drag at the bottom keeps the scroller bottom-following",
      bottomBefore.after.distanceToBottom !== null &&
        Math.abs(bottomBefore.after.distanceToBottom) <= 1.5,
      { before: bottomBefore.before, after: bottomBefore.after },
    )
    const savedHeight = bottomBefore.after.slotHeight
    const uncommittedRow = page.locator(UNCOMMITTED_ROW_SELECTOR).first()
    await uncommittedRow.click({ position: { x: 8, y: 8 } })
    await page.waitForFunction(
      () => !document.querySelector('[data-testid="uncommitted-slot"]'),
      null,
      { timeout: 10_000 },
    )
    await uncommittedRow.click({ position: { x: 8, y: 8 } })
    await waitForAny(page, SELECTORS.uncommittedBody)
    await page.waitForFunction(
      () => Boolean(document.querySelector('[data-testid="uncommitted-slot"]')),
      null,
      { timeout: 10_000 },
    )
    await waitRaf(page, 3)
    const reopenedSlot = await uncommittedSlotSnapshot(page)
    checkResult(
      checks,
      "Uncommitted slot height persists for the session after collapse/reopen",
      savedHeight !== null &&
        reopenedSlot.slotHeight !== null &&
        Math.abs(reopenedSlot.slotHeight - savedHeight) <= 1,
      { savedHeight, reopened: reopenedSlot.slotHeight },
    )
    metrics.uncommitted = { counts, snapshot: opened, legacyCount, slotResize: { initialSlot, grow, minimum: minimum.after, maximum: maximum.after, bottom: bottomBefore, reopenedSlot } }
  } catch (error) {
    checkResult(checks, "Uncommitted changes scenario executes", false, { error: String(error) })
  } finally {
    await context.close().catch(() => {})
    fixture.cleanup()
  }
}

async function fetchScenario(browser, tempRepo, checks, metrics) {
  const tempStatus = (await fetchRpc(TEMP_ORIGIN, "getStatus", { repositoryId: tempRepo.id })).body.result
  let remote
  try {
    remote = setupFetchRemote(tempRepo, tempStatus)
  } catch (error) {
    checkResult(checks, "TEMP local bare fetch remote can be created", false, { error: String(error) })
    return
  }
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "en-US" })
  const fetchRequests = []
  let fetchResult = null
  try {
    const page = await context.newPage()
    page.on("request", (request) => {
      if (!request.url().endsWith(`/__gg/rpc/${FETCH_METHOD}`)) return
      fetchRequests.push({ input: parseInput(request), at: Date.now() })
    })
    await page.goto(TEMP_BASE, { waitUntil: "domcontentloaded" })
    await page.waitForFunction(
      () => document.querySelectorAll('[data-testid="repository-select"] option').length >= 2,
      null,
      { timeout: 30_000 },
    )
    await page.locator(SELECTORS.repository[0]).selectOption(tempRepo.id)
    await waitRows(page, 1)
    await waitNotBusy(page)

    const fetchButton = await anyLocator(page, SELECTORS.fetchButton)
    checkResult(checks, "toolbar exposes a fetch button", Boolean(fetchButton), {})
    if (!fetchButton) return
    const fetchEnabled = !(await fetchButton.isDisabled().catch(() => true))
    checkResult(checks, "fetch button is enabled when remotes exist", fetchEnabled, {})
    if (!fetchEnabled) return

    // Cancel must not issue any fetch RPC.
    await fetchButton.click()
    await waitForAny(page, SELECTORS.fetchDialog)
    await screenshot(page, "20-temp-fetch-dialog.png", { fullPage: true })
    const requestsBeforeCancel = fetchRequests.length
    const cancel = await anyLocator(page, SELECTORS.fetchCancel)
    checkResult(checks, "fetch confirmation has a cancel action", Boolean(cancel), {})
    if (cancel) {
      await cancel.click()
      await page.waitForFunction(
        () => !document.querySelector('[data-testid="fetch-dialog"], [data-testid="fetch-confirm-dialog"], [data-testid="confirm-dialog"]'),
        null,
        { timeout: 10_000 },
      ).catch(() => {})
      await waitRaf(page, 3)
    }
    checkResult(
      checks,
      "fetch cancel sends zero fetch RPCs",
      fetchRequests.length === requestsBeforeCancel && fetchRequests.length === 0,
      { before: requestsBeforeCancel, after: fetchRequests.length },
    )

    // Confirmed fetch against the local bare remote.
    await fetchButton.click()
    await waitForAny(page, SELECTORS.fetchDialog)
    const remoteSelect = await anyLocator(page, SELECTORS.fetchRemote)
    checkResult(checks, "fetch dialog exposes a remote selector", Boolean(remoteSelect), {})
    if (!remoteSelect) return
    const optionCount = await remoteSelect.locator("option").count()
    let selected = false
    for (let index = 0; index < optionCount; index += 1) {
      const option = remoteSelect.locator("option").nth(index)
      const value = await option.getAttribute("value")
      const label = (await option.textContent()) ?? ""
      if (value === remote.remoteName || label.trim() === remote.remoteName) {
        await remoteSelect.selectOption(value ? value : { label: remote.remoteName })
        selected = true
        break
      }
    }
    checkResult(checks, "fetch dialog can select the local bare remote", selected, { remote: remote.remoteName, optionCount })
    if (!selected) return

    const prune = await anyLocator(page, SELECTORS.fetchPrune)
    checkResult(checks, "fetch dialog exposes a prune control", Boolean(prune), {})
    if (prune) {
      const type = await prune.getAttribute("type")
      if (type === "checkbox") await prune.check().catch(() => {})
      else await prune.click().catch(() => {})
    }
    const expectedHeadControl = await anyLocator(page, SELECTORS.fetchExpectedHead)
    if (expectedHeadControl) {
      const expectedHeadText = `${await expectedHeadControl.inputValue().catch(() => "")} ${await expectedHeadControl.textContent().catch(() => "")}`
      checkResult(checks, "fetch dialog exposes the expected HEAD", expectedHeadText.includes(tempStatus.head ?? ""), { expectedHead: tempStatus.head })
    } else {
      checkResult(checks, "fetch dialog exposes the expected HEAD", false, { note: "no fetch-expected-head/fetch-head testid; request guard still asserts it" })
    }

    const responsePromise = page.waitForResponse(
      (response) => response.url().endsWith(`/__gg/rpc/${FETCH_METHOD}`),
      { timeout: 30_000 },
    )
    const refsRefresh = page.waitForRequest(
      (request) => request.url().endsWith("/__gg/rpc/getRefs"),
      { timeout: 30_000 },
    ).catch(() => null)
    const logRefresh = page.waitForRequest(
      (request) => request.url().endsWith("/__gg/rpc/getLog"),
      { timeout: 30_000 },
    ).catch(() => null)
    const confirm = await anyLocator(page, SELECTORS.fetchConfirm)
    checkResult(checks, "fetch confirmation has a confirm action", Boolean(confirm), {})
    if (!confirm) return
    await confirm.click()
    const response = await responsePromise
    const body = await response.json().catch(() => null)
    await Promise.allSettled([refsRefresh, logRefresh])
    const result = body?.result
    fetchResult = result ?? null
    const refsUpdated = Array.isArray(result?.refsUpdated) ? result.refsUpdated.length : result?.refsUpdated
    checkResult(
      checks,
      "confirmed fetch returns refsUpdated/changed/status",
      response.status() === 200 &&
        body?.ok === true &&
        typeof refsUpdated === "number" &&
        refsUpdated > 0 &&
        result?.changed === true &&
        result?.status?.head === tempStatus.head,
      { status: response.status(), result },
    )
    checkResult(
      checks,
      "fetch request carries remote/prune/expectedHead/confirmed",
      fetchRequests.some(
        (entry) =>
          entry.input?.repositoryId === tempRepo.id &&
          entry.input?.remote === remote.remoteName &&
          typeof entry.input?.prune === "boolean" &&
          entry.input?.expectedHead === tempStatus.head &&
          entry.input?.confirmed === true,
      ),
      { requests: fetchRequests },
    )
    const refsAfter = (await fetchRpc(TEMP_ORIGIN, "getRefs", { repositoryId: tempRepo.id })).body.result.refs
    checkResult(
      checks,
      "confirmed fetch refreshes the new remote-tracking ref",
      refsAfter.some((ref) => ref.kind === "remote" && ref.name === `${remote.remoteName}/fetch-target`),
      { remote: `${remote.remoteName}/fetch-target`, refs: refsAfter.filter((ref) => ref.kind === "remote").length },
    )
    await waitRaf(page, 4)
    const remoteBadge = page
      .locator(`[data-testid="ref-badge"][data-ref-name="${remote.remoteName}/fetch-target"]`)
      .first()
    await remoteBadge.waitFor({ state: "visible", timeout: 20_000 }).catch(() => {})
    const badgeCount = await page
      .locator(`[data-testid="ref-badge"][data-ref-name="${remote.remoteName}/fetch-target"]`)
      .count()
    // A commit with many refs may put the new remote behind the "+N" budget
    // badge; the overflow title still proves the refreshed ref reached the row.
    const overflowTitle = await page
      .locator('[data-testid="ref-more"]')
      .first()
      .getAttribute("title")
      .catch(() => "")
    checkResult(
      checks,
      "fetch success refreshes visible refs/history",
      badgeCount > 0 || (overflowTitle ?? "").includes(`${remote.remoteName}/fetch-target`),
      { badgeCount, overflowTitle },
    )
    await screenshot(page, "21-temp-fetch-success.png", { fullPage: true })

    // Failure reason injection: only the bounded reason may reach the user.
    const injectedReason = "fetch_failed"
    await page.route(`**/__gg/rpc/${FETCH_METHOD}`, async (route) => {
      fetchRequests.push({ input: parseInput(route.request()), injected: true })
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            type: "mutation_rejected",
            message: "Fetch rejected",
            data: { reason: injectedReason, path: "C:\\private\\secret-fetch.git" },
          },
        }),
      })
    })
    await fetchButton.click()
    await waitForAny(page, SELECTORS.fetchDialog)
    const failureResponse = page.waitForResponse(
      (response) => response.url().endsWith(`/__gg/rpc/${FETCH_METHOD}`),
      { timeout: 20_000 },
    )
    await confirm.click().catch(async () => {
      const fallback = await anyLocator(page, SELECTORS.fetchConfirm)
      if (fallback) await fallback.click()
    })
    await failureResponse.catch(() => null)
    await page.waitForFunction(
      () => Boolean(document.querySelector('[data-testid="fetch-error"], [data-testid="mutation-warning"], [data-testid="mutation-notice"], .gg-mutation-warning, .gg-mutation-notice')),
      null,
      { timeout: 20_000 },
    ).catch(() => {})
    const failureText = await anyLocator(page, SELECTORS.fetchError)
      .then((element) => element?.innerText().catch(() => "") ?? "")
      .catch(() => "")
    checkResult(checks, "injected fetch failure surfaces the bounded reason", failureText.includes(injectedReason), { failureText })
    checkResult(
      checks,
      "fetch failure does not leak injected private paths",
      !/C:\\private|secret-fetch\.git/i.test(failureText),
      { failureText },
    )
    await screenshot(page, "22-temp-fetch-failure.png", { fullPage: true })
    await page.unroute(`**/__gg/rpc/${FETCH_METHOD}`).catch(() => {})
    metrics.fetch = { remote: remote.remoteName, requests: fetchRequests, result: fetchResult }
  } catch (error) {
    checkResult(checks, "confirmed fetch scenario executes", false, { error: String(error) })
  } finally {
    await context.close().catch(() => {})
    remote.cleanup()
  }
}

async function frFetchGuardScenario(browser, frPrimary, checks, metrics) {
  const status = (await fetchRpc(FR_ORIGIN, "getStatus", { repositoryId: frPrimary.id })).body.result
  const refsBefore = (await fetchRpc(FR_ORIGIN, "getRefs", { repositoryId: frPrimary.id })).body.result.refs
  const direct = await fetchRpc(FR_ORIGIN, FETCH_METHOD, {
    repositoryId: frPrimary.id,
    remote: "__gg_release_guard__",
    prune: false,
    expectedHead: status.head,
    confirmed: true,
  })
  const refsAfterDirect = (await fetchRpc(FR_ORIGIN, "getRefs", { repositoryId: frPrimary.id })).body.result.refs
  checkResult(checks, "FR fetch is still rejected with HTTP 403", direct.status === 403, { status: direct.status, body: direct.body })
  checkResult(
    checks,
    "FR fetch guard leaves HEAD and refs unchanged",
    refsSignature(refsAfterDirect) === refsSignature(refsBefore),
    { before: refsBefore.length, after: refsAfterDirect.length },
  )

  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "en-US" })
  const intercepted = []
  try {
    const page = await context.newPage()
    await page.route(`**/__gg/rpc/${FETCH_METHOD}`, async (route) => {
      intercepted.push({ input: parseInput(route.request()), blocked: true })
      await route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({
          error: { type: "rpc.method_forbidden", message: "Mutation methods are not available in FR read-only mode" },
        }),
      })
    })
    await page.goto(FR_BASE, { waitUntil: "domcontentloaded" })
    await page.waitForFunction(
      () => document.querySelectorAll('[data-testid="repository-select"] option').length >= 1,
      null,
      { timeout: 30_000 },
    )
    await page.locator(SELECTORS.repository[0]).selectOption(frPrimary.id)
    await waitLoaded(page, 100)
    await waitRows(page, 1)
    await waitNotBusy(page)
    const fetchButton = await anyLocator(page, SELECTORS.fetchButton)
    checkResult(checks, "FR toolbar exposes the fetch confirmation entry", Boolean(fetchButton), {})
    if (fetchButton) {
      await fetchButton.click().catch(() => {})
      await waitForAny(page, SELECTORS.fetchDialog).catch(() => null)
      const remoteSelect = await anyLocator(page, SELECTORS.fetchRemote)
      if (remoteSelect && (await remoteSelect.locator("option").count()) > 1) {
        await remoteSelect.selectOption({ index: 1 }).catch(() => {})
      }
      const confirm = await anyLocator(page, SELECTORS.fetchConfirm)
      if (confirm) await confirm.click()
      await page.waitForResponse(
        (response) => response.url().endsWith(`/__gg/rpc/${FETCH_METHOD}`),
        { timeout: 20_000 },
      ).catch(() => null)
      await waitRaf(page, 3)
    }
    const refsAfterUi = (await fetchRpc(FR_ORIGIN, "getRefs", { repositoryId: frPrimary.id })).body.result.refs
    const fetchErrorElement = await anyLocator(page, SELECTORS.fetchError)
    const fetchErrorText = fetchErrorElement
      ? await fetchErrorElement.innerText().catch(() => "")
      : ""
    // The FR dev client intentionally does not expose mutation methods, so the
    // never-reaches-bridge case is a valid client-side block; if a request is
    // forced through, the intercepted 403 response must be the block instead.
    const clientBlocked =
      intercepted.length === 0 && /does not expose fetchRemote|not support|unavailable/i.test(fetchErrorText)
    const bridgeBlocked = intercepted.length > 0 && intercepted.every((entry) => entry.blocked === true)
    checkResult(
      checks,
      "FR fetch confirmation is blocked before any valid write",
      (clientBlocked || bridgeBlocked) && refsSignature(refsAfterUi) === refsSignature(refsBefore),
      { intercepted, fetchErrorText, clientBlocked, bridgeBlocked, before: refsBefore.length, after: refsAfterUi.length },
    )
    metrics.frFetchGuard = { direct, intercepted }
    await screenshot(page, "23-fr-fetch-forbidden.png", { fullPage: true })
  } catch (error) {
    checkResult(checks, "FR fetch guard scenario executes", false, { error: String(error) })
  } finally {
    await context.close().catch(() => {})
  }
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
    ...SELECTORS.fetchButton,
    ...SELECTORS.remountPanel,
    ...SELECTORS.uncommittedRow,
  ])
  await auditGroup("legacy-absent", [LEGACY_CHANGES_SELECTOR])
  await openUncommitted(page).catch(() => null)
  await auditGroup("uncommitted", [
    '[data-testid="uncommitted-row"]',
    '[data-testid="uncommitted-total"]',
    '[data-testid="uncommitted-slot"]',
    '[data-testid="uncommitted-files"]',
  ])
  const fetchButton = await anyLocator(page, SELECTORS.fetchButton)
  if (fetchButton) {
    await fetchButton.click().catch(() => {})
    await waitForAny(page, SELECTORS.fetchDialog).catch(() => null)
    await auditGroup("fetch-dialog", [
      '[data-testid="fetch-dialog"]',
      '[data-testid="fetch-remote-select"]',
      '[data-testid="fetch-prune"]',
      '[data-testid="fetch-dialog"] .gg-dialog-facts dd:nth-of-type(2)',
      '[data-testid="fetch-confirm"]',
      '[data-testid="fetch-cancel"]',
    ])
    const cancel = await anyLocator(page, SELECTORS.fetchCancel)
    if (cancel) await cancel.click().catch(() => {})
  }
  const inlineRow = page.locator(SELECTORS.row[0]).first()
  await inlineRow.locator(".gg-subject").click().catch(() => {})
  await waitForAny(page, SELECTORS.inlineSlot).catch(() => null)
  await auditGroup("inline-slot", [...SELECTORS.slotResizeHandle])
  await auditGroup("inline-divider", [...SELECTORS.inlineInfoDivider])
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
    '[data-testid="first-parent"]',
    '[data-testid="jump-head"]',
    '[data-testid="dense-graph"]',
    LEGACY_CHANGES_SELECTOR,
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
  result.sourceCheck = sourceRegistrationCheck()
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
  const sourceCheck = sourceRegistrationCheck()
  metrics.sourceCheck = sourceCheck
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
      () => document.querySelectorAll('[data-testid="repository-select"] option').length >= 1,
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
    const worktreeRepos = frRepos.filter((repo) => repo.type === "worktree")
    const optionEntries = await fr
      .locator(`${SELECTORS.repository[0]} option`)
      .evaluateAll((options) =>
        options
          .map((option) => ({ value: option.value, label: (option.textContent ?? "").trim() }))
          .filter((option) => option.value.length > 0),
      )
    const selectedBefore = await fr.locator(SELECTORS.repository[0]).inputValue()
    const initialRows = await fr.locator(SELECTORS.row[0]).count()
    const initialBranch = await fr.locator(SELECTORS.currentBranch[0]).innerText().catch(() => "")
    const initialFooter = await fr.locator(".gg-history-footer").innerText().catch(() => "")
    const repositoryLoads = []
    for (const option of optionEntries) {
      if (option.value === selectedBefore) {
        repositoryLoads.push({
          id: option.value,
          label: option.label,
          type: frRepos.find((repo) => repo.id === option.value)?.type ?? null,
          selectedOk: true,
          rows: initialRows,
          branch: initialBranch.trim(),
          footer: initialFooter.replace(/\s+/g, " ").trim(),
          errors: [],
          initial: true,
        })
        continue
      }
      const statusRequest = fr
        .waitForRequest(
          (request) => {
            if (!request.url().endsWith("/__gg/rpc/getStatus")) return false
            return parseInput(request)?.repositoryId === option.value
          },
          { timeout: 20_000 },
        )
        .catch(() => null)
      await fr.locator(SELECTORS.repository[0]).selectOption(option.value)
      await statusRequest
      await waitNotBusy(fr, 20_000).catch(() => {})
      await waitRows(fr, 1, 20_000).catch(() => {})
      const state = await fr.evaluate(() => ({
        selected: document.querySelector('[data-testid="repository-select"]')?.value ?? null,
        rows: document.querySelectorAll(".gg-graph-row:not(.gg-uncommitted-row)").length,
        branch: (document.querySelector('[data-testid="current-branch"]')?.textContent ?? "").trim(),
        footer: (document.querySelector(".gg-history-footer")?.innerText ?? "").replace(/\s+/g, " ").trim(),
        errors: [...document.querySelectorAll(".gg-error")].map((element) =>
          (element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 160),
        ),
      }))
      repositoryLoads.push({
        id: option.value,
        label: option.label,
        type: frRepos.find((repo) => repo.id === option.value)?.type ?? null,
        selectedOk: state.selected === option.value,
        rows: state.rows,
        branch: state.branch,
        footer: state.footer,
        errors: state.errors,
        initial: false,
      })
    }
    const worktreeLabels = worktreeRepos.map((repo) => {
      const option = optionEntries.find((entry) => entry.value === repo.id)
      return {
        id: repo.id,
        label: option?.label ?? null,
        hasWorktreeLabel: Boolean(option && /\(worktree\)/i.test(option.label)),
      }
    })
    metrics.repositories = {
      count: frRepos.length,
      worktrees: worktreeRepos.length,
      worktreeLabels: worktreeRepos.length > 0 ? worktreeLabels : "notPresent",
      options: optionEntries.length,
      loads: repositoryLoads,
    }
    const repositoryLoaded = (entry) =>
      entry.selectedOk &&
      entry.branch.length > 0 &&
      entry.errors.length === 0 &&
      (entry.rows > 0 || /\b0 loaded\b/.test(entry.footer))
    checkResult(
      checks,
      "FR repository picker loads every repository and labels worktrees when present",
      frRepos.length >= 1 &&
        optionEntries.length === frRepos.length &&
        repositoryLoads.length === optionEntries.length &&
        repositoryLoads.every(repositoryLoaded) &&
        (worktreeRepos.length === 0 || worktreeLabels.every((entry) => entry.hasWorktreeLabel)),
      {
        count: frRepos.length,
        worktrees: worktreeRepos.length,
        worktreeLabels: worktreeRepos.length > 0 ? worktreeLabels : "notPresent",
        loads: repositoryLoads.map((entry) => ({
          label: entry.label,
          type: entry.type,
          selectedOk: entry.selectedOk,
          rows: entry.rows,
          errors: entry.errors,
          initial: entry.initial,
        })),
      },
    )
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
    checkResult(checks, "graph starts at 240px with a resize handle and no graph scrollbar", layout.graph.headerWidth === 240 && layout.graph.rowWidth === 240 && layout.graph.handleCount >= 1 && !layout.graph.hasGraphScroll && layout.graph.scrollWidth <= layout.graph.clientWidth, layout.graph)
    checkResult(checks, "Date shows a 16-character YYYY-MM-DD HH:mm value and an ISO tooltip", layout.date.visible && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(layout.date.text) && layout.date.text.length === 16 && layout.date.scrollWidth <= layout.date.clientWidth + 1 && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(layout.date.title ?? ""), layout.date)
    checkResult(checks, "1100px has no body/panel horizontal overflow or nested buttons", layout.doc.scrollWidth <= layout.doc.clientWidth && layout.body.scrollWidth <= layout.body.clientWidth && layout.panelOverflowX <= 1 && layout.nestedButtons === 0, { doc: layout.doc, body: layout.body, panelOverflow: layout.panelOverflowX, nestedButtons: layout.nestedButtons })
    const frLabelStatus = (await fetchRpc(FR_ORIGIN, "getStatus", { repositoryId: frPrimary.id })).body.result
    const currentLabel1100 = await fullTextState(fr, SELECTORS.currentBranch[0], frLabelStatus.branch)
    const refBadges1100 = await refBadgeSnapshot(fr)
    metrics.labels1100 = { currentLabel1100, refBadges1100 }
    checkResult(
      checks,
      "current-branch and visible ref badges show full names without ellipsis at 1100px",
      currentLabel1100.present &&
        currentLabel1100.includesName &&
        currentLabel1100.noEllipsis &&
        currentLabel1100.fullyVisible &&
        refBadges1100.badges.every(
          (badge) => badge.noEllipsis && (badge.fullyVisible || badge.multiline),
        ) &&
        refBadges1100.more === null &&
        refBadges1100.containers.every(
          (container) => !container.horizontalScroll && container.count > 0,
        ),
      { currentLabel1100, refBadges1100 },
    )
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
      const mergeDense = await fr.locator('[data-testid="dense-graph"]').count()
      checkResult(checks, "dense graph keeps parent edges, fits the graph column and has no dense hint", mergeInfo.paths >= expectedParents && mergeInfo.graphScrollWidth <= mergeInfo.graphClientWidth && mergeDense === 0, { ...mergeInfo, expectedParents, mergeDense })
      await fr.locator(SELECTORS.historyScroll[0]).evaluate((element) => { element.scrollTop = 0 })
      await waitRaf(fr, 2)
    } else {
      checkResult(checks, "dense graph merge fixture exists", false, { commits: frLog.commits.length })
    }

    const nonGraphHandles = ["description", "date", "author", "commit"]
    const nonGraphDividers = []
    for (const name of nonGraphHandles) {
      nonGraphDividers.push({ name, geometry: await columnDividerGeometry(fr, name) })
      const drag = await dragColumn(fr, name, 12)
      checkResult(checks, `${name} column drag changes width`, Math.abs(drag.after - drag.before) > 1, drag)
    }
    const nonGraphDecoration = []
    for (const name of nonGraphHandles) {
      nonGraphDecoration.push({ name, decoration: await hoverDecoration(fr, COLUMN_DIVIDER_SELECTOR(name)) })
    }
    const nonGraphSync = await columnSync(fr)
    metrics.columnDividers = { nonGraphDividers, nonGraphDecoration, nonGraphSync }
    checkResult(
      checks,
      "header column dividers are ~5px hit areas without separate handle ornaments",
      nonGraphDividers.every(
        (entry) =>
          entry.geometry.present &&
          entry.geometry.width >= COLUMN_DIVIDER_MIN_WIDTH &&
          entry.geometry.width <= COLUMN_DIVIDER_MAX_WIDTH &&
          entry.geometry.boundaryDelta !== null &&
          entry.geometry.boundaryDelta <= 4 &&
          entry.geometry.cursor === "col-resize" &&
          !entry.geometry.ornament,
      ) && nonGraphDecoration.every((entry) => !entry.decoration.smallWidgetInside),
      { nonGraphDividers, nonGraphDecoration },
    )
    checkResult(
      checks,
      "header and history row widths stay in sync after column divider drags",
      nonGraphSync.length >= 4 && nonGraphSync.every((entry) => entry.row !== null && entry.delta <= 1),
      nonGraphSync,
    )
    const afterResize = await layoutSnapshot(fr)
    metrics.afterResize = afterResize
    checkResult(checks, "non-graph column drags do not overflow the panel", afterResize.panelOverflowX <= 1 && afterResize.doc.scrollWidth <= afterResize.doc.clientWidth, { panelOverflow: afterResize.panelOverflowX, doc: afterResize.doc })
    await screenshot(fr, "02-fr-columns-after-drag.png", { fullPage: true })

    const persistedBefore = await columnSync(fr)
    await fr.reload({ waitUntil: "domcontentloaded" })
    await fr.waitForFunction(
      () => document.querySelectorAll('[data-testid="repository-select"] option').length >= 1,
      null,
      { timeout: 30_000 },
    )
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
    const persistedAfter = await columnSync(fr)
    const persistedAll = persistedBefore.every((entry) => {
      const match = persistedAfter.find((candidate) => candidate.label === entry.label)
      return match && Math.abs(match.header - entry.header) <= 2 && match.delta <= 1
    })
    checkResult(checks, "column widths persist across reload and stay header/row synced", persistedAll, { before: persistedBefore, after: persistedAfter })

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
    checkResult(checks, "520px keeps the graph within its budget without horizontal overflow", narrow.graph.headerWidth <= 241 && narrow.graph.rowWidth <= 241 && !narrow.graph.hasGraphScroll && narrow.graph.scrollWidth <= narrow.graph.clientWidth, narrow.graph)
    const currentLabel520 = await fullTextState(fr, SELECTORS.currentBranch[0], frLabelStatus.branch)
    const refBadges520 = await refBadgeSnapshot(fr)
    const dense520 = await fr.locator('[data-testid="dense-graph"]').count()
    metrics.labels520 = { currentLabel520, refBadges520, dense520 }
    checkResult(
      checks,
      "520px keeps current-branch/ref names fully visible without ellipsis or page overflow",
      narrow.doc.scrollWidth <= narrow.doc.clientWidth &&
        narrow.body.scrollWidth <= narrow.body.clientWidth &&
        narrow.panelOverflowX <= 1 &&
        currentLabel520.present &&
        currentLabel520.includesName &&
        currentLabel520.noEllipsis &&
        currentLabel520.fullyVisible &&
        refBadges520.badges.every(
          (badge) => badge.noEllipsis && (badge.fullyVisible || badge.multiline),
        ) &&
        refBadges520.more === null &&
        refBadges520.containers.every(
          (container) => !container.horizontalScroll && container.count > 0,
        ) &&
        dense520 === 0,
      { doc: narrow.doc, body: narrow.body, panelOverflow: narrow.panelOverflowX, currentLabel520, refBadges520, dense520 },
    )
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
      const source = await findRepoWithRefKind(frRepos, kind, frPrimary)
      if (!source) {
        checkResult(checks, `${kind} ref fixture exists`, false, {})
        continue
      }
      const switchedForKind = source.repo.id !== frPrimary.id
      if (switchedForKind) {
        await fr.locator(SELECTORS.repository[0]).selectOption(source.repo.id)
        await waitRows(fr, 1)
        await waitNotBusy(fr)
        await waitLoaded(fr, 100).catch(() => {})
      }
      try {
        const ref = source.ref
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
      } finally {
        if (switchedForKind) {
          await closeBranchSelectorIfOpen(fr).catch(() => {})
          await fr.locator(SELECTORS.repository[0]).selectOption(frPrimary.id)
          await waitLoaded(fr, 100)
          await waitRows(fr, 1)
          await waitNotBusy(fr)
        }
      }
    }

    const showRemotes = await anyLocator(fr, SELECTORS.showRemotes)
    if (showRemotes) {
      let remotesResult = null
      const remoteHistoryRepo = await findRepoWithRemoteOnlyHistory(frRepos, frPrimary)
      let switchedForRemotes = false
      if (remoteHistoryRepo) {
        if (remoteHistoryRepo.id !== frPrimary.id) {
          await fr.locator(SELECTORS.repository[0]).selectOption(remoteHistoryRepo.id)
          await waitRows(fr, 1)
          await waitNotBusy(fr)
          await waitLoaded(fr, 100).catch(() => {})
          switchedForRemotes = true
        }
        const beforeHashes = await visibleRowHashes(fr)
        const input = await triggerHistoryRequest(fr, (value) => value.showRemotes === false, async () => {
          await fr.locator(SELECTORS.showRemotes[0]).click()
        })
        const afterHashes = await visibleRowHashes(fr)
        await triggerHistoryRequest(fr, (value) => value.showRemotes !== false, async () => {
          await fr.locator(SELECTORS.showRemotes[0]).click()
        })
        remotesResult = {
          source: "FR",
          repositorySwitched: switchedForRemotes,
          input,
          before: beforeHashes,
          after: afterHashes,
          changed: beforeHashes.join(",") !== afterHashes.join(","),
        }
        if (switchedForRemotes) {
          await fr.locator(SELECTORS.repository[0]).selectOption(frPrimary.id)
          await waitLoaded(fr, 100)
          await waitRows(fr, 1)
          await waitNotBusy(fr)
        }
      }
      if (!remotesResult) {
        remotesResult = await runShowRemotesTempFallback(browser).catch(() => null)
      }
      if (remotesResult) {
        checkResult(
          checks,
          "showRemotes is sent in the history request",
          remotesResult.input.showRemotes === false,
          remotesResult,
        )
        checkResult(
          checks,
          "showRemotes changes the loaded history",
          remotesResult.changed,
          {
            source: remotesResult.source,
            repositorySwitched: remotesResult.repositorySwitched ?? false,
            before: remotesResult.before.slice(0, 3),
            after: remotesResult.after.slice(0, 3),
          },
        )
      } else {
        checkResult(checks, "showRemotes is sent in the history request", false, { reason: "no remote-only fixture" })
        checkResult(checks, "showRemotes changes the loaded history", false, { reason: "no remote-only fixture" })
      }
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
    const forbiddenToolbar = await fr
      .locator(`${FORBIDDEN_TOOLBAR_SELECTORS.join(", ")}, ${LEGACY_CHANGES_SELECTOR}`)
      .count()
    checkResult(
      checks,
      "toolbar no longer exposes first-parent/HEAD jump and the legacy Changes section is gone",
      forbiddenToolbar === 0,
      { forbiddenToolbar },
    )

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
    const logCountBeforeCtrlH = events.fr.rpc.filter((entry) => entry.method === "getLog").length
    await fr.keyboard.press("Control+h")
    await waitRaf(fr, 3)
    const logCountAfterCtrlH = events.fr.rpc.filter((entry) => entry.method === "getLog").length
    await fr.keyboard.press("Escape")
    checkResult(
      checks,
      "Ctrl+H does not enable first-parent or jump to HEAD",
      logCountAfterCtrlH === logCountBeforeCtrlH &&
        (await fr.locator(`${FORBIDDEN_TOOLBAR_SELECTORS.join(", ")}, ${SELECTORS.dialog.join(",")}, ${SELECTORS.refMenu.join(",")}, ${SELECTORS.commitMenu.join(",")}`).count()) === 0,
      { logCountBeforeCtrlH, logCountAfterCtrlH },
    )

    const jump = await anyLocator(fr, SELECTORS.jumpHead)
    checkResult(checks, "jump-head selector is absent", !jump, { present: Boolean(jump) })

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
      // The restore is scheduled on the next frame after the diff closes.
      await fr.waitForFunction(
        (expected) =>
          Math.abs((document.querySelector('[data-testid="history-scroll"]')?.scrollTop ?? -1) - expected) <= 1,
        scrollBeforeInline,
        { timeout: 10_000 },
      ).catch(() => {})
      await waitRaf(fr, 2)
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
      () => document.querySelectorAll('[data-testid="repository-select"] option').length >= 1,
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
    try {
      await graphDragScenario(browser, frPrimary, checks, metrics)
    } catch (error) {
      checkResult(checks, "graph drag scenario executes", false, { error: String(error) })
    }
    try {
      await inlineThreeColumnScenario(browser, frPrimary, checks, metrics)
    } catch (error) {
      checkResult(checks, "inline three-column scenario executes", false, { error: String(error) })
    }
    try {
      await inlineLayoutScenario(browser, frPrimary, checks, metrics)
    } catch (error) {
      checkResult(checks, "inline layout scenario executes", false, { error: String(error) })
    }
    try {
      await dynamicRefRowScenario(browser, frPrimary, checks, metrics)
    } catch (error) {
      checkResult(checks, "dynamic ref row scenario executes", false, { error: String(error) })
    }
    try {
      await slotResizeScenario(browser, frPrimary, checks, metrics)
    } catch (error) {
      checkResult(checks, "slot resize scenario executes", false, { error: String(error) })
    }
    try {
      await uncommittedCleanScenario(browser, frPrimary, checks, metrics)
    } catch (error) {
      checkResult(checks, "clean uncommitted row scenario executes", false, { error: String(error) })
    }
    try {
      await frFetchGuardScenario(browser, frPrimary, checks, metrics)
    } catch (error) {
      checkResult(checks, "FR fetch guard scenario executes", false, { error: String(error) })
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
    const tempHistory = await ensureTempHistory(tempRepo, 2)
    if (tempHistory.created.length > 0 || (await temp.locator(SELECTORS.row[0]).count()) < 2) {
      await temp.locator(SELECTORS.refresh[0]).click().catch(() => {})
      await waitRows(temp, 2, 20_000)
    }
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
    await waitRows(temp, 2, 20_000)
    await scrollToRowIndex(temp, 1)
    const tempRow = temp.locator(SELECTORS.row[0]).nth(1)
    const tempCommit = await tempRow.getAttribute("data-commit")
    await tempRow.locator(".gg-subject").click({ button: "right" })
    await menuAction(temp, SELECTORS.commitMenu, "create-branch")
    const branchName = `gg-release-${Date.now().toString(36)}-long-branch-name-for-label-overflow-regression`
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
      await waitNotBusy(temp).catch(() => {})
      await waitRows(temp, 1, 20_000)
      await temp.locator(SELECTORS.historyScroll[0]).evaluate((element) => {
        element.scrollTop = 0
      })
      await waitRaf(temp, 2)
      await temp.waitForFunction(
        (name) =>
          [...document.querySelectorAll('[data-testid="ref-badge"]')].some(
            (badge) => badge.getAttribute("data-ref-name") === name,
          ),
        branchName,
        { timeout: 30_000 },
      )
      const longLabel = await fullTextState(temp, SELECTORS.currentBranch[0], branchName)
      const longBadge = await fullTextState(temp, SELECTORS.refBadge.join(","), branchName)
      const longRefs = await refBadgeSnapshot(temp)
      const longBadgeOk =
        longBadge.present &&
        longBadge.includesName &&
        longBadge.noEllipsis &&
        (longBadge.fullyVisible || longBadge.multiline) &&
        longRefs.more === null &&
        longRefs.containers.every((container) => !container.horizontalScroll)
      checkResult(
        checks,
        "current-branch and ref badge show a long name fully without ellipsis",
        longLabel.present &&
          longLabel.includesName &&
          longLabel.noEllipsis &&
          longLabel.fullyVisible &&
          longBadgeOk,
        { branchName: branchName.length, longLabel, longBadge, more: longRefs.more },
      )
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
      if (annotated) {
        await waitRaf(temp, 1)
        await fillFieldIfPresent(temp, "message", "release acceptance annotated tag")
        await waitRaf(temp, 1)
        // Re-assert the name after the optional multiline field settles; a
        // controlled-dialog re-render must not merge the two values.
        await fillFieldIfPresent(temp, "name", tagName)
      }
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
      await contentFixtureScenario(browser, tempRepo, checks, metrics)
    } catch (error) {
      checkResult(checks, "TEMP content fixture scenario executes", false, { error: String(error) })
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
    try {
      await slotBottomFollowScenario(browser, tempRepo, checks, metrics)
    } catch (error) {
      checkResult(checks, "slot bottom-follow scenario executes", false, { error: String(error) })
    }
    try {
      await uncommittedScenario(browser, tempRepo, checks, metrics)
    } catch (error) {
      checkResult(checks, "Uncommitted changes scenario executes", false, { error: String(error) })
    }
    try {
      await fetchScenario(browser, tempRepo, checks, metrics)
    } catch (error) {
      checkResult(checks, "confirmed fetch scenario executes", false, { error: String(error) })
    }
    try {
      await watcherRefreshScenario(browser, tempRepo, checks, metrics)
    } catch (error) {
      checkResult(checks, "watcher auto-refresh scenario executes", false, { error: String(error) })
    }
    try {
      await remountCacheScenario(browser, tempRepo, checks, metrics)
    } catch (error) {
      checkResult(checks, "cache remount scenario executes", false, { error: String(error) })
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
    sourceChecks: [sourceCheck],
    selectorAssumptions: {
      slotResizeHandle: SLOT_HANDLE_SELECTOR,
      remountPanel: SELECTORS.remountPanel,
      columnDividers: "resize-column-<graph|description|date|author|commit> (~5px header divider hit area)",
      denseGraphAbsent: '[data-testid="dense-graph"]',
      refsRendering: "all ref-badge names in the commit row DOM; no ref-more; .gg-ref-badges must not scroll horizontally; tall rows use dynamic rowTop prefix sums",
      inlineInfoDivider: INLINE_INFO_DIVIDER_SELECTORS,
      dateFormat: "YYYY-MM-DD HH:mm (16 chars) with the original ISO value in title",
      labelOverflow: "current-branch and visible ref badges keep full text; +N aggregation is allowed",
      uncommittedRow: UNCOMMITTED_ROW_SELECTOR,
      uncommittedGroups: "visible group buttons labelled Staged/Unstaged/Untracked/Conflicted",
      legacyChangesAbsent: LEGACY_CHANGES_SELECTOR,
      fetchButton: SELECTORS.fetchButton,
      fetchDialog: SELECTORS.fetchDialog,
      fetchConfirm: SELECTORS.fetchConfirm,
      fetchCancel: SELECTORS.fetchCancel,
      fetchRemote: SELECTORS.fetchRemote,
      fetchPrune: SELECTORS.fetchPrune,
      fetchExpectedHead: SELECTORS.fetchExpectedHead,
      fetchMethod: FETCH_METHOD,
    },
    notes,
    privateDataNote:
      "TEMP result.json may contain private repository/hash/path details. The committed acceptance summary is anonymous.",
    notCovered: [
      "Desktop window/panel chrome, tab strip, drag/resize and side-region rules",
      "Tab label icon+text rendering in the real Desktop host (sourceCheck only; desktopManual)",
      "MenuItem registration for session.panel",
      "OpenCode session switching, project/sidebar data, host theme injection and host event bus",
      "Network push/pull/reset clean, credential prompts, SSH/HTTPS authentication and interactive prune confirmation",
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









