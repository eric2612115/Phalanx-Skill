import type { ApprovalClass, RuntimeIntent } from "./types.js";

export interface ActionDefinition {
  readonly approvalClass: ApprovalClass;
  readonly conversationAllowed: boolean;
  readonly allowedBeforeReady: boolean;
  readonly stateChanging: boolean;
}

/**
 * Actions that mutate portfolio, chain state, or paid/external side effects.
 * Conversation lane must never register tools that map to these actions.
 */
const ACTION_DEFINITIONS = {
  getPortfolioStatus: {
    approvalClass: "AUTO_EXECUTE",
    conversationAllowed: true,
    allowedBeforeReady: true,
    stateChanging: false,
  },
  queryRates: {
    approvalClass: "AUTO_EXECUTE",
    conversationAllowed: true,
    allowedBeforeReady: true,
    stateChanging: false,
  },
  getRuntimeStatus: {
    approvalClass: "AUTO_EXECUTE",
    conversationAllowed: true,
    allowedBeforeReady: true,
    stateChanging: false,
  },
  emergencyExit: {
    approvalClass: "AUTO_EXECUTE",
    conversationAllowed: false,
    allowedBeforeReady: false,
    stateChanging: true,
  },
  proposeRebalance: {
    approvalClass: "AUTO_EXECUTE",
    conversationAllowed: false,
    allowedBeforeReady: false,
    stateChanging: true,
  },
  executeRebalance: {
    approvalClass: "AUTO_EXECUTE",
    conversationAllowed: false,
    allowedBeforeReady: false,
    stateChanging: true,
  },
  requestWhitelistExpansion: {
    approvalClass: "REQUIRE_APPROVAL",
    conversationAllowed: false,
    allowedBeforeReady: false,
    stateChanging: true,
  },
  executeApprovedAction: {
    approvalClass: "AUTO_EXECUTE",
    conversationAllowed: false,
    allowedBeforeReady: false,
    stateChanging: true,
  },
  deposit: {
    approvalClass: "AUTO_EXECUTE",
    conversationAllowed: false,
    allowedBeforeReady: false,
    stateChanging: true,
  },
  withdraw: {
    approvalClass: "AUTO_EXECUTE",
    conversationAllowed: false,
    allowedBeforeReady: false,
    stateChanging: true,
  },
  swap: {
    approvalClass: "AUTO_EXECUTE",
    conversationAllowed: false,
    allowedBeforeReady: false,
    stateChanging: true,
  },
  planUniswapLiquidity: {
    approvalClass: "AUTO_EXECUTE",
    conversationAllowed: true,
    allowedBeforeReady: false,
    stateChanging: false,
  },
  pauseRuntime: {
    approvalClass: "REQUIRE_APPROVAL",
    conversationAllowed: false,
    allowedBeforeReady: false,
    stateChanging: true,
  },
  resumeRuntime: {
    approvalClass: "REQUIRE_APPROVAL",
    conversationAllowed: false,
    allowedBeforeReady: false,
    stateChanging: true,
  },
} as const satisfies Record<string, ActionDefinition>;

export function getActionDefinition(action: string): ActionDefinition | undefined {
  return ACTION_DEFINITIONS[action as keyof typeof ACTION_DEFINITIONS];
}

export const STATE_CHANGING_ACTIONS = new Set<string>(
  Object.entries(ACTION_DEFINITIONS)
    .filter(([, definition]) => definition.stateChanging)
    .map(([action]) => action),
);

export function isStateChangingAction(action: string): boolean {
  return getActionDefinition(action)?.stateChanging ?? false;
}

/**
 * Read-only / observability actions allowed on the conversation lane.
 */
export const CONVERSATION_ALLOWED_ACTIONS = new Set<string>(
  Object.entries(ACTION_DEFINITIONS)
    .filter(([, definition]) => definition.conversationAllowed)
    .map(([action]) => action),
);

export function isConversationLaneActionAllowed(action: string): boolean {
  return getActionDefinition(action)?.conversationAllowed ?? false;
}

export function isActionAllowedBeforeReady(action: string): boolean {
  return getActionDefinition(action)?.allowedBeforeReady ?? false;
}

export function isExplicitReadOnlyAction(action: string): boolean {
  const definition = getActionDefinition(action);
  return definition !== undefined && !definition.stateChanging;
}

/** Tool ids exposed to the conversation lane (must be non-mutating). */
export function getConversationLaneToolNames(): readonly string[] {
  return Array.from(CONVERSATION_ALLOWED_ACTIONS).sort((a, b) => a.localeCompare(b));
}

/** Tool ids for the execution lane (structured intents only). */
export function getExecutionLaneToolNames(): readonly string[] {
  return Object.keys(ACTION_DEFINITIONS).sort((a, b) => a.localeCompare(b));
}

export function assertIntentShape(intent: RuntimeIntent): void {
  if (!intent.id || !intent.action) {
    throw new Error("Invalid intent: id and action are required");
  }
  if (intent.lane !== "conversation" && intent.lane !== "execution") {
    throw new Error("Invalid intent: lane");
  }
}

export function fingerprintForPending(intent: RuntimeIntent): string {
  const target = intent.target ?? "";
  const payloadKey = stablePayloadKey(intent.payload);
  return `${intent.action}|${target}|${payloadKey}`;
}

function stablePayloadKey(payload: Readonly<Record<string, unknown>>): string {
  const keys = Object.keys(payload).sort((a, b) => a.localeCompare(b));
  const parts = keys.map((k) => `${k}:${JSON.stringify(payload[k])}`);
  return parts.join("&");
}
