import type { PhalanxHost, RuntimeStartupSummary } from "../../app/host.js";
import type { RuntimeReadinessSummary } from "../../config/store.js";

export interface OperatorStatusSnapshot {
  readonly mode: RuntimeStartupSummary["mode"];
  readonly lifecycle: RuntimeStartupSummary["lifecycle"];
  readonly executionPaused: boolean;
  readonly pendingApprovals: number;
  readonly guidance: string;
  readonly readiness: RuntimeReadinessSummary;
  readonly surfaces: RuntimeStartupSummary["surfaces"];
}

export async function fetchOperatorStatusSnapshot(host: PhalanxHost): Promise<OperatorStatusSnapshot> {
  const summary = host.getStartupSummary();
  const cfg = host.getRuntimeConfig();
  return {
    mode: summary.mode,
    lifecycle: summary.lifecycle,
    executionPaused: summary.executionPaused,
    pendingApprovals: summary.pendingApprovals,
    guidance: summary.guidance,
    readiness: cfg.readiness,
    surfaces: summary.surfaces,
  };
}
