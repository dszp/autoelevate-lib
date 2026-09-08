import { AutoElevateHttp, type AutoElevateHttpConfig, type ApiResult, type Query } from './http.js';
import type {
  AuditLogEntry,
  Company,
  Computer,
  CursorPage,
  ElevatedSession,
  ElevationEvent,
  ElevationRequest,
  ElevationRule,
  ListAuditLogsOptions,
  ListComputersOptions,
  ListElevatedSessionsOptions,
  ListElevationEventsOptions,
  ListElevationRequestsOptions,
  ListElevationRulesOptions,
  ListLocationsOptions,
  Location,
  Page,
  PageOptions,
  UsageResponse,
} from './model.js';

/** The API's hard cap on `take`. The `*All` walkers always use it: fewest requests per collection. */
export const MAX_PAGE_SIZE = 200;

/**
 * Runaway guard for the `*All` walkers: 200 pages × 200 rows = 40,000 items. Hitting it means a
 * server that ignores `skip`, and the caller should know rather than spin the hourly budget away.
 */
const DEFAULT_MAX_PAGES = 200;

export interface WalkOptions {
  /** Override the runaway guard. */
  maxPages?: number;
}

/** Thrown when a full walk collected a different number of rows than the API's own `totalCount`. */
export class IncompleteListError extends Error {
  constructor(
    public readonly path: string,
    public readonly expected: number,
    public readonly received: number,
  ) {
    super(
      `AutoElevate ${path}: walked ${received} rows but the first page reported totalCount=${expected}. ` +
        'The collection changed mid-walk or the server mis-paginated; re-run rather than trust a short list.',
    );
    this.name = 'IncompleteListError';
  }
}

export type AutoElevateReadClientConfig = AutoElevateHttpConfig;

/**
 * Read-only client for the Partner API. One method per GET endpoint, plus an `*All` companion for
 * every list that walks the whole collection and asserts completeness against `totalCount`.
 *
 * The write endpoints (`approve`/`deny` an elevation request) are intentionally absent. Create the
 * key without the `requestEdit` scope and the API enforces the same boundary server-side.
 */
export class AutoElevateReadClient {
  private readonly http: AutoElevateHttp;

  constructor(config: AutoElevateReadClientConfig) {
    this.http = new AutoElevateHttp(config);
  }

  // ---- usage ----------------------------------------------------------------------------

  /** MSP-wide usage snapshot. Scope: `computerView`. */
  async getUsage(): Promise<UsageResponse> {
    return (await this.http.get<UsageResponse>('/usage')).body;
  }

  // ---- companies ------------------------------------------------------------------------

  /** Scope: `companyView`. A restricted key sees only its permitted companies. */
  async listCompanies(opts: PageOptions = {}): Promise<Page<Company>> {
    return (await this.http.get<Page<Company>>('/companies', pageQuery(opts))).body;
  }

  async listAllCompanies(opts: WalkOptions = {}): Promise<Company[]> {
    return this.walk('/companies', {}, opts);
  }

  async getCompany(id: string): Promise<Company> {
    return (await this.http.get<Company>(`/companies/${encodeURIComponent(id)}`)).body;
  }

  // ---- computers ------------------------------------------------------------------------

  /**
   * Scope: `computerView`. **Only computers that checked in within the last 30 days** are returned
   * (the active-fleet window), so `totalCount` here is the billable-agent figure, not the inventory.
   */
  async listComputers(opts: ListComputersOptions = {}): Promise<Page<Computer>> {
    const { companyId, locationId, ...page } = opts;
    return (await this.http.get<Page<Computer>>('/computers', { ...pageQuery(page), companyId, locationId })).body;
  }

  async listAllComputers(opts: Omit<ListComputersOptions, keyof PageOptions> & WalkOptions = {}): Promise<Computer[]> {
    const { maxPages, ...filters } = opts;
    return this.walk('/computers', filters, { maxPages });
  }

  async getComputer(id: string): Promise<Computer> {
    return (await this.http.get<Computer>(`/computers/${encodeURIComponent(id)}`)).body;
  }

  // ---- locations ------------------------------------------------------------------------

  /** Scope: `locationView`. */
  async listLocations(opts: ListLocationsOptions = {}): Promise<Page<Location>> {
    const { companyId, ...page } = opts;
    return (await this.http.get<Page<Location>>('/locations', { ...pageQuery(page), companyId })).body;
  }

  async listAllLocations(opts: Omit<ListLocationsOptions, keyof PageOptions> & WalkOptions = {}): Promise<Location[]> {
    const { maxPages, ...filters } = opts;
    return this.walk('/locations', filters, { maxPages });
  }

  async getLocation(id: string): Promise<Location> {
    return (await this.http.get<Location>(`/locations/${encodeURIComponent(id)}`)).body;
  }

  // ---- elevation requests ---------------------------------------------------------------

  /** Scope: `requestView`. */
  async listElevationRequests(opts: ListElevationRequestsOptions = {}): Promise<Page<ElevationRequest>> {
    const { companyId, approvalState, start, end, ...page } = opts;
    return (
      await this.http.get<Page<ElevationRequest>>('/elevation-requests', {
        ...pageQuery(page),
        companyId,
        approvalState,
        start,
        end,
      })
    ).body;
  }

  async listAllElevationRequests(
    opts: Omit<ListElevationRequestsOptions, keyof PageOptions> & WalkOptions = {},
  ): Promise<ElevationRequest[]> {
    const { maxPages, ...filters } = opts;
    return this.walk('/elevation-requests', filters, { maxPages });
  }

  async getElevationRequest(id: string): Promise<ElevationRequest> {
    return (await this.http.get<ElevationRequest>(`/elevation-requests/${encodeURIComponent(id)}`)).body;
  }

  // ---- elevation events -----------------------------------------------------------------

  /** Scope: `eventView`. */
  async listElevationEvents(opts: ListElevationEventsOptions = {}): Promise<Page<ElevationEvent>> {
    const { companyId, start, end, ...page } = opts;
    return (await this.http.get<Page<ElevationEvent>>('/elevation-events', { ...pageQuery(page), companyId, start, end }))
      .body;
  }

  async listAllElevationEvents(
    opts: Omit<ListElevationEventsOptions, keyof PageOptions> & WalkOptions = {},
  ): Promise<ElevationEvent[]> {
    const { maxPages, ...filters } = opts;
    return this.walk('/elevation-events', filters, { maxPages });
  }

  // ---- elevated sessions ----------------------------------------------------------------

  /** Scope: `elevatedSessionView`. */
  async listElevatedSessions(opts: ListElevatedSessionsOptions = {}): Promise<Page<ElevatedSession>> {
    const { companyId, computerId, status, ...page } = opts;
    return (
      await this.http.get<Page<ElevatedSession>>('/elevated-sessions', { ...pageQuery(page), companyId, computerId, status })
    ).body;
  }

  async listAllElevatedSessions(
    opts: Omit<ListElevatedSessionsOptions, keyof PageOptions> & WalkOptions = {},
  ): Promise<ElevatedSession[]> {
    const { maxPages, ...filters } = opts;
    return this.walk('/elevated-sessions', filters, { maxPages });
  }

  async getElevatedSession(id: string): Promise<ElevatedSession> {
    return (await this.http.get<ElevatedSession>(`/elevated-sessions/${encodeURIComponent(id)}`)).body;
  }

  // ---- elevation rules ------------------------------------------------------------------

  /** Scope: `ruleView`. */
  async listElevationRules(opts: ListElevationRulesOptions = {}): Promise<Page<ElevationRule>> {
    const { companyId, ...page } = opts;
    return (await this.http.get<Page<ElevationRule>>('/elevation-rules', { ...pageQuery(page), companyId })).body;
  }

  async listAllElevationRules(
    opts: Omit<ListElevationRulesOptions, keyof PageOptions> & WalkOptions = {},
  ): Promise<ElevationRule[]> {
    const { maxPages, ...filters } = opts;
    return this.walk('/elevation-rules', filters, { maxPages });
  }

  // ---- audit logs (cursor-paginated) ----------------------------------------------------

  /** Scope: `auditLogView`. May 403 for tenants outside the audit-log Early Access. */
  async listAuditLogs(opts: ListAuditLogsOptions = {}): Promise<CursorPage<AuditLogEntry>> {
    return (await this.http.get<CursorPage<AuditLogEntry>>('/audit-logs', { ...opts, take: opts.take ?? MAX_PAGE_SIZE }))
      .body;
  }

  async listAllAuditLogs(opts: Omit<ListAuditLogsOptions, 'cursor' | 'take'> & WalkOptions = {}): Promise<AuditLogEntry[]> {
    const { maxPages = DEFAULT_MAX_PAGES, ...filters } = opts;
    const out: AuditLogEntry[] = [];
    let cursor: string | undefined;
    let expected: number | undefined;
    for (let page = 0; page < maxPages; page++) {
      const res = await this.listAuditLogs({ ...filters, cursor, take: MAX_PAGE_SIZE });
      expected ??= res.totalCount;
      out.push(...res.items);
      if (!res.hasMore || res.nextCursor === null) {
        if (out.length !== expected) throw new IncompleteListError('/audit-logs', expected, out.length);
        return out;
      }
      cursor = res.nextCursor;
    }
    throw new Error(`AutoElevate /audit-logs: exceeded ${maxPages} pages; refusing to continue.`);
  }

  // ---- internals ------------------------------------------------------------------------

  /** Offset walk at the maximum page size. Stops on a short page; asserts against `totalCount`. */
  private async walk<T>(path: string, filters: Query, opts: WalkOptions): Promise<T[]> {
    const maxPages = opts.maxPages ?? DEFAULT_MAX_PAGES;
    const out: T[] = [];
    let expected: number | undefined;
    for (let page = 0; page < maxPages; page++) {
      const res: ApiResult<Page<T>> = await this.http.get<Page<T>>(path, {
        ...filters,
        take: MAX_PAGE_SIZE,
        skip: page * MAX_PAGE_SIZE,
      });
      const { items, totalCount } = res.body;
      // Only the first page's totalCount is trusted: the API reports 0 once skip passes the end.
      expected ??= totalCount;
      out.push(...items);
      if (items.length < MAX_PAGE_SIZE || out.length >= expected) {
        if (out.length !== expected) throw new IncompleteListError(path, expected, out.length);
        return out;
      }
    }
    throw new Error(`AutoElevate ${path}: exceeded ${maxPages} pages; refusing to continue.`);
  }
}

function pageQuery(opts: PageOptions): Query {
  if (opts.take !== undefined && (opts.take < 1 || opts.take > MAX_PAGE_SIZE)) {
    throw new RangeError(`take must be 1..${MAX_PAGE_SIZE}, got ${opts.take}`);
  }
  return { take: opts.take, skip: opts.skip };
}
