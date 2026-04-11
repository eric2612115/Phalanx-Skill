import { resolve } from "node:path";

import { buildRuntimeConfig, type RuntimeConfig, type RuntimeMode } from "../config/store.js";
import { ApprovalPolicy } from "../policy/approval-policy.js";
import { PolicyGate } from "../policy/gate.js";
import { WhitelistPolicy } from "../policy/whitelist-policy.js";
import { RiskEngine, type RiskEvaluationContext } from "../risk/engine.js";
import { ApprovalRouter } from "../runtime/approval-router.js";
import { RuntimeCore, type ExecutionAdapter } from "../runtime/core.js";
import { buildRuntimeEvent, type RuntimeEvent } from "../runtime/events.js";
import { PendingOperationsTracker } from "../runtime/pending-operations.js";
import type { PolicyContext, RuntimeLifecycleState, RuntimeOutcome } from "../runtime/types.js";
import { invokePhalanxMcpTool, type McpToolResult, type TelegramApprovalNotifier } from "../mcp/server.js";
import { buildStatusToolResult } from "../mcp/tools/status.js";
import { buildApprovalCallbackData, parseApprovalCallbackData } from "../telegram/approvals.js";
import { createSetupSession, handleTelegramUpdate, type SetupSession, type TelegramUpdate } from "../telegram/setup.js";
import { createSkillBackedExecutor } from "../executors/skill-backed.js";
import { createGovernanceAwareExecutor } from "../executors/governance-aware.js";
import { writeWhitelistContractAllowance } from "../adapters/whitelist-contract.js";
import type { UniswapPlannerExecutionHooks } from "../adapters/uniswap.js";
import type { GuardianCycleResult } from "../guardian/cycle.js";
import { EventStore } from "../storage/event-store.js";

export interface ApprovalOutboxItem {
  readonly approvalId: string;
  readonly summary: string;
  readonly approveCallbackData: string;
  readonly rejectCallbackData: string;
}

export interface TelegramCallbackResult {
  readonly handled: boolean;
  readonly decision?: "approve" | "reject";
  readonly runtimeOutcome?: RuntimeOutcome;
}

export interface RuntimeStartupSummary {
  readonly mode: RuntimeMode;
  readonly lifecycle: RuntimeLifecycleState;
  readonly executionPaused: boolean;
  readonly pendingApprovals: number;
  readonly guidance: string;
  readonly config: RuntimeConfig["readiness"];
  readonly surfaces: {
    readonly mcp: "ready";
    readonly telegram: "ready";
    readonly guardian: "disabled" | "enabled";
  };
}

export interface TelegramReportNotifier {
  sendExecutionReport(event: RuntimeEvent): Promise<void>;
}

export interface CreatePhalanxHostOptions {
  readonly configValues?: Readonly<Record<string, string | undefined>>;
  readonly lifecycle?: RuntimeLifecycleState;
  readonly executionPaused?: boolean;
  readonly approvalNotifyTimeoutMs?: number;
  readonly guardianEnabled?: boolean;
  readonly whitelistTargets?: readonly string[];
  readonly executor?: ExecutionAdapter;
  readonly riskContext?: RiskEvaluationContext;
  readonly setupSession?: SetupSession;
  readonly telegramApproval?: TelegramApprovalNotifier;
  readonly telegramReport?: TelegramReportNotifier;
  readonly eventStorePath?: string;
  readonly governanceWriteImpl?: typeof writeWhitelistContractAllowance;
  /** Injected for tests; production uses real `npx skills list` and DexScreener fetch. */
  readonly uniswapPlannerHooks?: UniswapPlannerExecutionHooks;
}

export interface PhalanxHost {
  invokeMcp(toolName: string, args: Record<string, unknown>): Promise<McpToolResult>;
  handleTelegramMessage(update: TelegramUpdate): ReturnType<typeof handleTelegramUpdate>;
  handleTelegramCallback(callbackData: string): Promise<TelegramCallbackResult>;
  bindTelegramApprovalNotifier(notifier: TelegramApprovalNotifier): void;
  bindTelegramReportNotifier(notifier: TelegramReportNotifier): void;
  handleGuardianCycleResult(result: GuardianCycleResult): Promise<readonly RuntimeOutcome[]>;
  getTelegramApprovalOutbox(): readonly ApprovalOutboxItem[];
  getPolicyContext(): PolicyContext;
  getSetupSession(): Readonly<SetupSession>;
  getRuntimeConfig(): RuntimeConfig;
  getRuntimeEvents(limit?: number): readonly RuntimeEvent[];
  getStartupSummary(): RuntimeStartupSummary;
}

function createDryRunExecutor(
  env: NodeJS.ProcessEnv,
  uniswapPlannerHooks?: UniswapPlannerExecutionHooks,
): ExecutionAdapter {
  return {
    async execute(intent: Parameters<ExecutionAdapter["execute"]>[0]): Promise<unknown> {
      if (intent.action === "planUniswapLiquidity") {
        const { runUniswapLiquidityPlannerForPayload } = await import("../adapters/uniswap.js");
        return runUniswapLiquidityPlannerForPayload(intent.payload, env, uniswapPlannerHooks);
      }
      return {
        mode: "dry_run",
        action: intent.action,
        target: intent.target ?? null,
        payload: intent.payload,
      };
    },
  };
}

function parseWhitelistTargets(values: Readonly<Record<string, string | undefined>>): string[] {
  const raw = values.WHITELIST_TARGETS ?? values.PHALANX_WHITELIST_TARGETS ?? "";
  const parsed = raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  return normalizeWhitelistTargets(parsed.length > 0 ? parsed : ["pool"]);
}

function normalizeWhitelistTargets(targets: readonly string[]): string[] {
  const next = new Set(targets.map((target) => target.trim()).filter((target) => target.length > 0));
  next.add("whitelist-admin");
  return [...next];
}

function pickExecutor(
  options: CreatePhalanxHostOptions,
  configValues: Readonly<Record<string, string | undefined>>,
): ExecutionAdapter {
  if (options.executor) {
    return options.executor;
  }
  const env = configValues as NodeJS.ProcessEnv;
  if ((configValues.PHALANX_EXECUTION_BACKEND ?? "").trim() === "onchainos_skill") {
    return createSkillBackedExecutor({ env, uniswapPlannerHooks: options.uniswapPlannerHooks });
  }
  return createDryRunExecutor(env, options.uniswapPlannerHooks);
}

function pickEventStorePath(
  options: CreatePhalanxHostOptions,
  configValues: Readonly<Record<string, string | undefined>>,
): string | undefined {
  const explicit = options.eventStorePath?.trim();
  if (explicit) {
    return explicit;
  }
  const raw = configValues.PHALANX_EVENT_STORE_PATH?.trim();
  return raw && raw.length > 0 ? resolve(raw) : undefined;
}

export function createPhalanxHost(options: CreatePhalanxHostOptions = {}): PhalanxHost {
  const approvalRouter = new ApprovalRouter();
  const pendingOps = new PendingOperationsTracker();
  const approvalOutbox: ApprovalOutboxItem[] = [];
  const runtimeEvents: RuntimeEvent[] = [];
  const session = options.setupSession ?? createSetupSession();
  const configValues = options.configValues ?? process.env;
  const runtimeConfig = buildRuntimeConfig(configValues);
  const whitelistTargets = normalizeWhitelistTargets(options.whitelistTargets ?? parseWhitelistTargets(configValues));
  const whitelistPolicy = new WhitelistPolicy(new Set(whitelistTargets));
  const executor = createGovernanceAwareExecutor({
    baseExecutor: pickExecutor(options, configValues),
    whitelistPolicy,
    env: configValues as NodeJS.ProcessEnv,
    governanceWriteImpl: options.governanceWriteImpl,
  });
  const eventStorePath = pickEventStorePath(options, configValues);
  const eventStore = eventStorePath ? new EventStore<RuntimeEvent>(eventStorePath, 500) : undefined;
  const restoredLifecycle: RuntimeLifecycleState =
    runtimeConfig.mode === "live" &&
    runtimeConfig.readiness.liveReady &&
    Boolean(runtimeConfig.telegram.allowedUserId)
      ? "READY"
      : session.lifecycle;
  const policyState: { lifecycle: RuntimeLifecycleState; executionPaused: boolean } = {
    lifecycle: options.lifecycle ?? restoredLifecycle,
    executionPaused: options.executionPaused ?? false,
  };

  session.lifecycle = policyState.lifecycle;
  if (policyState.lifecycle === "READY") {
    session.ownerUserId ??= runtimeConfig.telegram.allowedUserId ?? "dry-run-owner";
    session.pendingOwnerUserId = null;
    session.wizardStep = null;
  }

  const fallbackNotifier: TelegramApprovalNotifier = {
    async sendApprovalRequest({ approvalId, summary }) {
      approvalOutbox.push({
        approvalId,
        summary,
        approveCallbackData: buildApprovalCallbackData("approve", approvalId),
        rejectCallbackData: buildApprovalCallbackData("reject", approvalId),
      });
      return { ok: true };
    },
  };
  let notifier: TelegramApprovalNotifier = options.telegramApproval ?? fallbackNotifier;
  let reportNotifier: TelegramReportNotifier | undefined = options.telegramReport;

  async function publishRuntimeEvent(event: RuntimeEvent): Promise<void> {
    runtimeEvents.push(event);
    if (runtimeEvents.length > 500) {
      runtimeEvents.splice(0, runtimeEvents.length - 500);
    }
    eventStore?.append(event);
    if (
      reportNotifier &&
      event.entrySource === "guardian" &&
      (event.stage === "executed" || event.stage === "blocked" || event.stage === "rejected")
    ) {
      await reportNotifier.sendExecutionReport(event);
    }
  }

  const core = new RuntimeCore({
    policyGate: new PolicyGate({
      whitelist: whitelistPolicy,
    }),
    riskEngine: new RiskEngine(),
    approvalPolicy: new ApprovalPolicy(),
    approvalRouter,
    pendingOps,
    executor,
    emitEvent: publishRuntimeEvent,
    getPolicyContext: () => ({ ...policyState }),
    getRiskContext: () => options.riskContext ?? { now: Date.now() },
  });

  async function invokeMcp(toolName: string, args: Record<string, unknown>): Promise<McpToolResult> {
    return invokePhalanxMcpTool(toolName, args, {
      core,
      approvalRouter,
      pendingOps,
      getPolicyContext: () => ({ ...policyState }),
      telegramApproval: notifier,
      approvalNotifyTimeoutMs: options.approvalNotifyTimeoutMs ?? 8_000,
    });
  }

  async function routeMessage(update: TelegramUpdate) {
    const result = await handleTelegramUpdate(update, session);
    policyState.lifecycle = result.nextState;
    return result;
  }

  async function routeCallback(callbackData: string): Promise<TelegramCallbackResult> {
    const parsed = parseApprovalCallbackData(callbackData);
    if (!parsed) {
      return { handled: false };
    }
    const runtimeOutcome = await core.submitApprovalDecision(parsed.approvalId, parsed.action === "approve");
    const remaining = approvalOutbox.filter((item) => item.approvalId !== parsed.approvalId);
    approvalOutbox.length = 0;
    approvalOutbox.push(...remaining);
    return {
      handled: true,
      decision: parsed.action,
      runtimeOutcome,
    };
  }

  async function handleGuardianCycle(result: GuardianCycleResult): Promise<readonly RuntimeOutcome[]> {
    const outcomes: RuntimeOutcome[] = [];
    for (const item of result.items) {
      const intent = item.intent;
      if (intent) {
        await publishRuntimeEvent(
          buildRuntimeEvent(intent, "guardian_detected", {
            summary: item.explanation.whatWeDid,
            reason: item.explanation.detected,
            riskNotes: item.explanation.furtherAction ? [item.explanation.furtherAction] : undefined,
          }),
        );
        outcomes.push(await core.handleIntent(intent));
        continue;
      }
      const notifyId = `guardian-notify-${Date.now()}`;
      await publishRuntimeEvent({
        eventId: notifyId,
        createdAt: new Date().toISOString(),
        correlationId: notifyId,
        intentId: notifyId,
        action: "guardian_notify",
        entrySource: "guardian",
        target: undefined,
        stage: "guardian_detected",
        summary: item.explanation.whatWeDid,
        reason: item.explanation.detected,
        riskNotes: item.explanation.furtherAction ? [item.explanation.furtherAction] : undefined,
      });
    }
    return outcomes;
  }

  function getStartupSummary(): RuntimeStartupSummary {
    const status = buildStatusToolResult(() => ({ ...policyState }));
    return {
      mode: runtimeConfig.mode,
      lifecycle: status.lifecycle,
      executionPaused: status.executionPaused,
      pendingApprovals: approvalRouter.size(),
      guidance: status.guidance,
      config: runtimeConfig.readiness,
      surfaces: {
        mcp: "ready",
        telegram: "ready",
        guardian: options.guardianEnabled ? "enabled" : "disabled",
      },
    };
  }

  return {
    invokeMcp,
    handleTelegramMessage: routeMessage,
    handleTelegramCallback: routeCallback,
    bindTelegramApprovalNotifier: (nextNotifier) => {
      notifier = nextNotifier;
      approvalOutbox.length = 0;
    },
    bindTelegramReportNotifier: (nextNotifier) => {
      reportNotifier = nextNotifier;
    },
    handleGuardianCycleResult: handleGuardianCycle,
    getTelegramApprovalOutbox: () => [...approvalOutbox],
    getPolicyContext: () => ({ ...policyState }),
    getSetupSession: () => session,
    getRuntimeConfig: () => runtimeConfig,
    getRuntimeEvents: (limit = 50) => runtimeEvents.slice(Math.max(0, runtimeEvents.length - limit)),
    getStartupSummary,
  };
}

export function buildDryRunStartupSummary(host: PhalanxHost): RuntimeStartupSummary {
  return host.getStartupSummary();
}
