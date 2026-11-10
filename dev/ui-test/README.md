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

Environment overrides:

| variable | purpose |
| --- | --- |
| `GG_FR_URL` / `GG_TEMP_URL` | the two harness origins |
| `GG_RELEASE_ARTIFACTS` | screenshot/result directory |
| `GG_FR_REPO` / `GG_TEMP_REPO` | fixture repository names |
| `GG_PLAYWRIGHT_CORE` / `GG_CHROME_PATH` | browser automation overrides |

The script never sends a valid confirmed mutation to the FR origin. Mutation
requests there are limited to `confirmed:false`, unknown-target and stale-head
guard probes. Full write flows (checkout/create/rename/delete branch, create/
delete tag, dirty/stale/unknown errors) run only against the approved TEMP
fixture. Screenshots and private result data stay under the TEMP artifacts
directory.

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

The script only reads: `ping`, `listRepositories`, `getStatus`, `getLog`,
`getRefs`, `getCommitFiles`, `getDiff`. It does not stage, commit, checkout,
pull, push or write to the fixture repository.
