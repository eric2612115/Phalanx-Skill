import { readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface StrategyProfile {
  profileId: string;
  schemaVersion: number;
  riskLevel: string;
  allocations: Record<string, number>;
  allowedProtocols: string[];
  rebalanceThresholdBps: number;
}

export interface StrategyProfileSnapshot {
  readonly version: number;
  readonly profile: StrategyProfile;
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function validateProfile(raw: unknown, profileIdFromFile: string): StrategyProfile {
  if (!isRecord(raw)) {
    throw new Error("Strategy profile must be a JSON object");
  }
  const profileId = raw.profileId;
  const schemaVersion = raw.schemaVersion;
  const riskLevel = raw.riskLevel;
  const allocations = raw.allocations;
  const allowedProtocols = raw.allowedProtocols;
  const rebalanceThresholdBps = raw.rebalanceThresholdBps;

  if (typeof profileId !== "string" || profileId.length === 0) {
    throw new Error("Invalid or missing profileId");
  }
  if (profileId !== profileIdFromFile) {
    throw new Error(`profileId "${profileId}" does not match file id "${profileIdFromFile}"`);
  }
  if (typeof schemaVersion !== "number" || !Number.isFinite(schemaVersion)) {
    throw new Error("Invalid or missing schemaVersion");
  }
  if (typeof riskLevel !== "string" || riskLevel.length === 0) {
    throw new Error("Invalid or missing riskLevel");
  }
  if (!isRecord(allocations)) {
    throw new Error("Invalid or missing allocations");
  }
  for (const [k, v] of Object.entries(allocations)) {
    if (typeof v !== "number" || !Number.isFinite(v)) {
      throw new Error(`Invalid allocation weight for "${k}"`);
    }
  }
  if (!Array.isArray(allowedProtocols) || !allowedProtocols.every((p) => typeof p === "string")) {
    throw new Error("Invalid or missing allowedProtocols");
  }
  if (typeof rebalanceThresholdBps !== "number" || !Number.isFinite(rebalanceThresholdBps)) {
    throw new Error("Invalid or missing rebalanceThresholdBps");
  }

  return {
    profileId,
    schemaVersion,
    riskLevel,
    allocations: { ...allocations } as Record<string, number>,
    allowedProtocols: [...allowedProtocols],
    rebalanceThresholdBps,
  };
}

function atomicWriteJson(path: string, value: unknown): void {
  const tmp = `${path}.${process.pid}.tmp`;
  const data = `${JSON.stringify(value, null, 2)}\n`;
  writeFileSync(tmp, data, "utf8");
  renameSync(tmp, path);
}

function readJson(path: string): unknown {
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw) as unknown;
}

function pendingPath(baseDir: string, profileId: string): string {
  return join(baseDir, `${profileId}.pending.json`);
}

function profilePath(baseDir: string, profileId: string): string {
  return join(baseDir, `${profileId}.json`);
}

function mergeProfile(base: StrategyProfile, partial: Record<string, unknown>): StrategyProfile {
  const merged = { ...base, ...partial } as Record<string, unknown>;
  return validateProfile(merged, base.profileId);
}

export class StrategyStore {
  private readonly versions = new Map<string, number>();

  constructor(private readonly profilesDir: string) {}

  readProfile(profileId: string): StrategyProfile {
    const path = profilePath(this.profilesDir, profileId);
    const raw = readJson(path);
    return validateProfile(raw, profileId);
  }

  reloadProfile(profileId: string): StrategyProfileSnapshot {
    const profile = this.readProfile(profileId);
    const next = (this.versions.get(profileId) ?? 0) + 1;
    this.versions.set(profileId, next);
    return { version: next, profile };
  }

  writeProfile(profileId: string, profile: StrategyProfile): void {
    const validated = validateProfile(profile as unknown, profileId);
    atomicWriteJson(profilePath(this.profilesDir, profileId), validated);
  }

  getPendingSensitive(profileId: string): Record<string, unknown> | null {
    const path = pendingPath(this.profilesDir, profileId);
    try {
      const raw = readJson(path);
      if (!isRecord(raw)) {
        throw new Error("Pending sensitive payload must be a JSON object");
      }
      return raw;
    } catch (e: unknown) {
      const code = e && typeof e === "object" && "code" in e ? (e as NodeJS.ErrnoException).code : undefined;
      if (code === "ENOENT") return null;
      throw e;
    }
  }

  markSensitivePending(profileId: string, partial: Partial<StrategyProfile>): void {
    this.readProfile(profileId);
    const existing = this.getPendingSensitive(profileId);
    const next: Record<string, unknown> = { ...(existing ?? {}), ...(partial as Record<string, unknown>) };
    atomicWriteJson(pendingPath(this.profilesDir, profileId), next);
  }

  discardPendingSensitive(profileId: string): void {
    try {
      unlinkSync(pendingPath(this.profilesDir, profileId));
    } catch (e: unknown) {
      const code = e && typeof e === "object" && "code" in e ? (e as NodeJS.ErrnoException).code : undefined;
      if (code === "ENOENT") return;
      throw e;
    }
  }

  commitPendingSensitive(profileId: string): void {
    const pending = this.getPendingSensitive(profileId);
    if (pending === null) {
      return;
    }
    const base = this.readProfile(profileId);
    const merged = mergeProfile(base, pending);
    this.writeProfile(profileId, merged);
    this.discardPendingSensitive(profileId);
  }
}
