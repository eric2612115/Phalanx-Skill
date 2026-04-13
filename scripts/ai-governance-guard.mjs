#!/usr/bin/env node

import { execFileSync } from "node:child_process";

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

function parseArgs(argv) {
  const args = { json: false, diffBase: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--json") {
      args.json = true;
      continue;
    }
    if (value === "--diff-base") {
      args.diffBase = argv[index + 1];
      index += 1;
    }
  }
  return args;
}

function changedPaths(diffBase) {
  const output = diffBase
    ? runGit(["diff", "--name-only", `${diffBase}...HEAD`])
    : runGit(["status", "--porcelain", "--untracked-files=all"]);
  if (!output) return [];
  if (diffBase) {
    return output
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }
  return output
    .split("\n")
    .map((line) => line.slice(3).trim())
    .filter(Boolean)
    .map((line) => {
      const renameParts = line.split(" -> ");
      return renameParts[renameParts.length - 1];
    });
}

function hasPath(paths, predicate) {
  return paths.some((path) => predicate(path));
}

function countChangedLines(path, diffBase) {
  const args = diffBase
    ? ["diff", "--numstat", `${diffBase}...HEAD`, "--", path]
    : ["diff", "--numstat", "HEAD", "--", path];
  const output = runGit(args);
  if (!output) return 0;
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .reduce((sum, line) => {
      const [added, removed] = line.split(/\s+/);
      const addCount = Number.parseInt(added ?? "0", 10);
      const removeCount = Number.parseInt(removed ?? "0", 10);
      return sum + (Number.isFinite(addCount) ? addCount : 0) + (Number.isFinite(removeCount) ? removeCount : 0);
    }, 0);
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

function evaluate(paths, diffBase) {
  const issues = [];

  if (paths.length === 0) {
    return issues;
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
    issues.push({
      code: "INTENTS_WITHOUT_TESTS",
      message: "`src/runtime/intents.ts` changed but no tests changed. Add or update focused action-flow coverage.",
    });
  }

  if ((paths.includes("src/config/store.ts") || paths.includes("src/index.ts")) && !changedDocs) {
    issues.push({
      code: "CONFIG_WITHOUT_DOCS",
      message: "Startup/config behavior changed without a matching README, runbook, or rule update.",
    });
  }

  const touchedHost = paths.includes("src/app/host.ts");
  const touchedRuntime = hasPath(paths, (path) => path.startsWith("src/runtime/"));
  const touchedAdapters = hasPath(paths, (path) => path.startsWith("src/adapters/"));
  if (touchedHost && touchedRuntime && touchedAdapters && !changedPlan) {
    issues.push({
      code: "CROSS_LAYER_WITHOUT_PLAN",
      message: "This change spans host, runtime, and adapters without a touched plan file. Add a plan or narrow the scope.",
    });
  }

  for (const file of HEAVY_FILES) {
    if (!paths.includes(file)) continue;
    if (countChangedLines(file, diffBase) < 40) continue;
    if (hasSupportingExtraction(paths, file)) continue;
    issues.push({
      code: "LARGE_EDIT_WITHOUT_EXTRACTION",
      message: `Large edit in \`${file}\` without a nearby extracted TypeScript module. Split the change or justify the boundary explicitly.`,
    });
  }

  return issues;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const paths = changedPaths(args.diffBase);
  const issues = evaluate(paths, args.diffBase);
  const payload = {
    ok: issues.length === 0,
    mode: args.diffBase ? "diff-base" : "worktree",
    diffBase: args.diffBase ?? null,
    changedPaths: paths,
    issues,
  };

  if (args.json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else if (payload.ok) {
    process.stdout.write("Phalanx AI governance guard: OK\n");
  } else {
    process.stdout.write("Phalanx AI governance guard found issues:\n");
    for (const issue of issues) {
      process.stdout.write(`- [${issue.code}] ${issue.message}\n`);
    }
  }

  process.exitCode = payload.ok ? 0 : 1;
}

main();
