/**
 * Real-browser interaction acceptance for the integrated Git Graph panel.
 *
 * Scope: pagination, inline commit files, full-page commit diff, resizable
 * columns, root commit, search and fault-injection diagnostics against the
 * real FR harness. This script does not mock normal repository data.
 *
 * It is intentionally separate from acceptance.mjs: the old script asserted
 * fixed 28px row geometry and manual pagination, which are no longer the
 * regression truth for the integrated interactions.
 *
 * Prerequisite: playwright-core installed in the approved TEMP directory (see
 * dev/ui-test/README.md), and `npm run dev:ui` serving 5178.
 */

import { createRequire } from "node:module"
import { existsSync, mkdirSync, writeFileSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, "../..")
const ORIGIN = (process.env.GG_UI_URL ?? "http://127.0.0.1:5178/").replace(/\/$/, "")
const BASE = `${ORIGIN}/`
const TEMP_ROOT = process.env.GG_UI_TEMP ?? join(process.env.TEMP ?? tmpdir(), "opencode")
const ARTIFACTS = resolve(
  process.env.GG_UI_INTERACTIONS_ARTIFACTS ?? join(TEMP_ROOT, "gg-ui-interactions-final"),
)
const REPOSITORY_A = process.env.GG_REPO_A ?? "sai-qx-api"
const REPOSITORY_B = process.env.GG_REPO_B ?? "qx-api"
const REPOSITORY_ROOT = process.env.GG_REPO_ROOT ?? "sai-transcoding-service"
const AUTO_LOAD_TIMEOUT = Number(process.env.GG_AUTO_LOAD_TIMEOUT ?? 12_000)
const SOURCE_FILES = [
  "src/gui/panel.tsx",
  "src/gui/styles.ts",
  "src/gui/column-layout.ts",
  "src/gui/row-layout.ts",
  "src/gui/commit-diff-view.tsx",
  "src/gui/pagination.ts",
]

const PLAYWRIGHT_CANDIDATES = [
  process.env.GG_PLAYWRIGHT_CORE,
  join(TEMP_ROOT, "gg-ui-test", "node_modules", "playwright-core"),
].filter(Boolean)

function loadPlaywright() {
  for (const candidate of PLAYWRIGHT_CANDIDATES) {
    try {
      return require(candidate)
    } catch (error) {
      if (candidate === PLAYWRIGHT_CANDIDATES.at(-1)) {
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
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Google/Chrome/Application/chrome.exe"),
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  ].filter(Boolean)
  const found = candidates.find((candidate) => existsSync(candidate))
  if (!found) throw new Error("No Chrome/Edge executable found")
  return found
}

const startedAt = new Date().toISOString()
const checks = []
const metrics = {}
const screenshots = []
const notes = []
const consoleErrors = []
const pageErrors = []
const requestFailures = []
const httpErrors = []
const abortedRequests = []
const hmrEvents = []
const rpcRequests = []
const faultEvidence = {
  consoleErrors: [],
  pageErrors: [],
  requestFailures: [],
  httpErrors: [],
  rpcRequests: [],
  abortedRequests: [],
}

function check(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail })
  return Boolean(ok)
}

async function step(name, fn) {
  try {
    await fn()
  } catch (error) {
    check(name, false, { error: error instanceof Error ? error.message : String(error) })
    notes.push(`Step failed: ${name}`)
  }
}

function round(value) {
  return Math.round(value * 100) / 100
}

async function harnessRpc(method, input) {
  const response = await fetch(`${ORIGIN}/__gg/rpc/${method}`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify(input),
  })
  const text = await response.text()
  let body
  try {
    body = JSON.parse(text)
  } catch {
    throw new Error(`${method} returned non-JSON (${response.status})`)
  }
  if (!response.ok || body?.error) {
    throw new Error(`${method} failed: ${body?.error?.message ?? response.status}`)
  }
  return body.result
}

function sourceMtimes() {
  return Object.fromEntries(
    SOURCE_FILES.map((file) => {
      const stat = statSync(join(ROOT, file))
      return [file, { mtimeMs: stat.mtimeMs, size: stat.size }]
    }),
  )
}

async function screenshot(page, name, { fullPage = false, locator } = {}) {
  const path = join(ARTIFACTS, name)
  if (locator) await locator.screenshot({ path, animations: "disabled" })
  else await page.screenshot({ path, fullPage, animations: "disabled" })
  screenshots.push(path)
  return path
}

async function waitForLoaded(page, count, timeout = 20_000) {
  await page.waitForFunction(
    (expected) => {
      const text = document.querySelector(".gg-history-footer")?.innerText ?? ""
      return new RegExp(`(^|\\D)${expected} loaded`).test(text)
    },
    count,
    { timeout },
  )
}

async function waitForRows(page, minimum = 1, timeout = 20_000) {
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

async function scrollToBottom(page) {
  await page.locator('[data-testid="history-scroll"]').evaluate((element) => {
    element.scrollTop = element.scrollHeight
  })
  await waitRaf(page, 2)
}

async function currentScrollTop(page) {
  return page.locator('[data-testid="history-scroll"]').evaluate((element) => element.scrollTop)
}

async function layoutSnapshot(page) {
  return page.evaluate(() => {
    const q = (selector, root = document) => root.querySelector(selector)
    const qa = (selector, root = document) => [...root.querySelectorAll(selector)]
    const round = (value) => Math.round(value * 100) / 100
    const scroller = q('[data-testid="history-scroll"]')
    const spacer = q(".gg-history-spacer")
    const rows = qa(".gg-graph-row")
    const slot = q('[data-testid="inline-slot"]')
    const panel = q(".git-graph-panel")
    const rect = (element) => {
      if (!element) return null
      const r = element.getBoundingClientRect()
      return { left: round(r.left), top: round(r.top), width: round(r.width), height: round(r.height) }
    }
    const rowHeight =
      rows.length > 1
        ? Math.round((Number(rows[1].dataset.rowTop) - Number(rows[0].dataset.rowTop)) * 100) / 100
        : rows[0]
          ? round(rows[0].getBoundingClientRect().height)
          : null
    return {
      viewport: { width: innerWidth, height: innerHeight },
      panel: rect(panel),
      doc: {
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      },
      body: { scrollWidth: document.body.scrollWidth, clientWidth: document.body.clientWidth },
      scroller: scroller
        ? {
            scrollTop: scroller.scrollTop,
            scrollHeight: scroller.scrollHeight,
            clientHeight: scroller.clientHeight,
            maxScroll: Math.max(0, scroller.scrollHeight - scroller.clientHeight),
          }
        : null,
      spacer: spacer
        ? {
            height: Number.parseFloat(spacer.style.height),
            slotHeight: Number(spacer.dataset.slotHeight ?? 0),
            expandedIndex: spacer.hasAttribute("data-expanded-index")
              ? Number(spacer.dataset.expandedIndex)
              : null,
          }
        : null,
      rows: rows.map((row) => ({
        index: Number(row.dataset.index),
        top: Number(row.dataset.rowTop),
        hash: row.dataset.commit,
        expanded: row.getAttribute("aria-expanded") === "true",
        height: round(row.getBoundingClientRect().height),
      })),
      rowHeight,
      slot: slot
        ? {
            top: Number.parseFloat(slot.style.top),
            height: Number.parseFloat(slot.style.height),
            dataHeight: Number(slot.dataset.slotHeight),
          }
        : null,
      inlineFiles: qa('[data-testid="inline-files"] .gg-file-row').length,
      inlineGraph: rect(q('[data-testid="inline-graph"]')),
      footer: (q(".gg-history-footer")?.innerText ?? "").replace(/\s+/g, " ").trim(),
      errors: qa(".gg-error").map((element) => element.innerText.trim().slice(0, 200)),
      loadMore: q('[data-testid="load-more"]')
        ? {
            visible: q('[data-testid="load-more"]').getBoundingClientRect().height > 0,
            disabled: q('[data-testid="load-more"]').disabled,
          }
        : null,
      historyVisible: Boolean(q('[data-testid="history"]')),
      commitDiffVisible: Boolean(q('[data-testid="commit-diff-page"]')),
    }
  })
}

async function graphSnapshot(page) {
  return page.evaluate(() => {
    const graphScroll = document.querySelector('[data-testid="graph-scroll"]')
    const history = document.querySelector('[data-testid="history"]')
    const row = document.querySelector(".gg-graph-row")
    const parse = (element) => {
      const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform)
      return { x: Math.round(matrix.e * 100) / 100, transform: getComputedStyle(element).transform }
    }
    const rowTransforms = [...document.querySelectorAll(".gg-row-graph-inner")].map(parse)
    const inlineInner = document.querySelector(
      '[data-testid="inline-graph"] .gg-row-slot-graph-inner',
    )
    const inlineTransform = inlineInner ? parse(inlineInner) : null
    return {
      columnWidth: row?.querySelector(".gg-row-graph")?.getBoundingClientRect().width ?? null,
      viewportWidth: graphScroll?.getBoundingClientRect().width ?? null,
      clientWidth: graphScroll?.clientWidth ?? null,
      scrollWidth: graphScroll?.scrollWidth ?? null,
      scrollLeft: graphScroll?.scrollLeft ?? null,
      maxScroll: graphScroll
        ? Math.max(0, graphScroll.scrollWidth - graphScroll.clientWidth)
        : null,
      shift: history
        ? getComputedStyle(history).getPropertyValue("--gg-graph-shift").trim()
        : null,
      historyStyle: history?.style.cssText ?? null,
      rowCount: rowTransforms.length,
      rowTransforms,
      inlineTransform,
      inlineGraphWidth: inlineInner?.parentElement?.getBoundingClientRect().width ?? null,
      allRowsSync:
        rowTransforms.length > 0 &&
        rowTransforms.every(
          (entry) => Math.abs(entry.x - -(graphScroll?.scrollLeft ?? 0)) < 0.2,
        ) &&
        (!inlineTransform ||
          Math.abs(inlineTransform.x - -(graphScroll?.scrollLeft ?? 0)) < 0.2),
    }
  })
}

async function waitGraphSync(page) {
  await page.waitForFunction(
    () => {
      const graphScroll = document.querySelector('[data-testid="graph-scroll"]')
      const history = document.querySelector('[data-testid="history"]')
      const expected = -(graphScroll?.scrollLeft ?? 0)
      const shift = Number.parseFloat(
        getComputedStyle(history).getPropertyValue("--gg-graph-shift"),
      )
      const inners = [
        ...document.querySelectorAll(".gg-row-graph-inner"),
        ...document.querySelectorAll(
          '[data-testid="inline-graph"] .gg-row-slot-graph-inner',
        ),
      ]
      return (
        Math.abs(shift - expected) < 0.2 &&
        inners.length > 0 &&
        inners.every((element) => {
          const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform)
          return Math.abs(matrix.e - expected) < 0.2
        })
      )
    },
    null,
    { timeout: 20_000 },
  )
}

async function panGraphToEnd(page) {
  await page.locator('[data-testid="graph-scroll"]').evaluate((element) => {
    element.scrollLeft = element.scrollWidth
  })
  await page.waitForFunction(
    () => (document.querySelector('[data-testid="graph-scroll"]')?.scrollLeft ?? 0) > 0,
    null,
    { timeout: 10_000 },
  )
  await waitGraphSync(page)
  return graphSnapshot(page)
}

async function waitCommitDiff(page, timeout = 20_000) {
  await page.waitForFunction(
    () => {
      const page = document.querySelector('[data-testid="commit-diff-page"]')
      if (!page) return false
      const loading = page.querySelector('[role="status"]')
      const lines = page.querySelectorAll(".gg-commit-diff-line").length
      const state = page.querySelector(".gg-commit-diff-state")
      return !loading && (lines > 0 || Boolean(state))
    },
    null,
    { timeout },
  )
}

async function commitDiffState(page) {
  return page.evaluate(() => {
    const root = document.querySelector('[data-testid="commit-diff-page"]')
    const q = (selector) => root?.querySelector(selector)
    const qa = (selector) => [...(root?.querySelectorAll(selector) ?? [])]
    return {
      visible: Boolean(root),
      parentHash: q(".gg-commit-diff-parent-hash")?.textContent?.trim() ?? null,
      commitHash: q(".gg-commit-diff-commit-hash")?.textContent?.trim() ?? null,
      rangeTitle: q(".gg-commit-diff-range")?.getAttribute("title") ?? null,
      path: q(".gg-commit-diff-path")?.getAttribute("title") ?? null,
      parentOptions: qa('select[aria-label="Diff parent"] option').map((option) => ({
        value: option.value,
        text: option.textContent.trim(),
      })),
      lines: qa(".gg-commit-diff-line").length,
      add: qa(".gg-commit-diff-add").length,
      remove: qa(".gg-commit-diff-remove").length,
      hunk: qa(".gg-commit-diff-hunk").length,
      historyVisible: Boolean(document.querySelector('[data-testid="history"]')),
      diffBack: Boolean(q('[data-testid="details-back"]')),
    }
  })
}

async function columnSnapshot(page) {
  return page.evaluate(() => {
    const q = (selector, root = document) => root.querySelector(selector)
    const qa = (selector, root = document) => [...root.querySelectorAll(selector)]
    const rect = (element) => {
      if (!element) return null
      const r = element.getBoundingClientRect()
      return { width: Math.round(r.width * 100) / 100, height: Math.round(r.height * 100) / 100 }
    }
    const head = q(".gg-history-head")
    const row = q(".gg-graph-row")
    const panel = q(".git-graph-panel")
    const headCells = qa(".gg-history-head > .gg-col-head", head)
    const labels = headCells.map((cell) => cell.textContent.trim())
    const rowCells = [
      row?.querySelector(".gg-row-graph"),
      row?.querySelector(".gg-col-desc"),
      row?.querySelector(".gg-col-date"),
      row?.querySelector(".gg-col-author"),
      row?.querySelector(".gg-col-commit"),
    ].filter(Boolean)
    const byLabel = (label) => headCells[labels.indexOf(label)]
    const widths = {
      graph: rect(byLabel("Graph")),
      description: rect(byLabel("Description")),
      date: rect(byLabel("Date")),
      author: rect(byLabel("Author")),
      commit: rect(byLabel("Commit")),
    }
    const rowWidths = {
      graph: rect(row?.querySelector(".gg-row-graph")),
      description: rect(row?.querySelector(".gg-col-desc")),
      date: rect(row?.querySelector(".gg-col-date")),
      author: rect(row?.querySelector(".gg-col-author")),
      commit: rect(row?.querySelector(".gg-col-commit")),
    }
    const overflow = (element) =>
      element ? Math.max(0, element.scrollWidth - element.clientWidth) : 0
    const panelRect = panel?.getBoundingClientRect()
    const overflowElements =
      panel && panelRect
        ? [...panel.querySelectorAll("*")]
            .filter((element) => element.getBoundingClientRect().right > panelRect.right + 0.5)
            .slice(0, 12)
            .map((element) => {
              const r = element.getBoundingClientRect()
              return {
                tag: element.tagName,
                className: typeof element.className === "string" ? element.className : "",
                testid: element.getAttribute("data-testid"),
                right: Math.round(r.right * 100) / 100,
                width: Math.round(r.width * 100) / 100,
              }
            })
        : []
    return {
      labels,
      widths,
      rowWidths,
      grids: {
        header: head ? getComputedStyle(head).gridTemplateColumns : null,
        row: row ? getComputedStyle(row).gridTemplateColumns : null,
      },
      panelWidth: rect(panel)?.width ?? null,
      panelOverflow: overflow(panel),
      overflowElements,
      rowOverflow: overflow(row),
      docWidth: {
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      },
      bodyWidth: {
        scrollWidth: document.body.scrollWidth,
        clientWidth: document.body.clientWidth,
      },
      handles: Object.fromEntries(
        ["graph", "description", "date", "author", "commit"].map((id) => [
          id,
          Boolean(document.querySelector(`[data-testid="resize-column-${id}"]`)),
        ]),
      ),
    }
  })
}

async function dragColumn(page, id, delta) {
  const handle = page.locator(`[data-testid="resize-column-${id}"]`)
  await handle.waitFor({ state: "visible", timeout: 10_000 })
  const box = await handle.boundingBox()
  if (!box) throw new Error(`No bounding box for resize-column-${id}`)
  const before = await columnSnapshot(page)
  const beforeWidth = before.widths[id]?.width ?? null
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + delta, y, { steps: 8 })
  await page.mouse.up()
  let changed = false
  try {
    await page.waitForFunction(
      ({ column, previous }) => {
        const labels = [...document.querySelectorAll(".gg-history-head > .gg-col-head")].map(
          (cell) => cell.textContent.trim(),
        )
        const cell = document.querySelectorAll(".gg-history-head > .gg-col-head")[
          labels.indexOf(column)
        ]
        return cell && Math.abs(cell.getBoundingClientRect().width - previous) > 1.5
      },
      { column: id[0].toUpperCase() + id.slice(1), previous: beforeWidth },
      { timeout: 8_000 },
    )
    changed = true
  } catch {
    changed = false
  }
  await waitRaf(page, 2)
  return { id, before, after: await columnSnapshot(page), changed }
}

async function scrollToRowIndex(page, index) {
  const target = await page.evaluate((wanted) => {
    const scroller = document.querySelector('[data-testid="history-scroll"]')
    const spacer = document.querySelector(".gg-history-spacer")
    const rows = [...document.querySelectorAll(".gg-graph-row")]
    const rowHeight =
      rows.length > 1
        ? Number(rows[1].dataset.rowTop) - Number(rows[0].dataset.rowTop)
        : rows[0]?.getBoundingClientRect().height || 28
    const slotHeight = Number(spacer?.dataset.slotHeight ?? 0)
    const expanded = spacer?.hasAttribute("data-expanded-index")
      ? Number(spacer.dataset.expandedIndex)
      : null
    const top =
      wanted * rowHeight +
      (expanded !== null && wanted > expanded ? slotHeight : 0)
    scroller.scrollTop = Math.min(
      Math.max(0, top),
      Math.max(0, scroller.scrollHeight - scroller.clientHeight),
    )
    return { top: scroller.scrollTop, rowHeight, slotHeight, expanded }
  }, index)
  await page.waitForFunction(
    (wanted) => Boolean(document.querySelector(`.gg-graph-row[data-index="${wanted}"]`)),
    index,
    { timeout: 20_000 },
  )
  await waitRaf(page, 2)
  return target
}

async function expandRow(page, index) {
  await scrollToRowIndex(page, index)
  await page.locator(`.gg-graph-row[data-index="${index}"]`).click()
  await page.waitForFunction(
    (wanted) => {
      const spacer = document.querySelector(".gg-history-spacer")
      const slot = document.querySelector('[data-testid="inline-slot"]')
      return (
        spacer?.hasAttribute("data-expanded-index") &&
        Number(spacer.dataset.expandedIndex) === wanted &&
        Boolean(slot)
      )
    },
    index,
    { timeout: 20_000 },
  )
  await page.waitForFunction(
    () => {
      const slot = document.querySelector('[data-testid="inline-slot"]')
      return (
        slot &&
        !slot.querySelector(".gg-status") &&
        slot.querySelectorAll('[data-testid="inline-files"] .gg-file-row').length >= 0
      )
    },
    null,
    { timeout: 20_000 },
  )
  return layoutSnapshot(page)
}

async function firstInlineFile(page) {
  const file = page.locator('[data-testid="inline-files"] .gg-file-row').first()
  await file.waitFor({ state: "visible", timeout: 20_000 })
  const title = await file.getAttribute("title")
  const path = title?.includes(" → ") ? title.split(" → ").at(-1) : title
  await file.click()
  await page.locator('[data-testid="commit-diff-page"]').waitFor({ state: "visible" })
  await waitCommitDiff(page)
  return { path: path ?? null, title: title ?? null }
}

function shortHash(hash) {
  return hash ? hash.slice(0, 7) : ""
}

function countRequests(predicate) {
  return rpcRequests.filter(predicate).length
}

function lastRequest(predicate) {
  for (let index = rpcRequests.length - 1; index >= 0; index -= 1) {
    if (predicate(rpcRequests[index])) return rpcRequests[index]
  }
  return undefined
}

async function main() {
  mkdirSync(ARTIFACTS, { recursive: true })
  const startMtimes = sourceMtimes()
  const chromium = loadPlaywright().chromium
  const executablePath = findChrome()
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: [
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--disable-component-update",
    ],
  })
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
    locale: "en-US",
  })
  const page = await context.newPage()
  page.setDefaultTimeout(25_000)

  page.on("console", (message) => {
    const text = message.text()
    if (message.type() === "error") {
      consoleErrors.push({ text, location: message.location() })
    }
    if (/hot updated|hot update|page reload|\[vite\]/.test(text)) {
      hmrEvents.push({ type: message.type(), text })
    }
  })
  page.on("pageerror", (error) => {
    pageErrors.push({ message: error.message, stack: error.stack?.slice(0, 500) })
  })
  page.on("request", (request) => {
    if (!request.url().includes("/__gg/rpc/")) return
    const method = request.url().split("/__gg/rpc/")[1]
    let input
    try {
      input = JSON.parse(request.postData() ?? "{}")
    } catch {
      input = undefined
    }
    rpcRequests.push({ method, input, url: request.url() })
  })
  page.on("requestfailed", (request) => {
    const failure = request.failure()?.errorText ?? "unknown"
    const entry = { url: request.url(), method: request.method(), failure }
    if (/ERR_ABORTED|NS_BINDING_ABORTED|aborted/i.test(failure)) abortedRequests.push(entry)
    else requestFailures.push(entry)
  })
  page.on("response", (response) => {
    if (response.status() >= 400) {
      httpErrors.push({ url: response.url(), status: response.status() })
    }
  })

  let fatal = null
  let repositoryInfo = null
  try {
    await step("1. load harness and repository metadata", async () => {
      await page.goto(BASE, { waitUntil: "domcontentloaded" })
      await page.waitForFunction(
        () => document.querySelectorAll('[data-testid="repository-select"] option').length >= 16,
        null,
        { timeout: 30_000 },
      )
      await waitForRows(page, 1)
      await waitNotBusy(page)
      const options = await page.evaluate(() =>
        [...document.querySelectorAll('[data-testid="repository-select"] option')].map(
          (option) => ({ value: option.value, text: option.textContent.trim() }),
        ),
      )
      const repositories = (await harnessRpc("listRepositories", {})).repositories
      const byName = (name) => repositories.find((repository) => repository.name === name)
      repositoryInfo = {
        options,
        repositories,
        A: byName(REPOSITORY_A),
        B: byName(REPOSITORY_B),
        ROOT: byName(REPOSITORY_ROOT),
        worktrees: repositories.filter((repository) => repository.type === "worktree").length,
      }
      metrics.repositories = {
        count: repositories.length,
        worktrees: repositoryInfo.worktrees,
        optionCount: options.length,
      }
      check("repository picker exposes 16 repositories and 4 worktrees", options.length === 16 && repositoryInfo.worktrees === 4, metrics.repositories)
      check("primary/secondary/root fixtures are present", Boolean(repositoryInfo.A && repositoryInfo.B && repositoryInfo.ROOT), {
        primary: Boolean(repositoryInfo.A),
        secondary: Boolean(repositoryInfo.B),
        root: Boolean(repositoryInfo.ROOT),
      })
    })
    if (!repositoryInfo?.A || !repositoryInfo?.B || !repositoryInfo?.ROOT) {
      throw new Error("Required fixture repositories are missing")
    }

    await step("2. primary repository 100 -> 200 automatic pagination", async () => {
      await page.locator('[data-testid="repository-select"]').selectOption(repositoryInfo.A.id)
      await waitForLoaded(page, 100)
      await waitForRows(page, 1)
      await waitNotBusy(page)
      const before = await layoutSnapshot(page)
      metrics.primary100 = before
      check("primary starts at 100 loaded", before.footer.includes("100 loaded"), { footer: before.footer })
      await scrollToBottom(page)
      const bottomTop = await currentScrollTop(page)
      let autoOk = false
      try {
        await waitForLoaded(page, 200, AUTO_LOAD_TIMEOUT)
        autoOk = true
      } catch {
        autoOk = false
      }
      const afterAuto = await layoutSnapshot(page)
      const skip100 = countRequests(
        (request) =>
          request.method === "getLog" &&
          request.input?.repositoryId === repositoryInfo.A.id &&
          request.input?.skip === 100,
      )
      const skip200 = countRequests(
        (request) =>
          request.method === "getLog" &&
          request.input?.repositoryId === repositoryInfo.A.id &&
          request.input?.skip === 200,
      )
      metrics.pagination100to200 = {
        ok: autoOk,
        bottomTop,
        after: afterAuto,
        skip100,
        skip200,
        errors: afterAuto.errors,
      }
      check(
        "scrolling near the bottom auto-loads page 2 without clicking Load more",
        autoOk && afterAuto.footer.includes("200 loaded"),
        { ok: autoOk, footer: afterAuto.footer, scrollTop: afterAuto.scroller?.scrollTop, max: afterAuto.scroller?.maxScroll, errors: afterAuto.errors, loadMore: afterAuto.loadMore },
      )
      check("page 2 requests getLog skip=100 exactly once", skip100 === 1, { skip100 })
      check("page 2 requests do not prefetch skip=200", skip200 === 0, { skip200 })
      check(
        "appending page 2 preserves the scroll position",
        autoOk && afterAuto.scroller.scrollTop >= bottomTop - 1,
        { before: bottomTop, after: afterAuto.scroller.scrollTop },
      )
      if (!autoOk) {
        await screenshot(page, "01-primary-520-auto-load-failure.png", {
          locator: page.locator('[data-testid="harness-panel-shell"]'),
        })
        await page.locator('[data-testid="load-more"]').click()
        await waitForLoaded(page, 200, 30_000)
        metrics.pagination100to200.manualFallback = true
      }
    })

    await step("3. expand a merge commit inline slot", async () => {
      const log = await harnessRpc("getLog", {
        repositoryId: repositoryInfo.A.id,
        limit: 300,
      })
      let candidate = null
      for (let index = 0; index < log.commits.length && index < 160; index += 1) {
        const commit = log.commits[index]
        if (commit.parents.length < 2) continue
        try {
          const parent0 = await harnessRpc("getCommitFiles", {
            repositoryId: repositoryInfo.A.id,
            hash: commit.hash,
            parentIndex: 0,
          })
          const parent1 = await harnessRpc("getCommitFiles", {
            repositoryId: repositoryInfo.A.id,
            hash: commit.hash,
            parentIndex: 1,
          })
          if (parent0.files.length > 0 && parent1.files.length > 0) {
            candidate = { index, commit, parent0Files: parent0.files.length, parent1Files: parent1.files.length }
            break
          }
        } catch {
          /* try next merge */
        }
      }
      if (!candidate) throw new Error("No merge commit with files in both parents")
      metrics.mergeCandidate = {
        index: candidate.index,
        hash: candidate.commit.hash,
        parents: candidate.commit.parents,
        parent0Files: candidate.parent0Files,
        parent1Files: candidate.parent1Files,
      }
      await scrollToRowIndex(page, candidate.index)
      const row = page.locator(`.gg-graph-row[data-index="${candidate.index}"]`)
      await row.click()
      await page.waitForFunction(
        (index) => {
          const spacer = document.querySelector(".gg-history-spacer")
          return (
            spacer?.hasAttribute("data-expanded-index") &&
            Number(spacer.dataset.expandedIndex) === index &&
            Boolean(document.querySelector('[data-testid="inline-slot"]'))
          )
        },
        candidate.index,
        { timeout: 20_000 },
      )
      await page.waitForFunction(
        () =>
          !document.querySelector('[data-testid="inline-slot"] .gg-status') &&
          document.querySelectorAll('[data-testid="inline-files"] .gg-file-row').length > 0,
        null,
        { timeout: 20_000 },
      )
      const layout = await layoutSnapshot(page)
      metrics.inlineExpanded = layout
      const expandedRow = layout.rows.find((entry) => entry.index === candidate.index)
      const nextRow = layout.rows.find((entry) => entry.index === candidate.index + 1)
      const slot = layout.slot
      check("inline slot is inserted directly below the clicked row", Boolean(expandedRow && slot && Math.abs(slot.top - (expandedRow.top + layout.rowHeight)) <= 1), {
        rowTop: expandedRow?.top,
        rowHeight: layout.rowHeight,
        slotTop: slot?.top,
        slotHeight: slot?.height,
      })
      check("spacer exposes the real slot height and expanded index", layout.spacer.slotHeight > 0 && layout.spacer.expandedIndex === candidate.index, layout.spacer)
      check(
        "rows after the slot are shifted by exactly the slot height",
        Boolean(nextRow && Math.abs(nextRow.top - (expandedRow.top + layout.rowHeight + layout.spacer.slotHeight)) <= 1),
        { nextRowTop: nextRow?.top, expected: expandedRow ? expandedRow.top + layout.rowHeight + layout.spacer.slotHeight : null, slotHeight: layout.spacer.slotHeight },
      )
      check("inline slot contains real file rows", layout.inlineFiles > 0, { inlineFiles: layout.inlineFiles })
      check("rendered row DOM remains bounded with an inline slot", layout.rows.length < 80 && layout.slot !== null, {
        renderedRows: layout.rows.length,
        slotCount: layout.slot ? 1 : 0,
      })
      await screenshot(page, "02-inline-slot-520.png", {
        locator: page.locator('[data-testid="harness-panel-shell"]'),
      })
      metrics.inlineMergeIndex = candidate.index
    })

    await step("4. inline graph follows pan and opens full-page commit diff", async () => {
      const pan = await panGraphToEnd(page)
      metrics.inlinePan = pan
      check("inline graph continuation follows the same graph pan", pan.allRowsSync && pan.inlineTransform && Math.abs(pan.inlineTransform.x - -pan.scrollLeft) < 0.2, {
        scrollLeft: pan.scrollLeft,
        inline: pan.inlineTransform,
        allRowsSync: pan.allRowsSync,
      })
      check("inline graph width follows the effective graph column", Math.abs(pan.inlineGraphWidth - pan.columnWidth) <= 1, {
        inlineGraphWidth: pan.inlineGraphWidth,
        graphColumn: pan.columnWidth,
      })
      const beforeDiff = await layoutSnapshot(page)
      const scrollBefore = beforeDiff.scroller.scrollTop
      const graphBefore = (await graphSnapshot(page)).scrollLeft
      const file = await firstInlineFile(page)
      const diffState = await commitDiffState(page)
      const diffRequest = lastRequest(
        (request) =>
          request.method === "getDiff" &&
          request.input?.target?.type === "commit",
      )
      const target = diffRequest?.input?.target
      const targetMatches =
        target?.type === "commit" &&
        target?.hash === metrics.mergeCandidate.hash &&
        target?.parentIndex === 0
      const pathMatches = diffRequest?.input?.path === file.path
      metrics.commitDiffRequest = {
        targetType: target?.type,
        parentIndex: target?.parentIndex,
        targetMatches,
        pathMatches,
        path: file.path,
      }
      check("clicking an inline file opens the full-page commit diff", diffState.visible && diffState.historyVisible === false && diffState.diffBack, diffState)
      check("commit diff hides the history table", diffState.historyVisible === false, { historyVisible: diffState.historyVisible })
      check("getDiff request uses the exact commit target and path", targetMatches && pathMatches, {
        targetType: target?.type,
        parentIndex: target?.parentIndex,
        targetMatches,
        pathMatches,
      })
      check("commit diff header shows parent -> commit hashes", diffState.parentHash === shortHash(metrics.mergeCandidate.parents[0]) && diffState.commitHash === shortHash(metrics.mergeCandidate.hash), {
        parentHash: diffState.parentHash,
        commitHash: diffState.commitHash,
        expectedParent: shortHash(metrics.mergeCandidate.parents[0]),
        expectedCommit: shortHash(metrics.mergeCandidate.hash),
      })
      check("commit diff renders a unified patch", diffState.lines > 0 && diffState.hunk > 0, {
        lines: diffState.lines,
        add: diffState.add,
        remove: diffState.remove,
        hunk: diffState.hunk,
      })
      await screenshot(page, "03-fullpage-commit-diff-520.png", {
        locator: page.locator('[data-testid="harness-panel-shell"]'),
      })

      const parentSelect = page.locator(
        '[data-testid="commit-diff-page"] select[aria-label="Diff parent"]',
      )
      await parentSelect.waitFor({ state: "visible", timeout: 20_000 })
      const parentOptions = await parentSelect.locator("option").count()
      check("merge commit exposes two parents in the full-page diff", parentOptions === 2, { parentOptions })
      await parentSelect.selectOption("1")
      await page.waitForFunction(
        (expected) =>
          document.querySelector(".gg-commit-diff-parent-hash")?.textContent?.trim() === expected,
        shortHash(metrics.mergeCandidate.parents[1]),
        { timeout: 20_000 },
      )
      const parentRequest = lastRequest(
        (request) =>
          request.method === "getDiff" &&
          request.input?.target?.type === "commit" &&
          request.input?.target?.parentIndex === 1,
      )
      const parentState = await commitDiffState(page)
      check("switching the merge parent issues the correct commit diff request", Boolean(parentRequest) && parentRequest.input.target.hash === metrics.mergeCandidate.hash, {
        parentIndex: parentRequest?.input?.target?.parentIndex,
        targetHashMatches: parentRequest?.input?.target?.hash === metrics.mergeCandidate.hash,
      })
      check("parent switch updates the parent hash header", parentState.parentHash === shortHash(metrics.mergeCandidate.parents[1]), {
        parentHash: parentState.parentHash,
        expected: shortHash(metrics.mergeCandidate.parents[1]),
      })
      await screenshot(page, "04-fullpage-commit-diff-parent2-520.png", {
        locator: page.locator('[data-testid="harness-panel-shell"]'),
      })

      await page.locator('[data-testid="details-back"]').click()
      await page.waitForFunction(
        () =>
          !document.querySelector('[data-testid="commit-diff-page"]') &&
          Boolean(document.querySelector('[data-testid="history"]')),
        null,
        { timeout: 20_000 },
      )
      await page
        .waitForFunction(
          () => document.querySelectorAll('[data-testid="inline-files"] .gg-file-row').length > 0,
          null,
          { timeout: 10_000 },
        )
        .catch(() => {})
      const back = await layoutSnapshot(page)
      const graphAfter = await graphSnapshot(page)
      metrics.backToHistory = {
        scrollBefore,
        scrollAfter: back.scroller.scrollTop,
        graphBefore,
        graphAfter: graphAfter.scrollLeft,
        expandedIndex: back.spacer.expandedIndex,
        slotVisible: Boolean(back.slot),
        inlineFiles: back.inlineFiles,
      }
      check("Back restores the history scroll within one pixel", Math.abs(back.scroller.scrollTop - scrollBefore) <= 1, metrics.backToHistory)
      check("Back restores the graph pan within one pixel", Math.abs(graphAfter.scrollLeft - graphBefore) <= 1, metrics.backToHistory)
      check("Back keeps the same inline expansion", back.spacer.expandedIndex === metrics.mergeCandidate.index && Boolean(back.slot) && back.inlineFiles > 0, metrics.backToHistory)
      if (
        Math.abs(back.scroller.scrollTop - scrollBefore) > 1 ||
        Math.abs(graphAfter.scrollLeft - graphBefore) > 1 ||
        back.spacer.expandedIndex !== metrics.mergeCandidate.index
      ) {
        await screenshot(page, "05-back-restore-failure.png", {
          locator: page.locator('[data-testid="harness-panel-shell"]'),
        })
      }
    })

    await step("5. same-row collapse and change-row cancellation", async () => {
      const expanded = await layoutSnapshot(page)
      const index = expanded.spacer.expandedIndex
      if (index === null) throw new Error("No expanded row to collapse")
      await page.locator(`.gg-graph-row[data-index="${index}"]`).click()
      await page.waitForFunction(
        () => !document.querySelector('[data-testid="inline-slot"]'),
        null,
        { timeout: 20_000 },
      )
      const collapsed = await layoutSnapshot(page)
      check("clicking the same row collapses the inline slot", collapsed.spacer.slotHeight === 0 && collapsed.spacer.expandedIndex === null && !collapsed.slot, {
        slotHeight: collapsed.spacer.slotHeight,
        expandedIndex: collapsed.spacer.expandedIndex,
      })

      const visible = collapsed.rows.filter((row) => row.index !== undefined)
      if (visible.length < 2) throw new Error("Not enough visible rows for change-row cancellation")
      const first = visible[0].index
      const second = visible[1].index
      const abortsBefore = abortedRequests.filter((entry) =>
        entry.url.includes("/__gg/rpc/getCommitFiles"),
      ).length
      await page.locator(`.gg-graph-row[data-index="${first}"]`).click()
      await page.locator(`.gg-graph-row[data-index="${second}"]`).click()
      await page.waitForFunction(
        (index) => {
          const spacer = document.querySelector(".gg-history-spacer")
          return (
            spacer?.hasAttribute("data-expanded-index") &&
            Number(spacer.dataset.expandedIndex) === index &&
            Boolean(document.querySelector('[data-testid="inline-slot"]'))
          )
        },
        second,
        { timeout: 20_000 },
      )
      const switched = await layoutSnapshot(page)
      const abortsAfter = abortedRequests.filter((entry) =>
        entry.url.includes("/__gg/rpc/getCommitFiles"),
      ).length
      metrics.rowSwitch = {
        first,
        second,
        abortedBefore: abortsBefore,
        abortedAfter: abortsAfter,
        expandedIndex: switched.spacer.expandedIndex,
      }
      check("switching rows replaces the inline slot with the new row", switched.spacer.expandedIndex === second, metrics.rowSwitch)
      check("switching rows cancels the previous file request", abortsAfter > abortsBefore, metrics.rowSwitch)
      check("switching rows leaves no stale error", switched.errors.length === 0, { errors: switched.errors })
    })

    await step("6. scroll with a slot open auto-loads page 3", async () => {
      const before = await layoutSnapshot(page)
      const expandedBefore = before.spacer.expandedIndex
      const slotBefore = before.spacer.slotHeight
      const scrollBefore = before.scroller.scrollTop
      await scrollToBottom(page)
      const bottomTop = await currentScrollTop(page)
      let autoOk = false
      try {
        await waitForLoaded(page, 300, AUTO_LOAD_TIMEOUT)
        autoOk = true
      } catch {
        autoOk = false
      }
      const after = await layoutSnapshot(page)
      const skip200 = countRequests(
        (request) =>
          request.method === "getLog" &&
          request.input?.repositoryId === repositoryInfo.A.id &&
          request.input?.skip === 200,
      )
      const skip300 = countRequests(
        (request) =>
          request.method === "getLog" &&
          request.input?.repositoryId === repositoryInfo.A.id &&
          request.input?.skip === 300,
      )
      metrics.pagination200to300WithSlot = {
        ok: autoOk,
        before,
        after,
        bottomTop,
        skip200,
        skip300,
      }
      check("scrolling with a slot open auto-loads page 3", autoOk && after.footer.includes("300 loaded"), {
        ok: autoOk,
        footer: after.footer,
        scrollTop: after.scroller.scrollTop,
        max: after.scroller.maxScroll,
        errors: after.errors,
      })
      check("page 3 requests getLog skip=200 exactly once", skip200 === 1, { skip200 })
      check("page 3 does not prefetch skip=300", skip300 === 0, { skip300 })
      check(
        "auto-loading with a slot preserves the expansion",
        after.spacer.expandedIndex === expandedBefore && Math.abs(after.spacer.slotHeight - slotBefore) <= 1 && Boolean(after.slot),
        { expandedBefore, expandedAfter: after.spacer.expandedIndex, slotBefore, slotAfter: after.spacer.slotHeight },
      )
      check(
        "auto-loading with a slot does not reset the scroll position",
        autoOk && after.scroller.scrollTop >= bottomTop - 1,
        { bottomTop, after: after.scroller.scrollTop },
      )
      if (!autoOk) {
        await screenshot(page, "05-slot-auto-load-failure.png", {
          locator: page.locator('[data-testid="harness-panel-shell"]'),
        })
        await page.locator('[data-testid="load-more"]').click()
        await waitForLoaded(page, 300, 30_000)
        metrics.pagination200to300WithSlot.manualFallback = true
      }
    })

    await step("7. search jump uses the real row top with a slot open", async () => {
      await scrollToBottom(page)
      const bottom = await layoutSnapshot(page)
      const last = bottom.rows.at(-1)
      if (!last) throw new Error("No bottom row for search")
      const expectedTop = Math.min(
        last.top,
        Math.max(0, bottom.scroller.scrollHeight - bottom.scroller.clientHeight),
      )
      const short = last.hash.slice(0, 7)
      const input = page.locator('[data-testid="search-commits"]')
      await input.fill(short)
      await page.waitForFunction(
        () => (document.querySelector(".gg-history-footer")?.innerText ?? "").includes("matches"),
        null,
        { timeout: 20_000 },
      )
      await input.press("Enter")
      await page.waitForFunction(
        ({ index, top }) => {
          const scroller = document.querySelector('[data-testid="history-scroll"]')
          const row = document.querySelector(`.gg-graph-row[data-index="${index}"]`)
          return Boolean(row) && Math.abs(scroller.scrollTop - top) <= 1
        },
        { index: last.index, top: expectedTop },
        { timeout: 20_000 },
      )
      const jumped = await layoutSnapshot(page)
      const jumpedLast = jumped.rows.find((row) => row.index === last.index)
      metrics.searchJump = {
        index: last.index,
        expectedTop,
        scrollTop: jumped.scroller.scrollTop,
        blankBottom:
          jumped.scroller.scrollHeight -
          (jumpedLast ? jumpedLast.top + jumped.rowHeight : jumped.scroller.scrollHeight),
        rendered: jumped.rows.length,
      }
      check("search jump uses the real data-row-top and clamps to the list range", Math.abs(jumped.scroller.scrollTop - expectedTop) <= 1, metrics.searchJump)
      check("search jump leaves no virtual blank at the bottom", jumpedLast && jumped.scroller.scrollTop + jumped.scroller.clientHeight >= jumped.scroller.scrollHeight - 1 && metrics.searchJump.blankBottom <= 1, metrics.searchJump)
      await screenshot(page, "06-search-jump-520.png", {
        locator: page.locator('[data-testid="harness-panel-shell"]'),
      })
      await page.locator("button.gg-search-clear").click()
      await page.waitForFunction(
        () => (document.querySelector('[data-testid="search-commits"]')?.value ?? "") === "",
        null,
        { timeout: 10_000 },
      )
    })

    await step("8. root commit shows Empty tree full-page diff", async () => {
      const log = await harnessRpc("getLog", {
        repositoryId: repositoryInfo.ROOT.id,
        limit: 100,
      })
      const rootIndex = log.commits.findIndex((commit) => commit.parents.length === 0)
      if (rootIndex < 0) throw new Error("Root commit not found")
      const rootCommit = log.commits[rootIndex]
      const files = await harnessRpc("getCommitFiles", {
        repositoryId: repositoryInfo.ROOT.id,
        hash: rootCommit.hash,
        parentIndex: 0,
      })
      if (files.files.length === 0) throw new Error("Root commit has no files to open")
      await page.locator('[data-testid="repository-select"]').selectOption(repositoryInfo.ROOT.id)
      await waitForLoaded(page, 8)
      await waitForRows(page, 1)
      await waitNotBusy(page)
      const layout = await layoutSnapshot(page)
      const logRequests = countRequests(
        (request) =>
          request.method === "getLog" &&
          request.input?.repositoryId === repositoryInfo.ROOT.id,
      )
      check("root fixture reports hasMore=false and does not request another page", logRequests === 1 && !layout.loadMore && !layout.footer.includes("+"), {
        footer: layout.footer,
        loadMore: layout.loadMore,
        logRequests,
      })
      await scrollToRowIndex(page, rootIndex)
      await page.locator(`.gg-graph-row[data-index="${rootIndex}"]`).click()
      await page.waitForFunction(
        (index) => {
          const spacer = document.querySelector(".gg-history-spacer")
          return spacer?.hasAttribute("data-expanded-index") && Number(spacer.dataset.expandedIndex) === index
        },
        rootIndex,
        { timeout: 20_000 },
      )
      await page.waitForFunction(
        () => document.querySelectorAll('[data-testid="inline-files"] .gg-file-row').length > 0,
        null,
        { timeout: 20_000 },
      )
      const file = await firstInlineFile(page)
      const diff = await commitDiffState(page)
      const request = lastRequest(
        (entry) =>
          entry.method === "getDiff" &&
          entry.input?.target?.type === "commit" &&
          entry.input?.target?.hash === rootCommit.hash,
      )
      metrics.rootDiff = {
        rootIndex,
        filePath: file.path,
        parentHash: diff.parentHash,
        commitHash: diff.commitHash,
        target: request?.input?.target,
        pathMatches: request?.input?.path === file.path,
        lines: diff.lines,
      }
      check("root commit diff header shows Empty tree", diff.parentHash === "Empty tree", { parentHash: diff.parentHash })
      check("root commit diff uses the root commit target", request?.input?.target?.parentIndex === 0 && request?.input?.path === file.path, {
        parentIndex: request?.input?.target?.parentIndex,
        pathMatches: request?.input?.path === file.path,
      })
      check("root commit diff contains real lines", diff.lines > 0, { lines: diff.lines })
      await screenshot(page, "07-root-empty-tree-520.png", {
        locator: page.locator('[data-testid="harness-panel-shell"]'),
      })
      await page.locator('[data-testid="details-back"]').click()
      await page.waitForFunction(() => !document.querySelector('[data-testid="commit-diff-page"]'))
    })

    await step("9. resize all five columns at 1100px and persist across reload", async () => {
      await page.locator('[data-testid="harness-width-1100"]').click()
      await page.waitForFunction(
        () =>
          document.querySelector('[data-testid="harness-panel-shell"]')?.dataset.panelWidth === "1100" &&
          Math.abs(document.querySelector(".git-graph-panel").getBoundingClientRect().width - 1100) <= 1,
        null,
        { timeout: 15_000 },
      )
      await page.locator('[data-testid="repository-select"]').selectOption(repositoryInfo.A.id)
      await waitForLoaded(page, 100)
      await waitForRows(page, 1)
      await waitNotBusy(page)
      const initial = await columnSnapshot(page)
      metrics.columnsInitial = initial
      check("1100px shows all five columns and resize handles", initial.labels.join("|") === "Graph|Description|Date|Author|Commit" && Object.values(initial.handles).every(Boolean), initial)
      check("header and row share one grid", initial.grids.header === initial.grids.row, initial.grids)
      check("1100px initial column layout has no panel overflow", initial.panelOverflow <= 1, {
        panelOverflow: initial.panelOverflow,
        overflowElements: initial.overflowElements,
      })
      const resizeResults = []
      for (const id of ["graph", "description", "date", "author", "commit"]) {
        // Narrowing graph guarantees a pan range at 1100px/100 rows; widening
        // it past the content width would make a pan assertion meaningless.
        const result = await dragColumn(page, id, id === "graph" ? -16 : 16)
        resizeResults.push(result)
        const beforeWidth = result.before.widths[id]?.width
        const afterWidth = result.after.widths[id]?.width
        const rowWidth = result.after.rowWidths[id]?.width
        check(`${id} column width changes after a real pointer drag`, result.changed && Math.abs(afterWidth - beforeWidth) > 1, {
          id,
          changed: result.changed,
          before: beforeWidth,
          after: afterWidth,
        })
        check(`${id} header and row widths stay in sync after drag`, Math.abs(afterWidth - rowWidth) <= 1, {
          id,
          header: afterWidth,
          row: rowWidth,
          grids: result.after.grids,
        })
        check(`${id} drag does not add panel overflow beyond the initial 1100px layout`, result.after.panelOverflow <= initial.panelOverflow + 1 && result.after.docWidth.scrollWidth <= result.after.docWidth.clientWidth, {
          id,
          panelOverflow: result.after.panelOverflow,
          initialOverflow: initial.panelOverflow,
          overflowElements: result.after.overflowElements,
          docWidth: result.after.docWidth,
          bodyWidth: result.after.bodyWidth,
        })
        if (id === "graph") {
          const graph = await graphSnapshot(page)
          check("graph pan viewport follows the effective resized graph column", Math.abs(graph.clientWidth - graph.columnWidth) <= 1, {
            graphColumn: graph.columnWidth,
            graphViewport: graph.clientWidth,
          })
          if (graph.scrollWidth > graph.clientWidth) {
            const pan = await panGraphToEnd(page)
            check("graph pan remains synchronized after resizing", pan.allRowsSync && pan.scrollLeft > 0, {
              scrollLeft: pan.scrollLeft,
              maxScroll: pan.maxScroll,
              allRowsSync: pan.allRowsSync,
            })
          } else {
            check("resized graph column has no hidden pan range", graph.maxScroll === 0, graph)
          }
        }
      }
      metrics.columnResizes = resizeResults
      const resized = await columnSnapshot(page)
      metrics.columnsResized = resized
      check("all five resized headers and rows remain aligned", Object.keys(resized.widths).every((key) => {
        const width = resized.widths[key]?.width
        const rowWidth = resized.rowWidths[key]?.width
        return width == null || rowWidth == null || Math.abs(width - rowWidth) <= 1
      }), resized)
      await screenshot(page, "08-all-column-widths-1100.png", {
        locator: page.locator('[data-testid="harness-panel-shell"]'),
      })

      await page.reload({ waitUntil: "domcontentloaded" })
      await page.waitForFunction(
        () => document.querySelectorAll('[data-testid="repository-select"] option').length >= 16,
        null,
        { timeout: 30_000 },
      )
      await waitForRows(page, 1)
      await waitNotBusy(page)
      await page.locator('[data-testid="harness-width-1100"]').click()
      await page.waitForFunction(
        () =>
          document.querySelector('[data-testid="harness-panel-shell"]')?.dataset.panelWidth === "1100" &&
          Math.abs(document.querySelector(".git-graph-panel").getBoundingClientRect().width - 1100) <= 1,
        null,
        { timeout: 15_000 },
      )
      await page.locator('[data-testid="repository-select"]').selectOption(repositoryInfo.A.id)
      await waitForLoaded(page, 100)
      await waitForRows(page, 1)
      await waitNotBusy(page)
      const persisted = await columnSnapshot(page)
      metrics.columnsPersisted = persisted
      check("all five column widths persist across reload", Object.keys(resized.widths).every((key) => {
        const before = resized.widths[key]?.width
        const after = persisted.widths[key]?.width
        return before == null || after == null || Math.abs(before - after) <= 1
      }), { before: resized.widths, after: persisted.widths })

      await page.locator('[data-testid="harness-width-520"]').click()
      await page.waitForFunction(
        () =>
          document.querySelector('[data-testid="harness-panel-shell"]')?.dataset.panelWidth === "520" &&
          Math.abs(document.querySelector(".git-graph-panel").getBoundingClientRect().width - 520) <= 1,
        null,
        { timeout: 15_000 },
      )
      await waitForLoaded(page, 100)
      await waitRaf(page, 2)
      const narrow = await columnSnapshot(page)
      metrics.columnsNarrow = narrow
      check("520px hides date and author", narrow.labels.join("|") === "Graph|Description|Commit" && !narrow.handles.date && !narrow.handles.author, narrow.labels)
      check("preserving wide column preferences does not overflow 520px", narrow.panelOverflow <= 1 && narrow.docWidth.scrollWidth <= narrow.docWidth.clientWidth && narrow.bodyWidth.scrollWidth <= narrow.bodyWidth.clientWidth, {
        panelOverflow: narrow.panelOverflow,
        docWidth: narrow.docWidth,
        bodyWidth: narrow.bodyWidth,
      })
      await screenshot(page, "09-520-after-wide.png", {
        locator: page.locator('[data-testid="harness-panel-shell"]'),
      })
    })

    await step("10. fault injection: auto-load failure and retry", async () => {
      const faultContext = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        deviceScaleFactor: 1,
        locale: "en-US",
      })
      const faultPage = await faultContext.newPage()
      let failOnce = true
      const faultRpc = []
      const attach = (target) => {
        target.on("console", (message) => {
          if (message.type() === "error") faultEvidence.consoleErrors.push({ text: message.text(), location: message.location() })
        })
        target.on("pageerror", (error) => faultEvidence.pageErrors.push({ message: error.message }))
        target.on("requestfailed", (request) => {
          const failure = request.failure()?.errorText ?? "unknown"
          const entry = { url: request.url(), method: request.method(), failure }
          if (/ERR_ABORTED|NS_BINDING_ABORTED|aborted/i.test(failure)) faultEvidence.abortedRequests.push(entry)
          else faultEvidence.requestFailures.push(entry)
        })
        target.on("response", (response) => {
          if (response.status() >= 400) faultEvidence.httpErrors.push({ url: response.url(), status: response.status() })
        })
        target.on("request", (request) => {
          if (!request.url().includes("/__gg/rpc/")) return
          const method = request.url().split("/__gg/rpc/")[1]
          let input
          try { input = JSON.parse(request.postData() ?? "{}") } catch { input = undefined }
          faultRpc.push({ method, input })
        })
      }
      attach(faultPage)
      await faultPage.route("**/__gg/rpc/getLog", async (route) => {
        let input
        try { input = JSON.parse(route.request().postData() ?? "{}") } catch { input = undefined }
        if (input?.skip === 100 && failOnce) {
          failOnce = false
          await route.fulfill({
            status: 502,
            contentType: "application/json",
            body: JSON.stringify({ error: { type: "git_failed", message: "injected getLog failure" } }),
          })
          return
        }
        await route.continue()
      })
      await faultPage.goto(BASE, { waitUntil: "domcontentloaded" })
      await faultPage.waitForFunction(
        () => document.querySelectorAll('[data-testid="repository-select"] option').length >= 16,
        null,
        { timeout: 30_000 },
      )
      await faultPage.locator('[data-testid="repository-select"]').selectOption(repositoryInfo.A.id)
      await waitForLoaded(faultPage, 100)
      await waitForRows(faultPage, 1)
      await waitNotBusy(faultPage)
      await scrollToBottom(faultPage)
      let faultTriggered = false
      try {
        await faultPage.waitForFunction(
          () =>
            Boolean(document.querySelector('[data-testid="retry-load-more"]')) ||
            Boolean(document.querySelector(".gg-error")),
          null,
          { timeout: AUTO_LOAD_TIMEOUT },
        )
        faultTriggered = true
      } catch {
        faultTriggered = false
      }
      const skip100 = faultRpc.filter((entry) => entry.method === "getLog" && entry.input?.skip === 100).length
      const faultState = await layoutSnapshot(faultPage)
      metrics.faultInjection = {
        autoTriggered: faultTriggered,
        skip100,
        footer: faultState.footer,
        errors: faultState.errors,
        retryVisible: Boolean(await faultPage.locator('[data-testid="retry-load-more"]').count()),
      }
      if (!faultTriggered) {
        check("auto-load fault injection requested skip=100", false, metrics.faultInjection)
        check("auto-load failure shows a retry control", false, metrics.faultInjection)
      } else {
        check("auto-load fault injection requested skip=100 exactly once", skip100 === 1, metrics.faultInjection)
        check("auto-load failure shows a retry control", metrics.faultInjection.retryVisible, metrics.faultInjection)
        const beforeRetry = skip100
        await faultPage.locator('[data-testid="history-scroll"]').evaluate((element) => {
          element.scrollTop = element.scrollHeight
        })
        await waitRaf(faultPage, 2)
        const afterReScroll = faultRpc.filter((entry) => entry.method === "getLog" && entry.input?.skip === 100).length
        check("auto-load does not retry while still at the bottom", afterReScroll === beforeRetry, { beforeRetry, afterReScroll })
      }
      if (!faultTriggered) {
        // Still exercise the manual fallback and error UI with the same fault.
        await faultPage.locator('[data-testid="load-more"]').click()
        try {
          await faultPage.waitForFunction(
            () => Boolean(document.querySelector('[data-testid="retry-load-more"]')) || Boolean(document.querySelector(".gg-error")),
            null,
            { timeout: 20_000 },
          )
        } catch { /* recorded below */ }
        metrics.faultInjection.manualTriggered = true
      }
      if (await faultPage.locator('[data-testid="retry-load-more"]').count()) {
        await faultPage.locator('[data-testid="retry-load-more"]').click()
        await waitForLoaded(faultPage, 200, 30_000).catch(() => {})
      }
      const recovered = await layoutSnapshot(faultPage)
      metrics.faultInjection.recovered = recovered.footer.includes("200 loaded")
      check("manual retry recovers after the injected getLog failure", recovered.footer.includes("200 loaded"), {
        footer: recovered.footer,
        errors: recovered.errors,
      })
      await screenshot(faultPage, "10-fault-auto-load-520.png", {
        locator: faultPage.locator('[data-testid="harness-panel-shell"]'),
      })
      metrics.faultInjection.rpc = faultRpc
      await faultContext.close()

      const duplicateContext = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        deviceScaleFactor: 1,
        locale: "en-US",
      })
      const duplicatePage = await duplicateContext.newPage()
      const duplicateRpc = []
      const duplicateConsole = []
      const duplicatePageErrors = []
      const duplicateHttp = []
      duplicatePage.on("console", (message) => {
        if (message.type() === "error") {
          duplicateConsole.push({ text: message.text(), location: message.location() })
        }
      })
      duplicatePage.on("pageerror", (error) => duplicatePageErrors.push({ message: error.message }))
      duplicatePage.on("response", (response) => {
        if (response.status() >= 400) duplicateHttp.push({ url: response.url(), status: response.status() })
      })
      duplicatePage.on("request", (request) => {
        if (!request.url().includes("/__gg/rpc/")) return
        const method = request.url().split("/__gg/rpc/")[1]
        let input
        try { input = JSON.parse(request.postData() ?? "{}") } catch { input = undefined }
        duplicateRpc.push({ method, input })
      })
      const duplicateLog = await harnessRpc("getLog", {
        repositoryId: repositoryInfo.A.id,
        limit: 100,
      })
      const duplicateCommit = duplicateLog.commits[0]
      let duplicateOnce = true
      await duplicatePage.route("**/__gg/rpc/getLog", async (route) => {
        let input
        try { input = JSON.parse(route.request().postData() ?? "{}") } catch { input = undefined }
        if (input?.skip === 100 && duplicateOnce) {
          duplicateOnce = false
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ ok: true, result: { commits: [duplicateCommit], hasMore: true } }),
          })
          return
        }
        await route.continue()
      })
      await duplicatePage.goto(BASE, { waitUntil: "domcontentloaded" })
      await duplicatePage.waitForFunction(
        () => document.querySelectorAll('[data-testid="repository-select"] option').length >= 16,
        null,
        { timeout: 30_000 },
      )
      await duplicatePage.locator('[data-testid="repository-select"]').selectOption(repositoryInfo.A.id)
      await waitForLoaded(duplicatePage, 100)
      await waitForRows(duplicatePage, 1)
      await waitNotBusy(duplicatePage)
      const duplicateResponse = duplicatePage.waitForResponse(
        (response) => {
          if (!response.url().includes("/__gg/rpc/getLog")) return false
          try {
            return JSON.parse(response.request().postData() ?? "{}").skip === 100
          } catch {
            return false
          }
        },
        { timeout: AUTO_LOAD_TIMEOUT },
      )
      await scrollToBottom(duplicatePage)
      let duplicateTriggered = false
      try {
        await duplicateResponse
        duplicateTriggered = true
      } catch {
        duplicateTriggered = false
      }
      await waitRaf(duplicatePage, 2)
      const duplicateState = await layoutSnapshot(duplicatePage)
      const duplicateSkip100 = duplicateRpc.filter(
        (entry) => entry.method === "getLog" && entry.input?.skip === 100,
      ).length
      metrics.duplicatePageInjection = {
        triggered: duplicateTriggered,
        skip100: duplicateSkip100,
        footer: duplicateState.footer,
        rows: duplicateState.rows.length,
        errors: duplicateState.errors,
        loadMore: duplicateState.loadMore,
      }
      check("duplicate-page injection reaches auto-load skip=100", duplicateTriggered, metrics.duplicatePageInjection)
      check("duplicate page does not append commits", duplicateState.footer.includes("100 loaded"), metrics.duplicatePageInjection)
      check("duplicate page does not raise a stale error", duplicateState.errors.length === 0, metrics.duplicatePageInjection)
      check("duplicate page keeps the manual fallback available", Boolean(duplicateState.loadMore), metrics.duplicatePageInjection)
      await duplicatePage.locator('[data-testid="history-scroll"]').evaluate((element) => {
        element.scrollTop = element.scrollHeight
      })
      await waitRaf(duplicatePage, 2)
      const duplicateSkip100After = duplicateRpc.filter(
        (entry) => entry.method === "getLog" && entry.input?.skip === 100,
      ).length
      metrics.duplicatePageInjection.skip100AfterReScroll = duplicateSkip100After
      check("duplicate page stops automatic retry while still at the bottom", duplicateSkip100After === duplicateSkip100, metrics.duplicatePageInjection)
      await screenshot(duplicatePage, "11-duplicate-page-stall-520.png", {
        locator: duplicatePage.locator('[data-testid="harness-panel-shell"]'),
      })
      faultEvidence.duplicatePage = {
        consoleErrors: duplicateConsole,
        pageErrors: duplicatePageErrors,
        httpErrors: duplicateHttp,
        rpcRequests: duplicateRpc,
      }
      await duplicateContext.close()

      // Simulate a blocked/frozen ResizeObserver: the panel signals stay at
      // their defaults, but auto-pagination must still use the live scroller
      // metrics from the scroll event/element.
      const roContext = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        deviceScaleFactor: 1,
        locale: "en-US",
      })
      const roPage = await roContext.newPage()
      await roPage.addInitScript(() => {
        window.__ggROObserved = 0
        window.ResizeObserver = class {
          observe() {
            window.__ggROObserved += 1
          }
          unobserve() {}
          disconnect() {}
        }
      })
      await roPage.goto(BASE, { waitUntil: "domcontentloaded" })
      await roPage.waitForFunction(
        () => document.querySelectorAll('[data-testid="repository-select"] option').length >= 16,
        null,
        { timeout: 30_000 },
      )
      await roPage.locator('[data-testid="repository-select"]').selectOption(repositoryInfo.A.id)
      await waitForLoaded(roPage, 100)
      await waitForRows(roPage, 1)
      await waitNotBusy(roPage)
      const roBefore = await layoutSnapshot(roPage)
      const roObserved = await roPage.evaluate(() => window.__ggROObserved ?? 0)
      await scrollToBottom(roPage)
      const roBottom = await currentScrollTop(roPage)
      let roAutoOk = false
      try {
        await waitForLoaded(roPage, 200, AUTO_LOAD_TIMEOUT)
        roAutoOk = true
      } catch {
        roAutoOk = false
      }
      const roAfter = await layoutSnapshot(roPage)
      metrics.roDisabled = {
        observedCallbacksSuppressed: roObserved > 0,
        roObserved,
        liveScrollerHeight: roBefore.scroller?.clientHeight ?? null,
        bottomTop: roBottom,
        autoOk: roAutoOk,
        footer: roAfter.footer,
        scrollTop: roAfter.scroller?.scrollTop ?? null,
        maxScroll: roAfter.scroller?.maxScroll ?? null,
        errors: roAfter.errors,
      }
      check(
        "RO-disabled panel still auto-loads 100 -> 200 from live scroller metrics",
        roAutoOk && roAfter.footer.includes("200 loaded"),
        metrics.roDisabled,
      )
      check(
        "RO-disabled auto-load preserves the live scroll position",
        roAutoOk && roAfter.scroller.scrollTop >= roBottom - 1,
        metrics.roDisabled,
      )
      await screenshot(roPage, "12-ro-disabled-auto-200-520.png", {
        locator: roPage.locator('[data-testid="harness-panel-shell"]'),
      })
      await roContext.close()
    })
  } catch (error) {
    fatal = error instanceof Error ? error.message : String(error)
    notes.push(`Fatal: ${fatal}`)
    try {
      await page.screenshot({ path: join(ARTIFACTS, "99-fatal.png"), animations: "disabled" })
      screenshots.push(join(ARTIFACTS, "99-fatal.png"))
    } catch { /* ignore */ }
  } finally {
    try {
      metrics.finalLayout = await layoutSnapshot(page)
    } catch {
      metrics.finalLayout = null
    }
    await context.close().catch(() => {})
    await browser.close().catch(() => {})
  }

  const endMtimes = sourceMtimes()
  const sourceStable = JSON.stringify(startMtimes) === JSON.stringify(endMtimes)
  check("production source mtimes are stable during the run", sourceStable, { start: startMtimes, end: endMtimes })

  const benignConsole = consoleErrors.filter(
    (entry) =>
      entry.location?.url?.endsWith("/favicon.ico") ||
      /Failed to load resource.*404/.test(entry.text),
  )
  const realConsole = consoleErrors.filter((entry) => !benignConsole.includes(entry))
  const realHttp = httpErrors.filter((entry) => !entry.url.endsWith("/favicon.ico"))
  check("no page errors", pageErrors.length === 0, { count: pageErrors.length, pageErrors })
  check("no unexpected console errors (favicon 404 excluded)", realConsole.length === 0, {
    consoleErrors: realConsole,
    benignConsole,
  })
  check("no failed non-aborted requests", requestFailures.length === 0, { requestFailures })
  check("no unexpected HTTP >=400 responses", realHttp.length === 0, { httpErrors: realHttp })
  check("no getRefs request", !rpcRequests.some((request) => request.method === "getRefs"), {
    methods: rpcRequests.reduce((counts, request) => {
      counts[request.method] = (counts[request.method] ?? 0) + 1
      return counts
    }, {}),
  })
  const faultExpectedConsole = faultEvidence.consoleErrors.filter(
    (entry) =>
      /502/.test(entry.text) && entry.location?.url?.includes("/__gg/rpc/getLog"),
  )
  const faultUnexpectedConsole = faultEvidence.consoleErrors.filter(
    (entry) =>
      !/favicon|404/.test(entry.text) && !faultExpectedConsole.includes(entry),
  )
  check("no fault-injection page errors", faultEvidence.pageErrors.length === 0, faultEvidence.pageErrors)
  check("no unexpected fault-injection console errors (injected 502 excluded)", faultUnexpectedConsole.length === 0, {
    expected: faultExpectedConsole,
    unexpected: faultUnexpectedConsole,
  })
  check("fault-injection response is separated from normal evidence", faultEvidence.httpErrors.some((entry) => entry.status === 502), faultEvidence.httpErrors)
  faultEvidence.expectedConsole = faultExpectedConsole
  faultEvidence.unexpectedConsole = faultUnexpectedConsole

  const failed = checks.filter((entry) => !entry.ok)
  const result = {
    startedAt,
    finishedAt: new Date().toISOString(),
    url: BASE,
    chrome: executablePath,
    artifacts: ARTIFACTS,
    verdict: failed.length === 0 && !fatal ? "PASS" : "FAIL",
    fatal,
    checks,
    failed,
    metrics,
    screenshots,
    consoleErrors: { all: consoleErrors, benign: benignConsole, unexpected: realConsole },
    pageErrors,
    requestFailures,
    httpErrors: { all: httpErrors, unexpected: realHttp },
    abortedRequests,
    hmrEvents,
    sourceMtimes: { start: startMtimes, end: endMtimes, stable: sourceStable },
    faultInjection: faultEvidence,
    notes,
    privateDataNote:
      "TEMP result.json may contain private repository/hash/path details for debugging. The committed report is anonymous.",
    desktopNotCovered: [
      "Desktop window/panel chrome, tab strip, drag/resize and side-region rules",
      "MenuItem registration for session.panel",
      "OpenCode session switching, project/sidebar data, host theme injection, host event bus",
    ],
  }
  const resultPath = join(ARTIFACTS, "result.json")
  writeFileSync(resultPath, JSON.stringify(result, null, 2), "utf8")
  console.log(JSON.stringify({ verdict: result.verdict, failed, screenshots, resultPath }, null, 2))
}

await main()
