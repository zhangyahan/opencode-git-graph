# Release UI acceptance (real browser)

**Verdict: PASS — 172/172 checks passed, 0 failed.**

The frozen 0.2.1 release UI was tested against two real environments:

- **FR**: read-only fixture, 16 repositories / 4 worktrees.
- **TEMP**: isolated synthetic mutation/content fixture.
- Real production components and the real repository manager/RPC path; normal
  repository data was not mocked.
- Fresh real-browser loads, real pointer and keyboard input.

This run revalidated the historical core subset (128 of the 131 historical
checks still apply; the three checks that asserted first-parent / Jump-HEAD
behavior are intentionally replaced by absence assertions in this build) and
added the next UI slice: inline slot resizing, the Uncommitted history row with
four working-tree groups, and the fetch confirmation/remote flow. Total: 172
checks.

This public summary is anonymized. Private repository names, absolute paths,
commit hashes, source paths and private file/diff content are not included.
Complete machine evidence and screenshots remain only in the operator TEMP
`gg-ui-release-extended-20261110-195711` directory.

## Final result

| Area | Result | Evidence |
| --- | --- | --- |
| Historical core regression | PASS | 128 of the 131 historical checks still apply and pass; the three first-parent / Jump-HEAD checks are superseded by the absence assertions. Repository discovery, history/filters/menus, comparison/Back, loading gate, FR guard, TEMP writes, binary/content fixtures, warning/afterServer paths. |
| Inline slot resize | PASS | Real `slot-resize-handle` pointer drag: clamps to 96 px; grows to the dynamic maximum computed from the live scroller (560 px at the 900 px viewport); bottom-follow keeps the scroller pinned (distance 0) while scrollHeight/scrollTop grow together; drags away from the bottom preserve scrollTop and slot top within 1 px; height survives collapse/reopen in the same session. |
| Uncommitted history row | PASS | The special row is above commit rows and carries no commit index/data; its counts badge matches real `getStatus` counts; a clean FR repo shows 0 files; expanding the TEMP dirty fixture reveals Staged / Unstaged / Untracked / Conflicted groups with real file rows. |
| Index / working-tree diff | PASS | A staged file requests `getDiff` with `target.type="index"`; an unstaged file requests `target.type="working-tree"`; both open the full-page diff whose `data-diff-source` matches, and Back returns to the Uncommitted row. |
| Legacy Changes section | PASS | The standalone `changes`/`.gg-changes-section` surface is absent in both FR and TEMP. |
| Toolbar removal + Ctrl+H | PASS | `first-parent` and `jump-head` are absent; Ctrl+H sends no history request and opens no menu/dialog. |
| Fetch dialog | PASS | The fetch button is enabled when remotes exist; the dialog exposes remote selector, prune, expected HEAD, cancel and confirm; cancel sends zero fetch RPCs. |
| Local bare fetch | PASS | A real fetch against a local bare remote returns `refsUpdated: 1`, `changed: true`, an unchanged HEAD status, and refreshes the new remote-tracking ref in refs/history. |
| Fetch failure reason | PASS | An injected 409 surfaces only the bounded `fetch_failed` reason; the injected private path never reaches the UI. |
| FR fetch guard | PASS | A direct confirmed FR fetch returns HTTP 403 and leaves HEAD/refs unchanged; the FR UI confirmation cannot reach a valid write (the dev client hides mutation methods and the bridge still rejects the method). |
| Console / network | PASS | 0 page errors, 0 unexpected console errors (only benign favicon 404s), 0 non-abort request failures, 0 unexpected HTTP >= 400. |
| Source / HMR | PASS | Production source mtimes identical before/after; no HMR or reload events. |
| TEMP cleanup | PASS | Returned to `main` with a clean worktree, no test branches/tags/remotes and no file-protocol override. |
| FR read-only | PASS | HEAD and refs unchanged; no guard branch/tag was created. |

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
- `17-fr-slot-resize.png`
- `17b-temp-slot-bottom-follow.png`
- `18-fr-inline-three.png`
- `18-fr-uncommitted-clean.png`
- `19-fr-file-actions.png`
- `19-temp-uncommitted-index.png`
- `19-temp-uncommitted-working-tree.png`
- `20-temp-content-fixture.png`
- `20-temp-fetch-dialog.png`
- `21-temp-fetch-success.png`
- `22-temp-fetch-failure.png`
- `23-fr-fetch-forbidden.png`

## Test-harness notes

Only the acceptance script was adjusted before this final run; no product GUI or
backend source changed (source mtimes were stable during the run).

- The local bare fetch remote is seeded by pushing the fixture HEAD, because a
  freshly `init --bare` repository has no objects to reference.
- Bottom-follow is measured on the small TEMP fixture in a short viewport so the
  expanded slot is genuinely visible at a stable bottom; the paginated FR list
  keeps extending its bottom while auto-loading.
- The inline Back assertion waits for the scheduled frame restore before
  sampling scrollTop.

## Historical baseline

The prior 0.2.1 run remains **131/131 PASS**. In this run, 128 of those checks
still apply and passed; the three checks that asserted first-parent / Jump-HEAD
behavior are intentionally obsolete in the frozen build and are replaced by the
absence and Ctrl+H assertions above. This run totals 172 checks.

## Not covered / manual

- Real Desktop session/scope switching, window/panel chrome, `MenuItem`
  registration, host theme/event bus and real Desktop panel resizing.
- Real `ctx.layout.open file` / `desktop.launch` host success; the dev harness
  only proved the readable copy-path fallback and records `hostApi:false`.
- Network push/pull/reset-clean, credential prompts, SSH/HTTPS authentication
  and interactive prune confirmation. The fetch acceptance is a local bare
  remote, not a network/authentication test.
