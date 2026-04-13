import type { PhalanxHost } from "../../app/host.js";
import type { RebalanceDemoRunMetadata } from "../../demo/rebalance-flow.js";
import type { RuntimeEventStage } from "../../runtime/events.js";

export interface OperatorEventEntry {
  readonly eventId: string;
  readonly createdAt: string;
  readonly stage: RuntimeEventStage;
  readonly action: string;
  readonly entrySource: string;
  readonly target?: string;
  readonly summary: string;
  readonly reason?: string;
  readonly riskNotes?: readonly string[];
  readonly txRefs?: readonly string[];
  readonly approvalId?: string;
  readonly correlationId: string;
  readonly intentId: string;
  readonly demoRun?: RebalanceDemoRunMetadata;
}

export interface OperatorEventSnapshot {
  readonly limit: number;
  readonly items: readonly OperatorEventEntry[];
}

export async function fetchOperatorEventSnapshot(
  host: PhalanxHost,
  options: { readonly limit?: number } = {},
): Promise<OperatorEventSnapshot> {
  const limit = options.limit ?? 50;
  const raw = host.getRuntimeEvents(limit);
  const items: OperatorEventEntry[] = raw.map((e) => ({
    eventId: e.eventId,
    createdAt: e.createdAt,
    stage: e.stage,
    action: e.action,
    entrySource: e.entrySource,
    target: e.target,
    summary: e.summary,
    reason: e.reason,
    riskNotes: e.riskNotes,
    txRefs: e.txRefs,
    approvalId: e.approvalId,
    correlationId: e.correlationId,
    intentId: e.intentId,
    demoRun: e.demoRun,
  }));
  return { limit, items };
}
