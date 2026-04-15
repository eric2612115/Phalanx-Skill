import type { InstallCheck } from "./checks.js";
import type { OperatorInitResult } from "./operator-init.js";

function formatCheckLine(c: InstallCheck): string {
  const status = c.ok ? "ok" : "missing";
  const detail = c.detail ? ` — ${c.detail}` : "";
  return `  [${status}] ${c.title}${detail}`;
}

function formatMissingKey(key: string): string {
  if (key === "EXECUTION_WALLET_SIGNAL") {
    return "Onchain OS managed wallet path (primary: OKX credentials enable runtime resolution; PHALANX_WALLET_ADDRESS / AGENT_WALLET_ADDRESS only for troubleshooting override; TEST_WALLET_ADDRESS only for rehearsal)";
  }
  return key;
}

function pushCheckGroup(parts: string[], title: string, checks: readonly InstallCheck[]): void {
  if (checks.length === 0) {
    return;
  }
  parts.push(title);
  for (const check of checks) {
    parts.push(formatCheckLine(check));
  }
  parts.push("");
}

export function formatOperatorInitReport(result: OperatorInitResult): string {
  const parts: string[] = [];
  parts.push("AgentPhalanx — terminal bootstrap (Telegram operator)");
  parts.push("");
  parts.push("What this terminal is for (then hand off to Telegram):");
  parts.push("  - Get TELEGRAM_BOT_TOKEN from @BotFather and save it in config.env");
  parts.push("  - Run npm run init to validate local config and print readiness");
  parts.push("  - Start the runtime from this shell (npm run dev), then continue in Telegram for /claim and approvals");
  parts.push("");
  if (result.configStatus === "missing") {
    parts.push("Config: missing");
    parts.push("No local config.env or config.env.example found in the current directory.");
  } else {
    parts.push(`Config: ${result.configPath}${result.configCreated ? " (created from config.env.example)" : ""}`);
  }
  parts.push(`Runtime mode: ${result.summary.mode}`);
  parts.push(
    `Readiness: ${result.readinessPhase}` +
      (result.readinessPhase === "partial" ? " (operator_ready, not yet demo_ready)" : "") +
      (result.readinessPhase === "blocked" ? " (operator_ready: false)" : ""),
  );
  if (result.x402BaselineReady) {
    parts.push("OmRate / x402: x402 baseline ready");
  }
  parts.push("");
  if (result.operatorMissing.length > 0) {
    parts.push("Operator tier — still missing:");
    for (const k of result.operatorMissing) {
      parts.push(`  - ${formatMissingKey(k)}`);
    }
    parts.push("");
  } else if (result.summary.mode === "live") {
    parts.push("Operator tier: satisfied");
    parts.push("");
  }

  if (result.demoMissing.length > 0) {
    parts.push("Demo tier — still missing:");
    for (const k of result.demoMissing) {
      parts.push(`  - ${formatMissingKey(k)}`);
    }
    parts.push("");
  } else if (result.summary.mode === "live") {
    parts.push("Demo tier: satisfied");
    parts.push("");
  }

  if (result.optionalMissing.length > 0) {
    parts.push("Optional — not set (not blocking operator_ready):");
    for (const k of result.optionalMissing) {
      parts.push(`  - ${k}`);
    }
    parts.push("");
  }

  parts.push("Checks:");
  pushCheckGroup(
    parts,
    "Operator checks:",
    result.checks.filter((check) => check.category === "operator_required"),
  );
  pushCheckGroup(
    parts,
    "Demo checks:",
    result.checks.filter((check) => check.category === "demo_required"),
  );
  pushCheckGroup(
    parts,
    "Optional checks:",
    result.checks.filter((check) => check.category === "optional"),
  );
  pushCheckGroup(
    parts,
    "Info:",
    result.checks.filter((check) => check.category === "info"),
  );
  parts.push("Next steps:");
  for (const s of result.nextSteps) {
    parts.push(`  - ${s}`);
  }
  return parts.join("\n");
}
