import { z } from "zod";

import type { PhalanxMcpDeps } from "./server.js";
import { buildStatusToolResult } from "./tools/status.js";
import { invokePortfolioTool } from "./tools/portfolio.js";
import { invokeActionTool } from "./tools/actions.js";
import { invokeApprovalDecisionTool } from "./tools/approval-decision.js";
import { invokeUniswapLiquidityPlanTool } from "./tools/uniswap-liquidity-plan.js";

export interface PhalanxMcpToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: z.ZodTypeAny;
  invoke(args: Record<string, unknown>, deps: PhalanxMcpDeps): ReturnType<typeof invokePortfolioTool>;
}

export const PHALANX_MCP_TOOL_REGISTRY = [
  {
    name: "phalanx_status",
    description: "Read current runtime lifecycle and readiness guidance.",
    inputSchema: z.object({}),
    invoke: async (_args, deps) => ({ ok: true as const, data: buildStatusToolResult(deps.getPolicyContext) }),
  },
  {
    name: "phalanx_portfolio",
    description: "Read managed portfolio state through the runtime.",
    inputSchema: z.object({
      target: z.string().optional(),
      payload: z.record(z.string(), z.unknown()).optional(),
    }),
    invoke: async (args, deps) =>
      invokePortfolioTool(args, { core: deps.core, getPolicyContext: deps.getPolicyContext }),
  },
  {
    name: "phalanx_action",
    description: "Invoke a state-changing runtime action that may require Telegram approval.",
    inputSchema: z.object({
      action: z.string(),
      target: z.string().optional(),
      payload: z.record(z.string(), z.unknown()).optional(),
    }),
    invoke: async (args, deps) =>
      invokeActionTool(args, {
        core: deps.core,
        approvalRouter: deps.approvalRouter,
        pendingOps: deps.pendingOps,
        getPolicyContext: deps.getPolicyContext,
        telegramApproval: deps.telegramApproval,
        approvalNotifyTimeoutMs: deps.approvalNotifyTimeoutMs ?? 8_000,
      }),
  },
  {
    name: "phalanx_approval_decision",
    description: "Resume or reject a pending approval using the machine-readable approval contract.",
    inputSchema: z.object({
      approvalId: z.string(),
      resumeToken: z.string(),
      approved: z.boolean(),
    }),
    invoke: async (args, deps) =>
      invokeApprovalDecisionTool(args, {
        core: deps.core,
      }),
  },
  {
    name: "phalanx_uniswap_liquidity_plan",
    description:
      "Run the official Uniswap/uniswap-ai liquidity-planner pipeline (skills CLI verify + DexScreener pool discovery) through the runtime.",
    inputSchema: z.object({
      chain: z.string().optional(),
      tokenA: z.string(),
      tokenB: z.string(),
      positionType: z.enum(["v2", "v3", "v4"]).optional(),
      target: z.string().optional(),
    }),
    invoke: async (args, deps) =>
      invokeUniswapLiquidityPlanTool(args, {
        core: deps.core,
        getPolicyContext: deps.getPolicyContext,
      }),
  },
] as const satisfies readonly PhalanxMcpToolDefinition[];

export const PHALANX_MCP_TOOL_NAMES = PHALANX_MCP_TOOL_REGISTRY.map((tool) => tool.name);
