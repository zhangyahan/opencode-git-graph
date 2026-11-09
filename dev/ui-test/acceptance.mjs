/**
 * Real-browser UI acceptance for the dev harness.
 *
 * This is intentionally dev-only and does not touch the production bundle.
 * It drives the real GitGraphPanel + RepositoryManager through the harness
 * bridge, takes screenshots and writes a machine-readable result.
 *
 * Prerequisite (isolated, outside the project):
 *   mkdir C:\Users\<you>\AppData\Local\Temp\opencode\gg-ui-test
 *   cd    C:\Users\<you>\AppData\Local\Temp\opencode\gg-ui-test
 *   npm init -y && npm i playwright-core@1.56.1
 *
 * Run from the repository root while `npm run dev:ui` is serving 5178:
 *   node dev/ui-test/acceptance.mjs
 *
 * Environment:
 *   GG_PLAYWRIGHT_CORE  path to a playwright-core install (defaults to the
 *                       approved TEMP directory used by this run)
 *   GG_CHROME_PATH      Chrome/Edge executable (auto-detected if omitted)
 *   GG_UI_ARTIFACTS     screenshot/result directory (defaults to TEMP)
 */

import { createRequire } from "node:module"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const require = createRequire(import.meta.url)

const BASE = process.env.GG_UI_URL ?? "http://127.0.0.1:5178/"
const TEMP_ROOT = process.env.GG_UI_TEMP ?? join(process.env.TEMP ?? tmpdir(), "opencode")
const ARTIFACTS = resolve(
  process.env.GG_UI_ARTIFACTS ?? join(TEMP_ROOT, "gg-ui-artifacts"),
)
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
        throw new Error(
          `Cannot load playwright-core from ${PLAYWRIGHT_CANDIDATES.join(", ")}: ${error.message}`,
        )
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
    "C:/Users/yahan/AppData/Local/Google/Chrome/Application/chrome.exe",
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
const consoleErrors = []
const pageErrors = []
const requestFailures = []
const httpErrors = []
const abortedRequests = []
const hmrEvents = []
const rpcRequests = []
const notes = []

function check(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail })
  return Boolean(ok)
}

function note(text) {
  notes.push(text)
}

async function step(name, fn) {
  try {
    await fn()
  } catch (error) {
    check(name, false, { error: error instanceof Error ? error.message : String(error) })
    note(`Step failed: ${name}`)
  }
}

function relativeRect(element, origin) {
  const rect = element.getBoundingClientRect()
  return {
    left: round(rect.left - origin.left),
    top: round(rect.top - origin.top),
    right: round(rect.right - origin.left),
    bottom: round(rect.bottom - origin.top),
    width: round(rect.width),
    height: round(rect.height),
  }
}

function round(value) {
  return Math.round(value * 100) / 100
}

async function screenshot(page, name, { fullPage = false, locator } = {}) {
  const path = join(ARTIFACTS, name)
  if (locator) await locator.screenshot({ path, animations: "disabled" })
  else await page.screenshot({ path, fullPage, animations: "disabled" })
  screenshots.push(path)
  return path
}

async function waitFooterContains(page, text, timeout = 20_000) {
  await page.waitForFunction(
    (needle) =>
      (document.querySelector(".gg-history-footer")?.innerText ?? "").includes(needle),
    text,
    { timeout },
  )
}

async function waitRows(page, minimum = 1, timeout = 20_000) {
  await page.waitForFunction(
    (count) => document.querySelectorAll(".gg-graph-row").length >= count,
    minimum,
    { timeout },
  )
}

async function waitBranch(page, text, timeout = 20_000) {
  await page.waitForFunction(
    (expected) =>
      (document.querySelector('[data-testid="current-branch"]')?.innerText ?? "").trim() ===
      expected,
    text,
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

async function layoutSnapshot(page) {
  return page.evaluate(() => {
    const q = (selector, root = document) => root.querySelector(selector)
    const qa = (selector, root = document) => [...root.querySelectorAll(selector)]
    const panel = q(".git-graph-panel")
    const origin = panel.getBoundingClientRect()
    const rect = (element) => {
      if (!element) return null
      const r = element.getBoundingClientRect()
      return {
        left: Math.round((r.left - origin.left) * 100) / 100,
        top: Math.round((r.top - origin.top) * 100) / 100,
        right: Math.round((r.right - origin.left) * 100) / 100,
        bottom: Math.round((r.bottom - origin.top) * 100) / 100,
        width: Math.round(r.width * 100) / 100,
        height: Math.round(r.height * 100) / 100,
      }
    }
    const overflowX = (element, min = 0) =>
      element ? Math.max(min, element.scrollWidth - element.clientWidth) : null
    const overflowY = (element, min = 0) =>
      element ? Math.max(min, element.scrollHeight - element.clientHeight) : null
    const history = q('[data-testid="history"]')
    const historyScroll = q('[data-testid="history-scroll"]')
    const toolbar = q(".gg-toolbar")
    const changes = q('[data-testid="changes"]')
    const head = q(".gg-history-head")
    const rows = qa(".gg-graph-row")
    const first = rows[0]
    const firstDesc = first?.querySelector(".gg-col-desc")
    const firstSubject = first?.querySelector(".gg-subject")
    const graphSpacer = q(".gg-graph-hspacer")
    const dateCell = first?.querySelector(".gg-col-date")
    const authorCell = first?.querySelector(".gg-col-author")
    const details = q('[data-testid="commit-details"]')
    const diff = q('[data-testid="diff"]')
    const stage = q(".harness-stage")
    const shell = q('[data-testid="harness-panel-shell"]')

    return {
      viewport: { width: innerWidth, height: innerHeight },
      shell: shell ? { width: Number(shell.dataset.panelWidth), rect: rect(shell) } : null,
      panel: rect(panel),
      panelOverflow: { x: overflowX(panel), y: overflowY(panel) },
      doc: {
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        scrollHeight: document.documentElement.scrollHeight,
        clientHeight: document.documentElement.clientHeight,
        overflowX: getComputedStyle(document.documentElement).overflowX,
        overflowY: getComputedStyle(document.documentElement).overflowY,
      },
      body: {
        scrollWidth: document.body.scrollWidth,
        clientWidth: document.body.clientWidth,
      },
      stage: stage
        ? { rect: rect(stage), overflowX: overflowX(stage), overflowY: overflowY(stage) }
        : null,
      toolbar: toolbar
        ? {
            rect: rect(toolbar),
            overflowX: overflowX(toolbar),
            singleLine: toolbar.getBoundingClientRect().height <= 42,
          }
        : null,
      changes: changes
        ? {
            rect: rect(changes),
            text: (changes.innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 240),
          }
        : null,
      history: history
        ? { rect: rect(history), overflowX: overflowX(history), overflowY: overflowY(history) }
        : null,
      historyScroll: historyScroll
        ? {
            rect: rect(historyScroll),
            scrollTop: historyScroll.scrollTop,
            scrollHeight: historyScroll.scrollHeight,
            clientHeight: historyScroll.clientHeight,
            overflowX: overflowX(historyScroll),
            overflowY: overflowY(historyScroll),
          }
        : null,
      rows: {
        rendered: rows.length,
        unique: new Set(rows.map((row) => row.dataset.commit)).size,
        rowHeight: first ? first.getBoundingClientRect().height : null,
        firstTop: first ? Number.parseFloat(first.style.top) : null,
        lastTop: rows.length
          ? Number.parseFloat(rows[rows.length - 1].style.top)
          : null,
        rowOverflowX: rows.reduce(
          (maximum, row) => Math.max(maximum, row.scrollWidth - row.clientWidth),
          0,
        ),
        titles: rows.slice(0, 3).map((row) => row.querySelector(".gg-subject")?.textContent ?? ""),
      },
      header: head
        ? {
            texts: qa(".gg-history-head > div").map((cell) => cell.textContent.trim()),
            rect: rect(head),
            scrollHeight: head.scrollHeight,
            clientHeight: head.clientHeight,
          }
        : null,
      grids: {
        header: head ? getComputedStyle(head).gridTemplateColumns : null,
        row: first ? getComputedStyle(first).gridTemplateColumns : null,
        match: Boolean(head && first && getComputedStyle(head).gridTemplateColumns ===
          getComputedStyle(first).gridTemplateColumns),
      },
      graph: {
        column: rect(first?.querySelector(".gg-row-graph")),
        viewport: (() => {
          const graphScroll = q('[data-testid="graph-scroll"]')
          if (!graphScroll) return null
          return {
            ...rect(graphScroll),
            clientWidth: graphScroll.clientWidth,
            scrollWidth: graphScroll.scrollWidth,
            scrollLeft: graphScroll.scrollLeft,
          }
        })(),
        contentWidth: graphSpacer ? Number.parseFloat(graphSpacer.style.width) : null,
        shift:
          history
            ? getComputedStyle(history).getPropertyValue("--gg-graph-shift").trim()
            : null,
      },
      desc: {
        left: firstDesc ? rect(firstDesc).left : null,
        subjectLeft: firstSubject ? rect(firstSubject).left : null,
        subjectWidth: firstSubject ? rect(firstSubject).width : null,
      },
      date: {
        visible: Boolean(dateCell),
        width: dateCell ? rect(dateCell).width : null,
      },
      author: {
        visible: Boolean(authorCell),
        width: authorCell ? rect(authorCell).width : null,
      },
      details: details
        ? {
            visible: true,
            rect: rect(details),
            layout: details.querySelector(".gg-details-body")?.className ?? null,
            filesCount: qa('[data-testid="commit-details"] .gg-file-row').length,
            parentOptions: qa('[data-testid="commit-details"] select[aria-label="Diff parent"] option')
              .length,
            diff: diff
              ? {
                  rect: rect(diff),
                  lines: qa('[data-testid="diff"] .gg-diff-line').length,
                  add: qa('[data-testid="diff"] .gg-diff-add').length,
                  remove: qa('[data-testid="diff"] .gg-diff-remove').length,
                  hunk: qa('[data-testid="diff"] .gg-diff-hunk').length,
                  context: qa('[data-testid="diff"] .gg-diff-context').length,
                  placeholder:
                    q('[data-testid="diff"] .gg-diff-placeholder')?.textContent?.trim() ?? null,
                  header:
                    q('[data-testid="diff"] .gg-diff-header')?.innerText
                      .replace(/\s+/g, " ")
                      .trim()
                      .slice(0, 180) ?? null,
                  buttons: qa('[data-testid="diff"] button').length,
                }
              : null,
          }
        : { visible: false },
      footer: (q(".gg-history-footer")?.innerText ?? "").replace(/\s+/g, " ").trim(),
      branch: (q('[data-testid="current-branch"]')?.innerText ?? "").trim(),
      repoValue: q('[data-testid="repository-select"]')?.value ?? null,
      searchValue: q('[data-testid="search-commits"]')?.value ?? null,
      errors: qa(".gg-error").map((element) => element.innerText.trim().slice(0, 200)),
      statuses: qa(".gg-status").map((element) => element.innerText.trim()).filter(Boolean),
    }
  })
}

async function graphSpacing(page) {
  return page.evaluate(() => {
    const xs = new Set()
    const svgs = [...document.querySelectorAll(".gg-graph-row .gg-graph-svg")].slice(0, 20)
    const pair = /(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g
    for (const svg of svgs) {
      for (const path of svg.querySelectorAll("path")) {
        const d = path.getAttribute("d") ?? ""
        let match
        while ((match = pair.exec(d))) xs.add(Math.round(Number(match[1]) * 100) / 100)
      }
      const circle = svg.querySelector("circle")
      if (circle) xs.add(Math.round(Number(circle.getAttribute("cx")) * 100) / 100)
    }
    const sorted = [...xs].sort((a, b) => a - b)
    const deltas = []
    for (let index = 1; index < sorted.length; index += 1) {
      const delta = Math.round((sorted[index] - sorted[index - 1]) * 100) / 100
      if (delta > 0.5) deltas.push(delta)
    }
    const frequency = new Map()
    for (const delta of deltas) frequency.set(delta, (frequency.get(delta) ?? 0) + 1)
    let mode = null
    let modeCount = 0
    for (const [delta, count] of frequency) {
      if (count > modeCount || (count === modeCount && mode !== null && delta < mode)) {
        mode = delta
        modeCount = count
      }
    }
    return {
      svgRows: svgs.length,
      xValues: sorted.length,
      minX: sorted[0] ?? null,
      maxX: sorted.at(-1) ?? null,
      minPositiveDelta: deltas.length ? Math.min(...deltas) : null,
      modeDelta: mode,
      modeCount,
      deltas: [...frequency.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8),
      sampleX: sorted.slice(0, 16),
    }
  })
}

async function renderedRows(page) {
  return page.evaluate(() => {
    const scroller = document.querySelector('[data-testid="history-scroll"]')
    const scrollTop = scroller?.scrollTop ?? 0
    const viewport = scroller?.clientHeight ?? 0
    return [...document.querySelectorAll(".gg-graph-row")].map((row) => {
      const top = Number.parseFloat(row.style.top)
      return {
        index: row.style.top ? Math.round(top / 28) : null,
        top,
        hash: row.dataset.commit,
        subject: row.querySelector(".gg-subject")?.textContent ?? "",
        visible: top + 28 > scrollTop && top < scrollTop + viewport,
      }
    })
  })
}

async function graphScrollState(page) {
  return page.evaluate(() => {
    const graphScroll = document.querySelector('[data-testid="graph-scroll"]')
    const history = document.querySelector('[data-testid="history"]')
    const row = document.querySelector(".gg-graph-row")
    const inners = [...document.querySelectorAll(".gg-row-graph-inner")].map((element) => {
      const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform)
      return {
        x: Math.round(matrix.e * 100) / 100,
        transform: getComputedStyle(element).transform,
      }
    })
    return {
      columnWidth: row ? row.querySelector(".gg-row-graph").getBoundingClientRect().width : null,
      width: graphScroll?.getBoundingClientRect().width ?? null,
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
      rowCount: inners.length,
      rowTransforms: inners,
      allRowsSync:
        inners.length > 0 &&
        inners.every(
          (entry) =>
            Math.abs(entry.x - -(graphScroll?.scrollLeft ?? 0)) < 0.2,
        ),
    }
  })
}

async function waitGraphShiftSync(page) {
  await page.waitForFunction(
    () => {
      const graphScroll = document.querySelector('[data-testid="graph-scroll"]')
      const history = document.querySelector('[data-testid="history"]')
      const expected = -(graphScroll?.scrollLeft ?? 0)
      const shift = Number.parseFloat(
        getComputedStyle(history).getPropertyValue("--gg-graph-shift"),
      )
      const inners = [...document.querySelectorAll(".gg-row-graph-inner")]
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
  await waitGraphShiftSync(page)
  return graphScrollState(page)
}

async function findWidestGraphRow(page, totalRows) {
  let best = { maxX: 0, index: null, hash: null, subject: null }
  const stepPx = 28 * 20
  for (let top = 0; top <= totalRows * 28; top += stepPx) {
    await page.locator('[data-testid="history-scroll"]').evaluate((element, value) => {
      element.scrollTop = value
    }, top)
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    )
    const found = await page.evaluate(() => {
      let maxX = 0
      let row = null
      for (const element of document.querySelectorAll(".gg-graph-row")) {
        const svg = element.querySelector(".gg-graph-svg")
        if (!svg) continue
        for (const path of svg.querySelectorAll("path")) {
          const d = path.getAttribute("d") ?? ""
          const xs = [...d.matchAll(/(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g)].map(
            (match) => Number(match[1]),
          )
          const local = Math.max(...xs, 0)
          if (local > maxX) {
            maxX = local
            row = {
              index: Math.round(Number.parseFloat(element.style.top) / 28),
              hash: element.dataset.commit,
              subject: element.querySelector(".gg-subject")?.textContent ?? "",
            }
          }
        }
        const circle = svg.querySelector("circle")
        if (circle) {
          const x = Number(circle.getAttribute("cx"))
          if (x > maxX) {
            maxX = x
            row = {
              index: Math.round(Number.parseFloat(element.style.top) / 28),
              hash: element.dataset.commit,
              subject: element.querySelector(".gg-subject")?.textContent ?? "",
            }
          }
        }
      }
      return { maxX, ...row }
    })
    if (found.maxX > best.maxX) best = found
  }
  return best
}

async function dragGraphColumn(page, delta) {
  const handle = page.locator(".gg-graph-resize")
  const box = await handle.boundingBox()
  if (!box) throw new Error("Graph resize handle has no bounding box")
  const start = await graphScrollState(page)
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + delta, y, { steps: 8 })
  await page.mouse.up()
  await page.waitForFunction(
    ([expected]) => {
      const row = document.querySelector(".gg-graph-row")
      const width = row?.querySelector(".gg-row-graph")?.getBoundingClientRect().width
      return typeof width === "number" && Math.abs(width - expected) < 1.5
    },
    [start.columnWidth + delta],
    { timeout: 10_000 },
  )
  await waitGraphShiftSync(page)
  return { before: start, after: await graphScrollState(page) }
}

async function hitTest(page, selector) {
  return page.evaluate((target) => {
    const element = document.querySelector(target)
    if (!element) return { found: false }
    const rect = element.getBoundingClientRect()
    const x = rect.left + rect.width / 2
    const y = rect.top + rect.height / 2
    const hit = document.elementFromPoint(x, y)
    return {
      found: true,
      inViewport:
        rect.left >= 0 &&
        rect.top >= 0 &&
        rect.right <= innerWidth &&
        rect.bottom <= innerHeight,
      hitTag: hit?.tagName ?? null,
      hitTestId: hit?.closest("[data-testid]")?.getAttribute("data-testid") ?? null,
      hitText: (hit?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 60),
      contains: element === hit || element.contains(hit),
    }
  }, selector)
}

async function collectRepoInfo(page) {
  return page.evaluate(() => {
    const select = document.querySelector('[data-testid="repository-select"]')
    const options = [...select.options].map((option) => ({
      value: option.value,
      text: option.textContent.trim(),
    }))
    return {
      options,
      worktrees: options.filter((option) => option.text.includes("(worktree)")),
      byText: Object.fromEntries(options.map((option) => [option.text, option.value])),
    }
  })
}

async function main() {
  mkdirSync(ARTIFACTS, { recursive: true })
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

  const requests = new Map()
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
    if (request.url().includes("/__gg/rpc/")) {
      const method = request.url().split("/__gg/rpc/")[1]
      let input
      try {
        input = JSON.parse(request.postData() ?? "{}")
      } catch {
        input = undefined
      }
      requests.set(request, { method, input })
      rpcRequests.push({
        method,
        repositoryId: input?.repositoryId ? String(input.repositoryId).split(/[\\/]/).pop() : undefined,
        parentIndex: input?.parentIndex,
        limit: input?.limit,
        skip: input?.skip,
        path: input?.target?.type === "commit" ? undefined : input?.path ? "working-tree" : undefined,
      })
    }
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
  try {
    await step("1. page load / repository options", async () => {
      await page.goto(BASE, { waitUntil: "domcontentloaded" })
      await page.waitForFunction(
        () => document.querySelectorAll('[data-testid="repository-select"] option').length >= 16,
        null,
        { timeout: 30_000 },
      )
      await waitRows(page, 1)
      await waitNotBusy(page)
      await waitFooterContains(page, "loaded")
      const repos = await collectRepoInfo(page)
      metrics.repositories = repos
      check("repository option count is 16", repos.options.length === 16, {
        count: repos.options.length,
      })
      check("repository option list contains 4 worktrees", repos.worktrees.length === 4, {
        worktrees: repos.worktrees.map((option) => option.text),
      })
      metrics.initialLayout = await layoutSnapshot(page)
      check("initial repository loads commits", metrics.initialLayout.rows.rendered > 0, {
        footer: metrics.initialLayout.footer,
        branch: metrics.initialLayout.branch,
      })
      await screenshot(page, "01-initial-520.png", { fullPage: true })
    })

    const repos = metrics.repositories
    const saiId = repos.byText["sai-qx-api"]
    const qxId = repos.byText["qx-api"]
    check("sai-qx-api option exists", Boolean(saiId), { value: saiId ?? null })
    check("qx-api option exists", Boolean(qxId), { value: qxId ?? null })
    if (!saiId || !qxId) throw new Error("Required fixture repositories are missing")

    await step("2a. sai-qx-api initial 100 commits", async () => {
      await page.locator('[data-testid="repository-select"]').selectOption(saiId)
      await waitBranch(page, "fixbug_zijinguoji_penetration_testing")
      await waitFooterContains(page, "100 loaded+")
      await waitRows(page, 1)
      await waitNotBusy(page)
      const layout = await layoutSnapshot(page)
      metrics.sai100 = layout
      metrics.sai100Spacing = await graphSpacing(page)
      const totalRows = Math.round(layout.historyScroll.scrollHeight / 28)
      check("sai-qx-api starts at 100 loaded", layout.footer.includes("100 loaded+"), {
        footer: layout.footer,
      })
      check("history spacer represents 100 rows", totalRows === 100, { totalRows })
      check("rendered row DOM is far below 100", layout.rows.rendered < 50, {
        rendered: layout.rows.rendered,
        unique: layout.rows.unique,
      })
      check("rendered rows are unique", layout.rows.unique === layout.rows.rendered, {
        rendered: layout.rows.rendered,
        unique: layout.rows.unique,
      })
      check(
        "graph lane spacing is at least 8px (expected 12-14px)",
        metrics.sai100Spacing.minPositiveDelta >= 8 &&
          metrics.sai100Spacing.modeDelta >= 12 &&
          metrics.sai100Spacing.modeDelta <= 14,
        metrics.sai100Spacing,
      )
      check(
        "graph column viewport is stable and narrow",
        layout.graph.column &&
          layout.graph.column.width >= 96 &&
          layout.graph.column.width <= 260 &&
          layout.desc.left === layout.graph.column.width,
        { graphColumn: layout.graph.column, descLeft: layout.desc.left },
      )
      check(
        "graph lane scroll viewport starts at the graph column width",
        layout.graph.viewport &&
          layout.graph.column &&
          Math.abs(layout.graph.viewport.width - layout.graph.column.width) <= 1,
        {
          graphColumn: layout.graph.column?.width,
          graphScroll: layout.graph.viewport,
          graphContent: layout.graph.contentWidth,
        },
      )
      check("description text is not pushed to 450px", layout.desc.left < 450, {
        descLeft: layout.desc.left,
        subjectLeft: layout.desc.subjectLeft,
        subjectWidth: layout.desc.subjectWidth,
      })
      check("toolbar is compact and does not overflow", layout.toolbar.singleLine && layout.toolbar.overflowX <= 1, layout.toolbar)
      check(
        "520px header hides Date/Author and stays single-line",
        layout.header.texts.join("|") === "Graph|Description|Commit" && layout.grids.match,
        { columns: layout.header.texts, grids: layout.grids },
      )
      check("520px clean changes section is <=60px", layout.changes.rect.height <= 60, {
        height: layout.changes.rect.height,
        text: layout.changes.text,
      })
      check(
        "history fills the available panel height",
        layout.history.rect.height > layout.panel.height * 0.7,
        {
          panel: layout.panel.height,
          history: layout.history.rect.height,
          historyScroll: layout.historyScroll.clientHeight,
        },
      )
      check(
        "no unintended body/panel horizontal overflow at 520",
        layout.doc.scrollWidth <= layout.viewport.width &&
          layout.body.scrollWidth <= layout.viewport.width &&
          layout.panelOverflow.x <= 1 &&
          layout.stage.overflowX <= 1,
        {
          viewport: layout.viewport,
          doc: layout.doc,
          body: layout.body,
          panelOverflow: layout.panelOverflow,
          stage: layout.stage,
        },
      )
      await screenshot(page, "02-sai-520-100.png", { locator: page.locator('[data-testid="harness-panel-shell"]') })
    })

    await step("2b. Load more to 200 and scroll rows 100..125", async () => {
      await page.locator('[data-testid="load-more"]').click()
      await waitFooterContains(page, "200 loaded+", 30_000)
      await waitNotBusy(page)
      await page.waitForFunction(
        () => {
          const spacer = document.querySelector(".gg-history-spacer")
          return spacer && Math.round(Number.parseFloat(spacer.style.height) / 28) === 200
        },
        null,
        { timeout: 20_000 },
      )
      const layout = await layoutSnapshot(page)
      metrics.sai200 = layout
      metrics.sai200Spacing = await graphSpacing(page)
      const totalRows = Math.round(layout.historyScroll.scrollHeight / 28)
      check("Load more appends to 200 loaded", layout.footer.includes("200 loaded+"), {
        footer: layout.footer,
      })
      check("history spacer represents 200 rows", totalRows === 200, { totalRows })
      check("rendered row DOM remains far below 200", layout.rows.rendered < 80, {
        rendered: layout.rows.rendered,
        totalRows,
      })
      check("rendered rows remain unique", layout.rows.unique === layout.rows.rendered, {
        rendered: layout.rows.rendered,
        unique: layout.rows.unique,
      })
      check(
        "graph column viewport width is stable between 100 and 200",
        Math.abs(
          (metrics.sai100.graph.column?.width ?? 0) - (layout.graph.column?.width ?? 0),
        ) <= 1,
        {
          at100: metrics.sai100.graph.column?.width ?? null,
          at200: layout.graph.column?.width ?? null,
          graphContentAt100: metrics.sai100.graph.contentWidth,
          graphContentAt200: layout.graph.contentWidth,
        },
      )
      check(
        "graph spacing remains 12-14px after loading 200",
        metrics.sai200Spacing.minPositiveDelta >= 8 &&
          metrics.sai200Spacing.modeDelta >= 12 &&
          metrics.sai200Spacing.modeDelta <= 14,
        metrics.sai200Spacing,
      )
      check("description column is stable at 200 rows", layout.desc.left === metrics.sai100.desc.left, {
        at100: metrics.sai100.desc.left,
        at200: layout.desc.left,
      })
      check(
        "graph lane scroll viewport width is stable between 100 and 200",
        layout.graph.viewport &&
          metrics.sai100.graph.viewport &&
          Math.abs(layout.graph.viewport.width - metrics.sai100.graph.viewport.width) <= 1 &&
          Math.abs(layout.graph.viewport.width - layout.graph.column.width) <= 1,
        {
          widthAt100: metrics.sai100.graph.viewport?.width ?? null,
          widthAt200: layout.graph.viewport?.width ?? null,
          graphColumn: layout.graph.column?.width,
          graphContentAt200: layout.graph.contentWidth,
        },
      )
      check(
        "graph lane scroll viewport has a real pan range",
        layout.graph.viewport &&
          layout.graph.contentWidth > layout.graph.viewport.clientWidth &&
          layout.graph.viewport.scrollWidth > layout.graph.viewport.clientWidth,
        {
          graphColumn: layout.graph.column?.width,
          graphContent: layout.graph.contentWidth,
          graphScroll: layout.graph.viewport,
        },
      )
      const pan = await panGraphToEnd(page)
      metrics.graphPan = pan
      check(
        "graph lane scroll viewport can pan when lanes exceed the column",
        pan.scrollLeft > 0 &&
          pan.maxScroll > 0 &&
          Math.abs(pan.scrollLeft - pan.maxScroll) <= 0.6,
        pan,
      )
      check(
        "all rendered graph rows follow the panned viewport",
        pan.rowCount > 0 && pan.allRowsSync,
        {
          rowCount: pan.rowCount,
          scrollLeft: pan.scrollLeft,
          shift: pan.shift,
          transforms: pan.rowTransforms.slice(0, 3),
        },
      )
      await page.locator('[data-testid="graph-scroll"]').evaluate((element) => {
        element.scrollLeft = 0
      })
      await waitGraphShiftSync(page)

      await page.locator('[data-testid="history-scroll"]').evaluate((element) => {
        element.scrollTop = 100 * 28
      })
      await page.waitForFunction(
        () => {
          const scroller = document.querySelector('[data-testid="history-scroll"]')
          return [...document.querySelectorAll(".gg-graph-row")].some(
            (row) => Math.abs(Number.parseFloat(row.style.top) - 2800) < 0.5,
          ) && scroller.scrollTop >= 2799
        },
        null,
        { timeout: 20_000 },
      )
      const scrolled = await renderedRows(page)
      metrics.saiScroll = {
        rows: scrolled,
        layout: await layoutSnapshot(page),
      }
      const visible = scrolled.filter((row) => row.visible)
      const indices = new Set(visible.map((row) => row.index))
      const missing = []
      for (let index = 100; index <= 125; index += 1) {
        if (!indices.has(index)) missing.push(index)
      }
      check("scrollTo row 100 renders row 100 at the viewport top", indices.has(100), {
        visibleIndices: [...indices].sort((a, b) => a - b),
      })
      check("rows 100..125 are all rendered in the viewport", missing.length === 0, {
        missing,
        visibleCount: indices.size,
      })
      check("virtual scrolling keeps DOM small while scrolled", scrolled.length < 80, {
        rendered: scrolled.length,
      })
      await screenshot(page, "03-sai-520-rows-100-125.png", {
        locator: page.locator('[data-testid="harness-panel-shell"]'),
      })

      const widest = await findWidestGraphRow(page, 200)
      metrics.widestGraphRow = widest
      check(
        "a 200-row graph row actually extends beyond the graph column",
        widest.maxX > (layout.graph.column?.width ?? 0) + 8,
        { widest, graphColumn: layout.graph.column?.width ?? null },
      )
      if (widest.index === null) throw new Error("No wide graph row was found")
      await page.locator('[data-testid="history-scroll"]').evaluate((element, index) => {
        element.scrollTop = index * 28
      }, widest.index)
      await page.waitForFunction(
        (index) =>
          [...document.querySelectorAll(".gg-graph-row")].some(
            (row) => Math.round(Number.parseFloat(row.style.top) / 28) === index,
          ),
        widest.index,
        { timeout: 20_000 },
      )
      const pannedWidest = await panGraphToEnd(page)
      metrics.graphPanWidestRow = { widest, pannedWidest }
      check(
        "panned graph reveals the right-side nodes of the widest row",
        pannedWidest.allRowsSync &&
          widest.maxX > (layout.graph.column?.width ?? 0) &&
          widest.maxX - pannedWidest.scrollLeft <= (layout.graph.column?.width ?? 0) + 0.5,
        { widest, pan: pannedWidest },
      )
      await screenshot(page, "10-sai-520-graph-panned-widest.png", {
        locator: page.locator('[data-testid="harness-panel-shell"]'),
      })
    })

    await step("2c. commit search by short hash/subject and restore", async () => {
      const rows = (await renderedRows(page)).filter((row) => row.visible)
      const target = rows.find((row) => row.hash) ?? null
      if (!target) throw new Error("No visible row available for search")
      const short = target.hash.slice(0, 7)
      metrics.searchTarget = { short, hash: target.hash, subject: target.subject }
      const input = page.locator('[data-testid="search-commits"]')
      await input.fill(short)
      await page.waitForFunction(
        () => (document.querySelector(".gg-history-footer")?.innerText ?? "").includes("matches"),
        null,
        { timeout: 20_000 },
      )
      const hashFooter = await page.locator(".gg-history-footer").innerText()
      const hashMatches = Number((hashFooter.match(/(\d+)\s+matches/) ?? [])[1] ?? 0)
      check("short-hash search reports matches", hashMatches >= 1, { footer: hashFooter, short })
      await input.press("Enter")
      await page.waitForFunction(
        (hash) =>
          [...document.querySelectorAll(".gg-graph-row.gg-search-match")].some(
            (row) => row.dataset.commit === hash,
          ),
        target.hash,
        { timeout: 20_000 },
      )
      const matchRows = await page.locator(".gg-graph-row.gg-search-match").count()
      check("Enter jumps to the matching commit row", matchRows >= 1, {
        matchRows,
        short,
      })
      await page.locator("button.gg-search-clear").click()
      await page.waitForFunction(
        () => (document.querySelector('[data-testid="search-commits"]')?.value ?? "") === "",
        null,
        { timeout: 10_000 },
      )
      await waitFooterContains(page, "200 loaded+")
      check("clearing search restores the 200 loaded view", true, {
        footer: await page.locator(".gg-history-footer").innerText(),
      })

      const subject = target.subject.trim()
      if (subject) {
        await input.fill(subject)
        await page.waitForFunction(
          () => (document.querySelector(".gg-history-footer")?.innerText ?? "").includes("matches"),
          null,
          { timeout: 20_000 },
        )
        const subjectFooter = await page.locator(".gg-history-footer").innerText()
        const subjectMatches = Number((subjectFooter.match(/(\d+)\s+matches/) ?? [])[1] ?? 0)
        check("subject search reports matches", subjectMatches >= 1, {
          footer: subjectFooter,
          subject,
        })
        await input.press("Escape")
        await page.waitForFunction(
          () => (document.querySelector('[data-testid="search-commits"]')?.value ?? "") === "",
          null,
          { timeout: 10_000 },
        )
        await waitFooterContains(page, "200 loaded+")
        check("restoring search/filter state works", true, {
          footer: await page.locator(".gg-history-footer").innerText(),
        })
      } else {
        check("subject search skipped because the row has no subject", false, target)
      }

      await page.locator('[data-testid="history-scroll"]').evaluate((element) => {
        element.scrollTop = element.scrollHeight
      })
      await page.waitForFunction(
        () => {
          const scroller = document.querySelector('[data-testid="history-scroll"]')
          if (!scroller) return false
          const rows = [...document.querySelectorAll(".gg-graph-row")]
            .map((row) => ({
              index: Math.round(Number.parseFloat(row.style.top) / 28),
              top: Number.parseFloat(row.style.top),
            }))
            .sort((a, b) => a.index - b.index)
          const last = rows.at(-1)
          return (
            Math.abs(scroller.scrollTop - (scroller.scrollHeight - scroller.clientHeight)) <= 1 &&
            last?.index === 199 &&
            Math.abs(last.top + 28 - scroller.scrollHeight) <= 1
          )
        },
        null,
        { timeout: 20_000 },
      )
      const bottomBefore = await page.evaluate(() => {
        const scroller = document.querySelector('[data-testid="history-scroll"]')
        const rows = [...document.querySelectorAll(".gg-graph-row")]
          .map((row) => ({
            index: Math.round(Number.parseFloat(row.style.top) / 28),
            top: Number.parseFloat(row.style.top),
            hash: row.dataset.commit,
            subject: row.querySelector(".gg-subject")?.textContent ?? "",
          }))
          .sort((a, b) => a.index - b.index)
        return {
          scrollTop: scroller.scrollTop,
          maxScroll: scroller.scrollHeight - scroller.clientHeight,
          scrollHeight: scroller.scrollHeight,
          clientHeight: scroller.clientHeight,
          rendered: rows.length,
          first: rows[0],
          last: rows.at(-1),
          blankBottom: scroller.scrollHeight - (rows.at(-1).top + 28),
        }
      })
      metrics.bottomBeforeSearch = bottomBefore
      const lastShort = bottomBefore.last.hash.slice(0, 7)
      metrics.bottomSearchTarget = {
        short: lastShort,
        hash: bottomBefore.last.hash,
        subject: bottomBefore.last.subject,
      }
      await input.fill(lastShort)
      await page.waitForFunction(
        () => (document.querySelector(".gg-history-footer")?.innerText ?? "").includes("matches"),
        null,
        { timeout: 20_000 },
      )
      await input.press("Enter")
      await page.waitForFunction(
        () => {
          const scroller = document.querySelector('[data-testid="history-scroll"]')
          const rows = [...document.querySelectorAll(".gg-graph-row")]
            .map((row) => ({
              index: Math.round(Number.parseFloat(row.style.top) / 28),
              top: Number.parseFloat(row.style.top),
              match: row.classList.contains("gg-search-match"),
            }))
            .sort((a, b) => a.index - b.index)
          const last = rows.at(-1)
          return (
            last?.index === 199 &&
            last.match &&
            Math.abs(scroller.scrollTop - (scroller.scrollHeight - scroller.clientHeight)) <= 1 &&
            Math.abs(last.top + 28 - scroller.scrollHeight) <= 1
          )
        },
        null,
        { timeout: 20_000 },
      )
      const bottomAfter = await page.evaluate(() => {
        const scroller = document.querySelector('[data-testid="history-scroll"]')
        const rows = [...document.querySelectorAll(".gg-graph-row")]
          .map((row) => ({
            index: Math.round(Number.parseFloat(row.style.top) / 28),
            top: Number.parseFloat(row.style.top),
            match: row.classList.contains("gg-search-match"),
          }))
          .sort((a, b) => a.index - b.index)
        return {
          scrollTop: scroller.scrollTop,
          maxScroll: scroller.scrollHeight - scroller.clientHeight,
          scrollHeight: scroller.scrollHeight,
          clientHeight: scroller.clientHeight,
          rendered: rows.length,
          first: rows[0],
          last: rows.at(-1),
          blankBottom: scroller.scrollHeight - (rows.at(-1).top + 28),
        }
      })
      metrics.bottomSearch = { before: bottomBefore, after: bottomAfter, short: lastShort }
      check(
        "searching the last commit while already at the bottom clamps scrollTop",
        Math.abs(bottomAfter.scrollTop - bottomAfter.maxScroll) <= 1 &&
          bottomAfter.scrollTop <= bottomAfter.maxScroll + 0.5,
        bottomAfter,
      )
      check(
        "last-row search jump leaves no virtual blank at the bottom",
        bottomAfter.last?.index === 199 &&
          bottomAfter.last.match &&
          bottomAfter.blankBottom <= 1 &&
          bottomAfter.rendered > 0,
        bottomAfter,
      )
      await page.locator("button.gg-search-clear").click()
      await page.waitForFunction(
        () => (document.querySelector('[data-testid="search-commits"]')?.value ?? "") === "",
        null,
        { timeout: 10_000 },
      )
      await waitFooterContains(page, "200 loaded+")
      const bottomRestored = await page.evaluate(() => {
        const scroller = document.querySelector('[data-testid="history-scroll"]')
        const rows = [...document.querySelectorAll(".gg-graph-row")]
          .map((row) => ({
            index: Math.round(Number.parseFloat(row.style.top) / 28),
            top: Number.parseFloat(row.style.top),
          }))
          .sort((a, b) => a.index - b.index)
        const last = rows.at(-1)
        return {
          scrollTop: scroller.scrollTop,
          maxScroll: scroller.scrollHeight - scroller.clientHeight,
          last,
          blankBottom: scroller.scrollHeight - (last.top + 28),
        }
      })
      check(
        "clearing last-row search keeps the bottom row rendered without blank space",
        bottomRestored.last?.index === 199 && bottomRestored.blankBottom <= 1,
        bottomRestored,
      )
    })

    await step("2d. graph column drag resizes the lane viewport", async () => {
      const expanded = await dragGraphColumn(page, 48)
      metrics.graphResize = { expanded }
      check(
        "dragging the graph column resizes its scroll viewport in sync",
        Math.abs(expanded.after.columnWidth - 200) <= 1 &&
          Math.abs(expanded.after.width - 200) <= 1 &&
          Math.abs(expanded.after.clientWidth - 200) <= 1 &&
          expanded.after.scrollLeft <= expanded.after.maxScroll + 0.5 &&
          Math.abs(expanded.after.scrollLeft - expanded.after.maxScroll) <= 0.6 &&
          expanded.after.allRowsSync,
        expanded.after,
      )
      await screenshot(page, "11-sai-520-graph-resized-200.png", {
        locator: page.locator('[data-testid="harness-panel-shell"]'),
      })
      const restored = await dragGraphColumn(page, -48)
      metrics.graphResize.restored = restored
      check(
        "dragging the graph column back restores the 152px viewport",
        Math.abs(restored.after.columnWidth - 152) <= 1 &&
          Math.abs(restored.after.width - 152) <= 1 &&
          Math.abs(restored.after.clientWidth - 152) <= 1 &&
          restored.after.scrollLeft <= restored.after.maxScroll + 0.5 &&
          restored.after.allRowsSync,
        restored.after,
      )
    })

    await step("2e. refresh and rapid repository switches have no stale errors", async () => {
      const before = rpcRequests.filter((request) => request.method === "listRepositories").length
      await page.locator('[data-testid="refresh"]').click()
      await waitNotBusy(page, 30_000)
      await waitFooterContains(page, "100 loaded+", 30_000)
      await waitRows(page, 1)
      const after = rpcRequests.filter((request) => request.method === "listRepositories").length
      const layout = await layoutSnapshot(page)
      metrics.refresh = layout
      check("refresh performs a real listRepositories request", after > before, { before, after })
      check("refresh returns to 100 loaded without errors", layout.errors.length === 0, {
        footer: layout.footer,
        errors: layout.errors,
      })

      await page.evaluate(
        ([qx, sai]) => {
          const select = document.querySelector('[data-testid="repository-select"]')
          for (const value of [qx, sai, qx]) {
            select.value = value
            select.dispatchEvent(new Event("change", { bubbles: true }))
          }
        },
        [qxId, saiId],
      )
      await waitBranch(page, "master", 30_000)
      await waitFooterContains(page, "100 loaded+", 30_000)
      await waitNotBusy(page, 30_000)
      await waitRows(page, 1)
      const afterSwitch = await layoutSnapshot(page)
      metrics.rapidSwitch = afterSwitch
      check("rapid qx -> sai -> qx ends on requested qx-api", afterSwitch.repoValue === qxId, {
        repoValue: afterSwitch.repoValue,
        branch: afterSwitch.branch,
      })
      check("rapid switches leave no stale error banner", afterSwitch.errors.length === 0, {
        errors: afterSwitch.errors,
        footer: afterSwitch.footer,
      })
      check("rapid switches settle on 100 loaded commits", afterSwitch.footer.includes("100 loaded+"), {
        footer: afterSwitch.footer,
      })
    })

    await step("3. qx-api working-tree change opens real diff", async () => {
      await waitNotBusy(page)
      const changes = page.locator('[data-testid="changes"]')
      await changes.waitFor({ state: "visible" })
      await page.waitForFunction(
        () => (document.querySelector('[data-testid="changes"]')?.innerText ?? "").includes("Changes"),
        null,
        { timeout: 20_000 },
      )
      const changeText = (await changes.innerText()).replace(/\s+/g, " ").trim()
      const fileRows = page.locator('[data-testid="changes"] .gg-file-row')
      const fileCount = await fileRows.count()
      check("qx-api Changes shows one working-tree file", fileCount === 1, {
        fileCount,
        text: changeText.slice(0, 200),
      })
      await fileRows.first().click()
      await page.locator('[data-testid="diff"] .gg-diff-line').first().waitFor({
        state: "visible",
        timeout: 20_000,
      })
      await page.waitForFunction(
        () => document.querySelectorAll('[data-testid="diff"] .gg-diff-line').length > 0,
        null,
        { timeout: 20_000 },
      )
      const layout = await layoutSnapshot(page)
      metrics.qxWorkingDiff = layout
      const diff = layout.details.diff
      check("working-tree diff renders unified lines", diff && diff.lines > 0, diff)
      check(
        "working-tree diff contains hunk/add/remove evidence",
        diff && diff.hunk > 0 && diff.remove > 0 && diff.add > 0,
        diff,
      )
      check("working-tree diff header identifies the changed file", Boolean(diff?.header), {
        header: diff?.header ?? null,
      })
      check("diff pane is read-only (no action buttons)", diff?.buttons === 0, {
        buttons: diff?.buttons ?? null,
      })
      await screenshot(page, "04-qx-520-working-tree-diff.png", {
        locator: page.locator('[data-testid="harness-panel-shell"]'),
      })
      await page.locator('[data-testid="close-details"]').click()
      await page.locator('[data-testid="commit-details"]').waitFor({ state: "hidden" })
      check("closing working-tree diff hides details", true, {})
    })

    await step("4. merge commit details, file diff and parent switch", async () => {
      await page.locator(".gg-graph-row").first().click()
      await page.locator('[data-testid="commit-details"]').waitFor({ state: "visible" })
      await page.waitForFunction(
        () =>
          document.querySelectorAll('[data-testid="commit-details"] .gg-file-row').length > 0,
        null,
        { timeout: 20_000 },
      )
      const parentSelect = page.locator(
        '[data-testid="commit-details"] select[aria-label="Diff parent"]',
      )
      await parentSelect.waitFor({ state: "visible", timeout: 20_000 })
      const parentOptions = await parentSelect.locator("option").count()
      check("merge commit exposes a parent selector", parentOptions >= 2, { parentOptions })

      const firstFiles = page.locator('[data-testid="commit-details"] .gg-file-row')
      const filesParent0 = await firstFiles.count()
      await firstFiles.first().click()
      await page.locator('[data-testid="diff"] .gg-diff-line').first().waitFor({
        state: "visible",
        timeout: 20_000,
      })
      const parent0 = await layoutSnapshot(page)
      metrics.mergeParent0 = parent0
      const diff0 = parent0.details.diff
      check("merge commit file shows a real unified diff", diff0 && diff0.lines > 0, diff0)
      check(
        "merge commit diff has add/remove/hunk lines",
        diff0 && diff0.hunk > 0 && diff0.add > 0 && diff0.remove > 0,
        diff0,
      )
      await screenshot(page, "05-qx-520-merge-commit-diff.png", {
        locator: page.locator('[data-testid="harness-panel-shell"]'),
      })

      await parentSelect.selectOption("1")
      await page.waitForFunction(
        () => {
          const select = document.querySelector(
            '[data-testid="commit-details"] select[aria-label="Diff parent"]',
          )
          const files = [...document.querySelectorAll('[data-testid="commit-details"] .gg-file-row')]
          const placeholder = document.querySelector('[data-testid="diff"] .gg-diff-placeholder')
          const empty = document.querySelector('[data-testid="commit-details"] .gg-empty')
          return (
            select?.value === "1" &&
            !document.querySelector('[data-testid="commit-details"] .gg-status') &&
            (files.length === 0 || placeholder !== null || empty !== null)
          )
        },
        null,
        { timeout: 20_000 },
      )
      const parent1 = await layoutSnapshot(page)
      metrics.mergeParent1 = parent1
      check("parent switch loads a different file set", parent1.details.filesCount !== filesParent0, {
        parent0Files: filesParent0,
        parent1Files: parent1.details.filesCount,
      })
      const parentRequests = rpcRequests.filter(
        (request) => request.method === "getCommitFiles" && request.parentIndex === 1,
      )
      check("parent switch issues a getCommitFiles request with parentIndex 1", parentRequests.length > 0, {
        requests: parentRequests.length,
      })
      await screenshot(page, "06-qx-520-merge-parent-1.png", {
        locator: page.locator('[data-testid="harness-panel-shell"]'),
      })

      await parentSelect.selectOption("0")
      await page.waitForFunction(
        () => document.querySelectorAll('[data-testid="commit-details"] .gg-file-row').length > 0,
        null,
        { timeout: 20_000 },
      )
      const back = await layoutSnapshot(page)
      metrics.mergeParent0Restored = back
      check("switching back to parent 0 restores files", back.details.filesCount === filesParent0, {
        parent0Files: filesParent0,
        restored: back.details.filesCount,
      })
      await page.locator('[data-testid="close-details"]').click()
      await page.locator('[data-testid="commit-details"]').waitFor({ state: "hidden" })
      check("closing commit details works", true, {})
    })

    await step("5. 1100px responsive layout", async () => {
      await page.locator('[data-testid="harness-width-1100"]').click()
      await page.waitForFunction(
        () =>
          document.querySelector('[data-testid="harness-panel-shell"]')?.dataset.panelWidth ===
            "1100" &&
          Math.abs(
            document.querySelector(".git-graph-panel").getBoundingClientRect().width - 1100,
          ) <= 1,
        null,
        { timeout: 15_000 },
      )
      await page.locator('[data-testid="repository-select"]').selectOption(saiId)
      await waitBranch(page, "fixbug_zijinguoji_penetration_testing")
      await waitFooterContains(page, "100 loaded+")
      await waitRows(page, 1)
      await waitNotBusy(page)
      const layout = await layoutSnapshot(page)
      metrics.sai1100 = layout
      metrics.sai1100Spacing = await graphSpacing(page)
      check("1100px panel is actually 1100px wide", Math.abs(layout.panel.width - 1100) <= 1, {
        panel: layout.panel.width,
        shell: layout.shell,
      })
      check(
        "1100px header shows Date and Author in one line",
        layout.header.texts.join("|") === "Graph|Description|Date|Author|Commit" &&
          layout.header.rect.height <= 30 &&
          layout.grids.match,
        {
          columns: layout.header.texts,
          headerHeight: layout.header.rect.height,
          grids: layout.grids,
        },
      )
      check(
        "1100px Date/Author cells have responsive widths",
        layout.date.visible &&
          layout.author.visible &&
          layout.date.width > 0 &&
          layout.author.width > 0,
        { date: layout.date, author: layout.author },
      )
      check("1100px rows stay 28px single-line", layout.rows.rowHeight === 28, {
        rowHeight: layout.rows.rowHeight,
        rendered: layout.rows.rendered,
      })
      check("1100px toolbar is compact and single-line", layout.toolbar.singleLine && layout.toolbar.overflowX <= 1, layout.toolbar)
      check("1100px clean changes section is <=60px", layout.changes.rect.height <= 60, {
        height: layout.changes.rect.height,
        text: layout.changes.text,
      })
      check(
        "1100px history fills the available panel height",
        layout.history.rect.height > layout.panel.height * 0.8 &&
          layout.historyScroll.clientHeight > 500,
        {
          panel: layout.panel.height,
          history: layout.history.rect.height,
          historyScroll: layout.historyScroll.clientHeight,
        },
      )
      check(
        "1100px has no unintended body/panel horizontal overflow",
        layout.doc.scrollWidth <= layout.viewport.width &&
          layout.body.scrollWidth <= layout.viewport.width &&
          layout.panelOverflow.x <= 1 &&
          layout.stage.overflowX <= 1,
        {
          viewport: layout.viewport,
          doc: layout.doc,
          body: layout.body,
          panelOverflow: layout.panelOverflow,
          stage: layout.stage,
        },
      )
      const hitRepo = await hitTest(page, '[data-testid="repository-select"]')
      const hitRefresh = await hitTest(page, '[data-testid="refresh"]')
      const hitLoadMore = await hitTest(page, '[data-testid="load-more"]')
      metrics.hitTests = { repo: hitRepo, refresh: hitRefresh, loadMore: hitLoadMore }
      check(
        "1100px toolbar controls are clickable and unobscured",
        hitRepo.contains && hitRepo.inViewport && hitRefresh.contains && hitRefresh.inViewport,
        { repo: hitRepo, refresh: hitRefresh },
      )
      check("1100px Load more is clickable and unobscured", hitLoadMore.contains && hitLoadMore.inViewport, hitLoadMore)
      await screenshot(page, "07-sai-1100.png", { fullPage: true })
      await screenshot(page, "08-sai-1100-panel.png", {
        locator: page.locator('[data-testid="harness-panel-shell"]'),
      })
    })

    await step("6. qx-api diff at 1100px (columns layout)", async () => {
      await page.locator('[data-testid="repository-select"]').selectOption(qxId)
      await waitBranch(page, "master")
      await waitFooterContains(page, "100 loaded+")
      await waitRows(page, 1)
      await waitNotBusy(page)
      await page.locator('[data-testid="changes"] .gg-file-row').first().click()
      await page.locator('[data-testid="diff"] .gg-diff-line').first().waitFor({
        state: "visible",
        timeout: 20_000,
      })
      const layout = await layoutSnapshot(page)
      metrics.qx1100Diff = layout
      check(
        "1100px details use files | diff columns",
        layout.details.layout?.includes("gg-layout-columns") ?? false,
        { layout: layout.details.layout },
      )
      check(
        "1100px diff pane remains readable beside the file tree",
        layout.details.diff &&
          layout.details.diff.lines > 0 &&
          layout.details.diff.rect.width > 400,
        {
          lines: layout.details.diff?.lines,
          diffWidth: layout.details.diff?.rect.width,
          filesWidth: layout.details.filesCount,
        },
      )
      await screenshot(page, "09-qx-1100-working-tree-diff.png", {
        locator: page.locator('[data-testid="harness-panel-shell"]'),
      })
      await page.locator('[data-testid="close-details"]').click()
      await page.locator('[data-testid="commit-details"]').waitFor({ state: "hidden" })
    })
  } catch (error) {
    fatal = error instanceof Error ? error.message : String(error)
    note(`Fatal: ${fatal}`)
    try {
      await page.screenshot({ path: join(ARTIFACTS, "99-fatal.png"), animations: "disabled" })
      screenshots.push(join(ARTIFACTS, "99-fatal.png"))
    } catch {
      /* ignore screenshot failure */
    }
  } finally {
    try {
      metrics.finalLayout = await layoutSnapshot(page)
    } catch {
      metrics.finalLayout = null
    }
    await context.close().catch(() => {})
    await browser.close().catch(() => {})
  }

  const benignConsole = consoleErrors.filter(
    (entry) =>
      entry.location?.url?.endsWith("/favicon.ico") ||
      /Failed to load resource.*404/.test(entry.text),
  )
  const realConsole = consoleErrors.filter((entry) => !benignConsole.includes(entry))
  const realHttp = httpErrors.filter((entry) => !entry.url.endsWith("/favicon.ico"))
  const expectedAborts = abortedRequests.filter((entry) => entry.url.includes("/__gg/rpc/"))

  check("no page errors", pageErrors.length === 0, { count: pageErrors.length, pageErrors })
  check("no unexpected console errors (favicon 404 excluded)", realConsole.length === 0, {
    consoleErrors: realConsole,
    benignConsole,
  })
  check("no failed non-aborted requests", requestFailures.length === 0, {
    requestFailures,
  })
  check("no unexpected HTTP >=400 responses", realHttp.length === 0, {
    httpErrors: realHttp,
  })
  const refsRequests = rpcRequests.filter((request) => request.method === "getRefs")
  metrics.rpcMethodCounts = rpcRequests.reduce((counts, request) => {
    counts[request.method] = (counts[request.method] ?? 0) + 1
    return counts
  }, {})
  check("no unused getRefs RPC requests", refsRequests.length === 0, {
    count: refsRequests.length,
    requests: refsRequests,
    methods: metrics.rpcMethodCounts,
  })

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
    consoleErrors: {
      all: consoleErrors,
      benign: benignConsole,
      unexpected: realConsole,
    },
    pageErrors,
    requestFailures,
    httpErrors: { all: httpErrors, unexpected: realHttp },
    expectedAborts,
    abortedRequests,
    rpcRequests,
    hmrEvents,
    notes,
    desktopNotCovered: [
      "Desktop window/panel chrome, tab strip, drag/resize and side-region rules",
      "MenuItem registration for session.panel",
      "OpenCode session switching, project/sidebar data, host theme injection, host event bus",
    ],
  }

  const resultPath = join(ARTIFACTS, "result.json")
  writeFileSync(resultPath, JSON.stringify(result, null, 2), "utf8")
  screenshots.push(resultPath)
  console.log(JSON.stringify({ verdict: result.verdict, failed, screenshots, resultPath }, null, 2))
}

await main()
