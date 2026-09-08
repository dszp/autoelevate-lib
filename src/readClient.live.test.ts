/**
 * Live read-only smoke test against the real Partner API. Self-skips unless AUTOELEVATE_TOKEN is
 * set. Source the key from your secret manager at run time; never commit it:
 *
 *   AUTOELEVATE_TOKEN=aeb_... pnpm test
 *   # HMAC key instead: AUTOELEVATE_TOKEN=aeh_... AUTOELEVATE_HMAC_KEY=... pnpm test
 *
 * Costs 3 + ceil(companies/200) + ceil(computers/200) requests from the hourly buckets.
 * `process` is declared locally so this compiles under the Node-free tsconfig (types: []).
 */
import { describe, it, expect } from 'vitest';
import { AutoElevateReadClient } from './readClient.js';
import { gatherAgentCounts } from './counts.js';
import type { Credential } from './auth.js';

declare const process: { env: Record<string, string | undefined> } | undefined;
const env = typeof process !== 'undefined' ? process!.env : {};
const TOKEN = env.AUTOELEVATE_TOKEN;
const HMAC_KEY = env.AUTOELEVATE_HMAC_KEY;

describe.skipIf(!TOKEN)('live read smoke (real AutoElevate Partner API)', () => {
  const credential: Credential = HMAC_KEY
    ? { scheme: 'hmac', token: TOKEN!, hmacKey: HMAC_KEY }
    : { scheme: 'bearer', token: TOKEN! };
  const client = new AutoElevateReadClient({ credential, baseUrl: env.AUTOELEVATE_BASE_URL });

  it('usage responds and per-company counts reconcile', async () => {
    const usage = await client.getUsage();
    expect(usage.partnerName).toBeTruthy();
    const report = await gatherAgentCounts(client);
    const sum = report.companies.reduce((n, c) => n + c.activeAgents, 0);
    expect(sum).toBe(report.msp.fromComputers);
    console.log(`[live] ${usage.partnerName}: usage=${report.msp.fromUsage} computers=${report.msp.fromComputers} companies=${report.companies.length}`);
  }, 60_000);
});
