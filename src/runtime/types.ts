/**
 * Core runtime types: lanes, approval classes, intents, and pipeline outcomes.
 */

export type Lane = "conversation" | "execution";

export type ApprovalClass = "AUTO_EXECUTE" | "REQUIRE_APPROVAL" | "AUTO_BLOCK";

export type RuntimeLifecycleState = "UNCLAIMED" | "SETUP_IN_PROGRESS" | "READY" | "PAUSED";

export type EntrySource = "telegram" | "mcp" | "guardian";

export interface PolicyContext {
  readonly lifecycle: RuntimeLifecycleState;
  /** True when runtime is explicitly paused (subset of PAUSED lifecycle). */
  readonly executionPaused: boolean;
}

export interface RuntimeIntent {
  readonly id: string;
  readonly lane: Lane;
  readonly action: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly entrySource: EntrySource;
  /** Optional execution target (e.g. contract or protocol id) for whitelist checks. */
  readonly target?: string;
}

export type BlockStage = "policy" | "risk" | "approval_class";

export type RuntimeOutcome =
  | { type: "executed"; intentId: string; adapterResult: unknown }
  | { type: "pending_approval"; intentId: string; approvalId: string }
  | {
      type: "blocked";
      intentId: string;
      stage: BlockStage;
      code: string;
      message: string;
    }
  | { type: "rejected"; intentId: string; code: string; message: string };
