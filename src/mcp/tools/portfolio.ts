import { randomUUID } from "node:crypto";
import type { RuntimeCore } from "../../runtime/core.js";
import type { PolicyContext } from "../../runtime/types.js";
import type { RuntimeIntent } from "../../runtime/types.js";
import type { McpToolResult } from "../server.js";
import { asRecord } from "../tool-args.js";

export interface PortfolioToolDeps {
  readonly core: RuntimeCore;
  getPolicyContext(): PolicyContext;
}

export async function invokePortfolioTool(
  args: Record<string, unknown>,
  deps: PortfolioToolDeps,
): Promise<McpToolResult> {
  const ctx = deps.getPolicyContext();
  if (ctx.lifecycle !== "READY") {
    return {
      ok: false,
      code: "NOT_READY",
      message: "Portfolio reads are disabled until setup completes (lifecycle READY). Use phalanx_status for setup guidance.",
    };
  }

  const intent: RuntimeIntent = {
    id: randomUUID(),
    lane: "execution",
    action: "getPortfolioStatus",
    payload: asRecord(args.payload),
    entrySource: "mcp",
    target: typeof args.target === "string" && args.target.length > 0 ? args.target : "pool",
  };

  const out = await deps.core.handleIntent(intent);
  if (out.type === "executed") {
    return { ok: true, data: { kind: "executed" as const, adapterResult: out.adapterResult } };
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
