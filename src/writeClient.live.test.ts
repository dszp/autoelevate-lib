/**
 * Live proof of the signed POST path with NO state change. Set AUTOELEVATE_LIVE_DECIDED_REQUEST_ID
 * to the id of an elevation request that is already APPROVED, DENIED or WITHDRAWN; the API must
 * answer 409 (not 401/403/400), which shows auth, body hash and routing are right. Needs a key with
 * `requestEdit`. Before the POST, the test reads the target request back and refuses to run if it
 * is still PENDING — approving a PENDING request would actually change its state, defeating the
 * "changes nothing" guarantee this test exists to provide. Self-skips without AUTOELEVATE_TOKEN and
 * that id.
 */
import { describe, it, expect } from 'vitest';
import { AutoElevateWriteClient } from './writeClient.js';
import { AutoElevateReadClient } from './readClient.js';
import { AutoElevateApiError } from './http.js';

declare const process: { env: Record<string, string | undefined> } | undefined;
const env = typeof process !== 'undefined' ? process!.env : {};
const TOKEN = env.AUTOELEVATE_TOKEN;
const DECIDED_ID = env.AUTOELEVATE_LIVE_DECIDED_REQUEST_ID;

describe.skipIf(!TOKEN || !DECIDED_ID)('live write smoke (expects 409, changes nothing)', () => {
  const credential = { token: TOKEN!, hmacKey: env.AUTOELEVATE_HMAC_KEY };
  const baseUrl = env.AUTOELEVATE_BASE_URL;
  const client = new AutoElevateWriteClient({ credential, baseUrl });
  const reader = new AutoElevateReadClient({ credential, baseUrl });

  it('approving an already-decided request is refused with 409', async () => {
    const target = await reader.getElevationRequest(DECIDED_ID!);
    expect(target.approvalState, 'AUTOELEVATE_LIVE_DECIDED_REQUEST_ID must NOT be PENDING').not.toBe('PENDING');

    const err = await client.approveElevationRequest(DECIDED_ID!, {}).catch((e) => e);
    expect(err).toBeInstanceOf(AutoElevateApiError);
    expect(err.status).toBe(409);
  }, 30_000);
});
