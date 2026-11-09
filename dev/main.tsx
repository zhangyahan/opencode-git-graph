import { For, createSignal } from "solid-js"
import { render } from "solid-js/web"
import type { PanelProps, PanelTab } from "@opencode/plugin/gui"
import { GitGraphPanel } from "../src/gui/panel"
import { FR_ROOT } from "./protocol"
import { createHarnessClient } from "./rpc-client"

const WIDTHS = [520, 1100] as const
const FIXED_DIRECTORY = FR_ROOT

const TAB: PanelTab = { id: "main", title: "Git Graph" }

function App() {
  const [width, setWidth] = createSignal<(typeof WIDTHS)[number]>(520)
  const [directory] = createSignal(FIXED_DIRECTORY)
  const client = createHarnessClient()

  /*
   * Minimal host stand-ins.
   *
   * The production panel reads only `session.directory`,
   * `session.server.id` and `session.server.client`. `directory` is a signal
   * read through a getter so a host-style reactive session works. `tab` and
   * `screen` exist because PanelProps requires them, but the panel never reads
   * them. The cast is limited to the host-owned fields this harness does not
   * implement; no repository, commit, status or diff data is fabricated.
   */
  const panel = {
    get tab() {
      return TAB
    },
    get session() {
      return {
        get key() {
          return "dev-harness\nmain"
        },
        get id() {
          return "main"
        },
        get tab() {
          return "dev-harness"
        },
        get pending() {
          return false
        },
        get directory() {
          return directory()
        },
        get server() {
          return {
            get id() {
              return "dev-harness"
            },
            get name() {
              return "dev-harness"
            },
            get url() {
              return "http://127.0.0.1:5178"
            },
            get client() {
              return client
            },
          }
        },
      }
    },
    get screen() {
      return {}
    },
  } as unknown as PanelProps

  return (
    <div class="harness">
      <header class="harness-toolbar" data-testid="harness-toolbar">
        <span class="harness-title">Git Graph dev harness</span>
        <span class="harness-root" data-testid="harness-root" title={FIXED_DIRECTORY}>
          {FIXED_DIRECTORY}
        </span>
        <span class="harness-badge" data-testid="harness-readonly">
          read-only
        </span>
        <span class="harness-spacer" />
        <span class="harness-label">Panel width</span>
        <For each={WIDTHS}>
          {(value) => (
            <button
              type="button"
              class={width() === value ? "harness-button harness-button-active" : "harness-button"}
              data-testid={`harness-width-${value}`}
              aria-pressed={width() === value}
              onClick={() => setWidth(value)}
            >
              {value}px
            </button>
          )}
        </For>
      </header>

      <main class="harness-stage">
        <section
          class="harness-panel"
          data-testid="harness-panel-shell"
          data-panel-width={width()}
          style={{ width: `${width()}px` }}
        >
          <GitGraphPanel panel={panel} />
        </section>
      </main>
    </div>
  )
}

const root = document.getElementById("root")
if (!root) throw new Error("Harness root element is missing")

render(() => <App />, root)
