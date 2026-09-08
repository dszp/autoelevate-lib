/**
 * The mutation surface of the Partner API: approve or deny a pending elevation request.
 *
 * A separate class on purpose. The read client's guarantee is that it cannot write; this class is
 * the explicit opt-in, and it needs a key carrying the `requestEdit` scope. Validation below mirrors
 * what the server enforces (400) so a bad call fails before spending a request from the hourly
 * bucket, and so the error names the field instead of echoing a generic message.
 */
import { AutoElevateHttp, type AutoElevateHttpConfig } from './http.js';
import type {
  ApproveElevationRequestPayload,
  DenyElevationRequestPayload,
  ElevationRequest,
} from './model.js';

export type AutoElevateWriteClientConfig = AutoElevateHttpConfig;

const RULE_LEVELS = new Set(['msp', 'company', 'location', 'computer']);
const ELEVATION_TYPES = new Set(['admin', 'user']);
export const DENIAL_REASON_MAX = 1000;

/** A payload the server would reject with 400, caught before the request is made. */
export class AutoElevateValidationError extends Error {
  constructor(
    public readonly field: string,
    message: string,
  ) {
    super(message);
    this.name = 'AutoElevateValidationError';
  }
}

function requireId(id: string): string {
  const trimmed = id.trim();
  if (!trimmed) throw new AutoElevateValidationError('id', 'Elevation request id is required.');
  return trimmed;
}

function validateRule(p: { createRule?: boolean; ruleLevel?: string }): void {
  if (p.createRule && !p.ruleLevel) {
    throw new AutoElevateValidationError('ruleLevel', 'ruleLevel is required when createRule is true.');
  }
  if (p.ruleLevel !== undefined && !RULE_LEVELS.has(p.ruleLevel)) {
    throw new AutoElevateValidationError('ruleLevel', `ruleLevel must be one of msp, company, location, computer; got "${p.ruleLevel}".`);
  }
}

export function validateApprovePayload(p: ApproveElevationRequestPayload): void {
  validateRule(p);
  if (p.elevationType !== undefined && !ELEVATION_TYPES.has(p.elevationType)) {
    throw new AutoElevateValidationError('elevationType', `elevationType must be admin or user; got "${p.elevationType}".`);
  }
  if (p.durationInMinutes !== undefined && (!Number.isInteger(p.durationInMinutes) || p.durationInMinutes <= 0)) {
    throw new AutoElevateValidationError('durationInMinutes', 'durationInMinutes must be a positive integer.');
  }
}

export function validateDenyPayload(p: DenyElevationRequestPayload): void {
  validateRule(p);
  // `.length` counts UTF-16 code units, matching a JavaScript server-side validator (`string.length`,
  // not `Array.from(string).length`). That undercounts a handful of characters outside the BMP
  // (surrogate pairs count as 2), so this errs toward rejecting locally rather than passing a
  // borderline value through to a 400 from the API.
  if (p.denialReason !== undefined && p.denialReason.length > DENIAL_REASON_MAX) {
    throw new AutoElevateValidationError('denialReason', `denialReason must be at most ${DENIAL_REASON_MAX} characters.`);
  }
}

/**
 * `JSON.stringify` already drops keys whose value is `undefined`, so this makes no difference to
 * the wire body. It exists as belt-and-braces: the payload object itself is clean for any caller
 * who inspects it (e.g. before it's serialised) rather than only for the request that goes out.
 */
function compact<T extends object>(p: T): T {
  return Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)) as T;
}

export class AutoElevateWriteClient {
  readonly #http: AutoElevateHttp;

  constructor(config: AutoElevateWriteClientConfig) {
    this.#http = new AutoElevateHttp(config);
  }

  /** Scope: `requestEdit`. The request must be `PENDING`; otherwise the API returns 409. */
  async approveElevationRequest(id: string, payload: ApproveElevationRequestPayload = {}): Promise<ElevationRequest> {
    const rid = requireId(id);
    validateApprovePayload(payload);
    return (await this.#http.post<ElevationRequest>(`/elevation-requests/${encodeURIComponent(rid)}/approve`, compact(payload))).body;
  }

  /** Scope: `requestEdit`. The request must be `PENDING`; otherwise the API returns 409. */
  async denyElevationRequest(id: string, payload: DenyElevationRequestPayload = {}): Promise<ElevationRequest> {
    const rid = requireId(id);
    validateDenyPayload(payload);
    return (await this.#http.post<ElevationRequest>(`/elevation-requests/${encodeURIComponent(rid)}/deny`, compact(payload))).body;
  }
}
