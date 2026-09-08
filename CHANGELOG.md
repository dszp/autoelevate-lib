# Changelog

All notable changes to `@dszp/autoelevate-lib` are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `AutoElevateWriteClient` with `approveElevationRequest` and `denyElevationRequest` (`requestEdit`
  scope), client-side payload validation (`AutoElevateValidationError`), and a 409 hint.
- `post()` on the private transport; the JSON body is serialised once and the same bytes are hashed
  for HMAC and sent.

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
