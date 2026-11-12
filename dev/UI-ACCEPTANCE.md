# Release UI acceptance (real browser)

**Verdict: PASS — 220/220 checks passed, 0 failed.**

The frozen release UI was tested against two real environments:

- **FR**: read-only fixture. This environment currently exposes **12 normal
  repositories / 0 worktrees**. The picker contract is environment-independent:
  at least one repository must exist, every dropdown repository must load and
  switch, and worktree labels are verified only when worktrees are present
  (`notPresent` is recorded for zero worktrees).
- **TEMP**: isolated synthetic mutation/content fixture, including real local
  commits, checkout, fetch and mutation writes.
- Real production components and the real repository manager/RPC/SSE path;
  normal repository data was not mocked.
- Fresh real-browser loads, real pointer and keyboard input.

This run keeps the historical **188-check baseline** as the regression floor and
adds **32 frozen-extension checks**. Total observed checks: 220; all passed. The
FR repository count is read dynamically, so the historical 16/4 fixture is no
longer a hard-coded precondition.

This public summary is anonymized. Private repository names, absolute paths,
commit hashes, source paths and private file/diff content are not included.
Complete machine evidence and screenshots remain only in the operator TEMP
`gg-ui-release-final-20261112-104617` directory.

## Final result

| Area | Result | Evidence |
| --- | --- | --- |
| Historical core regression | PASS | All 188 baseline checks passed. |
| Repository picker / FR fixture | PASS | Actual FR fixture: 12 repositories / 0 worktrees. Every one of the 12 dropdown options was selected and loaded successfully (commits/status present, no UI error); 0 worktrees is recorded as `notPresent`, so no worktree-label requirement is fabricated. The contract requires at least one repository and is independent of the old 16/4 shape. |
| Watcher auto-refresh | PASS | A real external commit appeared without Refresh; an external checkout updated `current-branch`; an external local fetch advanced the remote badge on the fetched commit. Each event produced exactly 1 `getLog` request (maximum per event 1), so there was no refresh storm. |
| Cache remount | PASS | `harness-remount-panel` rebuilt the panel; cached history painted in 26 ms with no loading skeleton, `getLog=0` on unchanged HEAD/refs (only `getStatus`/`getRefs`), scrollTop 0 and the same expanded hash/slot returned, refs stayed unchanged, and later row interaction worked. A post-external-commit remount showed the new commit with 2 bounded `getLog` calls and preserved the top reading position. |
| Dynamic multi-ref rows | PASS | A commit with 7 refs rendered every name in the DOM with no `+N`/`ref-more`, no ellipsis, no refs-group horizontal scroll and no clipping. Row height was 49 px at 1100 px and 89 px at 520 px, prefix sums stayed contiguous, and search, slot placement/drag, file-diff Back and both width reflows stayed correct. |
| Graph crop / dense hint | PASS | `dense-graph` is absent at 1100 px, at a 120 px graph column, at 520 px and on merge rows. Lane centres keep the fixed 14 px step; no graph scroll element, legacy scrollbar, wheel scroll or scrollable ancestor; a narrow column either fits exactly or clips with `overflow-x: hidden`. |
| Header column dividers | PASS | `resize-column-*` is a 5 px transparent hit strip ending on the always-visible divider (`boundaryDelta 2.5`), cursor `col-resize`, no pseudo-element grip or background ornament. Real pointer drags change widths; header and history-row widths stay in sync; widths persist across reload; 520 px has no horizontal overflow. |
| Date format | PASS | Date cell renders exactly 16 characters as `YYYY-MM-DD HH:mm` with no seconds, fits without clipping, and keeps the original ISO value in `title`. The inline Date row also uses the 16-character value with the ISO tooltip on its row. |
| Full branch/ref labels | PASS | The top `current-branch` label and every rendered `ref-badge` name are complete with no `text-overflow: ellipsis`, no `+N` hiding and no refs-group horizontal scroll. At 520 px the labels remain fully visible with zero document/body/panel horizontal overflow. A synthetic 66-character TEMP branch was checked out, shown fully in both places, then cleaned up and returned to the original branch. |
| Inline three columns | PASS | `inline-split` is a 5 px separator with ARIA 25–60. At 1100 px the info pane is 344 px of an 860 px body (~40%), the file pane is narrower, and a long subject wraps to 3 lines with no ellipsis or clipping. Pointer drag changes the ratio without overflow. Home/End report 25/60; the effective maximum width is additionally constrained by the file-pane minimum. The remembered 60 ratio survives collapse/reopen. |
| Slot bottom divider | PASS | `slot-resize-handle` is the full-width 5 px bottom strip (520/520 px), no small pill/grip pseudo-element. Drag clamps to 96 px, grows to the dynamic 560 px maximum at this viewport, survives collapse/reopen, and keeps bottom-follow pinned (`distanceToBottom 0`). |
| Fetch | PASS | FR direct confirmed fetch still returns HTTP 403. TEMP real local bare fetch returns `refsUpdated: 1`, `changed: true`, unchanged HEAD and refreshed remote-tracking refs. Injected failure exposes only the bounded reason. |
| Uncommitted row | PASS | Counts badge matches real status counts; expanding shows Staged / Unstaged / Untracked / Conflicted with real file rows; staged opens the `index` diff and unstaged opens the `working-tree` diff; legacy standalone Changes surface is absent. |
| Uncommitted slot resize | PASS | The expanded `uncommitted-slot` exposes the same full-width 5 px bottom handle with no small grip. Real pointer drag changed its height away from the bottom without moving scrollTop/row top, clamped to 96 px and the dynamic 152 px maximum at the short test viewport, kept bottom-follow at the scroller bottom, and preserved the height after collapse/reopen. The FR clean slot was present and resized 96→128 px. |
| File actions / list-tree | PASS | Real read-only content panels for text/binary/symlink/missing/truncated/size-only targets; deleted-file eye disabled; view action does not toggle or change selection; list/tree toggles do not collapse the row. |
| Comparison | PASS | Plain + Ctrl/Cmd click opens real comparison files/diff from a scrolled inline state; Back restores scroll within 1 px, preserves the expanded slot and leaves no blank viewport gap. |
| Write confirmation | PASS | Checkout cancel sends no mutation; confirmed checkout switches and returns; create/rename/delete branch and light/annotated tag create/delete update real TEMP refs; stale/unknown/dirty guards reject without changing HEAD. |
| Console / network | PASS | 0 page errors, 0 unexpected console errors (only benign favicon 404s), 0 non-abort request failures, 0 unexpected HTTP >= 400. |
| Source / HMR | PASS | Production source mtimes identical before/after; no HMR or reload events. |
| TEMP cleanup | PASS | Returned to `main` with a clean worktree; no test branches/tags/remotes or file-protocol override remained. |
| FR read-only | PASS | HEAD and refs unchanged; no valid confirmed mutation reached the FR bridge. |

## Frozen-extension checks (32/32 PASS)

1. Graph never renders the dense hint (initial, narrow, 520 px, merge row).
2. Graph divider is the 5 px header hit strip with no separate ornament.
3. Graph header/row widths stay in sync after resize.
4. Non-graph dividers are 5 px header hit strips with no separate ornament.
5. Header/row widths stay in sync after non-graph drags.
6. Column widths persist across reload and stay synced.
7. 520 px graph budget has no overflow and no dense hint.
8. Date is 16 characters with the ISO tooltip.
9. Current branch and visible ref badges are fully visible at 1100 px.
10. Current branch and ref badges remain fully visible at 520 px with no page overflow.
11. A 66-character TEMP branch name is fully visible in the current-branch label and ref badge.
12. Inline left/middle separator exists and the slot has no horizontal overflow.
13. Inline info pane is wider and the file pane narrower.
14. Inline info text wraps with no ellipsis/clipping and shows multiple lines.
15. Inline divider drag changes the ratio; Home/End clamp at 25/60; ratio survives collapse/reopen.
16. Slot bottom divider is the full line with no small widget; min/max/persistence/bottom-follow pass.
17. External commit appears in the panel without pressing Refresh.
18. External checkout updates the current branch.
19. External local fetch advances the remote badge on the fetched commit.
20. External events stay within 1–3 `getLog` requests each (measured 1/1/1).
21. Cache remount paints history without a loading skeleton (26 ms).
22. Cache remount restores scrollTop and the same expanded hash/slot.
23. Unchanged HEAD/refs remount performs zero `getLog` requests.
24. Cache remount keeps refs unchanged and subsequent interaction usable.
25. External commit + remount shows the new commit with a bounded refresh and preserved position.
26. A 7-ref commit renders every name with no `+N`, ellipsis or horizontal refs scroll.
27. Dynamic ref rows grow to 49 px (1100) / 89 px (520) with contiguous prefix sums.
28. Search, slot placement/drag and file-diff Back remain correct on the tall row.
29. 520/1100 reflow keeps all refs visible with no page overflow.
30. Uncommitted slot exposes the full-line bottom resize handle.
31. Uncommitted slot pointer drag/96 px min/dynamic max/bottom-follow/session persistence pass.
32. FR clean uncommitted slot handle is present and resizable (or `notPresent` when empty).

## Graph metric clarification

`overflow: hidden` clipping is expected. The acceptance does **not** treat the
clip container's `scrollWidth > clientWidth` as a failure. It verifies:

- no graph scroll element or legacy horizontal scrollbar;
- the graph cell and history scroller use `overflow-x: hidden`/`clip`;
- horizontal wheel leaves `scrollLeft` at 0 and history/document `scrollLeft`
  cannot be changed;
- no scrollable ancestor with `auto`/`scroll` overflow;
- lane centres remain fixed at 14 px spacing;
- the graph either fits the narrow column exactly or clips it with no hint/scroll;
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
- `17-fr-slot-resize.png`
- `17b-temp-slot-bottom-follow.png`
- `18-fr-inline-three.png`
- `18-fr-uncommitted-clean.png`
- `18b-fr-inline-layout.png`
- `18c-fr-dynamic-ref-row.png`
- `19-fr-file-actions.png`
- `19-temp-uncommitted-index.png`
- `19-temp-uncommitted-working-tree.png`
- `20-temp-content-fixture.png`
- `20-temp-fetch-dialog.png`
- `21-temp-fetch-success.png`
- `22-temp-fetch-failure.png`
- `23-fr-fetch-forbidden.png`

## Test-harness notes

This run used the frozen product sources unchanged. Only the acceptance script
and its README were updated; source mtimes were identical before/after the run.

- The FR picker contract is environment-independent: at least one repository,
  every dropdown option loads/switches, and worktree labels are checked only if
  worktrees exist. On this fixture the dynamic result is 12 repositories /
  0 worktrees, with worktree labels recorded as `notPresent`.
- `showRemotes` dynamically switches to a repository with a remote-only commit
  in the first page; the remote/tag filter loop switches to a repository that
  owns that ref kind when necessary; the clean Uncommitted scenario selects a
  clean repository when the primary is dirty.
- TEMP ensures the branch/tag repository has at least two commits and a real
  file change, creating throwaway TEMP commits when the fixture is smaller.
- The watcher run uses the real SSE `graphChanged` channel; commit/checkout/fetch
  each produced one `getLog`. The cache remount run verified zero `getLog` on an
  unchanged fingerprint and two bounded refreshes after a real external commit.
- Dynamic ref rows are selected from real refs; the 7-ref commit was verified at
  1100 px (49 px row) and 520 px (89 px row) with no `+N` or horizontal scroll.
- The TEMP fixture's README line-ending stat was refreshed (`core.autocrlf
  false`) before the run so the checkout guard saw a clean worktree. This is
  fixture metadata only, not a product change.
- Inline split clamp is asserted through the separator's ARIA 25/60 values and
  effective width, because the file-pane minimum can constrain the rendered
  width below the remembered 60% on content-heavy commits.
- The local bare fetch remote is seeded by pushing the fixture HEAD, because a
  freshly `init --bare` repository has no objects to reference.
- Bottom-follow is measured on the small TEMP fixture in a short viewport so the
  expanded slot is genuinely visible at a stable bottom.
- The inline Back assertion waits for the scheduled frame restore before
  sampling scrollTop.

## Historical baseline

The prior 0.2.1 run remains **131/131 PASS**; the 0.2.2 extended run remains
**172/172 PASS** on its original 16/4 fixture. This run re-executed the **188
baseline checks** with the environment-independent picker contract and passed
all of them on the current 12/0 fixture, plus 32 frozen-extension checks:
**220/220 PASS**. No product threshold was relaxed; only fixture selection became
dynamic.

## Not covered / manual

- Real Desktop session/scope switching, window/panel chrome, `MenuItem`
  registration, host theme/event bus and real Desktop panel resizing.
- Real Desktop tab icon+text rendering. The frozen run performed a source-level
  check (`Git Graph` + branch icon + side registration) marked
  `sourceCheck/desktopManual` and did not count it as a UI pass.
- Real `ctx.layout.open file` / `desktop.launch` host success; the dev harness
  only proved the readable copy-path fallback and records `hostApi:false`.
- Network push/pull/reset-clean, credential prompts, SSH/HTTPS authentication
  and interactive prune confirmation. The fetch acceptance is a local bare
  remote, not a network/authentication test.
