# Authentication & Authorization

## Overview

TermCast uses **token-based authentication**. There is no cookie/session layer — identity is
established by bearer tokens that the client presents on every request. Three token kinds exist:

- **Owner tokens** — prove the caller owns the server. Stored client-side in `localStorage` and sent
  as `Authorization: Bearer` on API calls (or as a `?token=` query param on WebSocket upgrades, since
  browsers can't set headers there). Opaque, server-side, in-memory.
- **Grant tokens** — short-lived JWTs (HS256) signed with `sessionEncryptionKey`. Minted out-of-band
  (the `termcast grant` CLI or the `auth.link` procedure) and exchanged for an owner token.
  They are the bootstrap path when no owner token exists yet (e.g. a fresh install or a new device).
- **Share tokens** — scoped, per-terminal guest links. Carry an `allowWrite`/`maxConnections` policy
  and bind to a specific tab.

A single **server secret** (`sessionEncryptionKey`, persisted in settings) signs grant tokens. It is
never exposed to clients.

## Trust model

A request resolves to one of:

| Role                | How it's established                                                            |
| ------------------- | ------------------------------------------------------------------------------- |
| **Guest**           | Presents a valid share token (per-terminal guest link).                         |
| **Verified owner**  | Presents a valid owner token (obtained via WebAuthn login or a grant exchange). |
| **Unauthenticated** | No owner token. Only unauthenticated endpoints are reachable (see below).       |

There is no longer a "trusted/loopback" tier — a request is either an owner, a guest, or blocked.
The `base` middleware (`orpc/middleware.ts`) computes only:

```
verified = verifyOwnerToken(token)
```

Protected procedures call `requireVerified`, which throws `UNAUTHORIZED` when `verified` is false.
This is the single gate for all dashboard/settings/device/command/share/tab/tunnel operations.

`UserInfo` still carries `isLocalhost` and `needsSetup` (consumed by the web UI for display/setup
gating), but neither participates in the `verified` decision anymore.

### Unauthenticated endpoints

A caller with no owner token can reach only:

- `setup.configure({ settings })` — persists the first-run settings. Requires a verified owner token,
  so a fresh server is first bootstrapped via a `termcast grant` URL (exchanged at `auth.token`) before
  setup can run.
- `auth.token({ grant })` — exchanges a grant token for an owner token.
- WebAuthn **registration** options (`webauthn.registration.options`) are gated by `requireVerified`.
  WebAuthn **authentication** options (`webauthn.authentication.options`) are intentionally unauthenticated —
  that procedure is the login path that _issues_ an owner token, so it must be reachable without one.

In practice, bringing a fresh install (or a new device) online means running `termcast grant` to mint
a grant token, then opening the resulting URL so the client exchanges it for an owner token.

## Client auth flow

1. On load the client calls `ensureToken()`. If the URL carries `?grant=<token>`, it is exchanged at
   `auth.token({ grant })` for an owner token, then stripped from the URL. Otherwise an existing
   stored token is renewed.
2. The owner token is cached in `localStorage` and attached as `Bearer` on every `/rpc` call.

The data channels those tokens unlock, and how state is streamed back, are described in
[architecture.md](./architecture.md).

## Token lifecycle

- **Owner issuance** — by finishing WebAuthn login, or by exchanging a grant token at `auth.token`.
- **Owner storage** — owner tokens live in an **in-memory** `TokenProvider` (7-day TTL). They are not
  persisted to the database.
- **Owner revocation** — logout deletes the owner token. Replacing `sessionEncryptionKey` (via the
  setup screen's session key field; client-generated, persisted on confirm) invalidates all grant
  tokens (they can no longer be verified) but does **not** retroactively invalidate already-issued
  owner tokens.
- **Grant tokens** — stateless JWTs (5-minute TTL), signed with `sessionEncryptionKey`. They are not
  single-use; the TTL is the only expiry. Because they are stateless, a grant minted before a restart
  still verifies afterward (as long as `sessionEncryptionKey` is unchanged and it hasn't expired).
- **Share tokens** — in-memory, keyed to their tab; they lapse with the tab.
- **Restart behavior** — in-memory owner/share tokens are dropped on restart. An owner must
  re-authenticate via WebAuthn or a fresh grant token; there is no loopback auto-reissue anymore.

## Discrepancies

- `sessionEncryptionKey` is documented in the shared schema as _"the auth-token signing secret."_ It
  signs the **grant token** (JWT), not the owner token. Owner tokens remain opaque random values
  verified by in-memory store lookup (by design, for now) — the signing relationship is wired up for
  grants but not for owner tokens. The doc above describes the implemented behavior.
- Owner/share tokens are in-memory only — there is no DB table for them, so they do not survive a
  restart. Grant tokens, being stateless JWTs, do survive a restart within their TTL.
