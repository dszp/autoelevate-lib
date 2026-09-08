# Architecture

Why this library is shaped the way it is. For the rules of contributing, see
[CONTRIBUTING.md](./CONTRIBUTING.md).

## Module boundaries

| File | Role | Ships? |
|---|---|---|
| `model.ts` | Types hand-derived from the vendored OpenAPI document; `Page<T>`, `CursorPage<T>`, list filter options. | ✅ |
| `auth.ts` | `Credential` shapes, `resolveScheme`, `signRequest`, the HMAC canonical string, the beta acknowledgment constants. Pure functions over WebCrypto. | ✅ |
| `http.ts` | `AutoElevateHttp` transport and `AutoElevateApiError`. The one choke point. **Not exported.** | ✅ |
| `readClient.ts` | `AutoElevateReadClient`: one method per GET endpoint plus `listAll*` walkers and `IncompleteListError`. Holds the transport privately. | ✅ |
| `writeClient.ts` | `AutoElevateWriteClient`: `approveElevationRequest` and `denyElevationRequest`, with client-side payload validation (`AutoElevateValidationError`) before the request is sent. Holds its own transport privately. | ✅ |
| `counts.ts` | `gatherAgentCounts` and the pure `bucketAgents`: per-company active-agent counts. | ✅ |
| `index.ts` | Public barrel: everything above except `AutoElevateHttp`. | ✅ |
| `testkit.ts` | Recording mock `fetch` that rejects a missing acknowledgment header with the API's own 400. **Excluded from the build.** | dev |
| `*.test.ts` | vitest units; `readClient.live.test.ts` is env-gated. **Excluded from the build.** | dev |

## The read-only guarantee is encapsulation

The Partner API has two write endpoints, both `POST`. The read client never issues anything but
`GET`, and it is the only thing that can reach `AutoElevateHttp`. The write client is the only
sanctioned way in, it is a separate import, and both clients hold their own private transport.

## Signing

Both schemes produce one `Authorization` header from `signRequest(credential, method, url, body)`.
The HMAC canonical string is five lines joined by `\n`:

```
AE-HMAC-SHA256
<METHOD>
<request-target>        path plus query string, no scheme or host
<sha256 hex of body>    the documented constant for an empty body
<epoch milliseconds>
```

The documentation calls the third line "the full URL"; the server signs the request-target.
`hmacStringToSign` reduces an absolute URL to its request-target so both forms sign identically,
and `http.test.ts` pins the signed target to what is fetched. The signing key is used as the raw
UTF-8 bytes of the 64-character hex string the portal displays, not hex-decoded.

## Pagination

Offset lists take `take` (max 200) and `skip`, and answer `{ items, totalCount }`. `totalCount`
becomes `0` once `skip` is past the end, so a walker trusts only the first page's total. The walk
stops on a short page or when the collected count reaches that total, and throws
`IncompleteListError` if the two disagree. A runaway guard (200 pages) protects against a server
that ignores `skip`. `/audit-logs` is cursor-paginated and walks `nextCursor` until `hasMore` is
false, with the same completeness check.

## Why counts are computed client-side

There is no per-company count endpoint. `/usage` gives one MSP-wide `totalActiveAgents` from a
periodically refreshed snapshot; `/computers` returns the 30-day active fleet with a `companyId`
on every row. Filtering `/computers` per company would cost one request per client from a
100-per-hour bucket. Walking it once unfiltered and bucketing in memory costs
`ceil(computers/200) + ceil(companies/200) + 1` requests for the whole MSP, and the two totals
cross-check each other for free.
