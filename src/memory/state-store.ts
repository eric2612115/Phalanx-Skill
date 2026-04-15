import type { PortfolioSnapshot } from "../adapters/portfolio.js";
import type { GuardianLastAssessment } from "../guardian/operator-assessment.js";
import type { RuntimeEvent } from "../runtime/events.js";
import type { TelegramJob } from "../telegram/job-queue.js";

export interface RuntimeMemoryState {
  readonly updatedAt: string;
  readonly source: "guardian_cycle" | "runtime_event" | "preference_patch" | "restore";
  readonly portfolioState?: PortfolioSnapshot;
  readonly guardianAssessment?: GuardianLastAssessment;
  readonly actionHistory?: readonly RuntimeEvent[];
  readonly userPreferences?: Readonly<Record<string, string>>;
  readonly x402Balance?: string;
  readonly activeProfileId?: string;
  readonly activeWalletId?: string;
  readonly pendingJobs?: readonly TelegramJob[];
}

export interface MemoryReasoningContextInput {
  readonly purpose: "guardian" | "operator";
}

export interface MemoryReasoningContext {
  readonly portfolioState?: PortfolioSnapshot;
  readonly guardianAssessment?: GuardianLastAssessment;
  readonly actionHistory: readonly RuntimeEvent[];
  readonly activeProfileId?: string;
  readonly activeWalletId?: string;
  readonly pendingJobs: readonly TelegramJob[];
}

export interface StateStore {
  loadLatestState(): Promise<RuntimeMemoryState | null>;
  persistCycleState(state: RuntimeMemoryState): Promise<void>;
  persistRuntimeEventState(state: RuntimeMemoryState): Promise<void>;
  persistConfirmedPreferencePatch(patch: Readonly<Record<string, string>>): Promise<void>;
  loadReasoningContext(input: MemoryReasoningContextInput): Promise<MemoryReasoningContext>;
}

export function mergeRuntimeMemoryState(
  current: RuntimeMemoryState | null,
  patch: RuntimeMemoryState,
): RuntimeMemoryState {
  return {
    updatedAt: patch.updatedAt,
    source: patch.source,
    portfolioState: patch.portfolioState ?? current?.portfolioState,
    guardianAssessment: patch.guardianAssessment ?? current?.guardianAssessment,
    actionHistory: patch.actionHistory ?? current?.actionHistory ?? [],
    userPreferences: patch.userPreferences ?? current?.userPreferences ?? {},
    x402Balance: patch.x402Balance ?? current?.x402Balance,
    activeProfileId: patch.activeProfileId ?? current?.activeProfileId,
    activeWalletId: patch.activeWalletId ?? current?.activeWalletId,
    pendingJobs: patch.pendingJobs ?? current?.pendingJobs ?? [],
  };
}
