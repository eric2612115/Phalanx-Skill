import type { RebalanceDemoRunMetadata } from "../demo/rebalance-flow.js";
import type { RuntimeIntent } from "./types.js";

export type RuntimeEventStage =
  | "guardian_detected"
  | "intent_received"
  | "awaiting_approval"
  | "approval_resumed"
  | "executed"
  | "blocked"
  | "rejected";

export interface RuntimeEvent {
  readonly eventId: string;
  readonly createdAt: string;
  readonly correlationId: string;
  readonly intentId: string;
  readonly action: string;
  readonly entrySource: RuntimeIntent["entrySource"];
  readonly target?: string;
  readonly stage: RuntimeEventStage;
  readonly summary: string;
  readonly reason?: string;
  readonly riskNotes?: readonly string[];
  readonly txRefs?: readonly string[];
  readonly approvalId?: string;
  /** Structured OmRate + Uniswap demo context when the event belongs to the agentic rebalance demo path. */
  readonly demoRun?: RebalanceDemoRunMetadata;
}

function stringField(payload: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function stringArrayField(payload: Readonly<Record<string, unknown>>, key: string): readonly string[] | undefined {
  const value = payload[key];
  if (!Array.isArray(value)) {
    return undefined;
  }
  const strings = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return strings.length > 0 ? strings : undefined;
}

export function buildRuntimeEvent(
  intent: RuntimeIntent,
  stage: RuntimeEventStage,
  extra: Partial<
    Omit<RuntimeEvent, "eventId" | "createdAt" | "correlationId" | "intentId" | "action" | "entrySource" | "target" | "stage">
  > = {},
): RuntimeEvent {
  const payload = intent.payload;
  const defaultReason = stringField(payload, "reason");
  const riskNotes = stringArrayField(payload, "riskNotes");
  return {
    eventId: `${intent.id}:${stage}:${Date.now()}`,
    createdAt: new Date().toISOString(),
    correlationId: intent.id,
    intentId: intent.id,
    action: intent.action,
    entrySource: intent.entrySource,
    target: intent.target,
    stage,
    summary: extra.summary ?? `${intent.action} ${stage}`,
    reason: extra.reason ?? defaultReason,
    riskNotes: extra.riskNotes ?? riskNotes,
    txRefs: extra.txRefs,
    approvalId: extra.approvalId,
    demoRun: extra.demoRun,
  };
}

export function extractRuntimeTxRefs(adapterResult: unknown): readonly string[] | undefined {
  if (!adapterResult || typeof adapterResult !== "object") {
    return undefined;
  }
  const record = adapterResult as Record<string, unknown>;
  if (Array.isArray(record.txRefs)) {
    const txRefs = record.txRefs.filter((item): item is string => typeof item === "string" && item.length > 0);
    return txRefs.length > 0 ? txRefs : undefined;
  }
  if (typeof record.txHash === "string" && record.txHash.length > 0) {
    return [record.txHash];
  }
  if (Array.isArray(record.broadcasts)) {
    const txRefs = record.broadcasts
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
      .map((item) => (typeof item.txHash === "string" ? item.txHash : undefined))
      .filter((item): item is string => Boolean(item));
    return txRefs.length > 0 ? txRefs : undefined;
  }
  return undefined;
}
