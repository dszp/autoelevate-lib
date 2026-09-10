/**
 * The Partner API transport: URL building, both auth schemes, the beta acknowledgment header,
 * JSON parsing and error normalisation.
 *
 * **Deliberately not exported from the package barrel.** The read-only guarantee of
 * {@link AutoElevateReadClient} comes from that class having no mutating method — which only holds
 * while consumers cannot reach the raw transport underneath it.
 */
import { ACKNOWLEDGMENT_HEADER, ACKNOWLEDGMENT_VALUE, signRequest, type Credential } from './auth.js';
import type { ApiErrorBody } from './model.js';

/** AutoElevate's production endpoint. */
export const DEFAULT_BASE_URL = 'https://partner-api.autoelevate.com';

/** Pinned API version segment. The unversioned alias is a permanent v1 alias; use this instead. */
export const API_PREFIX = '/api/v1';

export interface AutoElevateHttpConfig {
  credential: Credential;
  /** Defaults to production. Must be HTTPS. */
  baseUrl?: string;
  /** Injectable for tests / non-global fetch. */
  fetchImpl?: typeof fetch;
  /** Injectable clock in epoch ms (HMAC `ts`). Defaults to `Date.now`. */
  nowMs?: () => number;
}

/** Query values the transport knows how to serialise. `undefined` entries are dropped. */
export type Query = Record<string, string | number | boolean | undefined>;

/** Deprecation signals the API attaches to a versioned route on its way out. */
export interface DeprecationInfo {
  deprecated: boolean;
  /** RFC 8594 removal date, when committed. */
  sunset?: string;
  /** `Link` header value carrying `rel="successor-version"`. */
  successor?: string;
}

/** A response with the headers the caller may care about alongside the parsed body. */
export interface ApiResult<T> {
  body: T;
  status: number;
  deprecation?: DeprecationInfo;
}

/** An HTTP-level failure from the Partner API. */
export class AutoElevateApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly method: string,
    public readonly path: string,
    /** Parsed error body when the API sent one, else the raw text. */
    public readonly body: unknown,
    /**
     * Seconds to wait before retrying, from `Retry-After` on a 429. Surfaced rather than acted on:
     * with a 100-request-per-hour bucket, an automatic retry loop burns budget the caller needs.
     */
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'AutoElevateApiError';
  }

  get isRateLimited(): boolean {
    return this.status === 429;
  }
}

function isErrorBody(x: unknown): x is ApiErrorBody {
  return typeof x === 'object' && x !== null && 'message' in x && 'statusCode' in x;
}

/** Plain-language hints for the statuses a key holder can fix themselves. */
function hint(status: number, path: string): string {
  switch (status) {
    case 400:
      return 'Check the X-Acknowledgment header and query parameters.';
    case 401:
      return 'The key is missing, expired, revoked, or created under the other auth scheme.';
    case 403:
      return path.includes('/audit-logs')
        ? 'The key lacks the auditLogView scope, or the tenant is not enrolled in the audit-log Early Access.'
        : 'The key lacks the scope this endpoint requires (see the route table in the README).';
    case 429:
      return 'Rate limited (100 requests/hour per method+route). Wait for Retry-After.';
    case 409:
      return path.includes('/elevation-requests/')
        ? 'The request is not in a state that allows this transition (it must be PENDING).'
        : '';
    default:
      return '';
  }
}

export class AutoElevateHttp {
  private readonly credential: Credential;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly nowMs: () => number;

  constructor(config: AutoElevateHttpConfig) {
    const base = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    if (!/^https:\/\//i.test(base)) {
      throw new Error(`AutoElevate baseUrl must be HTTPS, got: ${base}`);
    }
    this.credential = config.credential;
    this.baseUrl = base;
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.nowMs = config.nowMs ?? Date.now;
  }

  /** Absolute URL for a v1 path plus query, with `undefined` values dropped. */
  buildUrl(path: string, query?: Query): string {
    const url = new URL(`${this.baseUrl}${API_PREFIX}${path}`);
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    return url.toString();
  }

  async get<T>(path: string, query?: Query): Promise<ApiResult<T>> {
    return this.request<T>('GET', path, query);
  }

  /**
   * POST a JSON body. The body is serialised exactly once here; the resulting string is both what
   * the HMAC `bodyHash` covers and what is sent, so the two can never drift.
   */
  async post<T>(path: string, body: unknown): Promise<ApiResult<T>> {
    return this.request<T>('POST', path, undefined, JSON.stringify(body ?? {}));
  }

  private async request<T>(method: string, path: string, query?: Query, body?: string): Promise<ApiResult<T>> {
    const url = this.buildUrl(path, query);
    const headers: Record<string, string> = {
      Accept: 'application/json',
      [ACKNOWLEDGMENT_HEADER]: ACKNOWLEDGMENT_VALUE,
      Authorization: await signRequest(this.credential, method, url, body, this.nowMs),
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const res = await this.fetchImpl(url, { method, headers, body });
    const text = await res.text();
    let parsed: unknown = text;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        /* keep raw text */
      }
    }

    if (!res.ok) {
      const retryAfter = res.headers.get('Retry-After');
      const retryAfterSeconds = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) : undefined;
      const apiMsg = isErrorBody(parsed) ? parsed.message : res.statusText || 'request failed';
      const h = hint(res.status, path);
      throw new AutoElevateApiError(
        `AutoElevate ${method} ${API_PREFIX}${path} -> ${res.status}: ${apiMsg}${h ? ` ${h}` : ''}`,
        res.status,
        method,
        `${API_PREFIX}${path}`,
        parsed,
        retryAfterSeconds,
      );
    }

    const result: ApiResult<T> = { body: parsed as T, status: res.status };
    const dep = res.headers.get('Deprecation');
    if (dep) {
      result.deprecation = {
        deprecated: dep.toLowerCase() === 'true',
        sunset: res.headers.get('Sunset') ?? undefined,
        successor: res.headers.get('Link') ?? undefined,
      };
    }
    return result;
  }
}
