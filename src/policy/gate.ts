import type { PolicyContext, RuntimeIntent } from "../runtime/types.js";
import {
  isActionAllowedBeforeReady,
  isExplicitReadOnlyAction,
  isConversationLaneActionAllowed,
} from "../runtime/intents.js";
import { WhitelistPolicy } from "./whitelist-policy.js";

export interface PolicyGateResult {
  readonly ok: boolean;
  readonly code?: string;
  readonly message?: string;
}

export interface PolicyGateDeps {
  readonly whitelist: WhitelistPolicy;
}

/**
 * Application-layer gate: lifecycle, pause, lane/action pairing, whitelist.
 */
export class PolicyGate {
  constructor(private readonly deps: PolicyGateDeps) {}

  evaluate(intent: RuntimeIntent, ctx: PolicyContext): PolicyGateResult {
    if (ctx.lifecycle === "PAUSED" || ctx.executionPaused) {
      if (isExplicitReadOnlyAction(intent.action)) {
        // Paused runtime remains queryable, but mutation stays blocked.
      } else {
        return {
          ok: false,
          code: "RUNTIME_PAUSED",
          message: "Runtime is paused; execution is blocked",
        };
      }
    }

    if (ctx.lifecycle === "UNCLAIMED" || ctx.lifecycle === "SETUP_IN_PROGRESS") {
      if (!isActionAllowedBeforeReady(intent.action)) {
        return {
          ok: false,
          code: "NOT_READY",
          message: "Runtime is not ready for this action",
        };
      }
    }

    if (intent.lane === "conversation" && !isConversationLaneActionAllowed(intent.action)) {
      return {
        ok: false,
        code: "LANE_VIOLATION",
        message: "Conversation lane only allows explicit read-only actions",
      };
    }

    if (!this.deps.whitelist.isAllowedTarget(intent.target)) {
      return {
        ok: false,
        code: "TARGET_NOT_WHITELISTED",
        message: "Target is not on the whitelist",
      };
    }

    return { ok: true };
  }
}
