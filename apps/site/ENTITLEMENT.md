# The app's entitlement contract

How the Fineframe desktop app signs a user in and decides whether they may use it. The website and Supabase implement the server side; the app implements the steps below.

## What the app is built with

All three are public; none is a secret.

| Value | Production | Local stack (`supabase start`) |
|---|---|---|
| `FINEFRAME_SUPABASE_URL` | `https://nvpwglzrjiikoawpjaak.supabase.co` | `http://127.0.0.1:54321` |
| `FINEFRAME_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_HlA6CkJjvqKysmpVgjZRdg_IM40gwBj` | printed by `supabase status` |
| `FINEFRAME_OAUTH_CLIENT_ID` | `e0da4b8b-53ee-4569-b3f2-43cbe748f8b9` | printed when you register it, below |

The OAuth app is a **public** client (no secret, `token_endpoint_auth_method: none`) whose redirect URIs are exactly these three:

```
http://127.0.0.1:47821/callback
http://127.0.0.1:47822/callback
http://127.0.0.1:47823/callback
```

Supabase matches a redirect URI exactly, port included, so the app listens on the first of these ports that is free. To register it on the local stack:

```bash
curl -X POST http://127.0.0.1:54321/auth/v1/admin/oauth/clients \
  -H "apikey: <SECRET_KEY from supabase status>" \
  -H "Authorization: Bearer <SECRET_KEY from supabase status>" \
  -H 'Content-Type: application/json' \
  -d '{"client_name":"Fineframe","client_type":"public","redirect_uris":["http://127.0.0.1:47821/callback","http://127.0.0.1:47822/callback","http://127.0.0.1:47823/callback"]}'
```

## Signing in

Supabase Auth's OAuth 2.1 server, with the authorization code flow and PKCE ([RFC 8252](https://datatracker.ietf.org/doc/html/rfc8252) loopback redirect).

1. Listen on `127.0.0.1` on the first free port of 47821, 47822 and 47823. The redirect URI is `http://127.0.0.1:<port>/callback`.
2. Make a `code_verifier` (32 random bytes, base64url without padding), its `code_challenge` (the SHA-256 of the verifier, base64url without padding) and a random `state`.
3. Open the system browser at:
   ```
   <FINEFRAME_SUPABASE_URL>/auth/v1/oauth/authorize?response_type=code&client_id=<FINEFRAME_OAUTH_CLIENT_ID>&redirect_uri=<redirect URI>&state=<state>&code_challenge=<code_challenge>&code_challenge_method=S256
   ```
   Supabase sends the browser to `https://fineframe.app/authorize/`. There the user signs in (email and password, or Google) or is already signed in, and confirms. The browser then comes back to the redirect URI.
4. The callback has `?code=<code>&state=<state>` when the user confirmed, or `?error=<error>&error_description=<text>&state=<state>` when they cancelled. Reject it if `state` differs. Answer the browser with a short page saying to return to the app, then close the listener.
5. Exchange the code within 10 minutes; it works once:
   ```
   POST <FINEFRAME_SUPABASE_URL>/auth/v1/oauth/token
   Content-Type: application/x-www-form-urlencoded

   grant_type=authorization_code&code=<code>&client_id=<FINEFRAME_OAUTH_CLIENT_ID>&redirect_uri=<redirect URI>&code_verifier=<code_verifier>
   ```
   The answer is JSON with `access_token` (a Supabase JWT whose `sub` is the user's id), `refresh_token`, `expires_in` (seconds) and `token_type: "bearer"`.
6. Keep the refresh token private to the user (the Fineframe app uses a file only its owner can read). Before the access token expires, refresh it; each refresh returns a new refresh token, which replaces the old one:
   ```
   POST <FINEFRAME_SUPABASE_URL>/auth/v1/oauth/token
   Content-Type: application/x-www-form-urlencoded

   grant_type=refresh_token&refresh_token=<refresh_token>&client_id=<FINEFRAME_OAUTH_CLIENT_ID>
   ```
   A `400` or `401` answer means the session has ended: sign in again.
7. To sign out, delete the stored tokens.

## Reading the switch and the subscription

First, whether Fineframe charges yet:

```
GET <FINEFRAME_SUPABASE_URL>/rest/v1/app_config?select=billing_enabled
apikey: <FINEFRAME_SUPABASE_PUBLISHABLE_KEY>
Authorization: Bearer <access_token>
```

The answer is `[{"billing_enabled": false}]` during the free public beta, and `true` once paid plans open. Anyone may read it, signed in or not.

Then, when it is `true`, the user's subscription:

```
GET <FINEFRAME_SUPABASE_URL>/rest/v1/subscriptions?select=status,plan,current_period_end,cancel_at
apikey: <FINEFRAME_SUPABASE_PUBLISHABLE_KEY>
Authorization: Bearer <access_token>
```

Row-level security returns only the signed-in user's row: a JSON array with one row, or `[]` when they have never subscribed.

| Column | Type | Meaning |
|---|---|---|
| `status` | text | Paddle's status: `active`, `trialing`, `past_due`, `paused` or `canceled` |
| `plan` | text | `monthly` or `yearly` |
| `current_period_end` | ISO 8601 timestamp or `null` | the end of the period paid for |
| `cancel_at` | ISO 8601 timestamp or `null` | when a cancellation the user scheduled takes effect |

## The rule

While `billing_enabled` is `false`, every signed-in user is entitled.

While it is `true`, the user is entitled while **either**:

- `status` is `active`, `trialing` or `past_due`; **or**
- `status` is `canceled` and `current_period_end` is later than now.

Otherwise, and when the subscriptions array is empty, they are not: the app shows that a subscription is needed, with a link to `https://fineframe.app/<locale>/pricing/`. The account page is `https://fineframe.app/<locale>/account/`, with `<locale>` `en` or `zh-tw`.

A user who cancels keeps `status` `active`, with `cancel_at` set, until the period ends; Paddle then changes the status to `canceled`.
