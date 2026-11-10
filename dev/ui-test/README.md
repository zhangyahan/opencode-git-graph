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
selectors in this document are the frozen names used by that run.

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

If any frozen name differs, adjust only the matching selector/constant and re-run
`node dev/ui-test/release.mjs --audit` before the full run. Do not run the new
scenarios against the WIP tree or record them as acceptance evidence.

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

Before the freeze notification, only syntax/static checks are expected. The final
frozen run additionally executed the full browser matrix via `release.mjs`:

```powershell
node --check dev/ui-test/release.mjs
```

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
