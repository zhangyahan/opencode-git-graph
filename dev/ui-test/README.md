# Real-browser UI acceptance

`acceptance.mjs` drives the real dev harness (`dev/main.tsx` →
`src/gui/panel.tsx`) and the real `RepositoryManager` bridge on
`http://127.0.0.1:5178/`. It records real screenshots and a machine-readable
result; no repository, commit or diff data is mocked.

## Prerequisites

1. Start the harness from the repository root:

   ```bash
   npm run dev:ui
   ```

2. Put `playwright-core` in the approved TEMP directory, not in this project.
   This keeps `package.json` / `package-lock.json` untouched:

   ```powershell
   $dir = "$env:LOCALAPPDATA/Temp/opencode/gg-ui-test"
   New-Item -ItemType Directory -Force $dir | Out-Null
   Set-Content "$dir/package.json" '{"name":"gg-ui-test","private":true}'
   Push-Location $dir
   npm install playwright-core@1.56.1 --no-audit --no-fund
   Pop-Location
   ```

   Chrome or Edge must already be installed. The script auto-detects the
   standard install paths. Use `GG_CHROME_PATH` to override.

## Run

From the repository root:

```powershell
node dev/ui-test/acceptance.mjs
```

### Integrated interactions acceptance

`interactions.mjs` is the current new-feature acceptance script: automatic
pagination, inline commit files, full-page commit diff, merge parent switching,
search jumps, root commits, all five column resizers, persistence and isolated
route-fault diagnostics. It uses the same real harness/FR data path and does not
mock normal repository data.

```powershell
node dev/ui-test/interactions.mjs
```

Optional isolated settings:

| variable | purpose |
| --- | --- |
| `GG_UI_INTERACTIONS_ARTIFACTS` | interactions screenshots/result directory |
| `GG_REPO_A` / `GG_REPO_B` / `GG_REPO_ROOT` | fixture aliases |
| `GG_AUTO_LOAD_TIMEOUT` | automatic-pagination wait budget (ms) |

`acceptance.mjs` remains the historical 79-check baseline for the earlier
graph-scroll fix. It uses fixed 28px row geometry and manual pagination, so it is
not the regression truth for the new row-layout/inline interactions.

### Release-candidate two-environment acceptance

`release.mjs` is prepared for the frozen release build. It expects the
read-only FR harness and the separate TEMP mutation fixture:

```powershell
# default: FR http://127.0.0.1:5178/, TEMP http://127.0.0.1:5179/
node dev/ui-test/release.mjs

# selector readiness audit only; no writes
node dev/ui-test/release.mjs --audit
```

The historical 0.2.1 baseline remains **131/131 PASS**. The extended run on the
frozen 0.2.2 build completed as **172/172 PASS** (`gg-ui-release-extended-20261110-195711`):
the 128 still-applicable historical checks plus the new scenarios below. The
selectors listed in that historical section are the names used by that run.

#### Next-freeze refinements (executed)

`release.mjs` encodes the layout refinements listed below. The frozen run on the
current fixture completed **220/220 checks** (188 baseline + 32 frozen-extension checks).
The FR picker assertion is environment-independent: at least one repository,
every dropdown option loads/switches, and worktree labels are checked only when
worktrees exist. This fixture reports 12 repositories / 0 worktrees and records
worktree labels as `notPresent`; that is a pass, not a lowered product threshold.

| refinement | environment | what the script asserts |
| --- | --- | --- |
| graph crop | FR | the graph still clips right lanes, keeps the fixed 14px lane step and has no horizontal scrollbar, but `[data-testid="dense-graph"]` is absent at every width |
| column divider itself | FR | `resize-column-<id>` (including graph) is the ~5px header divider hit area, not a separate grip; a real pointer drag changes the width; header and row widths stay in sync; widths persist across reload; 520px has no horizontal overflow |
| date format | FR | the Date cell is exactly 16 characters in `YYYY-MM-DD HH:mm` form with no seconds and the original ISO value in `title` |
| full labels | FR + TEMP | every branch/ref name must be rendered in the DOM and fully visible: no `+N`/`ref-more`, no ellipsis, no horizontal scrolling in `.gg-ref-badges`; a multi-ref row grows taller than 28px and reflows without clipping. The top `current-branch` label follows the same full-text rule; 520px has no horizontal overflow. TEMP additionally creates and checks out a long branch name and returns to the original branch afterwards |
| dynamic ref rows | FR | choose the commit with the most refs (preferring one with files), assert every expected ref name is present/visible, no `ref-more`, no horizontal container scroll, row height >28px and prefix-sum contiguity; then verify search, inline slot placement/drag, commit-diff Back and 520/1100 reflow keep the row and badges intact |
| inline three columns | FR | the left info column is wider (at least 200px and at least ~28% of info+files), the file column is narrower; left info text wraps without ellipsis or clipping and shows multiple lines for long text; the left/middle divider drags to change the ratio, clamps to about 25%-60%, survives collapse/reopen, and never overflows |
| slot bottom divider | FR + TEMP | `slot-resize-handle` is the full-width bottom divider hit area (no separate small grip); drag clamps to 96px, grows to the dynamic viewport maximum, persists for the session, and keeps bottom-follow behaviour |

Regression coverage is unchanged and still runs in the same script: loading
gates, fetch (FR 403 guard + TEMP real fetch), the Uncommitted row and its
groups, file eye/content actions, list/tree toggles, comparison scroll/back,
write confirmation and cancellation, and the TEMP return to the original branch
(`main` for the fixture).

Environment-data handling is dynamic, not a lowered product threshold:

- The FR picker contract only requires a non-empty repository list; worktrees
  are `notPresent` when none exist.
- `showRemotes` switches to a repository that actually has a
  remote-tracking-only commit in the first page; the assertion still requires the
  history to change when remotes are hidden.
- The remote/tag filter loop switches to a repository containing that ref kind
  when the primary does not have one; a genuinely missing kind remains a failure.
- The FR clean Uncommitted check selects a clean repository if the primary has
  local changes.
- TEMP ensures the selected repository has at least two commits and a real file
  change; if the fixture is too small, throwaway commits are created in TEMP and
  the UI must render at least two rows before the branch/tag flow.

New selector assumptions to confirm after the freeze:

| assumption | selectors currently probed |
| --- | --- |
| header divider is the resize hit area | `[data-testid="resize-column-<id>"]`; the script checks a 3-8px width, divider-edge alignment and the absence of a small pseudo-element grip |
| repository picker | at least one option; every dropdown option is selected and must load (status/branch and commits or an explicit 0-loaded state); worktree options must contain `(worktree)`, and zero worktrees is recorded as `notPresent` |
| remount panel | `[data-testid="harness-remount-panel"]` truly disposes and rebuilds the panel; the check waits for a new `.git-graph-panel` element |
| watcher refresh | no private event API is assumed: the script waits for the new hash in `.gg-graph-row[data-commit]`, `current-branch` text, or a visible `ref-badge` on the fetched `data-commit`; `getLog` counts are read from real RPC requests |
| tab label | `src/gui.tsx` sourceCheck only (`Git Graph` + branch icon); Desktop rendering is manual and not a script UI pass |
| refs visibility | all `[data-testid="ref-badge"]` names must exist in the row; `[data-testid="ref-more"]` must be absent; `.gg-ref-badges` must have no horizontal scroll (`scrollWidth <= clientWidth + 1`) |
| dynamic row height | tall ref rows use `data-row-top` prefix sums; the script checks `row height > 28px`, contiguous `rowTop`, and that slot/search/Back/520/1100 keep the row intact |
| uncommitted slot handle | `[data-testid="uncommitted-slot"] [data-testid="slot-resize-handle"]` must span the slot width; drag bounds use the same 96px/dynamic-max policy as commit slots |
| dense hint removed | `[data-testid="dense-graph"]` must have count 0 |
| inline left/middle divider | first present of `inline-split`, `inline-info-resize`, `inline-column-resize`, `inline-info-divider`, `inline-info-splitter`, `inline-resize`, `inline-splitter`, `.gg-inline-split`, `.gg-inline-info-resize`, `.gg-inline-splitter` |
| inline info/file columns | `[data-testid="inline-info"]` plus `.gg-row-slot-files` inside `inline-slot` |
| slot divider | `[data-testid="slot-resize-handle"]` must span the full slot width; no centered small grip |
| full labels | `[data-testid="current-branch"]` and `[data-testid="ref-badge"]`; `[data-testid="ref-more"]` must be absent; `.gg-ref-badges` has no horizontal scroll |
| date | 16-character text plus an ISO `title` on `commit-date` / the inline Date row |

If the frozen build renames the inline divider, update only
`INLINE_INFO_DIVIDER_SELECTORS`; the rest of the scenario is independent of the
exact name.

#### Watcher / remount / dynamic-ref / uncommitted-slot round (executed)

The **188/188** run above remains the baseline. The following scenarios are
included in the final **220/220** frozen run; they are not counted as UI passes
unless the real browser assertions ran.

| scenario | environment | what the script asserts |
| --- | --- | --- |
| external watcher refresh | TEMP | With the panel open on `main`, a real local `git commit` made outside the browser must make the new commit appear without clicking Refresh (waits on the new `data-commit` with a 10s `waitForFunction`, no fixed sleep). A real external `git checkout feature` must update `current-branch`; a real external `git fetch` of a local bare remote must advance the remote badge on the fetched commit. Each event's `getLog` burst is recorded and must stay within 1-3 (checkout/fetch allow 0-3 because they may only need status/refs). |
| cache remount | TEMP | Load `primary`, scroll to mid-history, expand a file-bearing commit and record `scrollTop`/expanded hash/refs. Click `harness-remount-panel`; the new panel must paint history immediately with no repository/loading skeleton, restore `scrollTop` within 1px and the same expanded hash/slot, keep refs unchanged, and run **no** full `getLog` when HEAD/refs are unchanged (`getStatus`/`getRefs` are allowed). A later row click must still work. |
| external commit + remount | TEMP | After a real external commit, remount (or the watcher event) must show the new commit silently while keeping the reading position broadly stable (not reset to 0, within 3 row heights), with a bounded 1-3 `getLog` refresh. |
| dynamic multi-ref row | FR | all ref names for the busiest commit are in the DOM and visible with no `+N`, ellipsis or refs-group horizontal scroll; the row grows >28px; search, slot placement/drag, file-diff Back and 520/1100 reflow keep the row, badges and virtual prefix sums correct. |
| uncommitted slot resize | TEMP dirty + FR clean | after expanding `uncommitted-row`, the `uncommitted-slot` bottom `slot-resize-handle` is a full-line hit area; a real pointer drag changes its height, clamps to 96px and the dynamic viewport maximum, keeps non-bottom scroll/row top stable, follows the bottom when parked there, and persists after collapse/reopen. FR clean(0) validates the handle/drag when the slot exists, otherwise records `notPresent` without failing. |
| tab label icon+text | source + Desktop | `src/gui.tsx` is statically checked for `title: "Git Graph"`, `name="branch"`/`icon: "branch"` and side-panel registration. This is recorded as `sourceCheck: true, desktopManual: true, uiPass: false`; it is **not** counted as a UI pass. Real tab icon/text rendering remains Desktop manual. |

The watcher/cache fixtures only write to TEMP: each scenario records the original
HEAD/branch, creates a throwaway commit or switches branches with real local git,
removes any throwaway local bare remote, then resets to the original HEAD/branch
and leaves `main` clean. FR is never written.

> Integration dependency: the dev harness must expose the production
> `rpc.events.on("graphChanged")` channel (and its local bridge) before the
> watcher scenario can pass. The `harness-remount-panel` button is already
> present. If the event channel is absent, the watcher scenario fails
> explicitly; it is not skipped or recorded as a UI pass.

The watcher scenario assumes the standard TEMP fixture still has local `main`
and `feature` branches and enough history for `feature~1`. A missing branch or
parent is reported as a fixture failure, not silently skipped.

#### Extended scenarios (frozen and passed)

| scenario | environment | what it asserts |
| --- | --- | --- |
| inline slot resize | FR | `slot-resize-handle` is a real pointer drag at the bottom of `inline-slot`; shrink clamps to 96px; growth stops at a dynamic maximum bounded by the history viewport; drag away from the bottom keeps `history-scroll` scrollTop/slot top stable; drag at the bottom keeps the scroller pinned to the bottom; the height survives collapse/reopen in the same session |
| Uncommitted history row | FR clean + TEMP dirty | the special row sits above commit rows and carries no commit index/commit data; it carries a counts badge; a clean repo shows 0; expanding it reveals Staged/Unstaged/Untracked/Conflicted groups; clicking a staged file requests `getDiff` with `target.type="index"`, an unstaged file with `working-tree`; the legacy standalone `changes` section is absent |
| toolbar/fetch | FR + TEMP | no `first-parent`/`jump-head`, and Ctrl+H sends no history request; `fetch-button` opens `fetch-confirm`/`fetch-cancel` with remote/prune/expectedHead; cancel sends zero fetch RPCs; a real fetch against a local bare remote returns `refsUpdated`/`changed`/`status` and refreshes refs/history; an injected failure shows only the bounded reason, never a path; FR still returns HTTP 403 and the confirmation is blocked before a valid write |

The script never sends a valid confirmed mutation to the FR origin. The new FR
fetch probes are either `confirmed` with an unknown remote (rejected with 403) or
are intercepted by the script and fulfilled with 403 before reaching the bridge.
Full fetch flows run only against TEMP, using a bare repository created under the
approved TEMP tree. Temporary remote config, remote-tracking refs, conflict
fixture commits and dirty files are cleaned up in `finally` blocks.

#### Selector assumptions to confirm after freeze

The backend implementation is still WIP. `release.mjs` pins these assumptions so
the audit reports them explicitly instead of silently skipping:

> Integration dependency: the dev harness must expose the frozen `fetchRemote`
> method in its mode allowlist (`dev/protocol.ts` / `dev/bridge.ts`) before the
> TEMP fetch path can run. FR must continue to return HTTP 403 for it.

| assumption | selectors currently probed |
| --- | --- |
| slot handle | `[data-testid="slot-resize-handle"]` |
| Uncommitted row | `[data-testid="uncommitted-row"]` (also `.gg-uncommitted-row`) |
| counts badge | `[data-testid="uncommitted-total"]` plus `[data-testid^="uncommitted-count-"]` |
| groups | group buttons inside `[data-testid="uncommitted-files"]` labelled Staged / Unstaged / Untracked / Conflicted |
| file rows | `.gg-file-row` inside `[data-testid="uncommitted-slot"]` / `uncommitted-files` |
| removed UI | `[data-testid="changes"]`, `.gg-changes-section`, `[data-testid="first-parent"]`, `[data-testid="jump-head"]` must be absent |
| fetch controls | `[data-testid="fetch-button"]`, `fetch-confirm`, `fetch-cancel`, `fetch-remote-select`, `fetch-prune`; expected HEAD is the second `.gg-dialog-facts dd` |
| fetch RPC | method `fetchRemote` by default; override with `GG_FETCH_METHOD` if the frozen contract renames it |
| fetch response | `{ status, refsUpdated, changed, warning? }` where `refsUpdated` is a count or array |
| status diff | `getDiff` target must be `index` or `working-tree`; the full-page surface is `commit-diff-page` (`data-diff-source` must match) with `details-back` |

The next-freeze section above supersedes the 0.2.2 slot-handle row: the frozen
build keeps `slot-resize-handle` but requires it to be the full-width bottom
divider with no small grip. The 0.2.2 result remains historical evidence only.

If any frozen name differs, adjust only the matching selector/constant and re-run
`node dev/ui-test/release.mjs --audit` before the full run. The frozen refinement
run already executed against the current build; re-run the full script after any
selector correction.

Known hard points for the frozen run:

- The slot maximum is dynamic: `max(96, min(560, history-client-height - 80))`.
  The test computes that from the live scroller height instead of assuming 560.
- Bottom-follow is only expected within the panel's two-row bottom threshold;
  the test parks at the real bottom and checks the scrollHeight/scrollTop delta,
  while the non-bottom case checks scrollTop and slot top stay within 1px.
- The four working-tree groups require a real conflicted index. The TEMP setup
  creates and aborts a throwaway conflict merge, then restores HEAD and tracked
  bytes; a non-clean fixture is reported as a failed precondition, not forced.
- The local bare fetch remote is created under TEMP with
  `protocol.file.allow=always` scoped to the fixture and removed afterwards.
  It is not a network test and never points at FR.
- FR fetch is a 403 guard: the UI confirmation is intercepted and fulfilled with
  403 so no valid confirmed write reaches the bridge.

#### Static readiness check

Static checks remain part of the release gate:

```powershell
node --check dev/ui-test/release.mjs
node dev/ui-test/release.mjs --audit   # confirm the new inline divider and label selectors
node dev/ui-test/release.mjs
```

The frozen final run completed **220/220 checks**; see
`dev/UI-ACCEPTANCE.md`. The FR picker contract is dynamic: it requires at least
one repository and verifies that every dropdown option loads/switches, with
worktree labels only when worktrees are present. The current fixture reports
12 repositories / 0 worktrees, so worktree labels are `notPresent`.

The watcher / remount / dynamic-ref / uncommitted-slot scenarios above were
executed in that frozen run. The tab-label source check remains
`sourceCheck/desktopManual` and is not counted as a UI pass.

Environment overrides:

| variable | purpose |
| --- | --- |
| `GG_FR_URL` / `GG_TEMP_URL` | the two harness origins |
| `GG_RELEASE_ARTIFACTS` | screenshot/result directory |
| `GG_FR_REPO` / `GG_TEMP_REPO` | fixture repository names |
| `GG_PLAYWRIGHT_CORE` / `GG_CHROME_PATH` | browser automation overrides |
| `GG_FETCH_METHOD` | fetch RPC method name (default `fetchRemote`) |

The script never sends a valid confirmed mutation to the FR origin. Mutation
requests there are limited to `confirmed:false`, unknown-target/stale-head guard
probes, and the intercepted fetch confirmation; the unknown-remote fetch probe is
rejected with 403 before any repository change. Full write flows (checkout/create/
rename/delete branch, create/delete tag, dirty/stale/unknown errors) run only
against the approved TEMP fixture. Screenshots and private result data stay under
the TEMP artifacts directory.

Optional environment variables:

| variable | purpose |
| --- | --- |
| `GG_UI_URL` | harness URL (default `http://127.0.0.1:5178/`) |
| `GG_PLAYWRIGHT_CORE` | absolute path to a `playwright-core` install |
| `GG_CHROME_PATH` | Chrome/Edge executable |
| `GG_UI_ARTIFACTS` | screenshot/result directory (defaults to approved TEMP) |

The script launches its own headless Chrome with an isolated temporary profile.
It does not attach to the user's browser, read a profile, or read cookies.

## Output

- Screenshots and `result.json` go to
  `%LOCALAPPDATA%\Temp\opencode\gg-ui-artifacts` by default.
- `result.json` contains every named check, measured layout numbers, console /
  page / request errors (normal aborts are separated), RPC request metadata and
  absolute screenshot paths.
- The latest human-readable acceptance report is `dev/UI-ACCEPTANCE.md`.

The script reads `ping`, `listRepositories`, `getStatus`, `getLog`, `getRefs`,
`getCommitFiles`, `getCommitFileContent`, `getDiff` and comparison methods. The
only write paths are TEMP-only: the prepared fetch scenario and the existing
branch/tag mutation flows. It never writes to the FR fixture.
