export type CoordinatorCommandFailure = {
  readonly status: "failed" | "tool_missing";
  readonly summary: string;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly exitCode?: number | null;
};

export type ExecutionPlanStep<TStep = unknown> = {
  readonly id: string;
  readonly summary: string;
  readonly payload: TStep;
};

export type BroadcastResult<TStep = unknown> = {
  readonly step: ExecutionPlanStep<TStep>;
  readonly txHash: string;
};

export type TxProgress = {
  readonly txHash: string;
  readonly txStatus: string;
  readonly failReason?: string;
};

export interface ConfirmationPolicy<TProgress extends TxProgress = TxProgress> {
  isSuccess(progress: TProgress): boolean;
  isFailure(progress: TProgress): boolean;
  summarizeFailure(progress: TProgress): string;
}

export interface ExecutionCoordinatorDeps<TStep, TProgress extends TxProgress = TxProgress> {
  readonly executeStep: (
    step: ExecutionPlanStep<TStep>,
  ) => Promise<BroadcastResult<TStep> | CoordinatorCommandFailure>;
  readonly readProgress: (
    broadcast: BroadcastResult<TStep>,
  ) => Promise<TProgress | CoordinatorCommandFailure>;
  readonly confirmationPolicy: ConfirmationPolicy<TProgress>;
  readonly delayImpl?: (ms: number) => Promise<void>;
  readonly pollIntervalMs?: number;
  readonly maxPollAttempts?: number;
}

export type ExecutionCoordinatorResult<TStep, TProgress extends TxProgress = TxProgress> =
  | {
      readonly status: "completed";
      readonly broadcasts: readonly BroadcastResult<TStep>[];
      readonly lastProgress?: TProgress;
    }
  | (CoordinatorCommandFailure & {
      readonly broadcasts: readonly BroadcastResult<TStep>[];
      readonly failedStep?: ExecutionPlanStep<TStep>;
      readonly lastProgress?: TProgress;
    });

export async function executeExecutionPlan<TStep, TProgress extends TxProgress = TxProgress>(
  steps: readonly ExecutionPlanStep<TStep>[],
  deps: ExecutionCoordinatorDeps<TStep, TProgress>,
): Promise<ExecutionCoordinatorResult<TStep, TProgress>> {
  const confirmationPolicy = deps.confirmationPolicy;
  const delay =
    deps.delayImpl ??
    (async (ms: number) => {
      await new Promise((resolve) => setTimeout(resolve, ms));
    });
  const pollIntervalMs = deps.pollIntervalMs ?? 1_500;
  const maxPollAttempts = deps.maxPollAttempts ?? 20;
  const broadcasts: BroadcastResult<TStep>[] = [];
  let lastProgress: TProgress | undefined;

  for (const step of steps) {
    const broadcast = await deps.executeStep(step);
    if ("status" in broadcast) {
      return { ...broadcast, broadcasts, failedStep: step, lastProgress };
    }
    broadcasts.push(broadcast);

    let finalProgress: TProgress | undefined;
    for (let attempt = 0; attempt < maxPollAttempts; attempt += 1) {
      const progress = await deps.readProgress(broadcast);
      if ("status" in progress) {
        return { ...progress, broadcasts, failedStep: step, lastProgress };
      }
      finalProgress = progress;
      lastProgress = progress;
      if (confirmationPolicy.isSuccess(progress)) {
        break;
      }
      if (confirmationPolicy.isFailure(progress)) {
        return {
          status: "failed",
          summary: confirmationPolicy.summarizeFailure(progress),
          broadcasts,
          failedStep: step,
          lastProgress: progress,
        };
      }
      if (attempt < maxPollAttempts - 1) {
        await delay(pollIntervalMs);
      }
    }
    if (!finalProgress || !confirmationPolicy.isSuccess(finalProgress)) {
      return {
        status: "failed",
        summary: `transaction ${broadcast.txHash} did not reach SUCCESS within polling budget`,
        broadcasts,
        failedStep: step,
        lastProgress: finalProgress,
      };
    }
  }

  return {
    status: "completed",
    broadcasts,
    lastProgress,
  };
}
