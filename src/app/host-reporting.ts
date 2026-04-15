import type { RuntimeEvent } from "../runtime/events.js";
import { SecretGuard } from "../security/secret-guard.js";

const HOST_REPORT_ERROR_GUARD = new SecretGuard("REDACT_AND_CONTINUE");

export function summarizeHostReportError(error: unknown): string {
  if (error instanceof Error) {
    return HOST_REPORT_ERROR_GUARD.safeErrorMessage(error);
  }
  const filtered = HOST_REPORT_ERROR_GUARD.filterOutput(error).output;
  try {
    return JSON.stringify(filtered);
  } catch {
    return "Telegram report delivery failed";
  }
}

export function buildReportFailedRuntimeEvent(
  sourceEvent: RuntimeEvent,
  errorSummary: string,
): RuntimeEvent {
  return {
    eventId: `${sourceEvent.eventId}:report_failed:${Date.now()}`,
    createdAt: new Date().toISOString(),
    correlationId: sourceEvent.correlationId,
    intentId: sourceEvent.intentId,
    action: sourceEvent.action,
    entrySource: sourceEvent.entrySource,
    target: sourceEvent.target,
    stage: "report_failed",
    summary: `Telegram report delivery failed after ${sourceEvent.stage}.`,
    reason: errorSummary,
    txRefs: sourceEvent.txRefs,
    approvalId: sourceEvent.approvalId,
    demoRun: sourceEvent.demoRun,
    executionEvidence: sourceEvent.executionEvidence,
  };
}

export type HostEventPublisherDeps = {
  readonly runtimeEvents: RuntimeEvent[];
  readonly eventStore?: { append(event: RuntimeEvent): void };
  readonly maxRuntimeEvents?: number;
  readonly getReportNotifier: () => { sendExecutionReport(event: RuntimeEvent): Promise<void> } | undefined;
  readonly onTelegramReportFailure: (sourceEvent: RuntimeEvent, errorSummary: string) => Promise<void>;
};

function shouldSendGuardianTelegramReport(event: RuntimeEvent): boolean {
  return (
    event.entrySource === "guardian" &&
    (event.stage === "guardian_detected" ||
      event.stage === "executed" ||
      event.stage === "blocked" ||
      event.stage === "rejected")
  );
}

export function createHostEventPublisher(deps: HostEventPublisherDeps): {
  publishRuntimeEvent(
    event: RuntimeEvent,
    options?: { readonly skipTelegramReport?: boolean },
  ): Promise<void>;
} {
  return {
    async publishRuntimeEvent(
      event: RuntimeEvent,
      options: { readonly skipTelegramReport?: boolean } = {},
    ): Promise<void> {
      deps.runtimeEvents.push(event);
      const maxEvents = deps.maxRuntimeEvents ?? 500;
      if (deps.runtimeEvents.length > maxEvents) {
        deps.runtimeEvents.splice(0, deps.runtimeEvents.length - maxEvents);
      }
      deps.eventStore?.append(event);
      const reportNotifier = deps.getReportNotifier();
      if (!options.skipTelegramReport && reportNotifier && shouldSendGuardianTelegramReport(event)) {
        try {
          await reportNotifier.sendExecutionReport(event);
        } catch (error) {
          const summary = summarizeHostReportError(error);
          console.error("Guardian Telegram report delivery failed:", summary);
          await deps.onTelegramReportFailure(event, summary);
        }
      }
    },
  };
}
