import { createPhalanxHost, type CreatePhalanxHostOptions, type PhalanxHost } from "./host.js";

export interface SkillHost {
  readonly runtime: PhalanxHost;
  readonly telegram: undefined;
  readonly guardian: undefined;
}

export function createSkillHost(options: CreatePhalanxHostOptions = {}): SkillHost {
  const runtime = createPhalanxHost({
    ...options,
    guardianEnabled: false,
  });

  return {
    runtime,
    telegram: undefined,
    guardian: undefined,
  };
}
