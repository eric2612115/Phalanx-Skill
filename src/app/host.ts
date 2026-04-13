import { resolve } from "node:path";

import {
  buildRuntimeConfig,
  getExecutionWalletAddress,
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
  buildRebalanceDemoRunMetadata,
  runRebalanceDemoFlow,
  type RebalanceDemoFlowInput,
  type RebalanceDemoFlowResult,
  type RebalanceDemoRunMetadata,
} from "../demo/rebalance-flow.js";
import { buildLpExecutionObserver } from "../demo/observer.js";
import { executeOmRateQuery } from "../adapters/omrate.js";

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
  getOperatorWalletSummary(): { readonly executionOrTestAddress?: string };
  getLatestRebalanceDemoRunSummary(): RebalanceDemoRunMetadata | undefined;
}

type GuardianDemoApprovalContext = {
  readonly resumedAction: string;
  readonly target?: string;
  readonly demoRun?: RebalanceDemoRunMetadata;
};

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

function resolveAgenticRebalanceDemoConfig(
  options: CreatePhalanxHostOptions,
  configValues: Readonly<Record<string, string | undefined>>,
): CreatePhalanxHostOptions["agenticRebalanceDemo"] | undefined {
  if (options.agenticRebalanceDemo?.enabled) {
    return {
      positionType: "v3",
      ...options.agenticRebalanceDemo,
    };
  }
  if ((configValues.PHALANX_AGENTIC_REBALANCE_DEMO_ENABLED ?? "").trim() !== "1") {
    return undefined;
  }
  return {
    enabled: true,
    omRatePath: (configValues.PHALANX_REBALANCE_OMRATE_PATH ?? "/rebalance/opportunities").trim(),
    chain: (configValues.PHALANX_DEFAULT_CHAIN ?? "base").trim(),
    tokenA: (configValues.PHALANX_REBALANCE_TOKEN_A ?? "USDC").trim(),
    tokenB: (configValues.PHALANX_REBALANCE_TOKEN_B ?? "ETH").trim(),
    positionType: "v3",
  };
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
  const eventStorePath = pickEventStorePath(options, configValues);
  const eventStore = eventStorePath ? new EventStore<RuntimeEvent>(eventStorePath, 500) : undefined;
  const demoConfig = resolveAgenticRebalanceDemoConfig(options, configValues);
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

  async function publishRuntimeEvent(event: RuntimeEvent): Promise<void> {
    runtimeEvents.push(event);
    if (runtimeEvents.length > 500) {
      runtimeEvents.splice(0, runtimeEvents.length - 500);
    }
    eventStore?.append(event);
    if (
      reportNotifier &&
      event.entrySource === "guardian" &&
      (event.stage === "guardian_detected" ||
        event.stage === "executed" ||
        event.stage === "blocked" ||
        event.stage === "rejected")
    ) {
      await reportNotifier.sendExecutionReport(event);
    }
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
    let runtimeOutcome: RuntimeOutcome;
    try {
      if (guardianDemo?.demoRun) {
        guardianDemoResumeEnrich = { approvalId: parsed.approvalId, demoRun: guardianDemo.demoRun };
      }
      runtimeOutcome = await core.submitApprovalDecision(parsed.approvalId, parsed.action === "approve");
    } finally {
      guardianDemoResumeEnrich = undefined;
    }
    if (guardianDemo) {
      guardianDemoApprovalContexts.delete(parsed.approvalId);
      if (runtimeOutcome.type === "executed") {
        await publishRuntimeEvent({
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
          demoRun: guardianDemo.demoRun,
        });
      } else if (runtimeOutcome.type === "blocked") {
        await publishRuntimeEvent({
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
          demoRun: guardianDemo.demoRun,
        });
      } else if (runtimeOutcome.type === "rejected") {
        await publishRuntimeEvent({
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
          demoRun: guardianDemo.demoRun,
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

  async function handleGuardianDemoRebalance(item: GuardianCycleResult["items"][number]): Promise<RuntimeOutcome> {
    const flow = await runRebalanceDemo({
      omRatePath: demoConfig!.omRatePath,
      chain: demoConfig!.chain,
      tokenA: demoConfig!.tokenA,
      tokenB: demoConfig!.tokenB,
      positionType: demoConfig!.positionType ?? "v3",
      prepareSwap: true,
    });
    const observer = buildLpExecutionObserver(flow.planner);
    const demoInput = {
      omRatePath: demoConfig!.omRatePath,
      chain: demoConfig!.chain,
      tokenA: demoConfig!.tokenA,
      tokenB: demoConfig!.tokenB,
    };
    const demoRunMeta = buildRebalanceDemoRunMetadata(
      demoInput,
      flow,
      observer
        ? {
            readyForExecution: observer.readyForExecution,
            missingExecutionFields: observer.missingExecutionFields,
            summary: observer.summary,
            action: observer.action,
            target: observer.target,
          }
        : undefined,
    );
    lastRebalanceDemoRunSummary = demoRunMeta;
    guardianDemoCoreAugmentMetadata = demoRunMeta;
    try {
      const proposalIntent = {
        id: `guardian-demo-proposal-${Date.now()}`,
        lane: "execution" as const,
        action: "proposeRebalance",
        payload: {
          reason: item.explanation.detected,
          riskNotes: [flow.swapPreparation.summary],
        },
        entrySource: "guardian" as const,
        target: observer?.target ?? "uniswap-v3",
      };
      await publishRuntimeEvent(
        buildRuntimeEvent(proposalIntent, "guardian_detected", {
          summary: [
            `Rebalance candidate ready`,
            flow.selectedPool?.pairLabel ? `Pool ${flow.selectedPool.pairLabel}` : undefined,
            flow.swapPreparation.summary,
          ]
            .filter(Boolean)
            .join(" | "),
          reason: item.explanation.detected,
          demoRun: demoRunMeta,
        }),
      );
      if (!observer || !observer.readyForExecution) {
        const blockedSummary = [
          observer?.summary ?? "Planner downstream is not execution-ready yet.",
          flow.selectedPool?.pairLabel
            ? `Pool ${flow.selectedPool.pairLabel} (${flow.selectedPool.pairAddress ?? "?"})`
            : undefined,
          `Swap prep: ${flow.swapPreparation.status}`,
        ]
          .filter(Boolean)
          .join(" | ");
        await publishRuntimeEvent(
          buildRuntimeEvent(proposalIntent, "blocked", {
            summary: blockedSummary,
            reason: "DEMO_OBSERVER_NOT_READY",
            demoRun: demoRunMeta,
          }),
        );
        return {
          type: "blocked",
          intentId: proposalIntent.id,
          stage: "approval_class",
          code: "DEMO_OBSERVER_NOT_READY",
          message: observer?.summary ?? "Planner downstream is not execution-ready yet.",
        };
      }

      if (flow.swapPreparation.recommendedSwapIntent) {
        const swapOut = await invokeMcp("phalanx_action", {
          action: "swap",
          payload: flow.swapPreparation.recommendedSwapIntent.payload,
          target: "pool",
        });
        if (isExecutedMcpResult(swapOut)) {
          await publishRuntimeEvent({
            eventId: `guardian-demo:${Date.now()}:swap`,
            createdAt: new Date().toISOString(),
            correlationId: proposalIntent.id,
            intentId: proposalIntent.id,
            action: "swap",
            entrySource: "guardian",
            target: "pool",
            stage: "executed",
            summary: "Executed swap",
            txRefs: extractRuntimeTxRefs(swapOut.data.adapterResult),
            demoRun: demoRunMeta,
          });
        } else {
          const message = swapOut.ok ? "Unexpected swap outcome" : swapOut.message;
          await publishRuntimeEvent({
            eventId: `guardian-demo:${Date.now()}:swap-blocked`,
            createdAt: new Date().toISOString(),
            correlationId: proposalIntent.id,
            intentId: proposalIntent.id,
            action: "swap",
            entrySource: "guardian",
            target: "pool",
            stage: "blocked",
            summary: message,
            reason: swapOut.ok ? "UNEXPECTED_SWAP_OUTCOME" : swapOut.code,
            demoRun: demoRunMeta,
          });
          return {
            type: "blocked",
            intentId: proposalIntent.id,
            stage: "policy",
            code: swapOut.ok ? "UNEXPECTED_SWAP_OUTCOME" : swapOut.code,
            message,
          };
        }
      }

      const depositOut = await invokeMcp("phalanx_action", {
        action: observer.action,
        payload: observer.payload,
        target: observer.target,
      });
      if (isExecutedMcpResult(depositOut)) {
        await publishRuntimeEvent({
          eventId: `guardian-demo:${Date.now()}:deposit`,
          createdAt: new Date().toISOString(),
          correlationId: proposalIntent.id,
          intentId: proposalIntent.id,
          action: observer.action,
          entrySource: "guardian",
          target: observer.target,
          stage: "executed",
          summary: `Executed ${observer.action}`,
          txRefs: extractRuntimeTxRefs(depositOut.data.adapterResult),
          demoRun: demoRunMeta,
        });
        return {
          type: "executed",
          intentId: proposalIntent.id,
          adapterResult: depositOut.data.adapterResult,
        };
      }
      if (isPendingApprovalMcpResult(depositOut)) {
        const demoPending = buildRebalanceDemoRunMetadata(
          demoInput,
          flow,
          {
            readyForExecution: observer.readyForExecution,
            missingExecutionFields: observer.missingExecutionFields,
            summary: observer.summary,
            action: observer.action,
            target: observer.target,
          },
          { pendingApprovalId: depositOut.data.approvalId },
        );
        lastRebalanceDemoRunSummary = demoPending;
        guardianDemoApprovalContexts.set(depositOut.data.approvalId, {
          resumedAction: observer.action,
          target: observer.target,
          demoRun: demoPending,
        });
        return {
          type: "pending_approval",
          intentId: proposalIntent.id,
          approvalId: depositOut.data.approvalId,
        };
      }
      await publishRuntimeEvent({
        eventId: `guardian-demo:${Date.now()}:deposit-blocked`,
        createdAt: new Date().toISOString(),
        correlationId: proposalIntent.id,
        intentId: proposalIntent.id,
        action: observer.action,
        entrySource: "guardian",
        target: observer.target,
        stage: "blocked",
        summary: depositOut.ok ? "Unexpected deposit outcome" : depositOut.message,
        reason: depositOut.ok ? "UNEXPECTED_DEPOSIT_OUTCOME" : depositOut.code,
        demoRun: demoRunMeta,
      });
      return {
        type: "blocked",
        intentId: proposalIntent.id,
        stage: "policy",
        code: depositOut.ok ? "UNEXPECTED_DEPOSIT_OUTCOME" : depositOut.code,
        message: depositOut.ok ? "Unexpected deposit outcome" : depositOut.message,
      };
    } finally {
      guardianDemoCoreAugmentMetadata = undefined;
    }
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
    getOperatorWalletSummary: () => ({
      executionOrTestAddress: getExecutionWalletAddress(configValues) ?? runtimeConfig.wallet.testAddress,
    }),
    getLatestRebalanceDemoRunSummary: () => lastRebalanceDemoRunSummary,
  };
}

export function buildDryRunStartupSummary(host: PhalanxHost): RuntimeStartupSummary {
  return host.getStartupSummary();
}
