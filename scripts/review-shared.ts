/**
 * Shared helpers for Docker-based third-party install reviews:
 * structured result types, log parsing, and Docker stdin-runner with timeout.
 */

import { spawn } from "node:child_process";
import { once } from "node:events";

export const REVIEW_HOME = "/review/home";
export const REVIEW_WORK = "/review/workspace";
export const REVIEW_NPM_CACHE = "/review/npm-cache";

export type ReviewTerminalStatus = "completed" | "timeout" | "docker_error" | "spawn_error";

export interface DockerRunMeta {
  image: string;
  timeoutMs: number;
  startedAtIso: string;
  finishedAtIso: string;
  durationMs: number;
  exitCode: number | null;
  timedOut: boolean;
  signal: NodeJS.Signals | null;
  errorMessage?: string;
}

export interface OnchainosSignals {
  binariesWritten: boolean;
  binaryPaths: string[];
  cacheFilesWritten: boolean;
  cachePaths: string[];
  shellProfileModified: boolean;
  touchedProfiles: string[];
  profileSnippets: string[];
}

export interface UniswapSignals {
  lifecycleScriptsMentioned: boolean;
  lifecycleHints: string[];
  gitHooksAttempted: boolean;
  gitHookHints: string[];
  largeBrowserDownloadStarted: boolean;
  browserDownloadHints: string[];
  engineMismatchWarning: boolean;
  engineHints: string[];
}

export interface StructuredDockerReview<TSignals> {
  review: "onchainos-install" | "uniswap-npm";
  meta: DockerRunMeta;
  stdout: string;
  stderr: string;
  combinedLog: string;
  signals: TSignals;
}

const MAX_LOG_CHARS = 512_000;

export function truncateLog(text: string, max = MAX_LOG_CHARS): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n[truncated ${text.length - max} chars]\n`;
}

/** Parse PROFILE blocks emitted by review shell scripts. */
export function extractProfileBlocks(log: string): { path: string; content: string }[] {
  const out: { path: string; content: string }[] = [];
  const re = /=== PROFILE ([^=\s]+) ===\n([\s\S]*?)\n=== END_PROFILE \1 ===/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(log)) !== null) {
    out.push({ path: m[1], content: m[2] });
  }
  return out;
}

export function parseOnchainosSignals(
  log: string,
  manifestLines: string[],
  profiles: { path: string; content: string }[],
): OnchainosSignals {
  const binaryPaths = manifestLines.filter(
    (p) => p.includes("/.local/bin/") && !p.endsWith("/") && !p.includes("last_check"),
  );
  const cachePaths = manifestLines.filter((p) => p.includes("/.onchainos/"));

  const installerBanner = /#\s*Added by onchainos installer/i;
  const pathExport = /\.local\/bin.*PATH|PATH=.*\.local\/bin/i;

  const touchedProfiles: string[] = [];
  const profileSnippets: string[] = [];
  for (const { path, content } of profiles) {
    if (installerBanner.test(content) || pathExport.test(content)) {
      touchedProfiles.push(path);
      profileSnippets.push(content.trim().slice(-400));
    }
  }

  const combined = `${log}\n${manifestLines.join("\n")}`;
  const binaryFromLog = /Installed onchainos|\.local\/bin\/onchainos|\/\.local\/bin\/onchainos\b/i.test(
    combined,
  );

  return {
    binariesWritten: binaryPaths.length > 0 || binaryFromLog,
    binaryPaths,
    cacheFilesWritten: cachePaths.length > 0,
    cachePaths,
    shellProfileModified: touchedProfiles.length > 0,
    touchedProfiles,
    profileSnippets,
  };
}

const LIFECYCLE_LINE =
  /(preinstall|postinstall|prepare|prepublish|install)\b|lifecycle script|Running (?:\"|')?(?:prepare|postinstall|preinstall)|npm\s+run\s+prepare|node\s+scripts\/prepare/i;
const GIT_HOOK_LINE =
  /\.git\/hooks\b|husky|lefthook|core\.hooksPath|git\s+config.*hooks|npx\s+lefthook/i;
const BROWSER_DL_LINE =
  /playwright|chromium|Downloading\s+(?:Chromium|Firefox|WebKit)|browser\s*download|npx\s+playwright\s+install|@playwright\/test|puppeteer.*download|Chromium\s+\d+\.\d+/i;
const ENGINE_LINE = /EBADENGINE|engine\s+node|unsupported engine|Not compatible with your version of node|required:\s*\{[^}]*node/i;

export function parseUniswapSignals(log: string): UniswapSignals {
  const lines = log.split("\n");
  const lifecycleHints = lines.filter((l) => LIFECYCLE_LINE.test(l)).slice(0, 30);
  const gitHookHints = lines.filter((l) => GIT_HOOK_LINE.test(l)).slice(0, 30);
  const browserDownloadHints = lines.filter((l) => BROWSER_DL_LINE.test(l)).slice(0, 30);
  const engineHints = lines.filter((l) => ENGINE_LINE.test(l)).slice(0, 30);

  return {
    lifecycleScriptsMentioned: lifecycleHints.length > 0,
    lifecycleHints,
    gitHooksAttempted: gitHookHints.length > 0,
    gitHookHints,
    largeBrowserDownloadStarted: browserDownloadHints.length > 0,
    browserDownloadHints,
    engineMismatchWarning: engineHints.length > 0,
    engineHints,
  };
}

export function buildOnchainosInnerScript(): string {
  return `#!/bin/bash
set -u
export HOME="${REVIEW_HOME}"
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
mkdir -p "$HOME" "${REVIEW_WORK}"

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates >/dev/null

echo "=== ONCHAINOS_MANIFEST_START ==="
find "$HOME" -type f 2>/dev/null | sort || true
echo "=== ONCHAINOS_MANIFEST_END ==="

set +e
curl -fsSL --max-time 60 https://raw.githubusercontent.com/okx/onchainos-skills/main/install.sh | sh 2>&1
INSTALL_RC=$?
set -e

echo "=== ONCHAINOS_MANIFEST_START ==="
find "$HOME" -type f 2>/dev/null | sort || true
echo "=== ONCHAINOS_MANIFEST_END ==="

for f in .profile .bashrc .bash_profile .zshrc; do
  if [[ -f "$HOME/$f" ]]; then
    echo "=== PROFILE $f ==="
    cat "$HOME/$f"
    echo "=== END_PROFILE $f ==="
  fi
done

exit $INSTALL_RC
`;
}

export function buildUniswapInnerScript(): string {
  return `#!/bin/bash
set -u
export HOME="${REVIEW_HOME}"
export NPM_CONFIG_CACHE="${REVIEW_NPM_CACHE}"
export GIT_TERMINAL_PROMPT=0
export CI=1
export NPM_CONFIG_AUDIT=false
export NPM_CONFIG_FUND=false
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
mkdir -p "$HOME" "${REVIEW_NPM_CACHE}" "${REVIEW_WORK}"

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq git ca-certificates >/dev/null

cd "${REVIEW_WORK}"
rm -rf uniswap-ai
git clone --depth 1 https://github.com/Uniswap/uniswap-ai.git
cd uniswap-ai

set +e
npm install --foreground-scripts --loglevel=info 2>&1
NPM_RC=$?
set -e
exit $NPM_RC
`;
}

export interface RunDockerStdinScriptOptions {
  image: string;
  timeoutMs: number;
  scriptBody: string;
  /** Extra docker run args after --rm */
  dockerExtraArgs?: string[];
}

export interface DockerStdinRunResult {
  meta: DockerRunMeta;
  stdout: string;
  stderr: string;
}

export async function runDockerStdinScript(
  opts: RunDockerStdinScriptOptions,
): Promise<DockerStdinRunResult> {
  const startedAtIso = new Date().toISOString();
  const started = Date.now();

  const args = [
    "run",
    "--rm",
    "-i",
    "-e",
    `HOME=${REVIEW_HOME}`,
    "-e",
    `NPM_CONFIG_CACHE=${REVIEW_NPM_CACHE}`,
    "-w",
    REVIEW_WORK,
    ...(opts.dockerExtraArgs ?? []),
    opts.image,
    "bash",
    "-s",
  ];

  const child = spawn("docker", args, {
    stdio: ["pipe", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  let timedOut = false;
  let exitCode: number | null = null;
  let signal: NodeJS.Signals | null = null;
  let errorMessage: string | undefined;

  child.on("error", (err) => {
    errorMessage = err.message;
  });

  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, opts.timeoutMs);

  child.stdout?.on("data", (c: Buffer) => {
    stdout += c.toString("utf8");
  });
  child.stderr?.on("data", (c: Buffer) => {
    stderr += c.toString("utf8");
  });

  child.stdin?.write(opts.scriptBody);
  child.stdin?.end();

  try {
    const [code, sig] = (await once(child, "close")) as [number | null, NodeJS.Signals | null];
    exitCode = code;
    signal = sig;
  } catch (e) {
    errorMessage ??= e instanceof Error ? e.message : String(e);
  } finally {
    clearTimeout(timer);
  }

  const finishedAtIso = new Date().toISOString();
  const durationMs = Date.now() - started;

  const meta: DockerRunMeta = {
    image: opts.image,
    timeoutMs: opts.timeoutMs,
    startedAtIso,
    finishedAtIso,
    durationMs,
    exitCode,
    timedOut,
    signal,
    errorMessage,
  };

  return { meta, stdout, stderr };
}

export function finalizeOnchainosReview(
  stdout: string,
  stderr: string,
  meta: DockerRunMeta,
): StructuredDockerReview<OnchainosSignals> {
  const combinedLog = `${stdout}\n${stderr}`;
  const manifests = extractAllMarkedSections(combinedLog, "=== ONCHAINOS_MANIFEST_START ===", "=== ONCHAINOS_MANIFEST_END ===");
  const lastManifest = manifests.length ? manifests[manifests.length - 1] : [];
  const profiles = extractProfileBlocks(combinedLog);
  const signals = parseOnchainosSignals(combinedLog, lastManifest, profiles);

  return {
    review: "onchainos-install",
    meta,
    stdout: truncateLog(stdout),
    stderr: truncateLog(stderr),
    combinedLog: truncateLog(combinedLog),
    signals,
  };
}

export function finalizeUniswapReview(
  stdout: string,
  stderr: string,
  meta: DockerRunMeta,
): StructuredDockerReview<UniswapSignals> {
  const combinedLog = `${stdout}\n${stderr}`;
  const signals = parseUniswapSignals(combinedLog);
  return {
    review: "uniswap-npm",
    meta,
    stdout: truncateLog(stdout),
    stderr: truncateLog(stderr),
    combinedLog: truncateLog(combinedLog),
    signals,
  };
}

/** All marked sections in order (for before/after manifests). */
export function extractAllMarkedSections(log: string, start: string, end: string): string[][] {
  const sections: string[][] = [];
  let from = 0;
  while (from < log.length) {
    const i = log.indexOf(start, from);
    if (i === -1) break;
    const j = log.indexOf(end, i + start.length);
    if (j === -1) break;
    const body = log.slice(i + start.length, j).trim();
    sections.push(
      body
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean),
    );
    from = j + end.length;
  }
  return sections;
}

export function printJson(result: unknown): void {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

export function parseTimeoutMs(envValue: string | undefined, fallback: number): number {
  if (!envValue) return fallback;
  const n = Number(envValue);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function deriveReviewStatus(meta: DockerRunMeta): ReviewTerminalStatus {
  if (meta.timedOut) return "timeout";
  if (meta.errorMessage) {
    if (/ENOENT|spawn\s+EN|docker.*not found/i.test(meta.errorMessage)) return "spawn_error";
    return "docker_error";
  }
  return "completed";
}
