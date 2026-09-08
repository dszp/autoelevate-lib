/**
 * Credential shapes and the `Authorization` header builder for both Partner API schemes.
 *
 * Uses only WebCrypto (`crypto.subtle`), so it runs in a Cloudflare Worker, Node >= 20, and the
 * browser. Exported from the barrel on its own because an n8n HTTP node or a shell script may
 * want just the signature.
 */

/** A key created with the AE-BEARER scheme: one secret, sent as-is. */
export interface BearerCredential {
  scheme: 'bearer';
  /** The `aeb_…` token shown once at creation. */
  token: string;
}

/** A key created with the AE-HMAC-SHA256 scheme: a wire token plus a separate signing key. */
export interface HmacCredential {
  scheme: 'hmac';
  /** The `aeh_…` identifier sent as `token=` on every request. */
  token: string;
  /** The signing key. Never transmitted. */
  hmacKey: string;
}

export type Credential = BearerCredential | HmacCredential;

/** The wire name of the HMAC scheme; also the first line of the string to sign. */
export const HMAC_SCHEME = 'AE-HMAC-SHA256';

/** SHA-256 of the empty string — the documented `bodyHash` for a body-less request. */
export const EMPTY_BODY_SHA256 =
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

/** Header every request must carry during the beta. Any other value is a 400. */
export const ACKNOWLEDGMENT_HEADER = 'X-Acknowledgment';
export const ACKNOWLEDGMENT_VALUE = 'i-understand-this-is-beta-and-may-change';

const encoder = new TextEncoder();

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** SHA-256 hex digest of a string's UTF-8 bytes. */
export async function sha256Hex(text: string): Promise<string> {
  if (text === '') return EMPTY_BODY_SHA256;
  return hex(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
}

/**
 * The canonical string the HMAC scheme signs. Lines are joined with a real newline. `url` is the
 * full request target including query string; `method` is upper-cased here so callers need not.
 */
export function hmacStringToSign(method: string, url: string, bodyHash: string, ts: number): string {
  return [HMAC_SCHEME, method.toUpperCase(), url, bodyHash, String(ts)].join('\n');
}

/**
 * Build the `Authorization` header value for one request.
 *
 * @param body The exact body string that will be sent, or `undefined`/`''` for none. The hash is
 *             over these bytes, so serialise once and pass the same string to `fetch`.
 * @param nowMs Injectable clock; the server rejects `ts` more than 5 minutes from its own time.
 */
export async function signRequest(
  credential: Credential,
  method: string,
  url: string,
  body?: string,
  nowMs: () => number = Date.now,
): Promise<string> {
  if (credential.scheme === 'bearer') {
    return `Bearer ${credential.token}`;
  }
  const ts = Math.floor(nowMs());
  const bodyHash = await sha256Hex(body ?? '');
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(credential.hmacKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = hex(
    await crypto.subtle.sign('HMAC', key, encoder.encode(hmacStringToSign(method, url, bodyHash, ts))),
  );
  return `${HMAC_SCHEME} token=${credential.token},bodyHash=${bodyHash},ts=${ts},sig=${sig}`;
}
