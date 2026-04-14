import type { OperatorQueryPayload } from "./operator-queries.js";

const TELEGRAM_SOFT_LIMIT = 3_800;

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

function formatReadiness(snapshot: Extract<OperatorQueryPayload, { family: "readiness_pending" }>["snapshot"]): string {
  const lines = [
    "Phalanx readiness",
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
    return ["Phalanx LP position", "", `Unavailable (${snapshot.code}): ${snapshot.message}`].join("\n");
  }
  return [
    "Phalanx LP position",
    "",
    `Pool: ${snapshot.poolAddress}`,
    `Token id: ${snapshot.tokenId}`,
    `Ticks: ${snapshot.tickLower} → ${snapshot.tickUpper}`,
    `Liquidity: ${snapshot.liquidity}`,
    `In range: ${snapshot.inRange ? "yes" : "no"}`,
    `Withdraw: ${snapshot.withdrawabilitySummary}`,
  ].join("\n");
}

function formatPortfolio(snapshot: Extract<OperatorQueryPayload, { family: "portfolio_balances" }>["snapshot"]): string {
  if (snapshot.status === "unavailable") {
    return ["Phalanx portfolio", "", `Unavailable (${snapshot.code}): ${snapshot.message}`].join("\n");
  }
  const lines = ["Phalanx portfolio", "", `Source: ${snapshot.source}`];
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
  return lines.join("\n");
}

function formatEvents(snapshot: Extract<OperatorQueryPayload, { family: "recent_events" }>["snapshot"]): string {
  const lines = [`Phalanx events (last ${snapshot.limit})`, ""];
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
      e.summary,
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
    lines.push(row);
  }
  if (items.length > 15) {
    lines.push("", `…and ${items.length - 15} older (narrow with MCP or lower volume).`);
  }
  return lines.join("\n");
}

function formatExplain(snapshot: Extract<OperatorQueryPayload, { family: "why_blocked_next" }>["snapshot"]): string {
  if (!snapshot.hasExplanation) {
    return ["Phalanx blocked / next steps", "", "No recent blocked or rejected runtime events."].join("\n");
  }
  return [
    "Phalanx blocked / next steps",
    "",
    `Stage: ${snapshot.stage ?? "unknown"}`,
    snapshot.eventId ? `Event: ${snapshot.eventId}` : "",
    snapshot.code ? `Code: ${snapshot.code}` : "",
    "",
    `What happened: ${snapshot.whatHappened ?? "n/a"}`,
    `Why: ${snapshot.why ?? "n/a"}`,
    "",
    `What next: ${snapshot.whatNext ?? "Review configuration and recent events."}`,
  ]
    .filter((line) => line.length > 0)
    .join("\n");
}

function formatPolicy(snapshot: Extract<OperatorQueryPayload, { family: "whitelist_policy" }>["snapshot"]): string {
  const lines = [
    "Phalanx policy",
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
    "Phalanx risk / guardian",
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
    "Phalanx binding / wallets",
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
