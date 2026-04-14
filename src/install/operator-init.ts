import { copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import {
  getConfigEnvValue,
  loadRuntimeConfigValues,
  summarizeRuntimeReadiness,
  type RuntimeReadinessSummary,
} from "../config/store.js";
import { computeX402BaselineReady, runInstallChecks, type InstallCheck } from "./checks.js";

export type ReadinessPhase = "blocked" | "partial" | "demo_ready";
export type ConfigStatus = "existing" | "created_from_example" | "missing";

export interface OperatorInitResult {
  readonly cwd: string;
  readonly configPath: string;
  readonly examplePath: string;
  readonly configCreated: boolean;
  readonly configStatus: ConfigStatus;
  readonly values: Readonly<Record<string, string | undefined>>;
  readonly summary: RuntimeReadinessSummary;
  readonly operatorMissing: readonly string[];
  readonly demoMissing: readonly string[];
  readonly requiredMissing: readonly string[];
  readonly optionalMissing: readonly string[];
  readonly x402BaselineReady: boolean;
  readonly partialReadiness: boolean;
  readonly readinessPhase: ReadinessPhase;
  readonly checks: readonly InstallCheck[];
  readonly nextSteps: readonly string[];
}

function deriveReadinessPhase(summary: RuntimeReadinessSummary): ReadinessPhase {
  if (!summary.operatorReady) {
    return "blocked";
  }
  if (summary.demoReady) {
    return "demo_ready";
  }
  return "partial";
}

function buildNextSteps(
  summary: RuntimeReadinessSummary,
  x402BaselineReady: boolean,
  configStatus: ConfigStatus,
): string[] {
  const steps: string[] = [];
  if (configStatus === "missing") {
    steps.push("No local config.env or config.env.example found; create one in this directory and re-run init.");
  }
  if (!summary.operatorReady) {
    steps.push(
      configStatus === "missing"
        ? 'Create a local config.env first, then fill the values listed under "Operator tier — still missing".'
        : 'Fill required keys listed under "Operator tier — still missing" in config.env.',
    );
    steps.push("Re-run: npm run init");
    return steps;
  }
  steps.push("Message your Telegram bot in a private chat to run /claim and bind the owner account.");
  steps.push("After claim, TELEGRAM_ALLOWED_USER_ID is written automatically; keep config.env out of version control.");
  if (x402BaselineReady) {
    steps.push(
      "OmRate access: x402 baseline is ready (OKX/onchainos bootstrap + execution wallet present; OMRATE_API_KEY remains optional).",
    );
  } else if (summary.mode === "live") {
    steps.push(
      "For x402 baseline: configure OKX credentials and an execution wallet address (AGENT_WALLET_ADDRESS or PHALANX_WALLET_ADDRESS).",
    );
  }
  if (summary.operatorReady && !summary.demoReady) {
    steps.push(
      "For demo_ready: add PHALANX_OWNER_EVM_ADDRESS. Base RPC now uses a fixed default unless you need an override; POLICY_OWNER_KEY + WHITELIST_POLICY_ADDRESS remain optional future on-chain governance inputs.",
    );
  }
  return steps;
}

export function runOperatorInit(cwd: string): OperatorInitResult {
  const configPath = join(cwd, "config.env");
  const examplePath = join(cwd, "config.env.example");
  const servicePath = join(cwd, "service.env");
  const serviceExamplePath = join(cwd, "service.env.example");
  let configCreated = false;
  const configExists = existsSync(configPath);
  const exampleExists = existsSync(examplePath);
  const serviceExists = existsSync(servicePath);
  const serviceExampleExists = existsSync(serviceExamplePath);
  let configStatus: ConfigStatus = "existing";
  if (!configExists && exampleExists) {
    copyFileSync(examplePath, configPath);
    configCreated = true;
    configStatus = "created_from_example";
  } else if (!configExists && !exampleExists) {
    configStatus = "missing";
  }
  if (!serviceExists && serviceExampleExists) {
    copyFileSync(serviceExamplePath, servicePath);
  }
  const values = loadRuntimeConfigValues(configPath);
  const summary = summarizeRuntimeReadiness(values);
  const checks = runInstallChecks(values, summary);
  const operatorMissing = [...summary.operatorMissing];
  const demoMissing = summary.demoMissing.filter((key) => !summary.operatorMissing.includes(key));
  const optionalMissing: string[] =
    summary.mode === "live" && getConfigEnvValue(values, "OMRATE_API_KEY") === undefined
      ? ["OMRATE_API_KEY"]
      : [];
  const x402BaselineReady = computeX402BaselineReady(values, summary);
  const partialReadiness = summary.operatorReady && !summary.demoReady;
  const readinessPhase = deriveReadinessPhase(summary);
  const nextSteps = buildNextSteps(summary, x402BaselineReady, configStatus);

  return {
    cwd,
    configPath,
    examplePath,
    configCreated,
    configStatus,
    values,
    summary,
    operatorMissing,
    demoMissing,
    requiredMissing: operatorMissing,
    optionalMissing,
    x402BaselineReady,
    partialReadiness,
    readinessPhase,
    checks,
    nextSteps,
  };
}

export function initExitCode(result: OperatorInitResult): number {
  return result.summary.operatorReady ? 0 : 1;
}
