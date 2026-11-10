# Release UI acceptance (real browser)

**Verdict: PASS — 93/93 checks passed, 0 failed.**

The frozen release build was tested against two real environments:

- **FR**: read-only fixture, 16 repositories / 4 worktrees.
- **TEMP**: isolated synthetic mutation fixture under the approved TEMP root.
- Real production components and the real repository manager/RPC path; normal
  repository data was not mocked.
- Fresh real-browser loads at the start of both environments; real pointer and
  keyboard input.

This public summary is anonymized. Private repository names, absolute paths,
hashes, source paths and private file/diff content are not included. Complete
machine evidence and screenshots remain only in the operator TEMP
`gg-ui-release-final-pass` directory. Earlier 70/70 evidence is retained
separately.

## Results

| Area | Result | Evidence |
| --- | --- | --- |
| Existing core regression | PASS | All prior 70 checks passed again in this run: repository discovery, fixed 240 px graph, Date 150 px with 19-character seconds and ISO title, 520/1100 layouts, four non-graph column resizers, branch filters/refs, history controls, menus, context-menu compare, auto pagination, inline/Back, FR guard, TEMP writes, root, dirty/stale/unknown errors. |
| FR loading gate | PASS | Initial load and Refresh held real `getStatus`/`getLog` responses. First-parent/remotes/tags/order were disabled or guarded while held; after release 100 loaded, rows/header/Refresh/repository select usable, no permanent busy. |
| Scrolled plain + Ctrl/Cmd comparison | PASS | History at 900 px with inline slot open; plain first commit + Ctrl/Cmd second opened comparison. Real `getComparisonFiles`/`getComparisonDiff` carried the selected base/head. The files pane showed 152 files; selecting a file rendered a real text diff. |
| Comparison Back | PASS | Vertical scroll remained 900 → 900 (≤1 px); expanded index and slot height were preserved; rendered DOM covered the viewport without a blank window. |
| Selected-ref filters + mutation | PASS | Selected filter showed 3 loaded rows. Rename/delete left history usable with no invalid-ref error; secondary repository did not inherit the old filter. |
| Badge keyboard | PASS | Enter and Space opened the ref menu without expanding the row; focus returned to the trigger after close. Ctrl+F/Enter and Ctrl+H/Escape worked. |
| TEMP binary diff | PASS | Real binary file diff showed a Binary warning and zero text diff lines. |
| Mutation warning fault | PASS | Isolated fault response carried a real status snapshot plus warning; UI showed it, one request, no automatic retry. Not mixed with normal success evidence. |
| AfterServer mutation gate | PASS | Real checkout mutation executed, then its real response was held. Repository dropdown was busy-disabled, exactly one mutation request occurred, no abort/retry, and a newly opened dialog survived completion. |
| FR read-only guard | PASS | Six invalid/guard probes returned 403 `rpc.method_forbidden`; HEAD and all refs unchanged. No valid confirmed FR mutation was sent. |
| Refs failure isolation | PASS | Injected refs 502 showed a refs error while history stayed at 100 loaded / 30 rows. |
| Console / network | PASS | FR and TEMP: 0 page errors, 0 unexpected console errors, 0 non-abort request failures, 0 unexpected HTTP ≥400. Only benign favicon 404s; expected aborts were separated; fault responses isolated. |
| Source / HMR | PASS | Production source mtimes were identical before/after; no hot-update or page-reload events. |

## Screenshots (basenames; private TEMP only)

- `01-fr-graph-date-1100.png` — fixed graph and full Date.
- `02-fr-columns-after-drag.png` — four non-graph columns after pointer drags.
- `03-fr-520.png` — compact layout.
- `04-fr-branch-filter.png` — branch selector and refs.
- `05-fr-ref-menu.png` — ref menu.
- `06-fr-compare.png` — context-menu comparison path.
- `07-temp-checkout-dialog.png` — checkout confirmation.
- `08-temp-checkout-success.png` — confirmed checkout.
- `09-temp-branch-success.png` — created branch visible.
- `10-temp-error-paths.png` — TEMP root/error context.
- `11-fr-refs-failure.png` — refs failure with usable history.
- `12-fr-loading-gate.png` — held status/log loading state.
- `13-fr-compare-scroll.png` — scrolled inline plain + Ctrl comparison with real diff.
- `14-temp-binary-diff.png` — binary diff warning.
- `15-temp-warning-fault.png` — isolated mutation warning.
- `16-temp-mutation-switch.png` — afterServer-held mutation with busy repository control.

Complete private result and screenshots are under the operator TEMP
`gg-ui-release-final-pass` directory. The earlier 70/70 baseline and 88/89
failure evidence are retained separately. No private evidence is committed.

## Historical baseline

The earlier 79/79 and 70/70 results remain historical baselines only; they are
not the regression truth for this extended interaction matrix.

## Not covered / unavailable

- Real Desktop session/scope switching and host session/route changes:
  explicitly outside this harness; no debug hooks or prod signal changes were
  used.
- Desktop window/panel chrome, `MenuItem` registration, host theme/event bus and
  real Desktop panel resize.
- Network push/fetch/reset-clean; unavailable and not invoked.
- Mutation output-warning behavior was exercised only as an isolated fault, not
  as a real successful mutation.
- No product FAIL remains in the exercised harness matrix.
