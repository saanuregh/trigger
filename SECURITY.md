# Security

## Authentication

Authentication is opt-in via OIDC. When `OIDC_ISSUER` is not set, the application has no authentication and should only be deployed behind a VPN or in a private network.

When enabled:
- **OIDC authorization code flow** with PKCE-less confidential client (server-side secret exchange)
- **HMAC-SHA256 signed session cookies** with 24-hour TTL
- **Group-based access control** at both namespace and pipeline level

## Session Security

- Sessions are signed with `SESSION_SECRET` (falls back to `OIDC_CLIENT_SECRET`) via `Bun.CryptoHasher` HMAC-SHA256
- Cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` in production
- No server-side session store — all state is in the signed cookie payload
- Session expiry is checked on every request

## Access Control

- **Namespace ACLs:** Config-defined group lists restrict namespace visibility
- **Pipeline ACLs:** Per-pipeline group overrides for finer-grained control
- **Super admins:** `TRIGGER_ADMINS` emails bypass all access checks
- When auth is disabled, all requests receive a stub super-admin session

## Secrets

- `SESSION_SECRET` — preferred key for session cookie signing (optional, falls back to `OIDC_CLIENT_SECRET`)
- `OIDC_CLIENT_SECRET` — used for OIDC token exchange and as fallback session signing key
- `GITHUB_TOKEN` — used for fetching pipeline configs from private repositories
- `CLOUDFLARE_API_TOKEN` — used for cache purge actions
- AWS credentials — sourced from the standard AWS credential chain (env vars, instance profile, etc.)

These should never be committed to source control. See `.env.example` for reference.

## Reporting a Vulnerability

If you discover a security vulnerability, please report it by opening a private issue or contacting the maintainer directly.
