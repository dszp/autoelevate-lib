# Contributing to `@dszp/autoelevate-lib`

Bug reports, ideas, and pull requests are welcome. The library is small and opinionated; the rules
below are the opinions, and each exists for a concrete reason rather than taste.

## Getting started

**Package manager: pnpm.** No runtime dependencies; please keep it that way.

```
pnpm install
pnpm build         # tsc → dist/
pnpm test          # the offline suite; must pass with NO credentials and no setup
pnpm typecheck     # type-checks the tests and the mock-fetch harness too
pnpm verify        # builds, then imports dist/index.js under Node
```

`pnpm test` must be green on a fresh clone with nothing configured. The live smoke test,
`src/readClient.live.test.ts`, self-skips unless `AUTOELEVATE_TOKEN` is set.

## The rules

### 1. Node-free, and the compiler enforces it

`tsconfig.json` sets `"types": []` and there is no `@types/node`. A stray `node:*` import or a
`Buffer` fails the build. That is the feature: the same file must run in a Cloudflare Worker, Node
20+, and the browser. Reach for `fetch`, `crypto.subtle`, `TextEncoder`, and `URL`. Do not add
`@types/node` to make an error go away.

### 2. The transport stays private

`AutoElevateHttp` is not exported from `src/index.ts`. The read-only guarantee of
`AutoElevateReadClient` is encapsulation: it has no mutating method, and nobody outside the
package can reach the request primitive underneath it. If a write client is ever added, it gets
its own class and its own explicit opt-in; the read client does not grow verbs.

### 3. Fixtures and examples are fictional

Every company, id, and token in code, comments, tests, and the README is invented: `Company 1`,
`PSA-1`, `aeb_test_0000`, `not-a-real-key`. `src/testkit.ts` is the reference. No real tenant
data anywhere, including commit messages and issues. If you need a real value to describe a bug,
describe its shape.

### 4. Completeness over convenience

A walker that cannot prove it collected everything throws rather than returning a short list.
Keep the `totalCount` assertion, keep the runaway guard, and keep the trust limited to the first
page's total (the API reports `0` once `skip` passes the end).

### 5. No automatic retries

The rate limit is 100 requests per hour per method and route. A retry loop inside the library
spends budget the caller needs and hides the fact that it happened. Surface `retryAfterSeconds`;
let the caller's scheduler decide.

### 6. Keep the n8n transport in step

`n8n-nodes-autoelevate` vendors this signing algorithm because verified community nodes cannot
carry dependencies. When `src/auth.ts` or the pagination rules change, change the node's
`transport/request.ts` in the same sitting.

## Releasing

Bump `version` in `package.json`, move the Unreleased section of `CHANGELOG.md` under the new
version, tag `vX.Y.Z`, push, and publish a GitHub Release. The `release-publish` workflow publishes
to npm with provenance via OIDC trusted publishing. The very first publish of a new package must
be done by hand (`pnpm publish --access public`) because npm can only attach a trusted publisher to
a package that already exists.
