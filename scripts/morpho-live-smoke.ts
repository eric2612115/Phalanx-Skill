import { resolve } from "node:path";

import { listOnchainosCapabilities, readOnchainosTxDetail } from "../src/adapters/onchainos.js";
import { loadRuntimeConfigValues } from "../src/config/store.js";

type MorphoSmokeTx = {
  readonly kind: "approve" | "deposit" | "withdraw";
  readonly txHash: string;
};

type MorphoSmokeOutput = {
  configPath: string;
  senderAddress: string;
  capabilities: unknown;
  txs: Array<{
    kind: MorphoSmokeTx["kind"];
    txHash: string;
    result: unknown;
  }>;
};

const DEFAULT_MORPHO_SENDER = "0x53cfae9af39fa1eed00d4402ed6ceabb112a3724";

const DEFAULT_MORPHO_TXS: readonly MorphoSmokeTx[] = [
  {
    kind: "approve",
    txHash: "0x86626434b285a1f5ff88134aa3d690301297cc26e2971a1a880aff4c456c4549",
  },
  {
    kind: "deposit",
    txHash: "0xe75c04a06bbe98988c5b5ca3469c9c9385853889c3473ffa3a8a44eb09dcca62",
  },
  {
    kind: "withdraw",
    txHash: "0xefb43f8b3bd8390143128071394ed9df6b9d02738df0c1001886bdfff550c332",
  },
] as const;

async function main(): Promise<void> {
  const configPath = process.env.PHALANX_CONFIG_PATH?.trim() || resolve(process.cwd(), "config.env");
  const runtimeEnv = loadRuntimeConfigValues(configPath, process.env);
  const senderAddress = (runtimeEnv.PHALANX_MORPHO_SMOKE_ADDRESS ?? DEFAULT_MORPHO_SENDER).trim();

  const output: MorphoSmokeOutput = {
    configPath,
    senderAddress,
    capabilities: await listOnchainosCapabilities("ethereum"),
    txs: [],
  };

  for (const tx of DEFAULT_MORPHO_TXS) {
    const result = await readOnchainosTxDetail({
      address: senderAddress,
      chain: "1",
      txHash: tx.txHash,
      env: runtimeEnv,
    });
    output.txs.push({
      kind: tx.kind,
      txHash: tx.txHash,
      result,
    });
  }

  console.log(JSON.stringify(output, null, 2));
}

await main();
