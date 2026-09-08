# @dszp/autoelevate-lib

Read-only TypeScript client for the [AutoElevate Partner API (beta)](https://partner-api-docs.autoelevate.com/).
It runs unchanged in a Cloudflare Worker, Node 20+, or the browser: no Node built-ins, only
`fetch` and WebCrypto.

What you get:

- `AutoElevateReadClient`: one typed method per GET endpoint, plus `listAll*` walkers that
  page at the API's maximum and verify the row count against the server's `totalCount`.
- `gatherAgentCounts()`: per-company active-agent counts for billing reconciliation, with an
  MSP-total cross-check against `/usage`.
- `signRequest()`: builds the `Authorization` header for both key schemes (Bearer and
  HMAC-SHA256), usable on its own from an n8n HTTP node or a script.

The two write endpoints (approve and deny an elevation request) are not implemented. Create
the API key without the `requestEdit` scope and the API enforces the same boundary.

> The Partner API is in beta and can change without notice. Every request carries the
> required `X-Acknowledgment: i-understand-this-is-beta-and-may-change` header. The library
> pins `/api/v1/` paths and surfaces `Deprecation` and `Sunset` headers when the API sends them.

## Install

```bash
pnpm add @dszp/autoelevate-lib
```

## Create an API key

1. In the AutoElevate admin portal, open **Users** and create a **service user** for the
   integration. Do not attach keys to a person's account.
2. In that user's **API Keys** section, add a key. Pick **API Token (AE-BEARER)** unless you
   need request signing; **HMAC (AE-HMAC-SHA256)** shows two values, a wire `token` and a
   separate `hmacKey`.
3. Grant only the scopes you need (table below). Set the shortest expiry that fits.
4. Copy the secret immediately. It is shown once.

Store the value in a secrets manager (Worker secret, 1Password, etc.), never in source.

| Method | Scope |
|---|---|
| `getUsage`, `listComputers`, `getComputer` | `computerView` |
| `listCompanies`, `getCompany` | `companyView` |
| `listLocations`, `getLocation` | `locationView` |
| `listElevationRequests`, `getElevationRequest` | `requestView` |
| `listElevationEvents` | `eventView` |
| `listElevatedSessions`, `getElevatedSession` | `elevatedSessionView` |
| `listElevationRules` | `ruleView` |
| `listAuditLogs` | `auditLogView` (may also require Early Access enrolment) |
| `gatherAgentCounts` | `computerView` + `companyView` |

## Use it in a Worker

```ts
import { AutoElevateReadClient, gatherAgentCounts } from '@dszp/autoelevate-lib';

export default {
  async fetch(_req: Request, env: { AUTOELEVATE_TOKEN: string }) {
    const client = new AutoElevateReadClient({
      credential: { scheme: 'bearer', token: env.AUTOELEVATE_TOKEN },
    });
    const report = await gatherAgentCounts(client);
    return Response.json(report);
  },
};
```

For an HMAC key, pass `{ scheme: 'hmac', token, hmacKey }` instead, with `hmacKey` exactly as
the portal showed it. The signature covers the method, the request-target (path and query
string, without the host), a SHA-256 of the body, and a millisecond timestamp. The server
rejects timestamps more than five minutes from its own clock. Verified against the live API
on 2026-09-08: signing the absolute URL is rejected with `Invalid signature`.

## Billing counts

`gatherAgentCounts(client)` returns:

```ts
{
  gatheredAt: 1757360000000,
  msp: { partnerId, partnerName, fromUsage: 142, fromComputers: 142, agree: true },
  companies: [
    {
      companyId, companyName, managementSystemCompanyId,  // PSA-side key when a PSA created it
      activeAgents: 37,
      byElevationMode: { audit: 2, live: 35, policy: 0, technicianBypass: 0, unknown: 0 },
    },
    // ...sorted by company name; companies with zero agents are present with 0
  ],
}
```

How it works, and why:

- `/computers` returns only computers that checked in within the **last 30 days**. That
  window is what AutoElevate calls the active fleet, so its `totalCount` is the billable
  figure, not the inventory.
- There is no per-company count endpoint. The helper walks `/computers` once, unfiltered, at
  200 rows per page and buckets by `companyId` in memory. For N computers and C companies
  that costs `ceil(N/200) + ceil(C/200) + 1` requests. Filtering by company would cost one
  request per client.
- `/usage` reports `totalActiveAgents` from a periodically refreshed snapshot. `agree` is
  `false` when it differs from the live walk. A difference of a few units is snapshot lag;
  a large one is worth investigating.
- A computer whose company the key cannot see (restricted-company keys) still counts, in a
  row with `companyName: null`.

`bucketAgents(companies, computers)` is exported separately if you already have the rows.

## Pagination and completeness

Offset lists (`take`/`skip`) return `{ items, totalCount }`. The API reports `totalCount: 0`
once `skip` is past the end, so a zero on a later page does not mean the collection is empty.
The `listAll*` walkers trust only the first page's `totalCount`, stop on a short page, and
throw `IncompleteListError` if the rows collected differ from that total. A runaway guard
(200 pages by default, `maxPages` to override) stops a walk against a server that ignores
`skip`.

`/audit-logs` uses a cursor instead; `listAllAuditLogs` follows `nextCursor` until
`hasMore` is false and applies the same completeness check.

## Rate limits and errors

Limits are **100 requests per hour per HTTP method and route**, in one sliding window. A
429 arrives as `AutoElevateApiError` with `isRateLimited === true` and `retryAfterSeconds`
set from the `Retry-After` header. The library does not retry on its own: with a budget that
small, a retry loop spends what the caller needs. Decide in your scheduler.

Every failure is an `AutoElevateApiError` with `status`, `method`, `path`, and the parsed
error body. Messages for 400, 401, 403, and 429 add a one-line hint about the likely cause
(missing acknowledgment header, expired key, missing scope or Early Access, rate limit).

## Timestamps

Every time field is epoch **milliseconds**. `ElevatedSession.endedAt` is the scheduled end,
set at creation and not updated if the session ends early.

## Development

```bash
pnpm install
pnpm test          # offline suite (mock fetch)
pnpm typecheck
pnpm verify        # build, then import dist/index.js under Node
```

Run the live smoke test against your own tenant with a short-lived read-only key. It costs a
handful of requests from the hourly buckets:

```bash
AUTOELEVATE_TOKEN=aeb_... pnpm test
# HMAC instead:
AUTOELEVATE_TOKEN=aeh_... AUTOELEVATE_HMAC_KEY=... pnpm test
```

The OpenAPI document this library was written against is vendored in
`reference/AutoElevate Partner API Beta.json` (downloaded 2026-09-08 from the
[Partner API reference](https://partner-api-docs.autoelevate.com/)). Types are hand-written
from it, not generated.

## Related

`n8n-nodes-autoelevate` exposes the same surface as an n8n community node. It vendors its own
copy of the transport because verified community nodes cannot carry runtime dependencies;
this repository's `src/auth.ts` is the reference implementation of the signing algorithm.

## License

MIT
