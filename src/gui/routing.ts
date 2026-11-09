/**
 * Resolve RPC calls through the routed session's own server client.
 *
 * `ctx.client` is always the desktop sidecar, which is the wrong server for a
 * session connected elsewhere. Every request must read the current session's
 * `server.client`; a restart or re-authentication replaces that client under
 * the same server id, so the value must never be cached across calls.
 */

export interface SessionRouteSource<Client> {
  readonly directory: string
  readonly server: {
    readonly id: string
    readonly client: Client
  }
}

export interface SessionRoute<Client> {
  readonly directory: string
  readonly serverId: string
  readonly client: Client
}

export function sessionRoute<Client>(session: SessionRouteSource<Client>): SessionRoute<Client> {
  return {
    directory: session.directory,
    serverId: session.server.id,
    client: session.server.client,
  }
}
