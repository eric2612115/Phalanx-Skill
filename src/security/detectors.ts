/**
 * P0 secret-shaped content detection for outbound filtering.
 * Best-effort heuristics; bounded work (depth, keys, string prefix).
 */

export type DetectionKind =
  | "secret_field"
  | "env_assignment"
  | "hex_secret"
  | "high_entropy_token"
  | "base64_blob"
  | "bearer_token"
  | "email_address";

export interface DetectionSpan {
  kind: DetectionKind;
  /** Inclusive start index in source string */
  start: number;
  /** Exclusive end index */
  end: number;
}

const MAX_DEPTH = 12;
const MAX_KEYS_PER_OBJECT = 512;
const MAX_STRING_SCAN = 96_000;

/** Field names that should never echo raw values (spec + common variants). */
const SECRET_NAME_RE =
  /^(?:.*_)?(?:API[_-]?KEY|SECRET|PASSPHRASE|PASSWORD|PRIVATE[_-]?KEY|OTP|AUTHORIZATION|ACCESS[_-]?TOKEN|AUTH[_-]?TOKEN|BEARER|MNEMONIC|SEED|REFRESH[_-]?TOKEN|LOGIN[_-]?EMAIL)(?:_.*)?$/i;

const SECRET_ENV_TOKENS = new Set([
  "AUTH",
  "AUTHORIZATION",
  "BEARER",
  "MNEMONIC",
  "OTP",
  "PASS",
  "PASSWORD",
  "PASSPHRASE",
  "SECRET",
  "SEED",
  "TOKEN",
]);

const SECRET_ENV_TOKEN_PAIRS = new Set([
  "ACCESS_TOKEN",
  "API_KEY",
  "AUTH_TOKEN",
  "LOGIN_EMAIL",
  "PRIVATE_KEY",
  "REFRESH_TOKEN",
]);

export function isSecretLikeFieldName(name: string): boolean {
  return SECRET_NAME_RE.test(name.trim());
}

function isSecretLikeEnvAssignmentKey(name: string): boolean {
  if (isSecretLikeFieldName(name)) {
    return true;
  }

  const tokens = name
    .trim()
    .toUpperCase()
    .split("_")
    .filter((token) => token.length > 0);

  if (tokens.some((token) => SECRET_ENV_TOKENS.has(token))) {
    return true;
  }

  for (let i = 0; i < tokens.length - 1; i++) {
    if (SECRET_ENV_TOKEN_PAIRS.has(`${tokens[i]}_${tokens[i + 1]}`)) {
      return true;
    }
  }

  return false;
}

function shannonEntropy(s: string): number {
  const counts = new Map<string, number>();
  for (const ch of s) {
    counts.set(ch, (counts.get(ch) ?? 0) + 1);
  }
  let h = 0;
  const n = s.length;
  for (const c of counts.values()) {
    const p = c / n;
    h -= p * Math.log2(p);
  }
  return h;
}

/** Env-style `KEY=value` assignments (uppercase-ish keys). */
function findEnvAssignments(text: string, out: DetectionSpan[]): void {
  const re = /(^|[\s"'{[,])([A-Z][A-Z0-9_]{2,})\s*=\s*(\S+)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const key = m[2]!;
    const valueStart = m.index + m[0].length - m[3]!.length;
    const valueEnd = valueStart + m[3]!.length;
    const assignStart = m.index + (m[1]?.length ?? 0);
    if (isSecretLikeEnvAssignmentKey(key)) {
      out.push({ kind: "env_assignment", start: assignStart, end: valueEnd });
    }
  }
}

/** 32-byte hex (private key material) and similar long fixed hex runs. */
function findHexSecrets(text: string, out: DetectionSpan[]): void {
  const re = /\b(?:0x)?[0-9a-fA-F]{64}\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({ kind: "hex_secret", start: m.index, end: m.index + m[0].length });
  }
}

function findBearerTokens(text: string, out: DetectionSpan[]): void {
  const re = /Bearer\s+([A-Za-z0-9._\-~+/=]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const full = m[0]!;
    out.push({ kind: "bearer_token", start: m.index, end: m.index + full.length });
  }
}

/** Long compact base64-like runs (payment / auth blobs). */
function findBase64Blobs(text: string, out: DetectionSpan[]): void {
  const re = /[A-Za-z0-9+/]{48,}={0,2}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const chunk = m[0]!;
    if (chunk.length % 4 === 0 || chunk.endsWith("=") || chunk.endsWith("==")) {
      out.push({ kind: "base64_blob", start: m.index, end: m.index + chunk.length });
    }
  }
}

function findHighEntropyTokens(text: string, out: DetectionSpan[]): void {
  const re = /[A-Za-z0-9+/=_-]{24,}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const chunk = m[0]!;
    if (chunk.length < 24) continue;
    if (!/^[A-Za-z0-9+/=_-]+$/.test(chunk)) continue;
    if (shannonEntropy(chunk) < 4.2) continue;
    out.push({
      kind: "high_entropy_token",
      start: m.index,
      end: m.index + chunk.length,
    });
  }
}

function findEmailAddresses(text: string, out: DetectionSpan[]): void {
  const re = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({ kind: "email_address", start: m.index, end: m.index + m[0]!.length });
  }
}

function mergeOverlapping(spans: DetectionSpan[]): DetectionSpan[] {
  if (spans.length === 0) return [];
  const sorted = [...spans].sort((a, b) => a.start - b.start || b.end - a.end);
  const merged: DetectionSpan[] = [];
  let cur = sorted[0]!;
  for (let i = 1; i < sorted.length; i++) {
    const s = sorted[i]!;
    if (s.start < cur.end) {
      cur = { kind: cur.kind, start: cur.start, end: Math.max(cur.end, s.end) };
    } else {
      merged.push(cur);
      cur = s;
    }
  }
  merged.push(cur);
  return merged;
}

/**
 * Scan a string for inline sensitive spans (not object keys).
 */
export function detectionsInString(text: string): DetectionSpan[] {
  const slice = text.length > MAX_STRING_SCAN ? text.slice(0, MAX_STRING_SCAN) : text;
  const raw: DetectionSpan[] = [];
  findEnvAssignments(slice, raw);
  findHexSecrets(slice, raw);
  findBearerTokens(slice, raw);
  findBase64Blobs(slice, raw);
  findHighEntropyTokens(slice, raw);
  findEmailAddresses(slice, raw);
  return mergeOverlapping(raw);
}

export interface ValueDetection {
  kind: DetectionKind;
  path: string;
}

/**
 * Walk JSON-like values; record secret field paths and embedded string issues.
 */
export function detectionsInValue(
  value: unknown,
  path = "$",
  depth = 0,
  keyCount = { n: 0 },
  ancestors = new WeakSet<object>(),
): ValueDetection[] {
  const out: ValueDetection[] = [];
  if (depth > MAX_DEPTH || keyCount.n > MAX_KEYS_PER_OBJECT) {
    return out;
  }

  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return out;
  }

  if (typeof value === "string") {
    const spans = detectionsInString(value);
    if (spans.length > 0) {
      out.push({ kind: spans[0]!.kind, path });
    }
    return out;
  }

  if (Array.isArray(value)) {
    if (ancestors.has(value)) {
      return out;
    }
    ancestors.add(value);
    const max = Math.min(value.length, 256);
    for (let i = 0; i < max; i++) {
      keyCount.n++;
      out.push(
        ...detectionsInValue(value[i], `${path}[${i}]`, depth + 1, keyCount, ancestors),
      );
    }
    ancestors.delete(value);
    return out;
  }

  if (typeof value === "object") {
    const ref = value as Record<string, unknown>;
    if (ancestors.has(ref)) {
      return out;
    }
    ancestors.add(ref);
    const entries = Object.entries(value as Record<string, unknown>);
    for (const [k, v] of entries) {
      keyCount.n++;
      if (keyCount.n > MAX_KEYS_PER_OBJECT) break;
      const p = `${path}.${k}`;
      if (isSecretLikeFieldName(k)) {
        out.push({ kind: "secret_field", path: p });
        continue;
      }
      if (typeof v === "string") {
        const spans = detectionsInString(v);
        if (spans.length > 0) {
          out.push({ kind: spans[0]!.kind, path: p });
        }
      } else {
        out.push(...detectionsInValue(v, p, depth + 1, keyCount, ancestors));
      }
    }
    ancestors.delete(ref);
  }

  return out;
}

export function valueLooksSensitive(value: unknown): boolean {
  return detectionsInValue(value).length > 0;
}
