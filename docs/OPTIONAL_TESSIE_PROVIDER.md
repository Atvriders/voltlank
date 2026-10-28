# Optional Tessie provider

Tessie is a third-party Tesla data service. VoltLink includes an optional
adapter so an operator who prefers Tessie's API can use it instead of (or
alongside) the official Fleet API provider.

## Status: optional adapter

- No Tessie SDK is required at build time — the adapter is a small HTTP client
  over `TESSIE_BASE_URL`.
- Configure nothing and the Tessie panel stays dormant; the rest of the
  platform is unaffected.

## Setup

1. Sign up at <https://tessie.com>, generate an access token, and (optionally)
   register a webhook that delivers refreshed tokens to:

   ```
   POST https://<your-voltlink-host>/api/v1/providers/tessie/webhook
   ```

2. In VoltLink: **Providers → Tessie → Connect** and paste the token.
3. **Import vehicles**.

## Command mapping

The adapter maps VoltLink commands onto Tessie's command endpoints
(`lock`, `unlock`, `honk`, `flash`, `charge start/stop`, `wake`, …) with the
same capability checks and lifecycle outcomes as the official provider.

## Base URL

`TESSIE_BASE_URL` defaults to `https://api.tessie.com`; set it if Tessie
documents a regional or custom endpoint.
