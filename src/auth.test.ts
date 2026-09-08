import { describe, it, expect } from 'vitest';
import { EMPTY_BODY_SHA256, hmacStringToSign, sha256Hex, signRequest } from './auth.js';
import { TEST_BEARER, TEST_HMAC } from './testkit.js';

describe('signRequest', () => {
  it('bearer: emits the token verbatim', async () => {
    expect(await signRequest(TEST_BEARER, 'GET', 'https://x/api/v1/usage')).toBe('Bearer aeb_test_0000');
  });

  it('empty body hashes to the documented constant', async () => {
    expect(await sha256Hex('')).toBe(EMPTY_BODY_SHA256);
    // Known vector: sha256("abc")
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('string to sign uses real newlines, upper-cased method and the request-target (path+query, no host)', () => {
    const s = hmacStringToSign('get', 'https://x/api/v1/computers?take=200&skip=0', EMPTY_BODY_SHA256, 1700000000000);
    expect(s.split('\n')).toEqual([
      'AE-HMAC-SHA256',
      'GET',
      '/api/v1/computers?take=200&skip=0',
      EMPTY_BODY_SHA256,
      '1700000000000',
    ]);
  });

  it('hmac: header carries token, bodyHash, ts and a 64-hex sig; sig is deterministic for a fixed clock', async () => {
    const url = 'https://x/api/v1/usage';
    const a = await signRequest(TEST_HMAC, 'GET', url, undefined, () => 1700000000000);
    const b = await signRequest(TEST_HMAC, 'GET', url, undefined, () => 1700000000000);
    expect(a).toBe(b);
    const m = /^AE-HMAC-SHA256 token=(aeh_test_0000),bodyHash=([0-9a-f]{64}),ts=(\d+),sig=([0-9a-f]{64})$/.exec(a);
    expect(m).not.toBeNull();
    expect(m![2]).toBe(EMPTY_BODY_SHA256);
    expect(m![3]).toBe('1700000000000');
  });

  it('hmac: RFC 4231 test case 2 vector ("Jefe" / "what do ya want for nothing?")', async () => {
    // Prove the primitive we call is real HMAC-SHA256, independent of the AutoElevate framing.
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('Jefe'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('what do ya want for nothing?'));
    const hex = Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('');
    expect(hex).toBe('5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843');
  });

  it('an absolute URL and its request-target sign identically; a different host does not matter', async () => {
    const t = () => 1700000000000;
    const a = await signRequest(TEST_HMAC, 'GET', 'https://partner-api.autoelevate.com/api/v1/usage?x=1', undefined, t);
    const b = await signRequest(TEST_HMAC, 'GET', '/api/v1/usage?x=1', undefined, t);
    const c = await signRequest(TEST_HMAC, 'GET', 'https://other.example/api/v1/usage?x=1', undefined, t);
    expect(a).toBe(b);
    expect(a).toBe(c);
  });

  it('hmac: a different body or URL changes the signature', async () => {
    const t = () => 1700000000000;
    const base = await signRequest(TEST_HMAC, 'GET', 'https://x/a', undefined, t);
    expect(await signRequest(TEST_HMAC, 'GET', 'https://x/a?q=1', undefined, t)).not.toBe(base);
    expect(await signRequest(TEST_HMAC, 'POST', 'https://x/a', '{}', t)).not.toBe(base);
  });
});
