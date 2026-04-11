import type { PolicyContext } from "../../runtime/types.js";

export interface StatusToolResult {
  readonly lifecycle: PolicyContext["lifecycle"];
  readonly executionPaused: boolean;
  readonly guidance: string;
}

export function buildStatusToolResult(getPolicyContext: () => PolicyContext): StatusToolResult {
  const ctx = getPolicyContext();
  return {
    lifecycle: ctx.lifecycle,
    executionPaused: ctx.executionPaused,
    guidance: guidanceForLifecycle(ctx),
  };
}

function guidanceForLifecycle(ctx: PolicyContext): string {
  switch (ctx.lifecycle) {
    case "UNCLAIMED":
      return "Setup is not started. Complete owner claim and the setup wizard in your private Telegram chat with the bot before execution or portfolio tools are available.";
    case "SETUP_IN_PROGRESS":
      return "Setup is in progress. Continue the Telegram setup wizard (OKX keys, wallet, OmRate key, whitelist, finalize). Until lifecycle becomes READY, MCP exposes read-only status only plus this guidance.";
    case "READY":
      if (ctx.executionPaused) {
        return "Runtime is READY but execution is paused. Read-only portfolio/status queries are allowed; state-changing actions remain policy-gated.";
      }
      return "Runtime is READY. Portfolio reads and approval-gated actions are available via MCP.";
    case "PAUSED":
      return "Runtime lifecycle is PAUSED. Only explicit read-only actions are permitted; mutations are blocked until resumed.";
    default: {
      const _exhaustive: never = ctx.lifecycle;
      return _exhaustive;
    }
  }
}
