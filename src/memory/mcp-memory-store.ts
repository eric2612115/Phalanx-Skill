import { readFileSync, renameSync, writeFileSync } from "node:fs";

import {
  mergeRuntimeMemoryState,
  type MemoryReasoningContext,
  type MemoryReasoningContextInput,
  type RuntimeMemoryState,
  type StateStore,
} from "./state-store.js";
import { toRuntimeStateSnapshot, type RuntimeStateStore, type RuntimeStateSnapshot } from "../state/runtime-state-store.js";

function atomicWrite(path: string, data: string): void {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, data, "utf8");
  renameSync(tmp, path);
}

export class McpMemoryStateStore implements StateStore, RuntimeStateStore {
  constructor(private readonly filePath: string) {}

  async loadLatestState(): Promise<RuntimeMemoryState | null> {
    try {
      return JSON.parse(readFileSync(this.filePath, "utf8")) as RuntimeMemoryState;
    } catch (error: unknown) {
      const code =
        error && typeof error === "object" && "code" in error ? (error as NodeJS.ErrnoException).code : undefined;
      if (code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  async persistCycleState(state: RuntimeMemoryState): Promise<void> {
    const current = await this.loadLatestState();
    atomicWrite(this.filePath, JSON.stringify(mergeRuntimeMemoryState(current, state), null, 2));
  }

  async persistRuntimeEventState(state: RuntimeMemoryState): Promise<void> {
    const current = await this.loadLatestState();
    atomicWrite(this.filePath, JSON.stringify(mergeRuntimeMemoryState(current, state), null, 2));
  }

  async persistConfirmedPreferencePatch(patch: Readonly<Record<string, string>>): Promise<void> {
    const current = await this.loadLatestState();
    const next = mergeRuntimeMemoryState(current, {
      updatedAt: new Date().toISOString(),
      source: "preference_patch",
      userPreferences: { ...(current?.userPreferences ?? {}), ...patch },
    });
    atomicWrite(this.filePath, JSON.stringify(next, null, 2));
  }

  async loadReasoningContext(_input: MemoryReasoningContextInput): Promise<MemoryReasoningContext> {
    const current = await this.loadLatestState();
    return {
      portfolioState: current?.portfolioState,
      guardianAssessment: current?.guardianAssessment,
      actionHistory: current?.actionHistory ?? [],
      activeProfileId: current?.activeProfileId,
      activeWalletId: current?.activeWalletId,
      pendingJobs: current?.pendingJobs ?? [],
    };
  }

  async loadLatestRuntimeState(): Promise<RuntimeStateSnapshot | null> {
    return toRuntimeStateSnapshot(await this.loadLatestState());
  }
}
