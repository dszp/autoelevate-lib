import { describe, it, expect } from 'vitest';
import { bucketAgents, gatherAgentCounts } from './counts.js';
import { AutoElevateReadClient } from './readClient.js';
import { fakeCompany, fakeComputer, fakeId, mockFetch, pagedHandler, TEST_BEARER } from './testkit.js';
import type { Company, Computer } from './model.js';

describe('bucketAgents', () => {
  it('counts per company, keeps zero-agent companies, buckets modes, and sorts by name', () => {
    const companies = [fakeCompany(2, { name: 'Zeta' }), fakeCompany(1, { name: 'Alpha' }), fakeCompany(3, { name: 'Empty' })] as Company[];
    const computers = [
      fakeComputer(1, 1),
      fakeComputer(2, 1, { elevationMode: 'audit' }),
      fakeComputer(3, 1, { elevationMode: null }),
      fakeComputer(4, 2),
    ] as Computer[];
    const out = bucketAgents(companies, computers);
    expect(out.map((r) => [r.companyName, r.activeAgents])).toEqual([
      ['Alpha', 3],
      ['Empty', 0],
      ['Zeta', 1],
    ]);
    expect(out[0]!.byElevationMode).toEqual({ audit: 1, live: 1, policy: 0, technicianBypass: 0, unknown: 1 });
    expect(out[0]!.managementSystemCompanyId).toBe('PSA-1');
  });

  it('a computer whose company is not visible lands in an unnamed bucket at the end', () => {
    const out = bucketAgents([fakeCompany(1, { name: 'Alpha' })] as Company[], [fakeComputer(1, 9)] as Computer[]);
    expect(out).toHaveLength(2);
    expect(out[1]).toMatchObject({ companyId: fakeId('c', 9), companyName: null, activeAgents: 1 });
  });
});

describe('gatherAgentCounts', () => {
  it('walks companies and computers once each, calls usage once, and reports agreement', async () => {
    const companies = [fakeCompany(1), fakeCompany(2)];
    const computers = [...Array.from({ length: 210 }, (_, i) => fakeComputer(i, 1)), fakeComputer(999, 2)];
    const paged = [pagedHandler('/companies', companies), pagedHandler('/computers', computers)];
    const f = mockFetch({
      handler: (call) => {
        if (call.target.startsWith('/api/v1/usage')) {
          return { body: { partnerId: 'p', partnerName: 'Acme MSP', blockerEnabled: true, justInTimeAdminLoginEnabled: false, totalActiveAgents: 211 } };
        }
        for (const h of paged) {
          const r = h(call);
          if (r) return r;
        }
        return undefined;
      },
    });
    const client = new AutoElevateReadClient({ credential: TEST_BEARER, fetchImpl: f.fetchImpl });
    const report = await gatherAgentCounts(client, { nowMs: () => 42 });
    expect(report.gatheredAt).toBe(42);
    expect(report.msp).toEqual({ partnerId: 'p', partnerName: 'Acme MSP', fromUsage: 211, fromComputers: 211, agree: true });
    expect(report.companies.map((c) => c.activeAgents)).toEqual([210, 1]);
    // Budget: 1 usage + 1 companies page + 2 computers pages.
    expect(f.calls).toHaveLength(4);
  });

  it('flags disagreement between the usage snapshot and the live walk', async () => {
    const f = mockFetch({
      handler: (call) =>
        call.target.startsWith('/api/v1/usage')
          ? { body: { partnerId: 'p', partnerName: 'x', blockerEnabled: false, justInTimeAdminLoginEnabled: false, totalActiveAgents: 5 } }
          : { body: { items: [], totalCount: 0 } },
    });
    const client = new AutoElevateReadClient({ credential: TEST_BEARER, fetchImpl: f.fetchImpl });
    const report = await gatherAgentCounts(client);
    expect(report.msp.agree).toBe(false);
    expect(report.msp.fromComputers).toBe(0);
  });
});
