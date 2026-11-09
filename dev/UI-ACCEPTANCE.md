# Git Graph UI acceptance (real browser)

**Verdict: PASS (79 checks, 0 failed).**

The panel was driven in a real headless Chrome against the running dev harness,
with the real production `GitGraphPanel` and the real `RepositoryManager`
bridge. No repository, commit, status or diff data was mocked. Screenshots are
real page captures but are kept only in a local temporary directory and are not
part of this repository.

- Run: 2026-11-09 23:00 local (UTC+8)
- Browser: locally installed Google Chrome, headless, isolated ephemeral
  profile launched by Playwright; the user's browser/profile/cookies were not
  used.
- Viewport: 1280 × 900; harness panel widths 520 px and 1100 px.
- Fixture: a fixed local fixture root with 16 repositories / 4 worktrees. The
  two repositories used below are referred to generically as **Repository A**
  (large history/ref fixture) and **Repository B** (working-tree changes
  fixture).
- Harness and browser automation are dev-only. No production, test,
  `package.json`, lockfile or `tsconfig` change was made by this test run.
- Script: `dev/ui-test/acceptance.mjs`
- Run instructions: `dev/ui-test/README.md`
- Local evidence (intentionally not committed):
  `%LOCALAPPDATA%\Temp\opencode\gg-ui-artifacts-final\result.json`.
  First-round evidence is retained separately under
  `%LOCALAPPDATA%\Temp\opencode\gg-ui-artifacts` and is also not committed.

The broader repository test suite is separate from this browser acceptance:
**168 unit tests** and typecheck pass, and the browser run exercises the real
production component and data path rather than replacing those tests.

## Result summary

| Area | Result | Evidence |
| --- | --- | --- |
| Page load and repository picker | PASS | 16 options; 4 options labelled `(worktree)`; initial repository loads commits. |
| Repository A, 100 → 200 loaded | PASS | Footer `100 loaded+` then `200 loaded+`; history spacer = 100 / 200 rows. |
| Graph lane spacing | PASS | Rendered SVG x positions `15, 29, 43 … 113`; minimum and modal spacing = **14 px** (≥ 8, within 12–14). |
| Graph column / text | PASS | Row graph column stays **152 px**; description starts at 152 px; subject starts at 354 px (< 450 px), so text is not pushed by graph width. |
| Graph scroll viewport (former failure 1) | PASS | At 100 loaded: viewport **152 px**, content 156 px. At 200 loaded: viewport **152 px**, content **226 px**, `scrollWidth > clientWidth`, max scroll **74 px**. Viewport stayed stable while content grew. |
| Graph pan + row transforms (former failure 2) | PASS | Setting `scrollLeft = scrollWidth` produced `scrollLeft = 74 px`; `--gg-graph-shift: -74px`; all **32** rendered `.gg-row-graph-inner` elements had `matrix(1,0,0,1,-74,0)`. The widest row (index **138**, SVG x up to **211 px**) shows its right-side nodes after panning. |
| Graph column drag | PASS | Dragged the resize handle 152 → 200 px: graph-scroll width/clientWidth also **200 px**, content 226 px, max scroll **26 px**, `scrollLeft` clamped to **26 px**, all row transforms `-26 px`. Dragged back to **152 px**; viewport 152 px, all transforms stayed in sync. |
| Virtual scrolling | PASS | At 200 loaded, **32** row DOM nodes, all unique; spacer = 200 rows. Rows **100–125** all rendered at `scrollTop = 2800`, viewport contains exactly the expected 26 rows. |
| Search / restore | PASS | A known short hash → `1 matches`; Enter jumped to the match. Subject search → `4 matches`; both cleared back to `200 loaded+`. |
| Last-row search at bottom | PASS | At the bottom (`scrollTop = 4897`, max 4897), searched the last commit by a known short hash and pressed Enter: scrollTop stayed clamped at **4897**, last row index **199** rendered and matched, `blankBottom = 0`, 32 rendered rows. Clearing search kept the bottom row rendered with no virtual blank. |
| Refresh and rapid switches | PASS | Refresh made a real second `listRepositories` request and returned to `100 loaded+`. Rapid `Repository A → Repository B → Repository A` ended on Repository B with no stale error banner. Four expected RPC `ERR_ABORTED` requests were recorded separately. |
| Repository B Changes + diff | PASS | 1 unstaged file; clicking it opened a modified text file and a real unified diff: 22 lines, 2 add / 2 remove / 2 hunk / 12 context, no action buttons. |
| Merge commit details | PASS | First commit exposed **2** parent options. UI Parent 1 (`parentIndex 0`): 2 files, real diff. UI Parent 2 (`parentIndex 1`): 0 files and the expected empty message/placeholder. Back to UI Parent 1 restored 2 files. |
| 520 px layout | PASS | Toolbar 39 px, single line, zero horizontal overflow; header `Graph / Description / Commit` (Date and Author hidden), header 26 px and single line; rows 28 px; clean Changes section **29.84 px** (≤ 60). History 768.16 px of an 837 px panel; history viewport 703 px. Body/panel/stage horizontal overflow = 0. |
| 1100 px layout | PASS | Panel exactly 1100 px; header `Graph / Description / Date / Author / Commit` in one 26 px line; Date 96 px, Author 118 px; header and row grid both `152px 660px 96px 118px 74px`; rows 28 px; clean Changes 29.84 px; history 768.16 px, viewport 703 px; zero horizontal body/panel/stage overflow. Hit tests on repository picker, refresh and Load more all hit the intended control. |
| 1100 px diff | PASS | Details switch to `gg-layout-columns`; diff pane remains > 400 px wide beside the file tree. |
| Console / network | PASS | 0 page errors; 0 failed non-abort requests; 0 unexpected HTTP ≥ 400. Only benign `favicon.ico` 404. Four RPC aborts are the expected in-flight cancellations from repository switching. |
| Unused `getRefs` request | PASS | Zero `getRefs` RPC calls. RPC counts: `listRepositories 2`, `getStatus 8`, `getLog 9`, `getDiff 3`, `getCommitFiles 3`. |

## Regression evidence for the two former failures

The previous round failed exactly these two checks:

1. `graph lane scroll viewport width is stable between 100 and 200`
2. `graph lane scroll viewport can pan when lanes exceed the column`

They now pass with the measurements above. The final checks explicitly cover:

- stable viewport width: **152 px at 100 and 200 loaded**;
- real pan range: content **226 px** − viewport **152 px** = **74 px**;
- after panning, every rendered row’s transform matches the actual
  `scrollLeft` (`-74 px`);
- the widest row at index **138** has graph content out to **211 px**, and
  after panning its right-side nodes are visible inside the 152 px column;
- after dragging the column to **200 px**, the viewport follows to **200 px**
  and the clamped `scrollLeft`/row transforms update to **26 px**;
- dragging back to **152 px** restores the viewport and keeps every rendered
  row transform in sync.

First-round result was **67 PASS / 2 FAIL**; both failures above are fixed in
the final **79 / 79 PASS** run. The old and new evidence directories are
retained locally outside the repository and are intentionally not committed.

## Screenshots (local only, not committed)

All screenshots are real page captures from the final run and live under
`%LOCALAPPDATA%\Temp\opencode\gg-ui-artifacts-final`. They are not part of the
repository. Coverage:

- initial page load, 16 repositories, 520 px;
- Repository A at 100 loaded and at 200 loaded, 520 px;
- rows 100–125 after scrolling, 520 px;
- the widest graph row panned to the right edge, right-side nodes visible;
- graph column dragged to 200 px, viewport followed;
- Repository B working-tree diff at 520 px;
- merge commit details with a real unified diff, UI Parent 1 and Parent 2;
- Repository A at 1100 px, full page and panel-only;
- Repository B diff in the 1100 px columns layout.

`result.json` (machine-readable checks, metrics, errors and RPC metadata) is
stored beside them as local-only evidence and is also not committed.

## Console and network

- Page errors: none.
- Unexpected console errors: none.
- Benign: one `favicon.ico` 404 (harness has no favicon).
- Failed non-aborted requests: none.
- HTTP ≥ 400 (excluding favicon): none.
- Expected RPC aborts: 4 (`getStatus`/`getLog` cancelled by rapid repository
  switching). These are not counted as errors.
- No non-loopback RPC origin was observed.
- No `getRefs` request was made.

## Source/HMR note

The production UI files were already at their final timestamps before the final
run and did not change during it. The final run recorded only
`[vite] connecting` / `[vite] connected`, with no hot-update or page-reload
event. The source mtimes were stable after the run as well.

## Not covered by this harness (Desktop-only)

- Desktop window/panel chrome, tab strip, drag/resize and side-region rules.
- `MenuItem` registration for `session.panel`.
- OpenCode session switching, project/sidebar data, host theme injection and
  the host event bus.
- Real Desktop 520 px panel registration and user pointer drag/resize.

No files were written under the fixed fixture root, and this document
intentionally contains no full diff text, repository source, short hashes,
changed file names or credentials.
