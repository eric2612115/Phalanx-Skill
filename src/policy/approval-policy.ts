import type { ApprovalClass, RuntimeIntent } from "../runtime/types.js";
import { getActionDefinition } from "../runtime/intents.js";

/**
 * Maps intents to approval classes. Bounded defaults; callers may extend via override hook.
 */
export class ApprovalPolicy {
  constructor(
    private readonly overrides?: Readonly<
      Partial<Record<string, ApprovalClass>>
    >,
  ) {}

  classify(intent: RuntimeIntent): ApprovalClass {
    const o = this.overrides?.[intent.action];
    if (o !== undefined) {
      return o;
    }

    return getActionDefinition(intent.action)?.approvalClass ?? "AUTO_BLOCK";
  }
}
