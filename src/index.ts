/**
 * @dszp/autoelevate-lib — read-only client for the AutoElevate Partner API (beta).
 *
 * The raw transport (`AutoElevateHttp`) is intentionally not exported; see `http.ts`.
 */
export { AutoElevateReadClient, IncompleteListError, MAX_PAGE_SIZE } from './readClient.js';
export type { AutoElevateReadClientConfig, WalkOptions } from './readClient.js';
export { AutoElevateApiError, DEFAULT_BASE_URL, API_PREFIX } from './http.js';
export type { DeprecationInfo } from './http.js';
export {
  signRequest,
  sha256Hex,
  hmacStringToSign,
  HMAC_SCHEME,
  EMPTY_BODY_SHA256,
  ACKNOWLEDGMENT_HEADER,
  ACKNOWLEDGMENT_VALUE,
} from './auth.js';
export type { Credential, BearerCredential, HmacCredential } from './auth.js';
export { gatherAgentCounts, bucketAgents } from './counts.js';
export type { AgentCountsReport, CompanyAgentCount, ElevationModeBucket, GatherAgentCountsOptions } from './counts.js';
export type * from './model.js';
