import { describe, expect, it } from "vitest";
import {
  detectionsInString,
  detectionsInValue,
  isSecretLikeFieldName,
} from "../src/security/detectors";
import { redactString } from "../src/security/redaction";
import { SecretGuard } from "../src/security/secret-guard";

describe("isSecretLikeFieldName", () => {
  it("matches spec examples (case-insensitive)", () => {
    expect(isSecretLikeFieldName("API_KEY")).toBe(true);
    expect(isSecretLikeFieldName("api_key")).toBe(true);
    expect(isSecretLikeFieldName("SECRET")).toBe(true);
    expect(isSecretLikeFieldName("PASSPHRASE")).toBe(true);
    expect(isSecretLikeFieldName("PRIVATE_KEY")).toBe(true);
    expect(isSecretLikeFieldName("OTP")).toBe(true);
    expect(isSecretLikeFieldName("AUTHORIZATION")).toBe(true);
    expect(isSecretLikeFieldName("OKX_AGENTIC_WALLET_LOGIN_EMAIL")).toBe(true);
  });

  it("returns false for benign keys", () => {
    expect(isSecretLikeFieldName("name")).toBe(false);
    expect(isSecretLikeFieldName("balance")).toBe(false);
    expect(isSecretLikeFieldName("timestamp")).toBe(false);
  });
});

describe("detectionsInString", () => {
  it("flags KEY=value env-style lines", () => {
    const d = detectionsInString("ok\nOMRATE_API_KEY=sk_live_abc123\nend");
    expect(d.some((x) => x.kind === "env_assignment")).toBe(true);
  });

  it("flags login-email style env assignments as sensitive outbound text", () => {
    const d = detectionsInString("OKX_AGENTIC_WALLET_LOGIN_EMAIL=operator@example.com");
    expect(d.some((x) => x.kind === "env_assignment")).toBe(true);
  });

  it("flags raw email addresses in free text for outbound redaction", () => {
    const d = detectionsInString("contact operator@example.com before retrying");
    expect(d.some((x) => x.kind === "email_address")).toBe(true);
  });

  it("does not flag obvious non-secret env keys by substring alone", () => {
    const d = detectionsInString("MONKEY=banana\nCAPKEY=baseball");
    expect(d.some((x) => x.kind === "env_assignment")).toBe(false);
  });

  it("flags 64-hex private-key-like sequences", () => {
    const hex =
      "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
    const d = detectionsInString(`prefix ${hex} suffix`);
    expect(d.some((x) => x.kind === "hex_secret")).toBe(true);
  });

  it("flags long high-entropy alphanumeric tokens", () => {
    const token = "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"; // 36 mixed alnum
    const d = detectionsInString(`token=${token}`);
    expect(d.some((x) => x.kind === "high_entropy_token")).toBe(true);
  });
});

describe("detectionsInValue", () => {
  it("flags values under secret-like keys", () => {
    const d = detectionsInValue({ nested: { API_KEY: "x" } });
    expect(d.some((x) => x.kind === "secret_field")).toBe(true);
  });

  it("treats login-email fields as sensitive structured output", () => {
    const d = detectionsInValue({ OKX_AGENTIC_WALLET_LOGIN_EMAIL: "operator@example.com" });
    expect(d.some((x) => x.kind === "secret_field")).toBe(true);
  });

  it("handles circular references without throwing", () => {
    const value: Record<string, unknown> = { safe: "ok" };
    value.self = value;
    expect(() => detectionsInValue(value)).not.toThrow();
  });
});

describe("redactString", () => {
  it("replaces detected spans with placeholder", () => {
    const hex =
      "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
    const raw = `k=${hex}`;
    const d = detectionsInString(raw);
    const out = redactString(raw, d);
    expect(out).not.toContain(hex);
    expect(out).toContain("[REDACTED]");
  });
});

describe("SecretGuard", () => {
  it("ALLOW returns payload unchanged", () => {
    const g = new SecretGuard("ALLOW");
    const payload = { API_KEY: "should_stay_in_allow_mode" };
    const r = g.filterOutput(payload);
    expect(r.blocked).toBe(false);
    expect(r.output).toEqual(payload);
    expect(r.redactionCount).toBe(0);
  });

  it("REDACT_AND_CONTINUE removes secrets from nested structures", () => {
    const g = new SecretGuard("REDACT_AND_CONTINUE");
    const payload = {
      user: "alice",
      credentials: { API_KEY: "sk-secret", password: "x" },
      note: "SECRET_TOKEN=abc123def456ghi789jkl012mno345pq",
    };
    const r = g.filterOutput(payload);
    expect(r.blocked).toBe(false);
    const out = r.output as Record<string, unknown>;
    expect(out.user).toBe("alice");
    expect((out.credentials as Record<string, string>).API_KEY).toBe("[REDACTED]");
    expect(typeof out.note).toBe("string");
    expect((out.note as string).includes("SECRET_TOKEN=")).toBe(false);
    expect(r.redactionCount).toBeGreaterThan(0);
  });

  it("BLOCK_AND_REWRITE replaces output with safe summary when sensitive", () => {
    const g = new SecretGuard("BLOCK_AND_REWRITE");
    const r = g.filterOutput({ PRIVATE_KEY: "0x" + "a".repeat(64) });
    expect(r.blocked).toBe(true);
    expect(r.output).not.toEqual({ PRIVATE_KEY: expect.anything() });
    expect(r.safeSummary).toBe(
      "Output blocked: sensitive content was detected and the raw response was withheld.",
    );
    expect(JSON.stringify(r.output)).not.toContain("aaaa");
  });

  it("BLOCK_AND_REWRITE allows benign payloads", () => {
    const g = new SecretGuard("BLOCK_AND_REWRITE");
    const payload = { status: "ok", count: 3 };
    const r = g.filterOutput(payload);
    expect(r.blocked).toBe(false);
    expect(r.output).toEqual(payload);
  });

  it("safeErrorMessage avoids echoing secret-like content", () => {
    const g = new SecretGuard("REDACT_AND_CONTINUE");
    const msg = g.safeErrorMessage(
      new Error("connect failed: AUTHORIZATION=Bearer eyJhbGciOiJIUzI1NiJ9"),
    );
    expect(msg).not.toContain("eyJ");
    expect(msg).not.toContain("Bearer ");
    expect(msg.length).toBeLessThan(500);
  });

  it("safeErrorMessage returns short summary for non-Error throws", () => {
    const g = new SecretGuard("BLOCK_AND_REWRITE");
    expect(g.safeErrorMessage("internal")).toMatch(/error|failed/i);
  });

  it("REDACT_AND_CONTINUE handles circular references without throwing", () => {
    const g = new SecretGuard("REDACT_AND_CONTINUE");
    const payload: Record<string, unknown> = { safe: "ok", API_KEY: "secret" };
    payload.self = payload;
    const r = g.filterOutput(payload);
    expect(r.blocked).toBe(false);
    expect((r.output as Record<string, unknown>).self).toBe("[Circular]");
  });
});
