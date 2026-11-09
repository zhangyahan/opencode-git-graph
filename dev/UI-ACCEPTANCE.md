# Git Graph UI acceptance (real browser)

**Verdict: PASS — 84/84 interaction checks passed, 0 failed.**

This is the final integrated-interactions acceptance run. It drives the real
production `GitGraphPanel` and the real read-only `RepositoryManager` bridge in
headless Chrome against the dev harness, with real FR data. Normal repository
data is not mocked.

Fixture aliases only: **Repository A**, **Repository B**, **Root Repository**.
No commit hashes, commit subjects, repository file paths, diff text or tokens
are included here. Screenshots and the machine result stay in TEMP.

- Run: 2026-11-10 00:06:25–00:06:36 local (UTC+8)
- Browser: locally installed Google Chrome, headless, isolated Playwright
  profile; the user browser/profile/cookies were not used.
- Harness: `http://127.0.0.1:5178/`, real `GitGraphPanel` +
  `RepositoryManager`, real read-only fixture repository.
- Viewports: 1280 × 900; panel widths 520 px and 1100 px.
- Script: `dev/ui-test/interactions.mjs`
- Final machine result (TEMP only, not committed):
  `%LOCALAPPDATA%\Temp\opencode\gg-ui-interactions-final2\result.json`
- First-failure evidence retained (TEMP only):
  `%LOCALAPPDATA%\Temp\opencode\gg-ui-interactions-run1-fail\result.json` and
  `%LOCALAPPDATA%\Temp\opencode\gg-ui-interactions-run2-fail\result.json`

## Historical baseline

The earlier **79/79 PASS** result covered the graph-scroll viewport fix
(`%LOCALAPPDATA%\Temp\opencode\gg-ui-artifacts-final\result.json`).

That script asserted fixed 28 px rows and manual pagination. The integrated UI
now uses `data-index`/`data-row-top`, a variable-height inline slot and automatic
pagination, so the old 79 checks are **historical baseline only**, not the
regression truth for these interactions.

## Results

| Area | Result | Evidence |
| --- | --- | --- |
| 100 → 200 → 300 automatic pagination | PASS | No manual Load more clicks. `getLog skip=100` once, `skip=200` once, no prefetch of the next page. `scrollTop` stayed 2097 after page 2 and 4993 after page 3; content heights 5600 / 8496, viewport 703. |
| Inline slot | PASS | Slot immediately below the clicked merge row; spacer `data-slot-height=162`; following row tops shifted by exactly 162; 30 rendered rows (bounded); 6 real inline file rows. |
| Inline graph + pan | PASS | Graph pan 74 px; all rendered row transforms and the inline continuation are `-74px`; inline graph width equals the 152 px effective graph column. |
| Full-page commit diff | PASS | Clicking an inline file hides the history table and opens the full-page diff. Real HTTP body target matched the clicked commit with `parentIndex:0`; path equality was exact. Unified patch rendered. |
| Merge parent switch | PASS | Two parents offered; switching to parent 2 issued `getDiff` with `parentIndex:1` and the matching commit; parent→commit header updated correctly. |
| Back to history | PASS | Strict **≤ 1 px** threshold: `scrollTop 112 → 112`, graph `scrollLeft 74 → 74`; expanded index 4, slot visible, inline files 175 after async load. |
| Same-row collapse / row switch | PASS | Same row collapsed the slot. Switching rows replaced it with the new row and aborted the previous `getCommitFiles` (1 expected abort), with no stale error. |
| Slot + auto page | PASS | With the slot open, scrolling to bottom auto-loaded page 3; expansion and slot height preserved; scroll position not reset; `skip=200` once, no `skip=300`. |
| Search jump | PASS | Last-row search at the bottom used real `data-row-top` and clamped correctly: `scrollTop=7793` (expected 7793), `blankBottom=0`, 32 rendered rows. |
| Root commit | PASS | Root fixture reported `hasMore=false` and made no extra page request; root diff header **“Empty tree”**, target matched root commit with `parentIndex:0`, path equality held, 19 real lines rendered. |
| 1100 px initial layout | PASS | Five columns, all five handles; header/row grid identical; panel overflow 0; body/document horizontal overflow 0. |
| Five-column pointer drag | PASS | Actual pointer drags: graph 152→136 (narrowed to create a pan range), description 676→692, date 80→96, author 118→134, commit 74→90. Header and row widths stayed aligned; panel overflow stayed 0. Graph pan remained synchronized after resize. |
| Persistence / 520 px | PASS | All five widths survived reload at 1100 px. At 520 px Date/Author are hidden; body/document and panel overflow are 0 even with the saved wide preferences. |
| Fault injection: `getLog` 502 | PASS | Injected 502 showed Retry; no automatic retry at the bottom; manual retry recovered to 200 loaded. Fault evidence is isolated from the normal run. |
| Fault injection: duplicate page | PASS | Injected duplicate real commit did not append; footer stayed 100 loaded with manual Load more; no error; no automatic retry while still at the bottom. |
| RO-disabled live metrics | PASS | With ResizeObserver callbacks suppressed, auto pagination still used the live scroller: viewport 703 px, `scrollTop` 2097, footer 200 loaded, no error. |
| Console/network | PASS | Normal page: 0 page errors, 0 unexpected console errors, 0 non-abort request failures, 0 unexpected HTTP ≥400. Only benign favicon 404 and one expected `getCommitFiles` abort. Injected 502 is isolated. |
| Source/HMR stability | PASS | Source mtimes were identical before/after the run (`panel.tsx`, `styles.ts`, `pagination.ts`). HMR logs only `[vite] connecting/connected`; no hot update or reload. |

## Unit tests / typecheck / build

Independent of this browser run, the repository passes **233/233** unit tests
(`npm test`), `npm run typecheck` and `npm run build`. Those results are the
regression gate for the logic; this report is the browser acceptance gate.

## Screenshots (TEMP only, not committed)

All under `%LOCALAPPDATA%\Temp\opencode\gg-ui-interactions-final2\`:

1. `02-inline-slot-520.png` — inline commit file slot at 520 px.
2. `03-fullpage-commit-diff-520.png` — full-page commit diff at 520 px.
3. `04-fullpage-commit-diff-parent2-520.png` — merge parent 2 diff.
4. `06-search-jump-520.png` — last-row search at the bottom, no virtual blank.
5. `07-root-empty-tree-520.png` — root commit “Empty tree” diff.
6. `08-all-column-widths-1100.png` — all five columns after real pointer
   resizing at 1100 px.
7. `09-520-after-wide.png` — wide preferences preserved; Date/Author hidden and
   no overflow at 520 px.
8. `10-fault-auto-load-520.png` — isolated 502 + Retry.
9. `11-duplicate-page-stall-520.png` — duplicate-page stall.
10. `12-ro-disabled-auto-200-520.png` — RO-disabled auto pagination 100→200.
11. `result.json` — full private machine result.

Screenshots/result are not copied into the repository or the fixture roots.

## Not covered by this harness (Desktop-only)

- Desktop window/panel chrome, tab strip, drag/resize and side-region rules.
- `MenuItem` registration for `session.panel`.
- OpenCode session switching, project/sidebar data, host theme injection and
  the host event bus.
- Real Desktop 520 px panel registration and user pointer drag/resize.

No files were written under the fixture roots. This report intentionally
contains no private commit hashes, subjects, repository file paths, full diff
text or tokens.
