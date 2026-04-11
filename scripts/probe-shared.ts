import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type ProbeCommandRecord = {
  argv: string[];
  /** Present when the subprocess used a non-default cwd. */
  cwd?: string;
  ok: boolean;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  spawnError?: { code: string; message: string };
};

export type ProbeProtocolDetection = {
  name: string;
  source: "heuristic";
  line?: string;
};

export async function runProbeCommand(
  command: string,
  args: string[],
  options: { timeoutMs?: number; cwd?: string } = {},
): Promise<ProbeCommandRecord> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const argv = [command, ...args];

  return new Promise((resolve) => {
    const child = spawn(command, args, {
      shell: false,
      cwd: options.cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      resolve({
        argv,
        ...(options.cwd ? { cwd: options.cwd } : {}),
        ok: false,
        exitCode: null,
        signal: null,
        stdout,
        stderr,
        spawnError: { code: error.code ?? "UNKNOWN", message: error.message },
      });
    });

    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({
        argv,
        ...(options.cwd ? { cwd: options.cwd } : {}),
        ok: code === 0,
        exitCode: code,
        signal,
        stdout,
        stderr,
      });
    });
  });
}

export function trimProbeSummary(summary: string, max = 240): string {
  const oneLine = summary.replace(/\s+/g, " ").trim();
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max)}…`;
}

export function isExecutedDirectly(importMetaUrl: string, argv = process.argv): boolean {
  const here = path.resolve(fileURLToPath(importMetaUrl));
  return argv.some((arg) => {
    try {
      return path.resolve(arg) === here;
    } catch {
      return false;
    }
  });
}
