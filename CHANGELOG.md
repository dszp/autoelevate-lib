# Changelog

All notable changes to `@dszp/autoelevate-lib` are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] — 2026-09-10

### Added

- `AutoElevateWriteClient` with `approveElevationRequest` and `denyElevationRequest` (`requestEdit`
  scope), client-side payload validation (`AutoElevateValidationError`, `validateApprovePayload`,
  `validateDenyPayload`), and a 409 hint scoped to the elevation-request routes.
- `post()` on the private transport; the JSON body is serialised once and the same bytes are hashed
  for HMAC and sent.
- Env-gated live test for the write path that expects `409` against an already-decided request and
  refuses to run against a `PENDING` one.

### Changed

- Both clients now hold the transport in an ES `#private` field, so the request primitive is
  unreachable from plain JavaScript as well as from TypeScript. The read client's method set is
  pinned by an exact inventory test.
- `denialReason` length is checked in UTF-16 code units (`.length`), matching a JavaScript server
  validator.

### Verified against the live API

- The node built on this transport approved and denied real requests, created rules, and set an
  elevation type on 2026-09-10; a second action on a decided request returned `409`.

## [0.1.1] — 2026-09-08

### Changed

- First release published through GitHub Actions with npm provenance (OIDC trusted publishing).
  No code changes from 0.1.0.

## [0.1.0] — 2026-09-08

### Added

- `AutoElevateReadClient` covering all 15 GET endpoints of the Partner API (beta), with `listAll*`
  walkers that page at 200 rows and throw `IncompleteListError` when the rows collected differ
  from the server's `totalCount`.
- `signRequest()` for both key schemes. HMAC (AE-HMAC-SHA256) is inferred when `hmacKey` is
  present; Bearer (AE-BEARER) otherwise. A token prefix that contradicts the scheme is rejected.
- `gatherAgentCounts()` and `bucketAgents()` for per-company active-agent counts with an MSP
  cross-check against `/usage`.
- `AutoElevateApiError` with `retryAfterSeconds` on 429 and plain-language hints for 400/401/403.
- Offline vitest suite with a recording mock `fetch`; env-gated live smoke test.

### Verified against the live API

- The HMAC signature is computed over the request-target (path plus query), not the absolute URL
  the documentation describes. Signing the absolute URL returns `401 Invalid signature`.
