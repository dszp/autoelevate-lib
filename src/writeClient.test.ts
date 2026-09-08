import { describe, it, expect } from 'vitest';
import { AutoElevateWriteClient, AutoElevateValidationError } from './writeClient.js';
import { mockFetch, TEST_HMAC } from './testkit.js';

const approved = { id: 'req-0000', computerId: 'm', approvalState: 'APPROVED', requestedBy: null, targetDescription: null, createdAt: 1 };

function client(f: ReturnType<typeof mockFetch>) {
  return new AutoElevateWriteClient({ credential: TEST_HMAC, fetchImpl: f.fetchImpl, nowMs: () => 1700000000000 });
}

describe('AutoElevateWriteClient', () => {
  it('approve posts to the encoded id path with the payload', async () => {
    const f = mockFetch({ responses: [{ body: approved }] });
    const out = await client(f).approveElevationRequest('req 0000', { elevationType: 'user', durationInMinutes: 30 });
    expect(out.approvalState).toBe('APPROVED');
    expect(f.calls[0]!.target).toBe('/api/v1/elevation-requests/req%200000/approve');
    expect(JSON.parse(f.calls[0]!.body!)).toEqual({ elevationType: 'user', durationInMinutes: 30 });
  });

  it('deny posts denialReason and rule options', async () => {
    const f = mockFetch({ responses: [{ body: { ...approved, approvalState: 'DENIED', denialReason: 'Not licensed' } }] });
    const out = await client(f).denyElevationRequest('req-0000', { denialReason: 'Not licensed', createRule: true, ruleLevel: 'company' });
    expect(out.approvalState).toBe('DENIED');
    expect(f.calls[0]!.target).toBe('/api/v1/elevation-requests/req-0000/deny');
  });

  it('an empty payload still sends a JSON object', async () => {
    const f = mockFetch({ responses: [{ body: approved }] });
    await client(f).approveElevationRequest('req-0000');
    expect(f.calls[0]!.body).toBe('{}');
  });

  it('rejects createRule without ruleLevel before any request', async () => {
    const f = mockFetch();
    await expect(client(f).approveElevationRequest('req-0000', { createRule: true })).rejects.toBeInstanceOf(AutoElevateValidationError);
    await expect(client(f).denyElevationRequest('req-0000', { createRule: true })).rejects.toThrow(/ruleLevel/);
    expect(f.calls).toHaveLength(0);
  });

  it('rejects a non-positive or fractional durationInMinutes', async () => {
    const f = mockFetch();
    await expect(client(f).approveElevationRequest('req-0000', { durationInMinutes: 0 })).rejects.toThrow(/durationInMinutes/);
    await expect(client(f).approveElevationRequest('req-0000', { durationInMinutes: 1.5 })).rejects.toThrow(/durationInMinutes/);
    expect(f.calls).toHaveLength(0);
  });

  it('rejects a denialReason over 1000 characters and an empty id', async () => {
    const f = mockFetch();
    await expect(client(f).denyElevationRequest('req-0000', { denialReason: 'x'.repeat(1001) })).rejects.toThrow(/1000/);
    await expect(client(f).denyElevationRequest('  ')).rejects.toThrow(/id/);
    expect(f.calls).toHaveLength(0);
  });

  it('has exactly the two write methods', () => {
    const names = Object.getOwnPropertyNames(AutoElevateWriteClient.prototype).filter((n) => n !== 'constructor');
    expect(names.sort()).toEqual(['approveElevationRequest', 'denyElevationRequest']);
  });
});
