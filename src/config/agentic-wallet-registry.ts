export interface AgenticWalletRecord {
  readonly walletId: string;
  readonly address: string;
  readonly label?: string;
}

export interface AgenticWalletProfile {
  readonly profileId: string;
  readonly email: string;
  readonly wallets: readonly AgenticWalletRecord[];
}

export interface AgenticWalletRegistry {
  readonly profiles: readonly AgenticWalletProfile[];
  readonly activeProfileId?: string;
  readonly activeWalletId?: string;
}

export interface ActiveAgenticWalletSelection {
  readonly profile?: AgenticWalletProfile;
  readonly wallet?: AgenticWalletRecord;
}

export interface UpsertAgenticWalletInput {
  readonly email: string;
  readonly address: string;
  readonly label?: string;
}

const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

function normalizedValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeWalletId(raw: unknown, index: number): string {
  const given = typeof raw === "string" ? raw.trim() : "";
  return given.length > 0 ? given : `wallet-${index + 1}`;
}

function normalizeProfileId(raw: unknown, index: number): string {
  const given = typeof raw === "string" ? raw.trim() : "";
  return given.length > 0 ? given : `profile-${index + 1}`;
}

function normalizeWallet(raw: unknown, index: number): AgenticWalletRecord | null {
  if (!isRecord(raw)) {
    return null;
  }
  const address = normalizedValue(typeof raw.address === "string" ? raw.address : undefined);
  if (address === undefined || !EVM_ADDRESS_RE.test(address)) {
    return null;
  }
  const label = normalizedValue(typeof raw.label === "string" ? raw.label : undefined);
  return {
    walletId: normalizeWalletId(raw.walletId, index),
    address,
    ...(label ? { label } : {}),
  };
}

function normalizeProfile(raw: unknown, index: number): AgenticWalletProfile | null {
  if (!isRecord(raw)) {
    return null;
  }
  const email = normalizedValue(typeof raw.email === "string" ? raw.email : undefined);
  if (email === undefined) {
    return null;
  }
  const walletInputs = Array.isArray(raw.wallets) ? raw.wallets : [];
  const seenAddresses = new Set<string>();
  const wallets: AgenticWalletRecord[] = [];
  for (const [walletIndex, walletInput] of walletInputs.entries()) {
    const wallet = normalizeWallet(walletInput, walletIndex);
    if (!wallet) {
      continue;
    }
    const dedupeKey = wallet.address.toLowerCase();
    if (seenAddresses.has(dedupeKey)) {
      continue;
    }
    seenAddresses.add(dedupeKey);
    wallets.push(wallet);
  }
  if (wallets.length === 0) {
    return null;
  }
  return {
    profileId: normalizeProfileId(raw.profileId, index),
    email,
    wallets,
  };
}

function parseRegistryJson(value: string | undefined): AgenticWalletRegistry | null {
  const raw = normalizedValue(value);
  if (raw === undefined) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) {
      return null;
    }
    const profilesInput = Array.isArray(parsed.profiles) ? parsed.profiles : [];
    const profiles = profilesInput
      .map((profile, index) => normalizeProfile(profile, index))
      .filter((profile): profile is AgenticWalletProfile => profile !== null);
    return {
      profiles,
      activeProfileId: normalizedValue(
        typeof parsed.activeProfileId === "string" ? parsed.activeProfileId : undefined,
      ),
      activeWalletId: normalizedValue(
        typeof parsed.activeWalletId === "string" ? parsed.activeWalletId : undefined,
      ),
    };
  } catch {
    return null;
  }
}

function buildLegacyRegistry(
  values: Readonly<Record<string, string | undefined>>,
): AgenticWalletRegistry {
  const email = normalizedValue(values.OKX_AGENTIC_WALLET_LOGIN_EMAIL);
  const currentAddress = normalizedValue(values.OKX_AGENTIC_WALLET_CURRENT_ADDRESS);
  const history = (values.OKX_AGENTIC_WALLET_ADDRESS_HISTORY ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => EVM_ADDRESS_RE.test(item));

  const orderedAddresses: string[] = [];
  const seen = new Set<string>();
  for (const address of [currentAddress, ...history].filter((value): value is string => !!value)) {
    const key = address.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    orderedAddresses.push(address);
  }

  if (email === undefined || orderedAddresses.length === 0) {
    return { profiles: [] };
  }

  return {
    activeProfileId: "profile-1",
    activeWalletId: "wallet-1",
    profiles: [
      {
        profileId: "profile-1",
        email,
        wallets: orderedAddresses.map((address, index) => ({
          walletId: `wallet-${index + 1}`,
          address,
        })),
      },
    ],
  };
}

export function resolveActiveAgenticWallet(
  registry: AgenticWalletRegistry,
): ActiveAgenticWalletSelection {
  const explicitProfile =
    registry.profiles.find((profile) => profile.profileId === registry.activeProfileId) ?? registry.profiles[0];
  if (!explicitProfile) {
    return {};
  }
  const explicitWallet =
    explicitProfile.wallets.find((wallet) => wallet.walletId === registry.activeWalletId) ?? explicitProfile.wallets[0];
  return {
    profile: explicitProfile,
    wallet: explicitWallet,
  };
}

export function normalizeAgenticWalletRegistry(
  values: Readonly<Record<string, string | undefined>>,
): AgenticWalletRegistry {
  const parsed = parseRegistryJson(values.OKX_AGENTIC_WALLET_PROFILES_JSON) ?? buildLegacyRegistry(values);
  const active = resolveActiveAgenticWallet(parsed);
  return {
    profiles: parsed.profiles,
    activeProfileId: active.profile?.profileId,
    activeWalletId: active.wallet?.walletId,
  };
}

export function serializeAgenticWalletRegistry(registry: AgenticWalletRegistry): string {
  return JSON.stringify(registry);
}

export function upsertAgenticWalletRegistryEntry(
  registry: AgenticWalletRegistry,
  input: UpsertAgenticWalletInput,
): AgenticWalletRegistry {
  const normalizedEmail = input.email.trim();
  const normalizedAddress = input.address.trim();
  if (!normalizedEmail || !EVM_ADDRESS_RE.test(normalizedAddress)) {
    return registry;
  }

  const profiles = registry.profiles.map((profile) => ({
    profileId: profile.profileId,
    email: profile.email,
    wallets: [...profile.wallets],
  }));
  const profileIndex = profiles.findIndex((profile) => profile.email.toLowerCase() === normalizedEmail.toLowerCase());
  if (profileIndex === -1) {
    const nextProfileId = `profile-${profiles.length + 1}`;
    return normalizeAgenticWalletRegistry({
      OKX_AGENTIC_WALLET_PROFILES_JSON: JSON.stringify({
        activeProfileId: nextProfileId,
        activeWalletId: "wallet-1",
        profiles: [
          ...profiles,
          {
            profileId: nextProfileId,
            email: normalizedEmail,
            wallets: [
              {
                walletId: "wallet-1",
                address: normalizedAddress,
                ...(input.label ? { label: input.label } : {}),
              },
            ],
          },
        ],
      } satisfies AgenticWalletRegistry),
    });
  }

  const profile = profiles[profileIndex]!;
  const walletIndex = profile.wallets.findIndex((wallet) => wallet.address.toLowerCase() === normalizedAddress.toLowerCase());
  if (walletIndex === -1) {
    profile.wallets = [
      ...profile.wallets,
      {
        walletId: `wallet-${profile.wallets.length + 1}`,
        address: normalizedAddress,
        ...(input.label ? { label: input.label } : {}),
      },
    ];
  }

  const activeWallet = profile.wallets.find((wallet) => wallet.address.toLowerCase() === normalizedAddress.toLowerCase());
  return normalizeAgenticWalletRegistry({
    OKX_AGENTIC_WALLET_PROFILES_JSON: JSON.stringify({
      activeProfileId: profile.profileId,
      activeWalletId: activeWallet?.walletId,
      profiles,
    } satisfies AgenticWalletRegistry),
  });
}

export function activateAgenticProfile(
  registry: AgenticWalletRegistry,
  profileId: string,
): AgenticWalletRegistry | null {
  const profile = registry.profiles.find((item) => item.profileId === profileId);
  if (!profile) {
    return null;
  }
  return normalizeAgenticWalletRegistry({
    OKX_AGENTIC_WALLET_PROFILES_JSON: JSON.stringify({
      activeProfileId: profile.profileId,
      activeWalletId: profile.wallets[0]?.walletId,
      profiles: registry.profiles,
    } satisfies AgenticWalletRegistry),
  });
}

export function activateAgenticWallet(
  registry: AgenticWalletRegistry,
  walletId: string,
): AgenticWalletRegistry | null {
  for (const profile of registry.profiles) {
    const wallet = profile.wallets.find((item) => item.walletId === walletId);
    if (!wallet) {
      continue;
    }
    return normalizeAgenticWalletRegistry({
      OKX_AGENTIC_WALLET_PROFILES_JSON: JSON.stringify({
        activeProfileId: profile.profileId,
        activeWalletId: wallet.walletId,
        profiles: registry.profiles,
      } satisfies AgenticWalletRegistry),
    });
  }
  return null;
}
