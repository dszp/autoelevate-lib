/**
 * Per-company active-agent counts for billing reconciliation.
 *
 * The API has no per-company count endpoint: `/usage` is one MSP-wide number, and filtering
 * `/computers` by `companyId` would cost one request per client against a 100-per-hour bucket.
 * Walking `/computers` unfiltered at 200 per page and bucketing client-side costs
 * `ceil(computers/200) + ceil(companies/200) + 1` requests for the whole MSP.
 */
import type { AutoElevateReadClient } from './readClient.js';
import type { Company, Computer, ElevationMode } from './model.js';

export type ElevationModeBucket = ElevationMode | 'unknown';

export interface CompanyAgentCount {
  companyId: string;
  /** `null` when a computer references a company the key cannot see (restricted-company keys). */
  companyName: string | null;
  managementSystemCompanyId: string | null;
  /** Computers seen in the last 30 days. */
  activeAgents: number;
  byElevationMode: Record<ElevationModeBucket, number>;
}

export interface AgentCountsReport {
  /** Epoch ms when the report was gathered. */
  gatheredAt: number;
  msp: {
    partnerId: string;
    partnerName: string;
    /** From `/usage`. A periodically refreshed snapshot. */
    fromUsage: number;
    /** From walking `/computers`. Live. */
    fromComputers: number;
    /** `fromUsage === fromComputers`. A small delta is the snapshot lag, not a bug; a large one is worth a look. */
    agree: boolean;
  };
  /** Sorted by company name; companies with zero active agents are present with 0. */
  companies: CompanyAgentCount[];
}

export interface GatherAgentCountsOptions {
  nowMs?: () => number;
}

const MODES: ElevationModeBucket[] = ['audit', 'live', 'policy', 'technicianBypass', 'unknown'];

function emptyModes(): Record<ElevationModeBucket, number> {
  return Object.fromEntries(MODES.map((m) => [m, 0])) as Record<ElevationModeBucket, number>;
}

/** Pure bucketing step, exported so it can be tested without a client and reused by the n8n node. */
export function bucketAgents(companies: Company[], computers: Computer[]): CompanyAgentCount[] {
  const byId = new Map<string, CompanyAgentCount>();
  for (const c of companies) {
    byId.set(c.id, {
      companyId: c.id,
      companyName: c.name,
      managementSystemCompanyId: c.managementSystemCompanyId,
      activeAgents: 0,
      byElevationMode: emptyModes(),
    });
  }
  for (const m of computers) {
    let row = byId.get(m.companyId);
    if (!row) {
      row = {
        companyId: m.companyId,
        companyName: null,
        managementSystemCompanyId: null,
        activeAgents: 0,
        byElevationMode: emptyModes(),
      };
      byId.set(m.companyId, row);
    }
    row.activeAgents++;
    row.byElevationMode[m.elevationMode ?? 'unknown']++;
  }
  return [...byId.values()].sort((a, b) =>
    (a.companyName ?? '￿').localeCompare(b.companyName ?? '￿') || a.companyId.localeCompare(b.companyId),
  );
}

/** Scopes needed: `computerView`, `companyView`. */
export async function gatherAgentCounts(
  client: AutoElevateReadClient,
  opts: GatherAgentCountsOptions = {},
): Promise<AgentCountsReport> {
  const nowMs = opts.nowMs ?? Date.now;
  const [usage, companies, computers] = await Promise.all([
    client.getUsage(),
    client.listAllCompanies(),
    client.listAllComputers(),
  ]);
  return {
    gatheredAt: nowMs(),
    msp: {
      partnerId: usage.partnerId,
      partnerName: usage.partnerName,
      fromUsage: usage.totalActiveAgents,
      fromComputers: computers.length,
      agree: usage.totalActiveAgents === computers.length,
    },
    companies: bucketAgents(companies, computers),
  };
}
