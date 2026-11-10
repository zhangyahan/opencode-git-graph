# Git Graph dev UI harness

A browser harness for the **real** production panel. It renders
`src/gui/panel.tsx` (`GitGraphPanel`) directly and talks to the **real**
`RepositoryManager` / `createGitGraphHandlers` / `GitGraphRpc` schemas through a
small loopback HTTP bridge.

It is dev-only. Nothing under `dev/` is part of the production plugin bundle,
and the bridge is only created by `dev/vite.config.ts`.

The harness has two environment-selected modes. The mode and repository root
are fixed at server startup; no HTTP request can choose either one.

| mode | default URL | root | write RPC |
| --- | --- | --- | --- |
| `fr` (default) | <http://127.0.0.1:5178/> | `D:\Workspace\FR` | never |
| `mutation-fixture` | <http://127.0.0.1:5179/> | validated child of the approved TEMP subtree | six explicit mutation methods |

## FR read-only mode

From the repository root:

```powershell
npm run dev:ui
```

Open <http://127.0.0.1:5178/>.

- Repository root is fixed to `D:\Workspace\FR`. The browser cannot choose a
  root, and RPC input cannot contain `repoPath`.
- Only `ping`, `listRepositories`, `getStatus`, `getLog`, `getRefs`,
  `getCommitFiles`, `getDiff`, `getComparisonFiles` and `getComparisonDiff`
  are exposed.
- `checkoutBranch`, `createBranch`, `createTag`, `renameBranch`,
  `deleteBranch` and `deleteTag` are rejected with HTTP 403 even if the
  production RPC later defines them.
- The expected fixture has **16 repositories / 4 worktrees**.
- Primary manual checks: `sai-qx-api` for the large ref set, `qx-api` for a
  working-tree change.
- No comment, commit subject, diff or repository data is mocked. FR is only
  read, never written.

## Mutation fixture mode (TEMP write tests)

This mode is for real checkout/create-branch/create-tag/rename/delete tests.
It uses two throwaway repositories created by a script, never FR or any
user-provided path.

### 1. Create a fixture

```powershell
node dev/ui-test/create-mutation-fixture.mjs
```

The script creates
`C:\Users\yahan\AppData\Local\Temp\opencode\gg-mutation-fixtures\fixture-<random>`,
initialises two real git repositories with isolated config, disabled hooks,
local `main`/`feature`/`release` branches, metadata-only remote refs, lightweight
and annotated tags, plus root/merge/rename/binary diff cases. It prints only the
fixture root and repository paths, then exits.

### 2. Start the harness

Use the `root` value printed by the script:

```powershell
$env:GG_UI_MODE = "mutation-fixture"
$env:GG_UI_PORT = "5179"
$env:GG_UI_FIXTURE_ROOT = "<printed root>"
npm run dev:ui
```

Open <http://127.0.0.1:5179/>. The page header shows
`TEMP WRITE TEST FIXTURE`; FR mode shows `FR READONLY`.

### Fixture and root validation

The bridge refuses to start when:

- `GG_UI_MODE` has an unknown value or `GG_UI_FIXTURE_ROOT` is missing;
- the root is not an absolute direct child of the fixed TEMP base;
- the root, the marker or any listed repository resolves through a symlink or
  junction;
- `.gg-mutation-fixture.json` is missing, malformed, has the wrong
  kind/version, or is bound to a different canonical root;
- the root or its base resolves into FR;
- FR mode is given a fixture root or a port other than 5178.

The manager still owns the repository allowlist through normal discovery below
the fixed root. RPC input cannot supply a repository path or a root.

### Mutation contract

Mutations are only forwarded when the production `GitGraphRpc`/handler exposes
them. The bridge validates the real input/output schemas; it never fabricates a
mutation result. The frozen contract is:

- `checkoutBranch({ repositoryId, branch, expectedHead, confirmed: true })`
- `createBranch({ repositoryId, name, startPoint, checkout?, expectedHead, confirmed: true })`
- `createTag({ repositoryId, name, target, message?, expectedHead, confirmed: true })`
- `renameBranch({ repositoryId, oldName, newName, expectedHead, confirmed: true })`
- `deleteBranch({ repositoryId, name, expectedHead, confirmed: true })`
- `deleteTag({ repositoryId, name, expectedHead, confirmed: true })`

Each returns `{ status, changed, warning? }`. `expectedHead` is `string | null`
and `confirmed` must be `true`. Until the production engine/rpc lands these
methods, startup still succeeds and the bridge logs the missing method names;
mutation requests return 404.

The bridge injects the real `src/server/git/mutations.ts` module through the
manager's documented `deps.mutations` seam in mutation-fixture mode. This is
needed because the manager's production lazy loader uses a `../git/mutations.js`
specifier that Vite's SSR runner cannot resolve from the TypeScript tree. No
mutation result or git command is mocked; the same upstream engine executes the
writes.

`GG_UI_FIXTURE_ROOT` is not accepted in FR mode. The fixture script takes no
arguments and never creates repositories outside its random TEMP directory.

## Bridge security

`POST /__gg/rpc/:method` only:

- binds loopback `127.0.0.1` on the mode's exact port (5178 or the configured
  mutation port);
- checks the exact `Host` (`127.0.0.1:<port>`) and `Origin`
  (`http://127.0.0.1:<port>`); no CORS headers are sent, so cross-site browser
  requests cannot read responses;
- requires `Sec-Fetch-Site` to be `same-origin`/`none` when present;
- accepts JSON bodies only, capped at **64 KiB**;
- parses input and output with the real zod schemas from `src/rpc.ts`;
- maps typed errors to `{ "error": { "type", "message", "data" } }` with
  statuses `invalid_input` 400, `repository_not_found` 404, `git_failed` 502,
  `disposed` 503;
- returns 403 for mutation method names in FR mode and 404 for methods not in
  the active mode's allowlist;
- never logs request bodies, commit messages, file contents or tokens;
- forwards `AbortSignal` from browser `fetch` → request close → handler context
  → manager → `git` child process where supported.

Vite's `fs.allow`/`fs.deny` remain scoped to the project root; the fixture is
accessed by git commands, not served as static files.

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
| harness mode badge | `[data-testid="harness-mode"]` (`data-mode="fr"` or `"mutation-fixture"`) |
| harness fixed root | `[data-testid="harness-root"]` |
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

1. `npm run dev:ui` starts on `http://127.0.0.1:5178/` with a 520 px panel and a
   `FR READONLY` badge.
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
9. In mutation-fixture mode, the badge reads `TEMP WRITE TEST FIXTURE`, both
   fixture repositories are listed, and checkout/create/tag/rename/delete work
   against the TEMP repositories once the production engine exposes them.
10. A fixture root outside the TEMP subtree, or one without the marker, aborts
    server startup.
