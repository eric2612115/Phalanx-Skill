#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

function runGit(args) {
  try {
    return execFileSync("git", args, {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function changedPaths() {
  const output = runGit(["status", "--porcelain", "--untracked-files=all"]);
  if (!output) return [];
  return output
    .split("\n")
    .map((line) => line.slice(3).trim())
    .filter(Boolean)
    .map((line) => {
      const renameParts = line.split(" -> ");
      return renameParts[renameParts.length - 1];
    });
}

function baselinePath() {
  const key = createHash("sha1").update(process.cwd()).digest("hex");
  const dir = join(tmpdir(), "phalanx-cursor-hooks");
  mkdirSync(dir, { recursive: true });
  return join(dir, `${key}.baseline.json`);
}

const data = {
  cwd: process.cwd(),
  changedPaths: changedPaths(),
  capturedAt: new Date().toISOString(),
};

writeFileSync(baselinePath(), `${JSON.stringify(data, null, 2)}\n`, "utf8");
process.stdout.write("{}");
