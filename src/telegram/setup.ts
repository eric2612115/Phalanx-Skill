import { resolve } from "node:path";
import { ConfigStore, getTelegramAllowedUserId, loadRuntimeConfigValues, resolveServiceConfigPath } from "../config/store.js";
import { readOnchainosManagedWalletAddress } from "../adapters/onchainos.js";
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
  "collect_login_email",
  "collect_okx",
  "collect_omrate",
  "bootstrap_wallet",
  "confirm_funding",
  "offer_allocate",
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

export interface ReadManagedWalletContext {
  readonly session: Readonly<SetupSession>;
}

export interface SetupHooks {
  readonly persistOwnerClaim?: (ctx: OwnerClaimPersistenceContext) => void | Promise<void>;
  readonly validateCapability?: (ctx: SetupCapabilityContext) => string | null | Promise<string | null>;
  readonly persistValidatedStep?: (ctx: SetupPersistenceContext) => void | Promise<void>;
  readonly readManagedWalletAddress?: (ctx: ReadManagedWalletContext) => Promise<string | null>;
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
  pendingLoginEmailChange: "confirm_overwrite" | "awaiting_new_email" | null;
  hooks: SetupHooks;
}

function mergedTelegramAllowedUserIdFromDisk(): string | undefined {
  const path = defaultConfigPath();
  const merged = loadRuntimeConfigValues(path, process.env);
  return getTelegramAllowedUserId(merged);
}

function defaultConfigPath(): string {
  const raw = process.env.PHALANX_CONFIG_PATH?.trim();
  if (raw && raw.length > 0) {
    return raw;
  }
  return resolve(process.cwd(), "config.env");
}

function createDefaultSetupHooks(): SetupHooks {
  const configPath = defaultConfigPath();
  return createConfigBackedSetupHooks(
    new ConfigStore(configPath),
    new ConfigStore(resolveServiceConfigPath(configPath)),
  );
}

export function createSetupSession(options: CreateSetupSessionOptions = {}): SetupSession {
  return {
    lifecycle: "UNCLAIMED",
    ownerUserId: null,
    pendingOwnerUserId: null,
    envAllowedUserId: options.envAllowedUserId ?? mergedTelegramAllowedUserIdFromDisk(),
    wizardStep: null,
    pendingLoginEmailChange: null,
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

function isLoginEmailChangeCommand(text: string): boolean {
  const choice = normalizedChoice(text);
  return (
    choice === "change_login_email" ||
    choice === "update_login_email" ||
    choice === "change_email" ||
    choice === "update_email"
  );
}

function buildStepAdvanceMessage(
  step: SetupWizardStep,
  next: SetupWizardStep,
  values: Readonly<Record<string, string>>,
): string {
  if (step === "bootstrap_wallet") {
    const address = values.OKX_AGENTIC_WALLET_CURRENT_ADDRESS ?? "unset";
    return [
      `Managed wallet confirmed: ${address}`,
      `Deposit funds into this wallet, then reply \`funded\`. ${setupStepPrompt(next)}`,
    ].join(" ");
  }
  if (step === "confirm_funding") {
    return `Funding acknowledged. ${setupStepPrompt(next)}`;
  }
  return `Step saved. ${setupStepPrompt(next)}`;
}

async function finalizeStepValues(
  step: SetupWizardStep,
  values: Record<string, string>,
  session: SetupSession,
): Promise<{ ok: true; values: Record<string, string> } | { ok: false; code: string; detail: string }> {
  if (step !== "bootstrap_wallet") {
    return { ok: true, values };
  }
  const address = await session.hooks.readManagedWalletAddress?.({ session });
  if (!address || !hasHexAddress(address)) {
    return {
      ok: false,
      code: "MANAGED_WALLET_UNRESOLVED",
      detail:
        "Managed wallet address could not be confirmed yet. Finish the OTP/login flow first, then reply `continue` again.",
    };
  }
  const merged = loadRuntimeConfigValues(defaultConfigPath(), process.env);
  return {
    ok: true,
    values: {
      ...values,
      OKX_AGENTIC_WALLET_CURRENT_ADDRESS: address,
      OKX_AGENTIC_WALLET_ADDRESS_HISTORY: mergeAddressHistory(
        merged.OKX_AGENTIC_WALLET_ADDRESS_HISTORY,
        address,
      ),
    },
  };
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

function hasBasicEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function hasHexAddress(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

function normalizedChoice(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, "_");
}

function mergeAddressHistory(existing: string | undefined, nextAddress: string): string {
  const seen = new Set(
    (existing ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0),
  );
  seen.add(nextAddress);
  return [...seen].join(",");
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
    case "collect_login_email": {
      if (!hasBasicEmail(t)) {
        return {
          ok: false,
          code: "INVALID_LOGIN_EMAIL",
          detail: "Invalid login email. Expected a reachable email address for OKX TEE wallet login and OTP.",
        };
      }
      return { ok: true, values: { OKX_AGENTIC_WALLET_LOGIN_EMAIL: t } };
    }
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
    case "collect_omrate": {
      if (normalizedChoice(t) === "skip") {
        return { ok: true, values: {} };
      }
      const pairs = parseKeyValueAssignments(t);
      if (!pairs.OMRATE_API_KEY) {
        return {
          ok: false,
          code: "INVALID_OMRATE_INPUT",
          detail: "Invalid OmRate payload. Expected OMRATE_API_KEY=<value> or `skip`.",
        };
      }
      return { ok: true, values: { OMRATE_API_KEY: pairs.OMRATE_API_KEY } };
    }
    case "bootstrap_wallet": {
      if (normalizedChoice(t) !== "continue") {
        return {
          ok: false,
          code: "BOOTSTRAP_CONTINUE_REQUIRED",
          detail: "Invalid wallet bootstrap input. Reply `continue` after checking OTP so AgentPhalanx can confirm the managed wallet address.",
        };
      }
      return { ok: true, values: {} };
    }
    case "confirm_funding": {
      if (normalizedChoice(t) !== "funded") {
        return {
          ok: false,
          code: "FUNDING_CONFIRM_REQUIRED",
          detail: "Invalid funding confirmation. Reply `funded` after assets have been deposited into the managed wallet.",
        };
      }
      return { ok: true, values: {} };
    }
    case "offer_allocate": {
      const choice = normalizedChoice(t);
      if (choice !== "allocate_now" && choice !== "skip") {
        return {
          ok: false,
          code: "INVALID_ALLOCATE_DECISION",
          detail: "Invalid allocation decision. Reply `allocate_now` to continue with allocation-oriented flow, or `skip` to finish setup.",
        };
      }
      return { ok: true, values: { AGENTPHALANX_ALLOCATE_DECISION: choice } };
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
    return handleReadyStateMessage(update, session);
  }

  return { nextState: session.lifecycle, messages: [] };
}

async function handleReadyStateMessage(
  update: TelegramUpdate,
  session: SetupSession,
): Promise<HandleTelegramUpdateResult> {
  if (!isOwner(update, session)) {
    return { nextState: "READY", messages: [] };
  }
  const raw = update.text ?? "";
  if (session.pendingLoginEmailChange === "confirm_overwrite") {
    const choice = normalizedChoice(raw);
    if (choice === "confirm") {
      session.pendingLoginEmailChange = "awaiting_new_email";
      return {
        nextState: "READY",
        messages: [
          "Send the new OKX TEE login email now. This changes the future login / OTP target for managed wallet access.",
        ],
      };
    }
    if (choice === "cancel") {
      session.pendingLoginEmailChange = null;
      return { nextState: "READY", messages: ["Login email change cancelled."] };
    }
    return {
      nextState: "READY",
      messages: [
        "Warning: changing the OKX login email can break access to wallets tied to the old email if you did not record it. Reply `confirm` to continue or `cancel` to abort.",
      ],
    };
  }
  if (session.pendingLoginEmailChange === "awaiting_new_email") {
    const validation = validateStepInput("collect_login_email", raw);
    if (!validation.ok) {
      return { nextState: "READY", messages: [renderSetupError(validation.code, validation.detail)] };
    }
    try {
      await session.hooks.persistValidatedStep?.({
        step: "collect_login_email",
        values: validation.values,
        session,
      });
    } catch (err: unknown) {
      return {
        nextState: "READY",
        messages: [renderSetupError("PERSIST_FAILED", err instanceof Error ? err.message : undefined)],
      };
    }
    session.pendingLoginEmailChange = null;
    return {
      nextState: "READY",
      messages: ["OKX login email updated and saved locally."],
    };
  }
  if (isLoginEmailChangeCommand(raw)) {
    session.pendingLoginEmailChange = "confirm_overwrite";
    return {
      nextState: "READY",
      messages: [
        "Warning: changing the OKX login email can break access to wallets tied to the old email if you did not record it. Reply `confirm` to continue or `cancel` to abort.",
      ],
    };
  }
  return { nextState: "READY", messages: [] };
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
    session.wizardStep = "collect_login_email";
    return {
      nextState: "SETUP_IN_PROGRESS",
      messages: ["Owner claim confirmed. " + setupStepPrompt("collect_login_email")],
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
    session.wizardStep = "collect_login_email";
    return {
      nextState: "SETUP_IN_PROGRESS",
      messages: [setupStepPrompt("collect_login_email")],
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
  const finalized = await finalizeStepValues(step, validation.values, session);
  if (!finalized.ok) {
    return {
      nextState: "SETUP_IN_PROGRESS",
      messages: [renderSetupError(finalized.code, finalized.detail)],
    };
  }

  const capabilityError = await session.hooks.validateCapability?.({
    step,
    values: finalized.values,
    session,
  });
  if (capabilityError !== null && capabilityError !== undefined) {
    return {
      nextState: "SETUP_IN_PROGRESS",
      messages: [renderSetupError("CAPABILITY_CHECK_FAILED", capabilityError)],
    };
  }

  if (Object.keys(finalized.values).length > 0) {
    try {
      await session.hooks.persistValidatedStep?.({
        step,
        values: finalized.values,
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
    messages: [buildStepAdvanceMessage(step, next, finalized.values)],
  };
}

export function createConfigBackedSetupHooks(
  configStore: ConfigStore,
  serviceStore: ConfigStore,
  overrides: Pick<SetupHooks, "validateCapability" | "readManagedWalletAddress"> = {},
): SetupHooks {
  const loadMergedEnv = (): NodeJS.ProcessEnv =>
    ({
      ...serviceStore.getSnapshot().values,
      ...configStore.getSnapshot().values,
      ...process.env,
    }) as NodeJS.ProcessEnv;
  return {
    validateCapability: overrides.validateCapability,
    readManagedWalletAddress:
      overrides.readManagedWalletAddress ??
      (async () => readOnchainosManagedWalletAddress({ chain: "base", env: loadMergedEnv() })),
    persistOwnerClaim: ({ ownerUserId }) => {
      configStore.updateValidated({ TELEGRAM_ALLOWED_USER_ID: ownerUserId }, () => null);
    },
    persistValidatedStep: ({ values }) => {
      const configValues: Record<string, string> = {};
      for (const [key, value] of Object.entries(values)) {
        configValues[key] = value;
      }
      if (Object.keys(configValues).length > 0) {
        configStore.updateValidated(configValues, () => null);
      }
    },
  };
}
