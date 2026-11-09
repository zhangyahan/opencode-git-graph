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
   $dir = "C:/Users/$env:USERNAME/AppData/Local/Temp/opencode/gg-ui-test"
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
  `C:\Users\<user>\AppData\Local\Temp\opencode\gg-ui-artifacts` by default.
- `result.json` contains every named check, measured layout numbers, console /
  page / request errors (normal aborts are separated), RPC request metadata and
  absolute screenshot paths.
- The latest human-readable acceptance report is `dev/UI-ACCEPTANCE.md`.

The script only reads: `ping`, `listRepositories`, `getStatus`, `getLog`,
`getRefs`, `getCommitFiles`, `getDiff`. It does not stage, commit, checkout,
pull, push or write to `D:\Workspace\FR`.
