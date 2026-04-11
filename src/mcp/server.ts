import type { RuntimeCore } from "../runtime/core.js";
import type { ApprovalRouter } from "../runtime/approval-router.js";
import type { PendingOperationsTracker } from "../runtime/pending-operations.js";
import type { PolicyContext } from "../runtime/types.js";
import { PHALANX_MCP_TOOL_NAMES, PHALANX_MCP_TOOL_REGISTRY } from "./registry.js";
export { PHALANX_MCP_TOOL_NAMES } from "./registry.js";

export type McpToolResult =
  | { ok: true; data: unknown }
  | { ok: false; code: string; message: string };

export type TelegramApprovalNotifierResult =
  | { ok: true }
  | { ok: false; code: string; message: string };

/**
 * Outbound hook to deliver approval prompts to Telegram (transport implemented by host).
 * Must resolve within {@link PhalanxMcpDeps.approvalNotifyTimeoutMs} or the MCP tool fails and rolls back.
 */
export interface TelegramApprovalNotifier {
  sendApprovalRequest(input: { approvalId: string; summary: string }): Promise<TelegramApprovalNotifierResult>;
}

export interface PhalanxMcpDeps {
  readonly core: RuntimeCore;
  readonly approvalRouter: ApprovalRouter;
  readonly pendingOps: PendingOperationsTracker;
  getPolicyContext(): PolicyContext;
  readonly telegramApproval?: TelegramApprovalNotifier;
  /** Default 8_000 ms when omitted. */
  readonly approvalNotifyTimeoutMs?: number;
}

export type PhalanxMcpToolName = (typeof PHALANX_MCP_TOOL_NAMES)[number];

/**
 * Thin local MCP surface: maps tool names to runtime calls (stdio/JSON-RPC can wrap this later).
 */
export async function invokePhalanxMcpTool(
  toolName: string,
  args: Record<string, unknown>,
  deps: PhalanxMcpDeps,
): Promise<McpToolResult> {
  const tool = PHALANX_MCP_TOOL_REGISTRY.find((entry) => entry.name === toolName);
  if (!tool) {
    return { ok: false, code: "UNKNOWN_TOOL", message: `Unknown tool: ${toolName}` };
  }
  return tool.invoke(args, deps);
}
