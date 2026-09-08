/**
 * Shared test helpers: a recording mock `fetch` that speaks the Partner API's shapes.
 *
 * Build-excluded and never exported from the barrel, but type-checked by `tsconfig.test.json`.
 * Node-free like the rest of the source.
 */
import { ACKNOWLEDGMENT_HEADER, ACKNOWLEDGMENT_VALUE } from './auth.js';

export interface RecordedCall {
  method: string;
  url: string;
  /** Path + query, without the origin, for terse assertions. */
  target: string;
  headers: Record<string, string>;
  body?: string;
}

export interface MockResponse {
  status?: number;
  body?: unknown;
  /** Non-JSON body, for the parse fallback. */
  rawBody?: string;
  headers?: Record<string, string>;
}

export interface MockFetchOptions {
  /** Answer for a call. Consulted before `responses`. */
  handler?: (call: RecordedCall) => MockResponse | undefined;
  /** Queue of answers, consumed in order. */
  responses?: MockResponse[];
}

export interface MockFetch {
  fetchImpl: typeof fetch;
  calls: RecordedCall[];
}

function toResponse(spec: MockResponse): Response {
  const status = spec.status ?? 200;
  const headers = { ...(spec.headers ?? {}) };
  if (spec.rawBody !== undefined) {
    return new Response(spec.rawBody, { status, headers: { 'content-type': 'text/html', ...headers } });
  }
  return new Response(JSON.stringify(spec.body ?? {}), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/**
 * A recording mock `fetch`. Every call is checked for the beta acknowledgment header — a missing
 * one is answered with the API's own 400, so a transport regression fails loudly in every test.
 */
export function mockFetch(opts: MockFetchOptions = {}): MockFetch {
  const calls: RecordedCall[] = [];
  const queue = [...(opts.responses ?? [])];

  const fetchImpl = (async (input: any, init: any = {}) => {
    const url = String(input);
    const u = new URL(url);
    const headers = (init.headers ?? {}) as Record<string, string>;
    const call: RecordedCall = {
      method: init.method ?? 'GET',
      url,
      target: u.pathname + u.search,
      headers,
      body: init.body,
    };
    calls.push(call);

    if (headers[ACKNOWLEDGMENT_HEADER] !== ACKNOWLEDGMENT_VALUE) {
      return toResponse({
        status: 400,
        body: { name: 'BadRequest', message: 'Missing or invalid X-Acknowledgment header', statusCode: 400 },
      });
    }

    const fromHandler = opts.handler?.(call);
    if (fromHandler) return toResponse(fromHandler);
    return toResponse(queue.shift() ?? {});
  }) as unknown as typeof fetch;

  return { fetchImpl, calls };
}

/** Entirely fictional credentials. */
export const TEST_BEARER = { scheme: 'bearer', token: 'aeb_test_0000' } as const;
export const TEST_HMAC = { scheme: 'hmac', token: 'aeh_test_0000', hmacKey: 'not-a-real-key' } as const;

/** Deterministic UUID-shaped ids for fixtures. */
export function fakeId(prefix: string, n: number): string {
  return `${prefix.padEnd(8, '0').slice(0, 8)}-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

export function fakeCompany(n: number, over: Record<string, unknown> = {}) {
  return {
    id: fakeId('c', n),
    name: `Company ${n}`,
    initials: null,
    managementSystemCompanyId: `PSA-${n}`,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...over,
  };
}

export function fakeComputer(n: number, companyN: number, over: Record<string, unknown> = {}) {
  return {
    id: fakeId('m', n),
    machineName: `WS-${n}`,
    operatingSystem: { name: 'Windows 11 Pro', version: '10.0.26100' },
    locationId: fakeId('l', companyN),
    companyId: fakeId('c', companyN),
    elevationMode: 'live',
    lastCheckedInAt: 1_700_000_000_000,
    createdAt: 1_690_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...over,
  };
}

/** Serve an offset-paginated collection the way the API does, including `totalCount: 0` past the end. */
export function pagedHandler(pathPrefix: string, rows: unknown[]) {
  return (call: RecordedCall): MockResponse | undefined => {
    const u = new URL(call.url);
    if (!u.pathname.endsWith(pathPrefix)) return undefined;
    const take = Number(u.searchParams.get('take') ?? 50);
    const skip = Number(u.searchParams.get('skip') ?? 0);
    const items = rows.slice(skip, skip + take);
    return { body: { items, totalCount: skip >= rows.length && rows.length > 0 ? 0 : rows.length } };
  };
}
