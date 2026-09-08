import { describe, it, expect } from 'vitest';
import { AutoElevateReadClient, IncompleteListError } from './readClient.js';
import { fakeComputer, mockFetch, pagedHandler, TEST_BEARER } from './testkit.js';
import * as barrel from './index.js';

function client(f: ReturnType<typeof mockFetch>) {
  return new AutoElevateReadClient({ credential: TEST_BEARER, fetchImpl: f.fetchImpl });
}

describe('AutoElevateReadClient', () => {
  it('builds filter queries and encodes path ids', async () => {
    const f = mockFetch({ responses: [{ body: { items: [], totalCount: 0 } }, { body: { id: 'a b' } }] });
    const c = client(f);
    await c.listElevationRequests({ companyId: 'c1', approvalState: 'PENDING', start: 1, end: 2, take: 10 });
    await c.getCompany('a b');
    expect(f.calls[0]!.target).toBe('/api/v1/elevation-requests?take=10&companyId=c1&approvalState=PENDING&start=1&end=2');
    expect(f.calls[1]!.target).toBe('/api/v1/companies/a%20b');
  });

  it('rejects take outside 1..200 before making a request', async () => {
    const f = mockFetch();
    await expect(client(f).listCompanies({ take: 201 })).rejects.toThrow(RangeError);
    expect(f.calls).toHaveLength(0);
  });

  it('listAllComputers walks at take=200 and returns exactly totalCount rows', async () => {
    const rows = Array.from({ length: 450 }, (_, i) => fakeComputer(i, i % 3));
    const f = mockFetch({ handler: pagedHandler('/computers', rows) });
    const out = await client(f).listAllComputers();
    expect(out).toHaveLength(450);
    expect(f.calls.map((c) => c.target)).toEqual([
      '/api/v1/computers?take=200&skip=0',
      '/api/v1/computers?take=200&skip=200',
      '/api/v1/computers?take=200&skip=400',
    ]);
  });

  it('a collection that is an exact multiple of the page size stops without an extra empty request', async () => {
    const rows = Array.from({ length: 400 }, (_, i) => fakeComputer(i, 0));
    const f = mockFetch({ handler: pagedHandler('/computers', rows) });
    expect(await client(f).listAllComputers()).toHaveLength(400);
    expect(f.calls).toHaveLength(2);
  });

  it('passes filters through every page of a walk', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => fakeComputer(i, 7));
    const f = mockFetch({ handler: pagedHandler('/computers', rows) });
    await client(f).listAllComputers({ companyId: 'c7' });
    expect(f.calls[0]!.target).toContain('companyId=c7');
  });

  it('throws IncompleteListError when a walk collects fewer rows than totalCount', async () => {
    const f = mockFetch({
      responses: [
        { body: { items: Array.from({ length: 200 }, (_, i) => fakeComputer(i, 0)), totalCount: 300 } },
        { body: { items: [], totalCount: 0 } }, // server lost the rest
      ],
    });
    await expect(client(f).listAllComputers()).rejects.toThrow(IncompleteListError);
  });

  it('runaway guard trips when the server ignores skip', async () => {
    const page = { items: Array.from({ length: 200 }, (_, i) => fakeComputer(i, 0)), totalCount: 100_000 };
    const f = mockFetch({ handler: () => ({ body: page }) });
    await expect(client(f).listAllComputers({ maxPages: 3 })).rejects.toThrow(/exceeded 3 pages/);
    expect(f.calls).toHaveLength(3);
  });

  it('listAllAuditLogs follows nextCursor and asserts totalCount', async () => {
    const f = mockFetch({
      responses: [
        { body: { items: [{ id: '1' }, { id: '2' }], totalCount: 3, hasMore: true, nextCursor: 'abc' } },
        { body: { items: [{ id: '3' }], totalCount: 3, hasMore: false, nextCursor: null } },
      ],
    });
    const out = await client(f).listAllAuditLogs({ entityType: 'users' });
    expect(out.map((e) => e.id)).toEqual(['1', '2', '3']);
    expect(f.calls[0]!.target).toBe('/api/v1/audit-logs?entityType=users&take=200');
    expect(f.calls[1]!.target).toBe('/api/v1/audit-logs?entityType=users&cursor=abc&take=200');
  });

  it('read client: transport is unreachable at runtime, not just in types', () => {
    const r = new AutoElevateReadClient({ credential: TEST_BEARER });
    expect(Object.keys(r)).toEqual([]);
    expect((r as unknown as Record<string, unknown>).http).toBeUndefined();
  });

  it('read client: exposes exactly the 21 documented read methods (plus the `walk` internal)', () => {
    // TypeScript's `private` on `walk` is compile-time only — it is a plain method on the
    // prototype at runtime, callable from any consumer's JS. That is exactly why this inventory
    // is exact rather than pattern-matched: a regex over method names could miss it, but an
    // exhaustive list can't. If a future change makes `walk` an ES `#private` method (as the
    // transport field now is), remove it from this list when it happens.
    const expected = [
      'getUsage',
      'listCompanies',
      'listAllCompanies',
      'getCompany',
      'listComputers',
      'listAllComputers',
      'getComputer',
      'listLocations',
      'listAllLocations',
      'getLocation',
      'listElevationRequests',
      'listAllElevationRequests',
      'getElevationRequest',
      'listElevationEvents',
      'listAllElevationEvents',
      'listElevatedSessions',
      'listAllElevatedSessions',
      'getElevatedSession',
      'listElevationRules',
      'listAllElevationRules',
      'listAuditLogs',
      'listAllAuditLogs',
      'walk',
    ].sort();
    const actual = Object.getOwnPropertyNames(AutoElevateReadClient.prototype)
      .filter((n) => n !== 'constructor')
      .sort();
    expect(actual).toEqual(expected);
  });

  it('barrel exports the write client but not the transport', () => {
    expect(typeof barrel.AutoElevateWriteClient).toBe('function');
    expect((barrel as Record<string, unknown>).AutoElevateHttp).toBeUndefined();
  });
});
