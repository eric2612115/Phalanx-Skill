import type { PhalanxHost } from "../../app/host.js";

export interface OperatorBindingSnapshot {
  readonly mode: ReturnType<PhalanxHost["getRuntimeConfig"]>["mode"];
  readonly readiness: ReturnType<PhalanxHost["getRuntimeConfig"]>["readiness"];
  readonly telegram: {
    readonly allowedUserId?: string;
    readonly botConfigured: boolean;
  };
  readonly owner: {
    readonly evmAddress?: string;
    readonly claimedTelegramUserId?: string | null;
    readonly pendingTelegramUserId?: string | null;
  };
  readonly wallet: {
    readonly executionOrTestAddress?: string;
  };
  readonly setup: {
    readonly lifecycle: ReturnType<PhalanxHost["getSetupSession"]>["lifecycle"];
    readonly wizardStep: ReturnType<PhalanxHost["getSetupSession"]>["wizardStep"];
  };
  readonly chain: {
    readonly baseRpcConfigured: boolean;
    readonly xlayerRpcConfigured: boolean;
  };
  readonly omrate: {
    readonly apiConfigured: boolean;
    readonly baseUrl: string;
  };
}

export async function fetchOperatorBindingSnapshot(host: PhalanxHost): Promise<OperatorBindingSnapshot> {
  const cfg = host.getRuntimeConfig();
  const wallet = host.getOperatorWalletSummary();
  const session = host.getSetupSession();
  return {
    mode: cfg.mode,
    readiness: cfg.readiness,
    telegram: {
      allowedUserId: cfg.telegram.allowedUserId,
      botConfigured: Boolean(cfg.telegram.botToken),
    },
    owner: {
      evmAddress: cfg.owner.evmAddress,
      claimedTelegramUserId: session.ownerUserId,
      pendingTelegramUserId: session.pendingOwnerUserId,
    },
    wallet: {
      executionOrTestAddress: wallet.executionOrTestAddress,
    },
    setup: {
      lifecycle: session.lifecycle,
      wizardStep: session.wizardStep,
    },
    chain: {
      baseRpcConfigured: Boolean(cfg.chain.baseRpcUrl),
      xlayerRpcConfigured: Boolean(cfg.chain.xlayerRpcUrl),
    },
    omrate: {
      apiConfigured: Boolean(cfg.omrate.apiKey),
      baseUrl: cfg.omrate.baseUrl ?? "https://api.omrate.com",
    },
  };
}
