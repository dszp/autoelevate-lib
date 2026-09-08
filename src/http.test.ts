import { describe, it, expect } from 'vitest';
import { AutoElevateApiError, AutoElevateHttp } from './http.js';
import { ACKNOWLEDGMENT_HEADER, ACKNOWLEDGMENT_VALUE } from './auth.js';
import { mockFetch, TEST_BEARER, TEST_HMAC } from './testkit.js';

describe('AutoElevateHttp', () => {
  it('refuses a non-HTTPS base URL', () => {
    expect(() => new AutoElevateHttp({ credential: TEST_BEARER, baseUrl: 'http://x' })).toThrow(/HTTPS/);
  });

  it('sends the acknowledgment header, Bearer auth, and the pinned v1 prefix; drops undefined query', async () => {
    const f = mockFetch({ responses: [{ body: { ok: true } }] });
    const http = new AutoElevateHttp({ credential: TEST_BEARER, fetchImpl: f.fetchImpl, baseUrl: 'https://x/' });
    const res = await http.get('/computers', { take: 200, skip: 0, companyId: undefined });
    expect(res.body).toEqual({ ok: true });
    const call = f.calls[0]!;
    expect(call.target).toBe('/api/v1/computers?take=200&skip=0');
    expect(call.headers[ACKNOWLEDGMENT_HEADER]).toBe(ACKNOWLEDGMENT_VALUE);
    expect(call.headers.Authorization).toBe('Bearer aeb_test_0000');
  });

  it('hmac: signs the exact URL that is fetched', async () => {
    const f = mockFetch({ responses: [{ body: {} }] });
    const http = new AutoElevateHttp({ credential: TEST_HMAC, fetchImpl: f.fetchImpl, nowMs: () => 1700000000000 });
    await http.get('/usage');
    expect(f.calls[0]!.headers.Authorization).toMatch(/^AE-HMAC-SHA256 token=aeh_test_0000,bodyHash=e3b0c442/);
  });

  it('normalises an API error body and surfaces Retry-After on 429', async () => {
    const f = mockFetch({
      responses: [
        {
          status: 429,
          body: { name: 'TooManyRequests', message: 'Rate limit exceeded', statusCode: 429 },
          headers: { 'Retry-After': '1800' },
        },
      ],
    });
    const http = new AutoElevateHttp({ credential: TEST_BEARER, fetchImpl: f.fetchImpl });
    const err = await http.get('/usage').catch((e) => e);
    expect(err).toBeInstanceOf(AutoElevateApiError);
    expect(err.status).toBe(429);
    expect(err.isRateLimited).toBe(true);
    expect(err.retryAfterSeconds).toBe(1800);
    expect(err.path).toBe('/api/v1/usage');
    expect(err.message).toMatch(/429: Rate limit exceeded/);
  });

  it('403 on audit logs names the Early Access cause', async () => {
    const f = mockFetch({ responses: [{ status: 403, body: { name: 'Forbidden', message: 'nope', statusCode: 403 } }] });
    const http = new AutoElevateHttp({ credential: TEST_BEARER, fetchImpl: f.fetchImpl });
    await expect(http.get('/audit-logs')).rejects.toThrow(/Early Access/);
  });

  it('falls back to raw text on a non-JSON error page', async () => {
    const f = mockFetch({ responses: [{ status: 502, rawBody: '<html>bad gateway</html>' }] });
    const http = new AutoElevateHttp({ credential: TEST_BEARER, fetchImpl: f.fetchImpl });
    const err = await http.get('/usage').catch((e) => e);
    expect(err.status).toBe(502);
    expect(err.body).toBe('<html>bad gateway</html>');
  });

  it('captures deprecation headers', async () => {
    const f = mockFetch({
      responses: [{ body: {}, headers: { Deprecation: 'true', Sunset: 'Sat, 01 Jan 2028 00:00:00 GMT', Link: '</api/v2/usage>; rel="successor-version"' } }],
    });
    const http = new AutoElevateHttp({ credential: TEST_BEARER, fetchImpl: f.fetchImpl });
    const res = await http.get('/usage');
    expect(res.deprecation).toEqual({
      deprecated: true,
      sunset: 'Sat, 01 Jan 2028 00:00:00 GMT',
      successor: '</api/v2/usage>; rel="successor-version"',
    });
  });
});
