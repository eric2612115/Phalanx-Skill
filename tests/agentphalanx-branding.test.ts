import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

describe("AgentPhalanx outward-facing branding", () => {
  it("documents the product name AgentPhalanx in README while keeping PHALANX_* env compatibility documented", () => {
    const readme = read("README.md");
    expect(readme).toMatch(/AgentPhalanx/);
    expect(readme).toMatch(/Phalanx-Skill/);
    expect(readme).toMatch(/secure DeFi action kernel/i);
    expect(readme).toMatch(/PHALANX_/);
  });

  it("keeps npm package technical name while describing AgentPhalanx in package.json", () => {
    const raw = read("package.json");
    const pkg = JSON.parse(raw) as { name?: string; description?: string };
    expect(pkg.name).toBe("phalanx-skill");
    expect(pkg.description ?? "").toMatch(/AgentPhalanx/);
  });

  it("uses AgentPhalanx in agent entry docs", () => {
    expect(read("AGENTS.md")).toMatch(/AgentPhalanx/);
    expect(read("CLAUDE.md")).toMatch(/AgentPhalanx/);
  });

  it("uses AgentPhalanx in operator runbooks and hackathon checklist", () => {
    expect(read("docs/live-demo-runbook.md")).toMatch(/AgentPhalanx/);
    expect(read("docs/hackathon/xlayer-demo-checklist.md")).toMatch(/AgentPhalanx/);
  });

  it("uses AgentPhalanx in linked outward-facing execution docs", () => {
    expect(read("docs/uniswap-v3-direct-execution.md")).toMatch(/AgentPhalanx/);
  });

  it("uses AgentPhalanx in remaining operator-facing runtime and install copy", () => {
    expect(read("src/telegram/operator-formatters.ts")).toMatch(/AgentPhalanx/);
    expect(read("src/telegram/fallback.ts")).toMatch(/AgentPhalanx/);
    expect(read("src/install/formatters.ts")).toMatch(/AgentPhalanx/);
    expect(read("src/install/operator-init.ts")).toMatch(/AgentPhalanx/);
  });

  it("uses shared root docs as the AI-editor entry surface", () => {
    expect(read("README.md")).toMatch(/AGENTS\.md|CLAUDE\.md|AI editor entry/);
    expect(read("AGENTS.md")).toMatch(/AgentPhalanx/);
    expect(read("CLAUDE.md")).toMatch(/AgentPhalanx/);
    expect(read("docs/agent-pack/DECISIONS.md")).toMatch(/shared root docs|README\.md|AGENTS\.md|CLAUDE\.md/);
  });

  it("documents the kernel split and migration map in active repo docs", () => {
    expect(read("README.md")).toMatch(/Telegram ownership.*DePhalanx|mission loops.*DePhalanx/is);
    expect(read("AGENTS.md")).toMatch(/kernel-migration-matrix\.md/);
    expect(read("CLAUDE.md")).toMatch(/kernel-migration-matrix\.md/);
    expect(read("docs/kernel-migration-matrix.md")).toMatch(/move_to_dephalanx/);
  });

  it("keeps MCP example wiring on PHALANX_* env keys for compatibility", () => {
    const mcp = read(".mcp.json.example");
    expect(mcp).toContain("PHALANX_ENABLE_MCP_STDIO");
    expect(mcp).toContain("PHALANX_CONFIG_PATH");
  });

  it("labels the runtime entrypoint documentation with AgentPhalanx", () => {
    expect(read("src/index.ts")).toMatch(/AgentPhalanx/);
  });

  it("keeps README status consistent about the live-proven withdraw roundtrip", () => {
    const readme = read("README.md");
    expect(readme).toMatch(/withdraw.*live-proven/i);
    expect(readme).not.toMatch(/withdraw.*additive win/i);
    expect(readme).not.toMatch(/deposit.*blocker/i);
  });

  it("keeps CLAUDE guidance consistent with the live-proven roundtrip status", () => {
    const claude = read("CLAUDE.md");
    expect(claude).toMatch(/roundtrip.*live-proven|withdraw.*live-proven/i);
    expect(claude).not.toMatch(/withdraw.*in-progress enhancement/i);
  });

  it("documents current verification reality without overstating live smoke success", () => {
    const combined = `${read("README.md")}\n${read("docs/live-demo-runbook.md")}`;
    expect(combined).toMatch(/npm run test/);
    expect(combined).toMatch(/npm run build/);
    expect(combined).toMatch(/npm run guard:ai/);
    expect(combined).toMatch(/PHALANX_AGENTIC_REBALANCE_DEMO_ENABLED/);
    expect(combined).toMatch(/chat not found/i);
    expect(combined).toMatch(/409 Conflict|getUpdates/i);
  });
});
