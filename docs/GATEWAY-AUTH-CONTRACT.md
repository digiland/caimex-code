# Caimex gateway — device-login auth contract

The CLI ships a login flow (`src/plugin/caimex.ts`) that lets users authenticate
without manually handling API keys. It implements the **RFC 8628 OAuth 2.0
Device Authorization Grant**. This document is the contract the **gateway must
implement** for the browser ("Login with Caimex") option. The "Paste an API key"
option needs nothing here — it just stores a key the user already has.

> Status: **implemented on both sides.** The CLI calls these endpoints
> (`src/plugin/caimex.ts`); the gateway implements them in
> `app/auth/device_router.py` (endpoints) + a `/activate` page in `caimexUI`.
> This doc remains the source of truth for the wire contract.

## Endpoints

By default the CLI derives endpoint URLs from the gateway base URL:

| Purpose            | Method | Default URL                              | Override env var          |
| ------------------ | ------ | ---------------------------------------- | ------------------------- |
| Start device login | POST   | `${CAIMEX_GATEWAY_URL}/api/auth/device/code` | `CAIMEX_DEVICE_CODE_URL`  |
| Poll for token     | POST   | `${CAIMEX_GATEWAY_URL}/api/auth/device/token`| `CAIMEX_DEVICE_TOKEN_URL` |

`CAIMEX_GATEWAY_URL` defaults to `http://localhost:8240` (note: **not** the
`/v1` base — these live at the gateway root). Point it at your deployed gateway.

All requests send `Content-Type: application/json` and
`User-Agent: caimex/<version>`.

### 1. `POST /api/auth/device/code` — start login

Request body:

```json
{ "client_id": "caimex-code", "scope": "gateway" }
```

Response `200`:

```json
{
  "device_code": "long-opaque-secret-bound-to-this-attempt",
  "user_code": "WDJB-MJHT",
  "verification_uri": "https://caimex.your-org.com/activate",
  "verification_uri_complete": "https://caimex.your-org.com/activate?code=WDJB-MJHT",
  "expires_in": 900,
  "interval": 5
}
```

- `device_code` — opaque secret the CLI polls with (never shown to the user).
- `user_code` — short human code the user types into the web page.
- `verification_uri` — page the user opens; `verification_uri_complete` (optional)
  pre-fills the code. The CLI opens the `_complete` form if present.
- `expires_in` — seconds until `device_code` expires (CLI stops polling).
- `interval` — seconds the CLI waits between polls.

### 2. `POST /api/auth/device/token` — poll for the key

Request body (sent every `interval` seconds):

```json
{
  "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
  "client_id": "caimex-code",
  "device_code": "the-device_code-from-step-1"
}
```

**While the user hasn't finished** — respond `400` (or `428`) with one of:

```json
{ "error": "authorization_pending" }   // keep polling at current interval
{ "error": "slow_down" }               // back off (+5s) and keep polling
```

**Terminal errors** — respond `400`:

```json
{ "error": "access_denied" }    // user rejected
{ "error": "expired_token" }    // device_code expired
```

**On success** — respond `200` with the issued gateway API key. Any one of
these field names is accepted (`api_key` preferred):

```json
{ "api_key": "sk-or-v1-...", "token_type": "bearer" }
```

The CLI stores that key in `~/.config/caimex-code/auth.json` and sends it to the
gateway as `Authorization: Bearer <key>` on every `/v1` request — identical to a
key the user would paste manually.

## The web side (`verification_uri`)

A page where a signed-in Caimex user:

1. enters (or has pre-filled) the `user_code`,
2. approves the login,

which causes the backend to mark the matching `device_code` as authorized and
mint an API key bound to that user. The next `/api/auth/device/token` poll then
returns that key.

## Security notes

- Bind `device_code` to the originating request; expire it at `expires_in`.
- Treat `user_code` as short-lived and single-use; rate-limit activation
  attempts to resist guessing.
- Rate-limit the token endpoint per `device_code`; honor the polling `interval`.
- Issue the **minimum-scope** key your gateway model allows, and record which
  user/device it was minted for so it can be revoked.

## How the CLI consumes it

- `packages/opencode/src/plugin/caimex.ts` — `requestDeviceCode()` +
  `pollDeviceToken()` implement the client side.
- On success the key is saved as provider `caimex` auth; the plugin's `loader`
  injects it as the provider's `options.apiKey`.
- Users trigger it with the provider login command (e.g. `caimex auth login`)
  and pick **"Login with Caimex"**, or **"Paste a Caimex API key"** for the
  manual path.
