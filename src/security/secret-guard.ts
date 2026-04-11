import {
  detectionsInString,
  isSecretLikeFieldName,
  valueLooksSensitive,
} from "./detectors.js";
import { REDACTION_PLACEHOLDER, redactString } from "./redaction.js";

export type SecretGuardMode =
  | "ALLOW"
  | "REDACT_AND_CONTINUE"
  | "BLOCK_AND_REWRITE";

const MAX_SAFE_ERR = 500;
const MAX_REDACT_DEPTH = 12;
const MAX_ARRAY_ITEMS = 256;
const CIRCULAR_REF_PLACEHOLDER = "[Circular]";
const BLOCKED_SAFE_SUMMARY =
  "Output blocked: sensitive content was detected and the raw response was withheld.";

export interface FilterOutputResult {
  output: unknown;
  blocked: boolean;
  redactionCount: number;
  /** Present when the payload was blocked and replaced by a safe summary. */
  safeSummary?: string;
}

function deepRedact(value: unknown): { value: unknown; count: number } {
  let count = 0;
  const ancestors = new WeakSet<object>();

  function walk(v: unknown, d: number): unknown {
    if (d > MAX_REDACT_DEPTH) {
      return v;
    }
    if (v === null || typeof v === "boolean" || typeof v === "number") {
      return v;
    }
    if (typeof v === "string") {
      const spans = detectionsInString(v);
      if (spans.length === 0) return v;
      count += spans.length;
      return redactString(v, spans);
    }
    if (Array.isArray(v)) {
      if (ancestors.has(v)) {
        return CIRCULAR_REF_PLACEHOLDER;
      }
      ancestors.add(v);
      const cap = Math.min(v.length, MAX_ARRAY_ITEMS);
      const next: unknown[] = [];
      for (let i = 0; i < cap; i++) {
        next.push(walk(v[i], d + 1));
      }
      ancestors.delete(v);
      return next;
    }
    if (typeof v === "object") {
      const o = v as Record<string, unknown>;
      if (ancestors.has(o)) {
        return CIRCULAR_REF_PLACEHOLDER;
      }
      ancestors.add(o);
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(o)) {
        if (isSecretLikeFieldName(k)) {
          count += 1;
          out[k] = REDACTION_PLACEHOLDER;
        } else {
          out[k] = walk(val, d + 1);
        }
      }
      ancestors.delete(o);
      return out;
    }
    return v;
  }

  return { value: walk(value, 0), count };
}

const BLOCKED_OUTPUT = Object.freeze({
  blocked: true,
  reason: "sensitive_content",
});

export class SecretGuard {
  constructor(private readonly mode: SecretGuardMode) {}

  filterOutput(payload: unknown): FilterOutputResult {
    if (this.mode === "ALLOW") {
      return { output: payload, blocked: false, redactionCount: 0 };
    }

    if (this.mode === "BLOCK_AND_REWRITE") {
      if (valueLooksSensitive(payload)) {
        return {
          output: { ...BLOCKED_OUTPUT },
          blocked: true,
          redactionCount: 0,
          safeSummary: BLOCKED_SAFE_SUMMARY,
        };
      }
      return { output: payload, blocked: false, redactionCount: 0 };
    }

    const { value, count } = deepRedact(payload);
    return { output: value, blocked: false, redactionCount: count };
  }

  safeErrorMessage(err: unknown): string {
    if (err instanceof Error) {
      const raw = err.message && err.message.length > 0 ? err.message : "Error";
      const spans = detectionsInString(raw);
      let msg = redactString(raw, spans);
      if (msg.length > MAX_SAFE_ERR) {
        msg = msg.slice(0, MAX_SAFE_ERR);
      }
      return msg.length > 0 ? msg : "An error occurred";
    }
    return "An error occurred";
  }
}
