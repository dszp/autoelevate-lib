/**
 * Types for the AutoElevate Partner API (beta), hand-derived from the vendored OpenAPI document
 * in `reference/`. Every timestamp is epoch **milliseconds**. Every id is a UUID string.
 */

/** Permission scopes a key can carry. The read client needs only the `*View` ones. */
export type Scope =
  | 'companyView'
  | 'computerView'
  | 'locationView'
  | 'requestView'
  | 'requestEdit'
  | 'eventView'
  | 'elevatedSessionView'
  | 'ruleView'
  | 'auditLogView';

/** One page of an offset-paginated list (`take`/`skip`). */
export interface Page<T> {
  items: T[];
  /**
   * Total matching items ignoring pagination. The API returns `0` here when `skip` is past the
   * end, so a zero on a non-first page does not mean the collection is empty.
   */
  totalCount: number;
}

/** One page of the cursor-paginated audit log. */
export interface CursorPage<T> extends Page<T> {
  nextCursor: string | null;
  hasMore: boolean;
}

/** Offset pagination inputs. `take` defaults to 50 server-side and is capped at 200. */
export interface PageOptions {
  take?: number;
  skip?: number;
}

/** Inclusive epoch-millisecond window. When omitted the endpoint applies its own default bounds. */
export interface TimeRange {
  start?: number;
  end?: number;
}

export interface UsageResponse {
  partnerId: string;
  partnerName: string;
  /** Any computer has application blocking configured (audit or live mode). */
  blockerEnabled: boolean;
  justInTimeAdminLoginEnabled: boolean;
  /** Agent installs seen in the last 30 days. A periodically refreshed snapshot, not a live count. */
  totalActiveAgents: number;
}

export interface Company {
  id: string;
  name: string;
  initials: string | null;
  /**
   * External identifier the partner supplied for this company (the PSA-side key when a PSA
   * integration created it). Defaults to the company name at creation when none was given.
   */
  managementSystemCompanyId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface Location {
  id: string;
  name: string;
  companyId: string;
  companyName: string | null;
  createdAt: number;
  updatedAt: number;
}

export type ElevationMode = 'audit' | 'live' | 'policy' | 'technicianBypass';

export interface Computer {
  id: string;
  machineName: string | null;
  operatingSystem: { name: string | null; version: string | null } | null;
  locationId: string;
  companyId: string;
  /** Effective mode the agent last reported; `null` when it has not reported a recognised one. */
  elevationMode: ElevationMode | null;
  lastCheckedInAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export type ApprovalState = 'PENDING' | 'APPROVED' | 'DENIED' | 'WITHDRAWN';

export interface ElevationRequest {
  id: string;
  computerId: string;
  approvalState: ApprovalState;
  requestedBy: string | null;
  targetDescription: string | null;
  createdAt: number;
  /** Present once denied; free text shown to the end user. */
  denialReason?: string;
}

export interface ElevationEvent {
  id: string;
  computerId: string;
  computerName: string | null;
  companyName: string | null;
  locationName: string | null;
  data: {
    /** Trigger that fired the event; shape varies by source. */
    trigger?: unknown;
    user: { name: string | null } | null;
    ruleThatApplied?: unknown;
  };
  createdAt: number;
}

export type ElevatedSessionStatus = 'active' | 'completed' | 'expired';

export interface ElevatedSession {
  id: string;
  computerId: string;
  userName: string | null;
  status: ElevatedSessionStatus;
  startedAt: number;
  /** Scheduled end. Not updated if the session ends early. */
  endedAt: number | null;
  durationMs: number | null;
}

export type RuleLevel = 'msp' | 'company' | 'location' | 'computer';
export type RuleElevationType = 'admin' | 'user';

export interface ElevationRule {
  id: string;
  level: RuleLevel;
  mspId: string | null;
  companyId: string | null;
  locationId: string | null;
  computerId: string | null;
  /** `true` auto-approves matching elevations; `false` auto-denies. */
  approved: boolean;
  elevationType: RuleElevationType | null;
  shouldIgnore: boolean;
  friendlyName: string | null;
  /** Opaque matching criteria; shape is intentionally unspecified. */
  identificationCriteria: unknown;
  createdAt: number;
  updatedAt: number;
}

export type AuditEntityType = 'users' | 'settings';
export type AuditAction = 'created' | 'updated' | 'deleted';

export interface AuditLogEntry {
  id: string;
  /** `<entityType>.<verb>`, e.g. `users.updated`. */
  action: string;
  entityType: string;
  entityId: string | null;
  actor: { id: string | null; type: 'human'; name: string | null };
  occurredAt: number;
  /** `{after}` for create, `{before}` for delete, `{before,after}` for update. */
  diff?: unknown;
}

/** The API's error body. */
export interface ApiErrorBody {
  name: string;
  message: string;
  statusCode: number;
}

// ---- list filters -------------------------------------------------------------------------

export interface ListComputersOptions extends PageOptions {
  companyId?: string;
  locationId?: string;
}

export interface ListLocationsOptions extends PageOptions {
  companyId?: string;
}

export interface ListElevationRequestsOptions extends PageOptions, TimeRange {
  companyId?: string;
  approvalState?: ApprovalState;
}

export interface ListElevationEventsOptions extends PageOptions, TimeRange {
  companyId?: string;
}

export interface ListElevatedSessionsOptions extends PageOptions {
  companyId?: string;
  computerId?: string;
  /** `active` = running now; `inactive` = ended (completed or expired). */
  status?: 'active' | 'inactive';
}

export interface ListElevationRulesOptions extends PageOptions {
  companyId?: string;
}

export interface ListAuditLogsOptions extends TimeRange {
  take?: number;
  cursor?: string;
  entityType?: AuditEntityType;
  action?: AuditAction;
}

// ---- write payloads ------------------------------------------------------------------------

/** Body for `POST /elevation-requests/{id}/approve`. The request must be `PENDING`. */
export interface ApproveElevationRequestPayload {
  /** Overrides the elevation level recorded on the request. Defaults to the request's own. */
  elevationType?: RuleElevationType;
  /** Also create an auto-approval rule from this request. Requires `ruleLevel`. */
  createRule?: boolean;
  /** Scope of the auto-created rule. Required when `createRule` is `true`. */
  ruleLevel?: RuleLevel;
  /** Session length in minutes for elevated-session requests; ignored otherwise. Must be > 0. */
  durationInMinutes?: number;
}

/** Body for `POST /elevation-requests/{id}/deny`. The request must be `PENDING`. */
export interface DenyElevationRequestPayload {
  /** Also create a denial rule from this request. Requires `ruleLevel`. */
  createRule?: boolean;
  /** Scope of the auto-created rule. Required when `createRule` is `true`. */
  ruleLevel?: RuleLevel;
  /** Plain text shown to the end user with the denial. Max 1000 characters. */
  denialReason?: string;
}
