# Release UI acceptance (real browser)

**Verdict: PASS — 131/131 checks passed, 0 failed.**

The frozen release UI was tested against two real environments:

- **FR**: read-only fixture, 16 repositories / 4 worktrees.
- **TEMP**: isolated synthetic mutation/content fixture.
- Real production components and the real repository manager/RPC path; normal
  repository data was not mocked.
- Fresh real-browser loads, real pointer and keyboard input.

This public summary is anonymized. Private repository names, absolute paths,
commit hashes, source paths and private file/diff content are not included.
Complete machine evidence and screenshots remain only in the operator TEMP
`gg-ui-release-frozen-final-20261110-1504` directory.

## Final result

| Area | Result | Evidence |
| --- | --- | --- |
| Prior 93-check core regression | PASS | Repository discovery, history, filters, menus, comparison/Back, loading gate, FR guard, TEMP writes, binary diff, warning/afterServer paths. |
| Graph fixed lane spacing | PASS | Narrow and wide drags keep lane centres at 15/29/43… with a fixed 14 px step; content width is `lanes * 14 + 16`. |
| Graph clipping semantics | PASS | At 120 px the 170 px lane field is clipped by `overflow-x: hidden`; no graph-scroll/legacy hscroll, no visible scrollbar, horizontal wheel and scroller stay at scrollLeft 0, dense hint is shown. |
| Graph wide reveal | PASS | Dragging to 320 px exposes every lane; dense hint disappears; reload persistence and 520 px budget pass. |
| Header dividers / Title Case | PASS | Always-visible vertical separators; Graph/Description/Date/Author/Commit labels. |
| Inline three-column layout | PASS | Info column, list/tree switching, row remains expanded, selection unchanged. |
| Stat badges | PASS | Real `+N/-M` values from `getCommitFiles`; binary rows show `-`/empty placeholder; gitlink rows show `-` with no fabricated counts. |
| File content panel | PASS | Real `getCommitFileContent`: text, binary, symlink, >20 MiB size-only, 2 MiB truncated, gitlink/missing; close preserves the inline slot and selection. |
| Deleted file eye | PASS | Deleted row eye action is disabled. |
| Open current file | PASS (dev harness) | No host: readable copy-path fallback; recorded `hostApi:false`, real Desktop remains manual. |
| Console / network | PASS | 0 page errors, 0 unexpected console errors, 0 non-abort request failures, 0 unexpected HTTP >= 400; only benign favicon 404s. |
| Source / HMR | PASS | Production source mtimes identical before/after; no HMR or reload events. |
| TEMP cleanup | PASS | Returned to `main` with a clean worktree and no test branches/tags. |
| FR read-only | PASS | HEAD and refs unchanged; no valid confirmed mutation was sent. |

## Graph metric clarification

`overflow: hidden` clipping is expected. The acceptance does **not** treat the
clip container's `scrollWidth > clientWidth` as a failure. It verifies:

- no graph scroll element or legacy horizontal scrollbar;
- the graph cell and history scroller use `overflow-x: hidden`/`clip`;
- horizontal wheel leaves `scrollLeft` at 0 and history/document `scrollLeft`
  cannot be changed;
- no scrollable ancestor with `auto`/`scroll` overflow;
- lane centres remain fixed at 14 px spacing;
- the right lane field extends beyond the column, proving clipping;
- a wider 320 px column exposes every lane.

## Screenshots (basenames; private TEMP only)

- `01-fr-graph-date-1100.png`
- `02-fr-columns-after-drag.png`
- `03-fr-520.png`
- `04-fr-branch-filter.png`
- `05-fr-ref-menu.png`
- `06-fr-compare.png`
- `07-temp-checkout-dialog.png`
- `08-temp-checkout-success.png`
- `09-temp-branch-success.png`
- `10-temp-error-paths.png`
- `11-fr-refs-failure.png`
- `12-fr-loading-gate.png`
- `13-fr-compare-scroll.png`
- `14-temp-binary-diff.png`
- `14b-temp-binary-content.png`
- `15-temp-warning-fault.png`
- `16-temp-mutation-switch.png`
- `17-fr-graph-drag.png`
- `18-fr-inline-three.png`
- `19-fr-file-actions.png`
- `20-temp-content-fixture.png`

## Historical baseline

The prior 93/93 PASS remains the historical baseline. This run revalidated that
core subset and added the 0.2.0 graph, header, inline three-column and file
content scenarios.

## Not covered / manual

- Real Desktop session/scope switching, window/panel chrome, `MenuItem`
  registration, host theme/event bus and real Desktop panel resizing.
- Real `ctx.layout.open file` / `desktop.launch` host success; the dev harness
  only proved the readable copy-path fallback and records `hostApi:false`.
- Network push/fetch/reset-clean and other unavailable remote operations.
