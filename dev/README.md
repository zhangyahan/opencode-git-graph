# Git Graph dev UI harness

A browser harness for the **real** production panel. It renders
`src/gui/panel.tsx` (`GitGraphPanel`) directly and talks to the **real**
`RepositoryManager` / `createGitGraphHandlers` / `GitGraphRpc` schemas through a
small loopback HTTP bridge.

It is dev-only. Nothing under `dev/` is part of the production plugin bundle,
and the bridge is only created by `dev/vite.config.ts`.

## Start

From the repository root:

```bash
npm run dev:ui
```

Open <http://127.0.0.1:5178/>.

The server binds `127.0.0.1:5178` with `strictPort`, so a second instance fails
instead of silently moving to another port. Stop it with `Ctrl+C`; the manager
is disposed when the HTTP server closes.

## Real data, fixed root

- Repository root is fixed to `D:\Workspace\FR`. The browser cannot choose a
  root, and RPC input cannot contain `repoPath`.
- The repository allowlist comes from the production discovery flow, exactly
  like the plugin. The expected fixture has **16 repositories / 4 worktrees**.
- Primary manual checks:
  - `sai-qx-api` — about **395 refs** (394 observed at verification time),
    exercising the ref pill/overflow UI.
  - `qx-api` — 1 unstaged working-tree change (848 commits in the current
    fixture) for changes/diff views.
- No comment, commit subject, diff or repository data is mocked. If the bridge
  cannot reach `D:\Workspace\FR`, the panel shows its normal loading/error
  states.

## Read-only boundary

The harness uses the existing safe repository manager and only calls:

`ping`, `listRepositories`, `getStatus`, `getLog`, `getRefs`,
`getCommitFiles`, `getDiff`.

There are no write routes. The git engine is the production read-only engine:
arguments are passed as arrays, `GIT_OPTIONAL_LOCKS=0` for read commands,
external diff/textconv/filter execution is disabled, and commit hashes /
relative paths are validated. The harness never runs stage, commit, checkout,
pull, push, or any command that mutates a worktree or index. It does not write
files inside `D:\Workspace\FR`.

## Bridge security

`POST /__gg/rpc/:method` only:

- loopback host `127.0.0.1:5178`;
- strict `Host` (`127.0.0.1:5178`) and `Origin`
  (`http://127.0.0.1:5178`) checks; no CORS headers are sent, so cross-site
  browser requests cannot read responses;
- `Sec-Fetch-Site` must be `same-origin`/`none` when present;
- JSON body only, capped at **64 KiB**;
- input and output are parsed with the real zod schemas from `src/rpc.ts`;
- typed errors are returned as `{ "error": { "type", "message", "data" } }`
  with a status mapped from the type (`invalid_input` 400,
  `repository_not_found` 404, `git_failed` 502, `disposed` 503);
- the browser client throws `GitGraphRpcError` for non-2xx/typed-error replies,
  so the panel's normal error and retry UI is exercised;
- the bridge never logs request bodies, commit messages, file contents, or
  tokens;
- `AbortSignal` flows browser `fetch` → request close → handler context →
  manager → `git` child process where the engine supports cancellation.

The bridge loads server modules through `server.ssrLoadModule` during
`configureServer`, so Vite transforms the TypeScript sources instead of
duplicating them. The manager is disposed on server shutdown.

## Harness chrome and selectors

Harness-only UI is outside the production panel. The harness shell and the
production panel both expose `data-testid` hooks; both are listed here.

Harness shell:

| element | selector |
| --- | --- |
| harness toolbar | `[data-testid="harness-toolbar"]` |
| harness fixed root | `[data-testid="harness-root"]` |
| harness read-only badge | `[data-testid="harness-readonly"]` |
| 520 px width | `[data-testid="harness-width-520"]` |
| 1100 px width | `[data-testid="harness-width-1100"]` |
| harness panel shell | `[data-testid="harness-panel-shell"]` (`data-panel-width`) |

Production panel hooks (owned by `src/gui/panel.tsx`, not by the harness):

| element | selector |
| --- | --- |
| repository select | `[data-testid="repository-select"]` |
| refresh button | `[data-testid="refresh"]` |
| current branch | `[data-testid="current-branch"]` |
| commit search | `[data-testid="search-commits"]` |
| working-tree changes | `[data-testid="changes"]` |
| history table | `[data-testid="history"]` |
| graph scroll pane | `[data-testid="graph-scroll"]` |
| commit list scroll pane | `[data-testid="history-scroll"]` |
| load more | `[data-testid="load-more"]` |
| commit details | `[data-testid="commit-details"]` |
| close details | `[data-testid="close-details"]` |
| diff pane | `[data-testid="diff"]` |

Stable fallback classes:

- root: `.git-graph-panel`
- branch/meta: `.gg-branch`, `.gg-branch-name`
- working tree clean: `.gg-working-tree-clean`
- status text: `.gg-status`, `.gg-empty`, `.gg-error`
- commits: `.gg-graph-row`, `.gg-subject`, `.gg-hash`
- changed files: `.gg-file-row`, `.gg-dir-row`, `.gg-file-name`
- diff: `.gg-diff-line`, `.gg-diff-add`, `.gg-diff-remove`, `.gg-diff-hunk`,
  `.gg-diff-context`


The layout uses normal document flow: `html`, `body`, `#root` and `.harness`
are 100% high, the stage is the flex remainder, and `.harness-panel` gives
`.git-graph-panel` a full-height flex parent. No fixed viewport height is baked
into the panel.

## Difference from the Desktop host

This harness verifies the panel component and its data path, not the whole
Desktop integration:

- no Desktop window/panel chrome, tab strip, drag/resize, side-region rules or
  `width: 520` panel registration;
- `MenuItem` registration for `session.panel` is **not covered**;
- no OpenCode session switching, project/sidebar data, host theme injection or
  host event bus;
- `PanelProps` is the minimal subset `GitGraphPanel` reads
  (`session.directory`, `session.server.id`, `session.server.client`). The
  session object is a getter-backed signal and is cast at the boundary; `tab`
  and `screen` are present but unused by the panel. No other production data is
  stubbed.

## Acceptance checklist

1. `npm run dev:ui` starts on `http://127.0.0.1:5178/` with a 520 px panel.
2. Repository select lists **16** entries and the default repository loads
   status, refs and commits.
3. `sai-qx-api` shows its large ref set; `qx-api` shows working-tree changes.
4. Clicking a commit loads the file tree; clicking a changed file loads a diff.
5. “Load more” appends commits without duplicates.
6. Width buttons switch the shell between 520 px and 1100 px without touching
   panel code.
7. `npm run typecheck` and `npm run build` pass.
8. The browser console has no errors; no RPC request is made to a non-loopback
   origin.
