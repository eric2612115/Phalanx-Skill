import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createSetupSession,
  handleTelegramUpdate,
  resetTelegramSetupStateForTests,
  tryClaimOwner,
} from "../src/telegram/setup.js";

const originalConfigPath = process.env.PHALANX_CONFIG_PATH;

beforeEach(() => {
  const isolatedDir = mkdtempSync(join(tmpdir(), "phalanx-owner-claim-"));
  const isolatedConfigPath = join(isolatedDir, "config.env");
  const isolatedServicePath = join(isolatedDir, "service.env");
  writeFileSync(isolatedConfigPath, "", "utf8");
  writeFileSync(isolatedServicePath, "", "utf8");
  process.env.PHALANX_CONFIG_PATH = isolatedConfigPath;
  resetTelegramSetupStateForTests();
});

afterEach(() => {
  if (originalConfigPath === undefined) {
    delete process.env.PHALANX_CONFIG_PATH;
  } else {
    process.env.PHALANX_CONFIG_PATH = originalConfigPath;
  }
  resetTelegramSetupStateForTests();
});

describe("owner claim boundaries", () => {
  it("rejects group chats during owner claim", async () => {
    const { tryClaimOwner: claim } = await import("../src/telegram/setup.js");
    const result = await claim({ from: { id: 1 }, chat: { type: "group" } });
    expect(result.allowed).toBe(false);
  });

  it("rejects supergroup and channel the same as group", () => {
    expect(tryClaimOwner({ from: { id: 1 }, chat: { type: "supergroup" } }).allowed).toBe(false);
    expect(tryClaimOwner({ from: { id: 1 }, chat: { type: "channel" } }).allowed).toBe(false);
  });

  it("allows first private user when unclaimed", () => {
    const session = createSetupSession();
    expect(tryClaimOwner({ from: { id: 42 }, chat: { type: "private" } }, session).allowed).toBe(true);
  });

  it("rejects private claim when env TELEGRAM user id does not match", () => {
    const session = createSetupSession({ envAllowedUserId: "99" });
    expect(tryClaimOwner({ from: { id: 1 }, chat: { type: "private" } }, session).allowed).toBe(false);
  });

  it("serializes concurrent private claims so only one owner wins", async () => {
    const session = createSetupSession();
    const u1 = handleTelegramUpdate({ from: { id: 1 }, chat: { type: "private" }, text: "a" }, session);
    const u2 = handleTelegramUpdate({ from: { id: 2 }, chat: { type: "private" }, text: "b" }, session);
    await Promise.all([u1, u2]);
    expect(session.ownerUserId).toBeNull();
    expect(session.pendingOwnerUserId === "1" || session.pendingOwnerUserId === "2").toBe(true);
    expect(session.lifecycle).toBe("UNCLAIMED");
  });

  it("only the candidate user can confirm ownership", async () => {
    const session = createSetupSession();
    await handleTelegramUpdate({ from: { id: 1 }, chat: { type: "private" }, text: "claim" }, session);

    const rejected = await handleTelegramUpdate(
      { from: { id: 2 }, chat: { type: "private" }, text: "confirm" },
      session,
    );
    expect(rejected.nextState).toBe("UNCLAIMED");
    expect(session.ownerUserId).toBeNull();

    const accepted = await handleTelegramUpdate(
      { from: { id: 1 }, chat: { type: "private" }, text: "confirm" },
      session,
    );
    expect(accepted.nextState).toBe("SETUP_IN_PROGRESS");
    expect(session.ownerUserId).toBe("1");
  });
});
