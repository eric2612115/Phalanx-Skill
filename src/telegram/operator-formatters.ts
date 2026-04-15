import type { OperatorQueryPayload } from "./operator-queries.js";
import { detectionsInString } from "../security/detectors.js";
import { redactString } from "../security/redaction.js";

const TELEGRAM_SOFT_LIMIT = 3_800;

function redactOperatorText(value: string | undefined): string | undefined {
  if (!value) {
    return value;
  }
  const spans = detectionsInString(value);
  return spans.length > 0 ? redactString(value, spans) : value;
}

export function formatOperatorQueryPayload(payload: OperatorQueryPayload): string[] {
  const body = formatPayloadBody(payload);
  if (body.length <= TELEGRAM_SOFT_LIMIT) {
    return [body];
  }
  return [`${body.slice(0, TELEGRAM_SOFT_LIMIT)}\n…(truncated)`];
}

function formatPayloadBody(payload: OperatorQueryPayload): string {
  switch (payload.family) {
    case "readiness_pending":
      return formatReadiness(payload.snapshot);
    case "lp_position_detail":
      return formatLpPositionDetail(payload.snapshot);
    case "portfolio_balances":
      return formatPortfolio(payload.snapshot);
    case "recent_events":
      return formatEvents(payload.snapshot);
    case "why_blocked_next":
      return formatExplain(payload.snapshot);
    case "runtime_execution_context":
      return formatRuntimeExecutionContext(payload.snapshot);
    case "whitelist_policy":
      return formatPolicy(payload.snapshot);
    case "risk_guardian":
      return formatRisk(payload.snapshot);
    case "wallets_binding":
      return formatBinding(payload.snapshot);
    default: {
      const _exhaustive: never = payload;
      return _exhaustive;
    }
  }
}

function formatRuntimeExecutionContext(
  snapshot: Extract<OperatorQueryPayload, { family: "runtime_execution_context" }>["snapshot"],
): string {
  if (snapshot.status === "empty") {
    return ["AgentPhalanx execution context (runtime evidence)", "", snapshot.message].join("\n");
  }
  const lines = [
    "AgentPhalanx execution context (runtime evidence)",
    "",
    `Source event: ${snapshot.sourceEventId}`,
    `Recorded: ${snapshot.createdAt}`,
    `Action: ${snapshot.sourceAction} (${snapshot.sourceStage})`,
  ];
  if (snapshot.wallet) {
    const w = snapshot.wallet;
    lines.push(
      "",
      "Wallet:",
      `• address: ${w.resolvedAddress || "<empty>"}`,
      `• source: ${w.source} chain=${w.chain} override=${w.overrideActive ? "yes" : "no"}`,
      `• reason: ${w.reason}`,
    );
  }
  if (snapshot.payment) {
    const p = snapshot.payment;
    lines.push(
      "",
      "Payment / x402:",
      `• mode=${p.mode} required=${p.paymentRequired} baseline=${p.baselineReady}`,
      `• attempted=${p.paymentAttempted} wrapped=${p.paymentWrapped} settled=${p.paymentSettled}`,
      `• summary: ${redactOperatorText(p.summary) ?? p.summary}`,
    );
  }
  if (snapshot.milestones) {
    const active = (
      Object.entries(snapshot.milestones) as Array<[string, boolean | undefined]>
    )
      .filter(([, v]) => v === true)
      .map(([k]) => k);
    if (active.length > 0) {
      lines.push("", `Milestones: ${active.join(", ")}`);
    }
  }
  return lines.join("\n");
}

function formatReadiness(snapshot: Extract<OperatorQueryPayload, { family: "readiness_pending" }>["snapshot"]): string {
  const lines = [
    "AgentPhalanx readiness",
    "",
    `Mode: ${snapshot.mode}`,
    `Lifecycle: ${snapshot.lifecycle}`,
    `Pending approvals: ${snapshot.pendingApprovals}`,
    `Execution paused: ${snapshot.executionPaused ? "yes" : "no"}`,
    `Guardian: ${snapshot.surfaces.guardian}`,
    "",
    `Live ready: ${snapshot.readiness.liveReady ? "yes" : "no"}`,
    `Demo ready: ${snapshot.readiness.demoReady ? "yes" : "no"}`,
    "",
    `Guidance: ${snapshot.guidance}`,
  ];
  return lines.join("\n");
}

function formatLpPositionDetail(snapshot: Extract<OperatorQueryPayload, { family: "lp_position_detail" }>["snapshot"]): string {
  if (snapshot.status === "unavailable") {
    return ["AgentPhalanx LP position", "", `Unavailable (${snapshot.code}): ${snapshot.message}`].join("\n");
  }
  const lines = [
    "AgentPhalanx LP position",
    "",
    snapshot.chain ? `Chain: ${snapshot.chain}` : "",
    snapshot.protocol ? `Protocol: ${snapshot.protocol}` : "",
    snapshot.platformId ? `Platform id: ${snapshot.platformId}` : "",
    snapshot.platformLabel ? `Platform: ${snapshot.platformLabel}` : "",
    snapshot.token0Symbol && snapshot.token1Symbol ? `Pair: ${snapshot.token0Symbol}/${snapshot.token1Symbol}` : "",
    snapshot.feeTier ? `Fee tier: ${snapshot.feeTier}` : "",
    `Pool: ${snapshot.poolAddress}`,
    `Token id: ${snapshot.tokenId}`,
    `Ticks: ${snapshot.tickLower} → ${snapshot.tickUpper}`,
    snapshot.currentTick !== undefined ? `Current tick: ${snapshot.currentTick}` : "",
    `Liquidity: ${snapshot.liquidity}`,
    `In range: ${snapshot.inRange ? "yes" : "no"}`,
    snapshot.withdrawable !== undefined ? `Withdrawable: ${snapshot.withdrawable ? "yes" : "no"}` : "",
    `Withdraw: ${snapshot.withdrawabilitySummary}`,
    snapshot.lastUpdatedAt ? `Last updated: ${snapshot.lastUpdatedAt}` : "",
  ].filter((line) => line.length > 0);
  return lines.join("\n");
}

function formatPortfolio(snapshot: Extract<OperatorQueryPayload, { family: "portfolio_balances" }>["snapshot"]): string {
  if (snapshot.status === "unavailable") {
    return ["AgentPhalanx portfolio", "", `Unavailable (${snapshot.code}): ${snapshot.message}`].join("\n");
  }
  const lines = ["AgentPhalanx portfolio", "", `Source: ${snapshot.source}`];
  if (snapshot.asOf !== undefined) {
    lines.push(`As of: ${snapshot.asOf}`);
  }
  if (snapshot.lendingHealthScore !== undefined) {
    lines.push(`Lending health: ${snapshot.lendingHealthScore}`);
  }
  if (snapshot.lpInRange !== undefined) {
    lines.push(`LP in range: ${snapshot.lpInRange ? "yes" : "no"}`);
  }
  if (snapshot.lpStrictRange !== undefined) {
    lines.push(`LP strict range: ${snapshot.lpStrictRange ? "yes" : "no"}`);
  }
  if (snapshot.buckets.length === 0) {
    lines.push("", "No bucket rows returned.");
  } else {
    lines.push("", "Buckets (kind: current → target bps):");
    for (const b of snapshot.buckets) {
      lines.push(`• ${b.kind}: ${b.currentBps} → ${b.targetBps}`);
    }
  }
  if (snapshot.postActionFromRuntime) {
    const pa = snapshot.postActionFromRuntime;
    lines.push(
      "",
      "Portfolio follow-up (latest runtime evidence):",
      `• action: ${pa.action} @ ${pa.createdAt}`,
      `• summary: ${redactOperatorText(pa.summary) ?? pa.summary}`,
    );
    if (pa.portfolioPushReady !== undefined) {
      lines.push(`• ready: ${pa.portfolioPushReady ? "yes" : "no"}`);
    }
    if (pa.portfolioPushSent !== undefined) {
      lines.push(`• sent: ${pa.portfolioPushSent ? "yes" : "no"}`);
    }
    if (pa.walletSource) {
      lines.push(`• wallet source: ${pa.walletSource}`);
    }
    if (pa.paymentSummary) {
      lines.push(`• payment summary: ${redactOperatorText(pa.paymentSummary) ?? pa.paymentSummary}`);
    }
    if (pa.milestoneLine) {
      lines.push(`• milestones: ${pa.milestoneLine}`);
    }
  }
  return lines.join("\n");
}

function formatEvents(snapshot: Extract<OperatorQueryPayload, { family: "recent_events" }>["snapshot"]): string {
  const lines = [`AgentPhalanx events (last ${snapshot.limit})`, ""];
  const items = [...snapshot.items].reverse();
  if (items.length === 0) {
    lines.push("No runtime events recorded yet.");
    return lines.join("\n");
  }
  for (const e of items.slice(0, 15)) {
    const bits = [
      `${e.createdAt}`,
      `${e.stage}`,
      e.action,
      e.entrySource,
      e.target ? `@${e.target}` : "",
      redactOperatorText(e.summary) ?? e.summary,
    ].filter(Boolean);
    let row = bits.join(" | ");
    if (e.txRefs && e.txRefs.length > 0) {
      row += ` | tx: ${e.txRefs.join(", ")}`;
    }
    if (e.approvalId) {
      row += ` | approval: ${e.approvalId}`;
    }
    if (e.demoRun?.selectedPool?.pairLabel) {
      row += ` | demo pool: ${e.demoRun.selectedPool.pairLabel}`;
    } else if (e.demoRun) {
      row += ` | demo: ${e.demoRun.swapPreparation.status}`;
    }
    if (e.demoRun?.omRateExecutionEvidence.payment) {
      const p = e.demoRun.omRateExecutionEvidence.payment;
      row += ` | omrate pay: req=${p.paymentRequired} att=${p.paymentAttempted} wrap=${p.paymentWrapped} set=${p.paymentSettled}`;
    }
    if (e.executionEvidence?.payment) {
      const p = e.executionEvidence.payment;
      row += ` | payment: req=${p.paymentRequired} att=${p.paymentAttempted} wrap=${p.paymentWrapped} set=${p.paymentSettled}`;
    }
    lines.push(row);
  }
  if (items.length > 15) {
    lines.push("", `…and ${items.length - 15} older (narrow with MCP or lower volume).`);
  }
  return lines.join("\n");
}

function formatExplain(snapshot: Extract<OperatorQueryPayload, { family: "why_blocked_next" }>["snapshot"]): string {
  if (!snapshot.hasExplanation) {
    return ["AgentPhalanx blocked / next steps", "", "No recent blocked or rejected runtime events."].join("\n");
  }
  return [
    "AgentPhalanx blocked / next steps",
    "",
    `Stage: ${snapshot.stage ?? "unknown"}`,
    snapshot.eventId ? `Event: ${snapshot.eventId}` : "",
    snapshot.code ? `Code: ${snapshot.code}` : "",
    "",
    `What happened: ${redactOperatorText(snapshot.whatHappened) ?? "n/a"}`,
    `Why: ${redactOperatorText(snapshot.why) ?? "n/a"}`,
    "",
    `What next: ${redactOperatorText(snapshot.whatNext) ?? "Review configuration and recent events."}`,
  ]
    .filter((line) => line.length > 0)
    .join("\n");
}

function formatPolicy(snapshot: Extract<OperatorQueryPayload, { family: "whitelist_policy" }>["snapshot"]): string {
  const lines = [
    "AgentPhalanx policy",
    "",
    `Lifecycle: ${snapshot.lifecycle}`,
    `Execution paused: ${snapshot.executionPaused ? "yes" : "no"}`,
    `Whitelist contract configured: ${snapshot.whitelistContractConfigured ? "yes" : "no"}`,
    "",
    "Allowlisted targets:",
    ...snapshot.whitelistTargets.map((t) => `• ${t}`),
  ];
  return lines.join("\n");
}

function formatRisk(snapshot: Extract<OperatorQueryPayload, { family: "risk_guardian" }>["snapshot"]): string {
  const parts: string[] = [
    "AgentPhalanx risk / guardian",
    "",
    `Risk engine rules: ${snapshot.engineRuleOrder.join(", ")}`,
    `Risk context.now: ${snapshot.riskContext.now}`,
  ];
  const g = snapshot.guardianLastAssessment;
  if (!g || g.items.length === 0) {
    parts.push("", "No guardian cycle assessment recorded yet.");
    return parts.join("\n");
  }
  parts.push("", `Last assessment at: ${g.assessedAt}`);
  for (const item of g.items.slice(0, 5)) {
    parts.push("");
    parts.push(`• ${item.outcome}${item.intentAction ? ` (${item.intentAction})` : ""}`);
    parts.push(`  Detected: ${item.detected}`);
    parts.push(`  Why it matters: ${item.whyItMatters}`);
    parts.push(`  What we did: ${item.whatWeDid}`);
    if (item.furtherAction) {
      parts.push(`  Next: ${item.furtherAction}`);
    }
  }
  return parts.join("\n");
}

function formatBinding(snapshot: Extract<OperatorQueryPayload, { family: "wallets_binding" }>["snapshot"]): string {
  const lines = [
    "AgentPhalanx binding / wallets",
    "",
    `Runtime mode: ${snapshot.mode}`,
    `Setup lifecycle: ${snapshot.setup.lifecycle}`,
    snapshot.setup.wizardStep ? `Wizard step: ${snapshot.setup.wizardStep}` : "Wizard: idle",
    "",
    `Telegram bot configured: ${snapshot.telegram.botConfigured ? "yes" : "no"}`,
    `Telegram allowed user id: ${snapshot.telegram.allowedUserId ?? "unset"}`,
    `Claimed operator Telegram id: ${snapshot.owner.claimedTelegramUserId ?? "none"}`,
    `Pending claim Telegram id: ${snapshot.owner.pendingTelegramUserId ?? "none"}`,
    "",
    `Owner EVM: ${snapshot.owner.evmAddress ?? "unset"}`,
    `Agent / execution wallet: ${snapshot.wallet.executionOrTestAddress ?? "unset"}`,
    `Wallet source: ${snapshot.wallet.source}`,
    `Wallet reason: ${snapshot.wallet.reason}`,
    `Wallet override active: ${snapshot.wallet.overrideActive ? "yes" : "no"}`,
    "",
    `Base RPC configured: ${snapshot.chain.baseRpcConfigured ? "yes" : "no"}`,
    `xLayer RPC configured: ${snapshot.chain.xlayerRpcConfigured ? "yes" : "no"}`,
    "",
    `OmRate API: ${snapshot.omrate.apiConfigured ? "configured" : "missing"} (${snapshot.omrate.baseUrl})`,
    "",
    `Live ready: ${snapshot.readiness.liveReady ? "yes" : "no"}`,
    `Demo ready: ${snapshot.readiness.demoReady ? "yes" : "no"}`,
  ];
  return lines.join("\n");
}
