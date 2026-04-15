import {
  buildRuntimeConfig,
  hasExecutionWalletSignal,
  type RuntimeConfig,
  type RuntimeMode,
} from "../config/store.js";
import { ApprovalPolicy } from "../policy/approval-policy.js";
import { PolicyGate } from "../policy/gate.js";
import { WhitelistPolicy } from "../policy/whitelist-policy.js";
import { RiskEngine, type RiskEvaluationContext } from "../risk/engine.js";
import { ApprovalRouter } from "../runtime/approval-router.js";
import { RuntimeCore, type ExecutionAdapter } from "../runtime/core.js";
import { buildRuntimeEvent, extractRuntimeTxRefs, type RuntimeEvent } from "../runtime/events.js";
import { PendingOperationsTracker } from "../runtime/pending-operations.js";
import type { PolicyContext, RuntimeLifecycleState, RuntimeOutcome } from "../runtime/types.js";
import { invokePhalanxMcpTool, type McpToolResult, type TelegramApprovalNotifier } from "../mcp/server.js";
import { buildStatusToolResult } from "../mcp/tools/status.js";
import { buildApprovalCallbackData, parseApprovalCallbackData } from "../telegram/approvals.js";
import { createSetupSession, handleTelegramUpdate, type SetupSession, type TelegramUpdate } from "../telegram/setup.js";
import { createSkillBackedExecutor } from "../executors/skill-backed.js";
import { createGovernanceAwareExecutor } from "../executors/governance-aware.js";
import { writeWhitelistContractAllowance } from "../adapters/whitelist-contract.js";
import {
  executeUniswapLiquidityPlannerInvocation,
  planUniswapLiquidityPlannerInvocation,
  type UniswapPlannerExecutionHooks,
} from "../adapters/uniswap.js";
import type { GuardianCycleResult } from "../guardian/cycle.js";
import {
  summarizeGuardianCycleForOperator,
  type GuardianLastAssessment,
} from "../guardian/operator-assessment.js";
import { EventStore } from "../storage/event-store.js";
import {
  runRebalanceDemoFlow,
  type RebalanceDemoFlowInput,
  type RebalanceDemoFlowResult,
  type RebalanceDemoRunMetadata,
} from "../demo/rebalance-flow.js";
import {
  executeGuardianAllocationMainline,
  type GuardianAllocationMainlineResult,
} from "../demo/allocation-mainline.js";
import { executeOmRateQuery } from "../adapters/omrate.js";
import { normalizeWalletEvidence, type WalletEvidence } from "../runtime/execution-evidence.js";
import type { ExecuteLpPositionIntentHooks } from "../adapters/lp-execution.js";
import {
  normalizeWhitelistTargets,
  parseWhitelistTargets,
  pickEventStorePath,
  pickExecutor,
  resolveAgenticRebalanceDemoConfig,
} from "./host-bootstrap.js";
import {
  buildSyntheticGuardianRebalanceItem,
  finalizeGuardianDemoRunForOutcome,
  type GuardianDemoApprovalContext,
} from "./host-guardian-demo.js";
import {
  buildReportFailedRuntimeEvent,
  createHostEventPublisher,
  summarizeHostReportError,
} from "./host-reporting.js";

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
  /** Optional hooks for Onchain OS–backed LP execution (tests, dry instrumentation). */
  readonly lpExecutionHooks?: ExecuteLpPositionIntentHooks;
  readonly agenticRebalanceDemo?: {
    readonly enabled: boolean;
    readonly omRatePath: string;
    readonly chain: string;
    readonly tokenA: string;
    readonly tokenB: string;
    readonly positionType?: RebalanceDemoFlowInput["positionType"];
  };
  readonly rebalanceDemoRunner?: (input: RebalanceDemoFlowInput) => Promise<RebalanceDemoFlowResult>;
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
  getPendingApprovalCount(): number;
  getEffectiveWhitelistTargets(): readonly string[];
  getRiskEvaluationContext(): RiskEvaluationContext;
  getRiskRuleOrder(): readonly string[];
  getGuardianLastAssessment(): GuardianLastAssessment | undefined;
  recordTelegramReportFailure(sourceEvent: RuntimeEvent, errorSummary: string): Promise<void>;
  getOperatorWalletSummary(): {
    readonly executionOrTestAddress?: string;
    readonly walletEvidence: WalletEvidence;
  };
  getLatestRebalanceDemoRunSummary(): RebalanceDemoRunMetadata | undefined;
  /**
   * Runs {@link executeGuardianAllocationMainline} with the same MCP bridge and funding gates as the
   * guardian agentic rebalance demo path. Requires `PHALANX_AGENTIC_REBALANCE_DEMO_ENABLED=1` or
   * `agenticRebalanceDemo.enabled` in {@link createPhalanxHost}.
   */
  runAgenticAllocationMainlineDemo(guardianReason?: string): Promise<GuardianAllocationMainlineResult>;
}

function isExecutedMcpResult(
  result: McpToolResult,
): result is { ok: true; data: { kind: "executed"; adapterResult: unknown } } {
  return Boolean(
    result.ok &&
      result.data &&
      typeof result.data === "object" &&
      "kind" in result.data &&
      (result.data as { kind?: unknown }).kind === "executed",
  );
}

function isPendingApprovalMcpResult(
  result: McpToolResult,
): result is { ok: true; data: { kind: "pending_approval"; approvalId: string } } {
  return Boolean(
    result.ok &&
      result.data &&
      typeof result.data === "object" &&
      "kind" in result.data &&
      (result.data as { kind?: unknown }).kind === "pending_approval" &&
      typeof (result.data as { approvalId?: unknown }).approvalId === "string",
  );
}

export function createPhalanxHost(options: CreatePhalanxHostOptions = {}): PhalanxHost {
  const approvalRouter = new ApprovalRouter();
  const pendingOps = new PendingOperationsTracker();
  const approvalOutbox: ApprovalOutboxItem[] = [];
  const runtimeEvents: RuntimeEvent[] = [];
  const session = options.setupSession ?? createSetupSession();
  const configValues = options.configValues ?? process.env;
  const runtimeConfig = buildRuntimeConfig(configValues);
  const guardianEnabled =
    options.guardianEnabled ?? (configValues.PHALANX_GUARDIAN_ENABLED ?? "").trim() === "1";
  const whitelistTargets = normalizeWhitelistTargets(options.whitelistTargets ?? parseWhitelistTargets(configValues));
  const whitelistPolicy = new WhitelistPolicy(new Set(whitelistTargets));
  const executor = createGovernanceAwareExecutor({
    baseExecutor: pickExecutor(options, configValues),
    whitelistPolicy,
    env: configValues as NodeJS.ProcessEnv,
    governanceWriteImpl: options.governanceWriteImpl,
  });
  const eventStorePath = pickEventStorePath(options.eventStorePath, configValues);
  const eventStore = eventStorePath ? new EventStore<RuntimeEvent>(eventStorePath, 500) : undefined;
  const demoConfig = resolveAgenticRebalanceDemoConfig(options.agenticRebalanceDemo, configValues);
  const guardianDemoApprovalContexts = new Map<string, GuardianDemoApprovalContext>();
  let lastGuardianAssessment: GuardianLastAssessment | undefined;
  let lastRebalanceDemoRunSummary: RebalanceDemoRunMetadata | undefined;
  let guardianDemoCoreAugmentMetadata: RebalanceDemoRunMetadata | undefined;
  let guardianDemoResumeEnrich: { readonly approvalId: string; readonly demoRun: RebalanceDemoRunMetadata } | undefined;
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

  const { publishRuntimeEvent } = createHostEventPublisher({
    runtimeEvents,
    eventStore,
    getReportNotifier: () => reportNotifier,
    onTelegramReportFailure: async (sourceEvent, errorSummary) => {
      await recordTelegramReportFailure(sourceEvent, errorSummary);
    },
  });

  async function recordTelegramReportFailure(sourceEvent: RuntimeEvent, errorSummary: string): Promise<void> {
    await publishRuntimeEvent(
      buildReportFailedRuntimeEvent(sourceEvent, errorSummary),
      { skipTelegramReport: true },
    );
  }

  /**
   * Guardian demo callback reporting is intentionally report-only.
   * RuntimeCore events remain the source of truth; this must not append synthetic runtime events.
   */
  async function sendGuardianDemoReport(event: RuntimeEvent): Promise<void> {
    if (!reportNotifier) {
      return;
    }
    try {
      await reportNotifier.sendExecutionReport(event);
    } catch (error) {
      const summary = summarizeHostReportError(error);
      console.error("Guardian demo Telegram report delivery failed:", summary);
      await recordTelegramReportFailure(event, summary);
    }
  }

  function readOperatorWalletSummary(): {
    readonly executionOrTestAddress?: string;
    readonly walletEvidence: WalletEvidence;
  } {
    const envOverride =
      (configValues.PHALANX_WALLET_ADDRESS ?? "").trim() || (configValues.AGENT_WALLET_ADDRESS ?? "").trim() || undefined;
    const walletEvidence = normalizeWalletEvidence({
      liveMode: runtimeConfig.mode === "live",
      chain: (configValues.PHALANX_DEFAULT_CHAIN ?? "").trim() || "base",
      explicitOverride: envOverride,
      testFallback: runtimeConfig.wallet.testAddress,
    });
    return {
      executionOrTestAddress: walletEvidence.resolvedAddress || undefined,
      walletEvidence,
    };
  }

  async function relayCoreRuntimeEvent(event: RuntimeEvent): Promise<void> {
    let next = event;
    if (guardianDemoResumeEnrich && event.approvalId === guardianDemoResumeEnrich.approvalId) {
      if (
        event.stage === "approval_resumed" ||
        event.stage === "executed" ||
        event.stage === "blocked" ||
        event.stage === "rejected"
      ) {
        next = { ...event, demoRun: guardianDemoResumeEnrich.demoRun };
      }
    } else if (guardianDemoCoreAugmentMetadata && event.entrySource === "mcp") {
      if (
        event.stage === "awaiting_approval" ||
        event.stage === "intent_received" ||
        event.stage === "executed" ||
        event.stage === "blocked" ||
        event.stage === "rejected"
      ) {
        const demoRun =
          event.stage === "awaiting_approval" && event.approvalId
            ? {
                ...guardianDemoCoreAugmentMetadata,
                pendingApproval: { approvalId: event.approvalId },
              }
            : guardianDemoCoreAugmentMetadata;
        next = { ...event, demoRun };
      }
    }
    await publishRuntimeEvent(next);
  }

  async function runRebalanceDemo(input: RebalanceDemoFlowInput): Promise<RebalanceDemoFlowResult> {
    if (options.rebalanceDemoRunner) {
      return options.rebalanceDemoRunner(input);
    }
    return runRebalanceDemoFlow(input, {
      env: configValues as NodeJS.ProcessEnv,
      executeOmRateQuery,
      planUniswapLiquidityPlannerInvocation,
      executeUniswapLiquidityPlannerInvocation,
    });
  }

  const riskEngine = new RiskEngine();
  const core = new RuntimeCore({
    policyGate: new PolicyGate({
      whitelist: whitelistPolicy,
    }),
    riskEngine,
    approvalPolicy: new ApprovalPolicy(),
    approvalRouter,
    pendingOps,
    executor,
    emitEvent: relayCoreRuntimeEvent,
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
    const guardianDemo = guardianDemoApprovalContexts.get(parsed.approvalId);
    const guardianDemoResumeRun = guardianDemo?.demoRun;
    const approved = parsed.action === "approve";
    let runtimeOutcome: RuntimeOutcome;
    try {
      if (guardianDemoResumeRun) {
        guardianDemoResumeEnrich = { approvalId: parsed.approvalId, demoRun: guardianDemoResumeRun };
      }
      runtimeOutcome = await core.submitApprovalDecision(parsed.approvalId, approved);
    } finally {
      guardianDemoResumeEnrich = undefined;
    }
    if (guardianDemo) {
      guardianDemoApprovalContexts.delete(parsed.approvalId);
      const finalizedGuardianDemoRun = finalizeGuardianDemoRunForOutcome(
        guardianDemoResumeRun,
        runtimeOutcome,
        approved,
      );
      if (finalizedGuardianDemoRun) {
        lastRebalanceDemoRunSummary = finalizedGuardianDemoRun;
      }
      if (runtimeOutcome.type === "executed") {
        await sendGuardianDemoReport({
          eventId: `guardian-demo:${parsed.approvalId}:executed`,
          createdAt: new Date().toISOString(),
          correlationId: `guardian-demo:${parsed.approvalId}`,
          intentId: `guardian-demo:${parsed.approvalId}`,
          action: guardianDemo.resumedAction,
          entrySource: "guardian",
          target: guardianDemo.target,
          stage: "executed",
          summary: `Executed ${guardianDemo.resumedAction}`,
          txRefs: extractRuntimeTxRefs(runtimeOutcome.adapterResult),
          demoRun: finalizedGuardianDemoRun,
        });
      } else if (runtimeOutcome.type === "blocked") {
        await sendGuardianDemoReport({
          eventId: `guardian-demo:${parsed.approvalId}:blocked`,
          createdAt: new Date().toISOString(),
          correlationId: `guardian-demo:${parsed.approvalId}`,
          intentId: `guardian-demo:${parsed.approvalId}`,
          action: guardianDemo.resumedAction,
          entrySource: "guardian",
          target: guardianDemo.target,
          stage: "blocked",
          summary: runtimeOutcome.message,
          reason: runtimeOutcome.code,
          demoRun: finalizedGuardianDemoRun,
        });
      } else if (runtimeOutcome.type === "rejected") {
        await sendGuardianDemoReport({
          eventId: `guardian-demo:${parsed.approvalId}:rejected`,
          createdAt: new Date().toISOString(),
          correlationId: `guardian-demo:${parsed.approvalId}`,
          intentId: `guardian-demo:${parsed.approvalId}`,
          action: guardianDemo.resumedAction,
          entrySource: "guardian",
          target: guardianDemo.target,
          stage: "rejected",
          summary: runtimeOutcome.message,
          reason: runtimeOutcome.code,
          demoRun: finalizedGuardianDemoRun,
        });
      }
    }
    const remaining = approvalOutbox.filter((item) => item.approvalId !== parsed.approvalId);
    approvalOutbox.length = 0;
    approvalOutbox.push(...remaining);
    return {
      handled: true,
      decision: parsed.action,
      runtimeOutcome,
    };
  }

  async function runGuardianAllocationMainlineForDemoItem(
    item: GuardianCycleResult["items"][number],
  ): Promise<GuardianAllocationMainlineResult> {
    const result = await executeGuardianAllocationMainline(
      {
        demoInput: {
          omRatePath: demoConfig!.omRatePath,
          chain: demoConfig!.chain,
          tokenA: demoConfig!.tokenA,
          tokenB: demoConfig!.tokenB,
          positionType: demoConfig!.positionType ?? "v3",
          prepareSwap: true,
        },
        guardianReason: item.explanation.detected,
      },
      {
        runRebalanceDemo: (demoInput) => runRebalanceDemo(demoInput),
        publishRuntimeEvent,
        invokePhalanxAction: async ({ action, payload, target }) => {
          const out = await invokeMcp("phalanx_action", { action, payload, target });
          if (!out.ok) {
            return { ok: false, code: out.code, message: out.message };
          }
          const data = out.data as { kind?: string; adapterResult?: unknown; approvalId?: string };
          if (data.kind === "executed") {
            return { ok: true, kind: "executed", adapterResult: data.adapterResult };
          }
          if (data.kind === "pending_approval" && typeof data.approvalId === "string") {
            return {
              ok: true,
              kind: "pending_approval",
              approvalId: data.approvalId,
              intentId: approvalRouter.get(data.approvalId)?.intent.id,
            };
          }
          return { ok: false, code: "UNEXPECTED_OUTCOME", message: "Unexpected MCP action outcome" };
        },
        assessFundingReadiness: ({ flow }) => {
          const walletSummary = readOperatorWalletSummary();
          const walletSignalReady =
            Boolean(walletSummary.executionOrTestAddress) || hasExecutionWalletSignal(configValues);
          const amountReady =
            (typeof flow.lpDepositPayloadSeed.amount === "string" && flow.lpDepositPayloadSeed.amount.trim().length > 0) ||
            (typeof flow.lpDepositPayloadSeed.amountSecondary === "string" &&
              flow.lpDepositPayloadSeed.amountSecondary.trim().length > 0);
          const swapFundingReady =
            flow.swapPreparation.status !== "wallet_unfunded_for_pair" &&
            flow.swapPreparation.status !== "insufficient_context";

          if (walletSignalReady && amountReady && swapFundingReady) {
            return {
              ok: true,
              summary:
                "Funding readiness is backed by wallet signal plus planner/swap funding facts available in this chunk.",
            };
          }
          return {
            ok: false,
            summary:
              "Funding readiness failed: wallet signal, planner amount facts, or swap funding facts were insufficient.",
          };
        },
        scopeAugmentDemoRun: async (meta, fn) => {
          guardianDemoCoreAugmentMetadata = meta;
          try {
            return await fn();
          } finally {
            guardianDemoCoreAugmentMetadata = undefined;
          }
        },
      },
    );
    lastRebalanceDemoRunSummary = result.demoRun;
    if (result.guardianApprovalContext) {
      guardianDemoApprovalContexts.set(result.guardianApprovalContext.approvalId, {
        resumedAction: result.guardianApprovalContext.resumedAction,
        target: result.guardianApprovalContext.target,
        demoRun: result.guardianApprovalContext.demoRun,
      });
    }
    return result;
  }

  async function handleGuardianDemoRebalance(item: GuardianCycleResult["items"][number]): Promise<RuntimeOutcome> {
    const r = await runGuardianAllocationMainlineForDemoItem(item);
    return r.outcome;
  }

  async function handleGuardianCycle(result: GuardianCycleResult): Promise<readonly RuntimeOutcome[]> {
    const outcomes: RuntimeOutcome[] = [];
    for (const item of result.items) {
      const intent = item.intent;
      if (intent) {
        if (demoConfig?.enabled && intent.action === "executeRebalance") {
          outcomes.push(await handleGuardianDemoRebalance(item));
          continue;
        }
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
    lastGuardianAssessment = summarizeGuardianCycleForOperator(result);
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
        guardian: guardianEnabled ? "enabled" : "disabled",
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
    getPendingApprovalCount: () => approvalRouter.size(),
    getEffectiveWhitelistTargets: () => whitelistPolicy.snapshot(),
    getRiskEvaluationContext: () => options.riskContext ?? { now: Date.now() },
    getRiskRuleOrder: () => riskEngine.getRuleOrder(),
    getGuardianLastAssessment: () => lastGuardianAssessment,
    recordTelegramReportFailure,
    getOperatorWalletSummary: readOperatorWalletSummary,
    getLatestRebalanceDemoRunSummary: () => lastRebalanceDemoRunSummary,
    runAgenticAllocationMainlineDemo: async (guardianReason?: string) => {
      if (!demoConfig?.enabled) {
        throw new Error(
          "runAgenticAllocationMainlineDemo requires PHALANX_AGENTIC_REBALANCE_DEMO_ENABLED=1 in config (or pass agenticRebalanceDemo.enabled to createPhalanxHost).",
        );
      }
      return runGuardianAllocationMainlineForDemoItem(
        buildSyntheticGuardianRebalanceItem(guardianReason ?? "allocation_mainline_smoke"),
      );
    },
  };
}

export function buildDryRunStartupSummary(host: PhalanxHost): RuntimeStartupSummary {
  return host.getStartupSummary();
}
