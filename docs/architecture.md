# Architecture — FE/BE data flow

This document describes how the web front-end (FE) and the host back-end (BE) communicate: the
transports, the initial load, and the live update stream. The token model that gates every channel
is covered separately in [auth.md](./auth.md).

## Transports

TermCast uses two transports:

- **oRPC over HTTP** (`/rpc`) for request/response — dashboard load, mutations, and the auth exchange.
- **WebSockets** for streaming — `/realtime` (owner dashboard state) and `/ws` (terminal PTY).

## Channels

### oRPC `/rpc`

The HTTP `Authorization: Bearer` header is extracted in `routes/index.ts` (`buildApp`) and placed
on the oRPC `InitialContext`. The shared `base` middleware verifies the owner token as described in
auth.md.
Owner-only procedures require `verified`.

Key procedures for the data flow:

- `setup.configure({ settings })` — persists first-run settings; requires a verified owner token (on a fresh server the owner token is obtained via a `termcast grant` URL before setup).
- `dashboard.get` — the initial owner state (see [Initial load](#initial-load)).
- `auth.token({ grant })` — exchanges a grant token for an owner token.
- Mutations: tabs / commands / devices / settings / tunnel operations.

### `/realtime` (owner dashboard state)

A live mirror of server state. **Owner-only**: the upgrade is rejected with a real `403 Forbidden`
unless a valid owner token is supplied as `?token=`.

On connect the server sends a full `snapshot`:

```json
{ "type": "snapshot", "state": "<ServerState>" }
```

then streams incremental events as state changes:

- `tabs.upsert` / `tabs.remove`
- `commands.upsert` / `commands.remove`
- `devices.upsert` / `devices.remove`
- `settings`
- `tunnel`

The wire shapes (`ServerState`, `RealtimeEvent`, `TabInfo`, `DeviceInfo`) are defined in
`packages/shared/src/` and are the contract source of truth.

**Server side:** state mutations emit on an in-process event bus (`core/events.ts`);
`routes/realtime.ts` subscribes once and fans each event out to every connected dashboard socket.
Emit sites (router, tab registry, pty) never import the transport.

### `/ws` (terminal PTY)

The terminal channel. Identity is resolved **before** the upgrade:

- **Owner** — valid owner token → its bound tab.
- **Guest** — valid share token → its bound tab.

After the upgrade the client sends only `{ type: "term.init", data: { since? } }`. Guests receive
terminal output plus `term.access`/connection updates only.

## Initial load

`GlobalState.load()` calls `dashboard.get`, which returns a `ServerState`:

```
user, tunnel, settings, tabs, devices, commands
```

This is the same shape delivered by the `/realtime` `snapshot`, so the dashboard can render
immediately and then let realtime events take over.

## Live sync

Once a `/realtime` socket is open, the server pushes the `RealtimeEvent` union above. The FE
maintains its `GlobalState` by applying the snapshot and then each incremental event (upsert/remove
by id, replace `settings`/`tunnel`).

## WebSocket auth

A WebSocket handshake cannot carry an `Authorization` header, so the token travels in the upgrade
URL query — `?token=<ownerToken>` for `/realtime`, and `?token=<ownerToken>` or `?token=<shareToken>`
for `/ws` — mirroring the oRPC bearer model. Unauthorized upgrades are rejected with `403` before the
handshake completes.

## Current web client status

- The web calls `dashboard.get` in `GlobalState.load()` to populate the initial dashboard.
- The `/realtime` subscriber is implemented in `packages/web/src/lib/realtime.ts` and wired into
  `GlobalState.load()` (and `ensureConnected()` after sign-in). It applies the server `snapshot` and
  then each incremental event onto `GlobalState`, keeping the dashboard live.
- The web derives its tabs from the `tabs` field of `ServerState`/`TabInfo` (the `connections` field
  on `GlobalState` is web-local per-tab WebSocket status, not a server field).
