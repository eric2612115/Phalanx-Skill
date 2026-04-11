import { randomUUID } from "node:crypto";
import type { RuntimeCore } from "../../runtime/core.js";
import type { PolicyContext } from "../../runtime/types.js";
import type { RuntimeIntent } from "../../runtime/types.js";
import type { McpToolResult } from "../server.js";
import { asRecord } from "../tool-args.js";

export interface UniswapLiquidityPlanToolDeps {
  readonly core: RuntimeCore;
  getPolicyContext(): PolicyContext;
}

/**
 * Read-only MCP surface: runs official Uniswap liquidity-planner pipeline through RuntimeCore
 * (policy, risk) so results are first-class runtime outcomes, not only smoke JSON.
 * This is planning-only: it must not be treated as an execution target or require execution whitelist membership.
 */
export async function invokeUniswapLiquidityPlanTool(
  args: Record<string, unknown>,
  deps: UniswapLiquidityPlanToolDeps,
): Promise<McpToolResult> {
  const ctx = deps.getPolicyContext();
  if (ctx.lifecycle !== "READY") {
    return {
      ok: false,
      code: "NOT_READY",
      message: "Uniswap liquidity planning is disabled until setup completes (lifecycle READY).",
    };
  }

  const intent: RuntimeIntent = {
    id: randomUUID(),
    lane: "conversation",
    action: "planUniswapLiquidity",
    payload: asRecord(args),
    entrySource: "mcp",
  };

  const out = await deps.core.handleIntent(intent);
  if (out.type === "executed") {
    return { ok: true, data: { kind: "uniswap_liquidity_plan" as const, adapterResult: out.adapterResult } };
  }
  if (out.type === "blocked") {
    return { ok: false, code: out.code, message: out.message };
  }
  if (out.type === "rejected") {
    return { ok: false, code: out.code, message: out.message };
  }
  return {
    ok: false,
    code: "UNEXPECTED_OUTCOME",
    message: `Unexpected runtime outcome: ${out.type}`,
  };
}
