import { resolve } from "node:path";
import { ConfigStore } from "../config/store.js";
import type { RuntimeLifecycleState } from "../runtime/types.js";
import {
  ownerAlreadyClaimedMessage,
  ownerClaimRejectedMessage,
  renderSetupError,
  setupCompleteMessage,
  setupStepPrompt,
  type SetupWizardStep,
} from "./messages.js";

export type { SetupWizardStep } from "./messages.js";

export interface TelegramFrom {
  readonly id: number;
}

export interface TelegramChat {
  readonly type: "private" | "group" | "supergroup" | "channel";
}

export interface TelegramUpdate {
  readonly from?: TelegramFrom;
  readonly chat: TelegramChat;
  readonly text?: string;
}

const WIZARD_ORDER: readonly SetupWizardStep[] = [
  "collect_okx",
  "collect_wallet",
  "collect_omrate",
  "collect_whitelist",
  "finalize",
] as const;

export function getNextWizardStep(current: SetupWizardStep): SetupWizardStep | null {
  const i = WIZARD_ORDER.indexOf(current);
  if (i < 0 || i >= WIZARD_ORDER.length - 1) {
    return null;
  }
  return WIZARD_ORDER[i + 1]!;
}

export interface OwnerClaimPersistenceContext {
  readonly ownerUserId: string;
  readonly session: Readonly<SetupSession>;
}

export interface SetupCapabilityContext {
  readonly step: SetupWizardStep;
  readonly values: Readonly<Record<string, string>>;
  readonly session: Readonly<SetupSession>;
}

export interface SetupPersistenceContext extends SetupCapabilityContext {}

export interface SetupHooks {
  readonly persistOwnerClaim?: (ctx: OwnerClaimPersistenceContext) => void | Promise<void>;
  readonly validateCapability?: (ctx: SetupCapabilityContext) => string | null | Promise<string | null>;
  readonly persistValidatedStep?: (ctx: SetupPersistenceContext) => void | Promise<void>;
}

export interface CreateSetupSessionOptions {
  readonly envAllowedUserId?: string;
  readonly hooks?: SetupHooks;
}

export interface SetupSession {
  lifecycle: RuntimeLifecycleState;
  ownerUserId: string | null;
  pendingOwnerUserId: string | null;
  envAllowedUserId: string | undefined;
  wizardStep: SetupWizardStep | null;
  hooks: SetupHooks;
}

function defaultAllowedUserId(): string | undefined {
  const raw = process.env.TELEGRAM_ALLOWED_USER_ID?.trim();
  return raw && raw.length > 0 ? raw : undefined;
}

function defaultConfigPath(): string {
  const raw = process.env.PHALANX_CONFIG_PATH?.trim();
  if (raw && raw.length > 0) {
    return raw;
  }
  return resolve(process.cwd(), "config.env");
}

function createDefaultSetupHooks(): SetupHooks {
  return createConfigBackedSetupHooks(new ConfigStore(defaultConfigPath()));
}

export function createSetupSession(options: CreateSetupSessionOptions = {}): SetupSession {
  return {
    lifecycle: "UNCLAIMED",
    ownerUserId: null,
    pendingOwnerUserId: null,
    envAllowedUserId: options.envAllowedUserId ?? defaultAllowedUserId(),
    wizardStep: null,
    hooks: options.hooks ?? createDefaultSetupHooks(),
  };
}

let defaultSession: SetupSession = createSetupSession();

export function resetTelegramSetupStateForTests(): void {
  defaultSession = createSetupSession();
}

function userIdString(from: TelegramFrom): string {
  return String(from.id);
}

export interface TryClaimOwnerResult {
  readonly allowed: boolean;
  readonly code?: string;
}

export function tryClaimOwner(
  update: TelegramUpdate,
  session: SetupSession = defaultSession,
): TryClaimOwnerResult {
  if (!update.from) {
    return { allowed: false, code: "NO_USER" };
  }
  if (update.chat.type !== "private") {
    return { allowed: false, code: "GROUP_NOT_ALLOWED" };
  }
  if (session.lifecycle !== "UNCLAIMED") {
    return { allowed: false, code: "NOT_UNCLAIMED" };
  }
  if (session.ownerUserId !== null) {
    return { allowed: false, code: "OWNER_EXISTS" };
  }
  const uid = userIdString(update.from);
  if (session.envAllowedUserId !== undefined && session.envAllowedUserId !== uid) {
    return { allowed: false, code: "ENV_USER_MISMATCH" };
  }
  return { allowed: true };
}

export interface HandleTelegramUpdateResult {
  readonly nextState: RuntimeLifecycleState;
  readonly messages: readonly string[];
}

let claimTail: Promise<unknown> = Promise.resolve();

function enqueueClaim<T>(fn: () => Promise<T>): Promise<T> {
  const next = claimTail.then(() => fn());
  claimTail = next.catch(() => {});
  return next;
}

function isOwner(update: TelegramUpdate, session: SetupSession): boolean {
  if (!update.from || session.ownerUserId === null) {
    return false;
  }
  return userIdString(update.from) === session.ownerUserId;
}

function parseKeyValueAssignments(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\n|;/)) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (!key || !value) continue;
    out[key] = value;
  }
  return out;
}

function hasHexAddress(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

function parseWhitelistTargets(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function validateStepInput(
  step: SetupWizardStep,
  text: string,
): { ok: true; values: Record<string, string> } | { ok: false; code: string; detail: string } {
  const t = text.trim();
  if (t.length === 0) {
    return { ok: false, code: "INVALID_INPUT", detail: "Input cannot be empty." };
  }

  switch (step) {
    case "collect_okx": {
      const pairs = parseKeyValueAssignments(t);
      if (!pairs.OKX_API_KEY || !pairs.OKX_API_SECRET || !pairs.OKX_API_PASSPHRASE) {
        return {
          ok: false,
          code: "INVALID_OKX_INPUT",
          detail: "Invalid OKX payload. Expected OKX_API_KEY, OKX_API_SECRET, and OKX_API_PASSPHRASE.",
        };
      }
      return {
        ok: true,
        values: {
          OKX_API_KEY: pairs.OKX_API_KEY,
          OKX_API_SECRET: pairs.OKX_API_SECRET,
          OKX_API_PASSPHRASE: pairs.OKX_API_PASSPHRASE,
        },
      };
    }
    case "collect_wallet": {
      const pairs = parseKeyValueAssignments(t);
      const wallet = pairs.AGENT_WALLET_ADDRESS ?? t;
      if (!hasHexAddress(wallet)) {
        return {
          ok: false,
          code: "INVALID_WALLET_INPUT",
          detail: "Invalid wallet payload. Expected AGENT_WALLET_ADDRESS=0x... with a 20-byte address.",
        };
      }
      return { ok: true, values: { AGENT_WALLET_ADDRESS: wallet } };
    }
    case "collect_omrate": {
      const pairs = parseKeyValueAssignments(t);
      if (!pairs.OMRATE_API_KEY) {
        return {
          ok: false,
          code: "INVALID_OMRATE_INPUT",
          detail: "Invalid OmRate payload. Expected OMRATE_API_KEY=<value>.",
        };
      }
      return { ok: true, values: { OMRATE_API_KEY: pairs.OMRATE_API_KEY } };
    }
    case "collect_whitelist": {
      const targets = parseWhitelistTargets(t);
      if (targets.length === 0 || targets.some((target) => !/^[A-Za-z0-9._-]+$/.test(target))) {
        return {
          ok: false,
          code: "INVALID_WHITELIST_INPUT",
          detail: "Invalid whitelist payload. Expected a comma- or newline-separated list of target ids.",
        };
      }
      return { ok: true, values: { WHITELIST_TARGETS: targets.join(",") } };
    }
    case "finalize": {
      if (t.toLowerCase() !== "confirm") {
        return {
          ok: false,
          code: "FINALIZE_NEED_CONFIRM",
          detail: "Invalid finalize input. Send confirm to complete setup.",
        };
      }
      return { ok: true, values: {} };
    }
    default:
      return { ok: false, code: "UNKNOWN_STEP", detail: "Unknown setup step." };
  }
}

export async function handleTelegramUpdate(
  update: TelegramUpdate,
  session: SetupSession = defaultSession,
): Promise<HandleTelegramUpdateResult> {
  if (!update.from) {
    return { nextState: session.lifecycle, messages: [renderSetupError("NO_USER")] };
  }

  if (session.lifecycle === "UNCLAIMED") {
    return enqueueClaim(() => handleUnclaimed(update, session));
  }

  if (session.lifecycle === "SETUP_IN_PROGRESS") {
    return handleSetupInProgress(update, session);
  }

  if (session.lifecycle === "READY") {
    return { nextState: "READY", messages: [] };
  }

  return { nextState: session.lifecycle, messages: [] };
}

async function handleUnclaimed(
  update: TelegramUpdate,
  session: SetupSession,
): Promise<HandleTelegramUpdateResult> {
  if (session.pendingOwnerUserId !== null) {
    const actorId = userIdString(update.from!);
    if (actorId !== session.pendingOwnerUserId) {
      return {
        nextState: "UNCLAIMED",
        messages: ["An owner claim candidate is already pending confirmation in another private chat."],
      };
    }
    if ((update.text ?? "").trim().toLowerCase() !== "confirm") {
      return {
        nextState: "UNCLAIMED",
        messages: ["Owner claim pending. Reply with `confirm` to finalize ownership and begin setup."],
      };
    }

    try {
      await session.hooks.persistOwnerClaim?.({ ownerUserId: actorId, session });
    } catch (err: unknown) {
      return {
        nextState: "UNCLAIMED",
        messages: [renderSetupError("OWNER_PERSIST_FAILED", err instanceof Error ? err.message : undefined)],
      };
    }

    session.ownerUserId = actorId;
    session.pendingOwnerUserId = null;
    session.lifecycle = "SETUP_IN_PROGRESS";
    session.wizardStep = "collect_okx";
    return {
      nextState: "SETUP_IN_PROGRESS",
      messages: ["Owner claim confirmed. " + setupStepPrompt("collect_okx")],
    };
  }

  const claim = tryClaimOwner(update, session);
  if (!claim.allowed) {
    if (claim.code === "GROUP_NOT_ALLOWED") {
      return { nextState: "UNCLAIMED", messages: [ownerClaimRejectedMessage()] };
    }
    return {
      nextState: session.lifecycle,
      messages: [renderSetupError(claim.code ?? "CLAIM_DENIED")],
    };
  }

  session.pendingOwnerUserId = userIdString(update.from!);
  return {
    nextState: "UNCLAIMED",
    messages: ["Owner claim candidate accepted. Reply with `confirm` to finalize ownership."],
  };
}

async function handleSetupInProgress(
  update: TelegramUpdate,
  session: SetupSession,
): Promise<HandleTelegramUpdateResult> {
  if (!isOwner(update, session)) {
    return {
      nextState: "SETUP_IN_PROGRESS",
      messages: [ownerAlreadyClaimedMessage()],
    };
  }

  const step = session.wizardStep;
  if (step === null) {
    session.wizardStep = "collect_okx";
    return {
      nextState: "SETUP_IN_PROGRESS",
      messages: [setupStepPrompt("collect_okx")],
    };
  }

  const raw = update.text ?? "";
  const validation = validateStepInput(step, raw);
  if (!validation.ok) {
    return {
      nextState: "SETUP_IN_PROGRESS",
      messages: [renderSetupError(validation.code, validation.detail)],
    };
  }

  const capabilityError = await session.hooks.validateCapability?.({
    step,
    values: validation.values,
    session,
  });
  if (capabilityError !== null && capabilityError !== undefined) {
    return {
      nextState: "SETUP_IN_PROGRESS",
      messages: [renderSetupError("CAPABILITY_CHECK_FAILED", capabilityError)],
    };
  }

  if (Object.keys(validation.values).length > 0) {
    try {
      await session.hooks.persistValidatedStep?.({
        step,
        values: validation.values,
        session,
      });
    } catch (err: unknown) {
      return {
        nextState: "SETUP_IN_PROGRESS",
        messages: [renderSetupError("PERSIST_FAILED", err instanceof Error ? err.message : undefined)],
      };
    }
  }

  const next = getNextWizardStep(step);
  if (next === null) {
    session.lifecycle = "READY";
    session.wizardStep = null;
    return {
      nextState: "READY",
      messages: [setupCompleteMessage()],
    };
  }

  session.wizardStep = next;
  return {
    nextState: "SETUP_IN_PROGRESS",
    messages: [`Step saved. ${setupStepPrompt(next)}`],
  };
}

export function createConfigBackedSetupHooks(
  configStore: ConfigStore,
  overrides: Pick<SetupHooks, "validateCapability"> = {},
): SetupHooks {
  return {
    validateCapability: overrides.validateCapability,
    persistOwnerClaim: ({ ownerUserId }) => {
      configStore.updateValidated({ TELEGRAM_ALLOWED_USER_ID: ownerUserId }, () => null);
    },
    persistValidatedStep: ({ values }) => {
      configStore.updateValidated(values, () => null);
    },
  };
}
