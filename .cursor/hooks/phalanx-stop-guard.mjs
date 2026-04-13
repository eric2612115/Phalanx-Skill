#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const HEAVY_FILES = [
  "src/app/host.ts",
  "src/adapters/onchainos.ts",
  "src/adapters/lp-execution.ts",
];

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
  return join(tmpdir(), "phalanx-cursor-hooks", `${key}.baseline.json`);
}

function baselineChangedPaths() {
  try {
    const raw = readFileSync(baselinePath(), "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.changedPaths) ? parsed.changedPaths.filter((value) => typeof value === "string") : [];
  } catch {
    return [];
  }
}

function hasPath(paths, predicate) {
  return paths.some((path) => predicate(path));
}

function countChangedLines(path) {
  const output = runGit(["diff", "--numstat", "--", path]);
  if (!output) return 0;
  const first = output.split("\n")[0]?.trim();
  if (!first) return 0;
  const [added, removed] = first.split(/\s+/);
  const addCount = Number.parseInt(added ?? "0", 10);
  const removeCount = Number.parseInt(removed ?? "0", 10);
  return (Number.isFinite(addCount) ? addCount : 0) + (Number.isFinite(removeCount) ? removeCount : 0);
}

function sameDirNewTsFile(paths, target) {
  const idx = target.lastIndexOf("/");
  const dir = idx >= 0 ? target.slice(0, idx + 1) : "";
  return paths.some((path) => path.startsWith(dir) && path.endsWith(".ts") && path !== target);
}

function hasSupportingExtraction(paths, target) {
  if (sameDirNewTsFile(paths, target)) {
    return true;
  }

  if (target === "src/app/host.ts") {
    return paths.some(
      (path) =>
        path.endsWith(".ts") &&
        path !== target &&
        (path.startsWith("src/app/") || path.startsWith("src/demo/")),
    );
  }

  return false;
}

function main() {
  try {
    process.stdin.resume();
    process.stdin.on("data", () => {});
    process.stdin.on("end", evaluate);
  } catch {
    evaluate();
  }
}

function evaluate() {
  const baseline = new Set(baselineChangedPaths());
  const paths = changedPaths().filter((path) => !baseline.has(path));
  const issues = [];

  if (paths.length === 0) {
    process.stdout.write("{}");
    return;
  }

  const changedTests = hasPath(paths, (path) => path.startsWith("tests/"));
  const changedDocs = hasPath(
    paths,
    (path) =>
      path === "README.md" ||
      path.startsWith("docs/") ||
      path.startsWith(".cursor/rules/"),
  );
  const changedPlan = hasPath(paths, (path) => path.startsWith("docs/superpowers/plans/"));

  if (paths.includes("src/runtime/intents.ts") && !changedTests) {
    issues.push("`src/runtime/intents.ts` changed but no tests changed. Add or update focused action-flow coverage.");
  }

  if ((paths.includes("src/config/store.ts") || paths.includes("src/index.ts")) && !changedDocs) {
    issues.push("Startup/config behavior changed without a matching README, runbook, or rule update.");
  }

  const touchedHost = paths.includes("src/app/host.ts");
  const touchedRuntime = hasPath(paths, (path) => path.startsWith("src/runtime/"));
  const touchedAdapters = hasPath(paths, (path) => path.startsWith("src/adapters/"));
  if (touchedHost && touchedRuntime && touchedAdapters && !changedPlan) {
    issues.push("This change spans host, runtime, and adapters without a touched plan file. Add a plan or narrow the scope.");
  }

  for (const file of HEAVY_FILES) {
    if (!paths.includes(file)) continue;
    if (countChangedLines(file) < 40) continue;
    if (hasSupportingExtraction(paths, file)) continue;
    issues.push(`Large edit in \`${file}\` without a nearby extracted TypeScript module. Split the change or justify the boundary explicitly.`);
  }

  if (issues.length === 0) {
    process.stdout.write("{}");
    return;
  }

  process.stdout.write(
    JSON.stringify({
      followup_message:
        "Phalanx governance stop hook found issues before ending the task:\n- " +
        issues.join("\n- ") +
        "\nAddress them or explicitly justify why the guard should be ignored.",
    }),
  );
}

main();
