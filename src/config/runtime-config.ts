import {
  loadRuntimeConfigValues,
  resolveMemoryStatePath,
  resolveServiceConfigPath,
  type RuntimeConfig,
  buildRuntimeConfig,
} from "./store.js";

export interface SkillBootstrapConfig {
  readonly configPath: string;
  readonly serviceConfigPath: string;
  readonly runtimeStatePath: string;
  readonly values: Readonly<Record<string, string | undefined>>;
  readonly runtimeConfig: RuntimeConfig;
}

/**
 * Kernel-facing config loader for skill-only startup paths.
 * It keeps the existing merged env precedence, but packages the values in a
 * bootstrap contract that does not imply channel ownership.
 */
export function loadSkillBootstrapConfig(
  configPath: string,
  baseEnv: Readonly<Record<string, string | undefined>> = process.env,
): SkillBootstrapConfig {
  const values = loadRuntimeConfigValues(configPath, baseEnv);
  return {
    configPath,
    serviceConfigPath: resolveServiceConfigPath(configPath, baseEnv),
    runtimeStatePath: resolveMemoryStatePath(configPath, values),
    values,
    runtimeConfig: buildRuntimeConfig(values),
  };
}
