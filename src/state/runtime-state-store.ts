import type { RuntimeMemoryState } from "../memory/state-store.js";

export interface RuntimeStateSnapshot {
  readonly updatedAt: string;
  readonly source: RuntimeMemoryState["source"];
  readonly actionHistory?: RuntimeMemoryState["actionHistory"];
  readonly activeProfileId?: string;
  readonly activeWalletId?: string;
}

export interface RuntimeStateStore {
  loadLatestRuntimeState(): Promise<RuntimeStateSnapshot | null>;
}

export function toRuntimeStateSnapshot(
  state: RuntimeMemoryState | null,
): RuntimeStateSnapshot | null {
  if (!state) {
    return null;
  }

  return {
    updatedAt: state.updatedAt,
    source: state.source,
    actionHistory: state.actionHistory,
    activeProfileId: state.activeProfileId,
    activeWalletId: state.activeWalletId,
  };
}
