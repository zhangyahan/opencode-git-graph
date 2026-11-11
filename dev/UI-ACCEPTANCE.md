# Release UI acceptance (real browser)

**Verdict: PASS — 188/188 checks passed, 0 failed.**

The frozen release UI was tested against two real environments:

- **FR**: read-only fixture. This environment currently exposes **12 normal
  repositories / 0 worktrees**. The picker contract is environment-independent:
  at least one repository must exist, every dropdown repository must load and
  switch, and worktree labels are verified only when worktrees are present
  (`notPresent` is recorded for zero worktrees).
- **TEMP**: isolated synthetic mutation/content fixture.
- Real production components and the real repository manager/RPC path; normal
  repository data was not mocked.
- Fresh real-browser loads, real pointer and keyboard input.

This run keeps the historical **172-check baseline** as the regression floor and
adds **16 refinement checks**. Total observed checks: 188; all passed. The FR
repository count is read dynamically, so the historical 16/4 fixture is no
longer a hard-coded precondition.

This public summary is anonymized. Private repository names, absolute paths,
commit hashes, source paths and private file/diff content are not included.
Complete machine evidence and screenshots remain only in the operator TEMP
`gg-ui-release-refined-20261111-201722` directory.

## Final result

| Area | Result | Evidence |
| --- | --- | --- |
| Historical core regression | PASS | All 172 baseline checks passed. |
| Repository picker / FR fixture | PASS | Actual FR fixture: 12 repositories / 0 worktrees. Every one of the 12 dropdown options was selected and loaded successfully (commits/status present, no UI error); 0 worktrees is recorded as `notPresent`, so no worktree-label requirement is fabricated. The contract requires at least one repository and is independent of the old 16/4 shape. |
| Graph crop / dense hint | PASS | `dense-graph` is absent at 1100 px, at a 120 px graph column, at 520 px and on merge rows. Lane centres keep the fixed 14 px step; no graph scroll element, legacy scrollbar, wheel scroll or scrollable ancestor; a narrow column either fits exactly or clips with `overflow-x: hidden`. |
| Header column dividers | PASS | `resize-column-*` is a 5 px transparent hit strip ending on the always-visible divider (`boundaryDelta 2.5`), cursor `col-resize`, no pseudo-element grip or background ornament. Real pointer drags change widths; header and history-row widths stay in sync; widths persist across reload; 520 px has no horizontal overflow. |
| Date format | PASS | Date cell renders exactly 16 characters as `YYYY-MM-DD HH:mm` with no seconds, fits without clipping, and keeps the original ISO value in `title`. The inline Date row also uses the 16-character value with the ISO tooltip on its row. |
| Full branch/ref labels | PASS | The top `current-branch` label and visible `ref-badge` names have no `text-overflow: ellipsis` and fit or wrap fully. `+N` aggregation remains. At 520 px the labels remain fully visible with zero document/body/panel horizontal overflow. A synthetic 66-character TEMP branch was checked out, shown fully in both places, then cleaned up and returned to the original branch. |
| Inline three columns | PASS | `inline-split` is a 5 px separator with ARIA 25–60. At 1100 px the info pane is 344 px of an 860 px body (~40%), the file pane is narrower, and a long subject wraps to 3 lines with no ellipsis or clipping. Pointer drag changes the ratio without overflow. Home/End report 25/60; the effective maximum width is additionally constrained by the file-pane minimum. The remembered 60 ratio survives collapse/reopen. |
| Slot bottom divider | PASS | `slot-resize-handle` is the full-width 5 px bottom strip (520/520 px), no small pill/grip pseudo-element. Drag clamps to 96 px, grows to the dynamic 560 px maximum at this viewport, survives collapse/reopen, and keeps bottom-follow pinned (`distanceToBottom 0`). |
| Fetch | PASS | FR direct confirmed fetch still returns HTTP 403. TEMP real local bare fetch returns `refsUpdated: 1`, `changed: true`, unchanged HEAD and refreshed remote-tracking refs. Injected failure exposes only the bounded reason. |
| Uncommitted row | PASS | Counts badge matches real status counts; expanding shows Staged / Unstaged / Untracked / Conflicted with real file rows; staged opens the `index` diff and unstaged opens the `working-tree` diff; legacy standalone Changes surface is absent. |
| File actions / list-tree | PASS | Real read-only content panels for text/binary/symlink/missing/truncated/size-only targets; deleted-file eye disabled; view action does not toggle or change selection; list/tree toggles do not collapse the row. |
| Comparison | PASS | Plain + Ctrl/Cmd click opens real comparison files/diff from a scrolled inline state; Back restores scroll within 1 px, preserves the expanded slot and leaves no blank viewport gap. |
| Write confirmation | PASS | Checkout cancel sends no mutation; confirmed checkout switches and returns; create/rename/delete branch and light/annotated tag create/delete update real TEMP refs; stale/unknown/dirty guards reject without changing HEAD. |
| Console / network | PASS | 0 page errors, 0 unexpected console errors (only benign favicon 404s), 0 non-abort request failures, 0 unexpected HTTP >= 400. |
| Source / HMR | PASS | Production source mtimes identical before/after; no HMR or reload events. |
| TEMP cleanup | PASS | Returned to `main` with a clean worktree; no test branches/tags/remotes or file-protocol override remained. |
| FR read-only | PASS | HEAD and refs unchanged; no valid confirmed mutation reached the FR bridge. |

## New refinement checks (16/16 PASS)

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
**172/172 PASS** on its original 16/4 fixture. This run re-executed all 172
baseline checks with the environment-independent picker contract and passed all
of them on the current 12/0 fixture, plus 16 refinement checks: **188/188 PASS**.
No product threshold was relaxed; the fixture-shaped precondition became a
dynamic contract instead.

## Not covered / manual

- Real Desktop session/scope switching, window/panel chrome, `MenuItem`
  registration, host theme/event bus and real Desktop panel resizing.
- Real `ctx.layout.open file` / `desktop.launch` host success; the dev harness
  only proved the readable copy-path fallback and records `hostApi:false`.
- Network push/pull/reset-clean, credential prompts, SSH/HTTPS authentication
  and interactive prune confirmation. The fetch acceptance is a local bare
  remote, not a network/authentication test.
