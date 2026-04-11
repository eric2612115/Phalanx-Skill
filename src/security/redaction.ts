import type { DetectionSpan } from "./detectors.js";

export const REDACTION_PLACEHOLDER = "[REDACTED]";

/**
 * Replace all detection spans with a fixed placeholder. Spans must refer to
 * indices in `text` (typically from {@link detectionsInString}).
 */
export function redactString(text: string, spans: DetectionSpan[]): string {
  if (spans.length === 0) return text;
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  let out = "";
  let i = 0;
  for (const s of sorted) {
    const start = Math.max(s.start, i);
    if (start > text.length) break;
    const end = Math.min(s.end, text.length);
    if (start < end) {
      out += text.slice(i, start);
      out += REDACTION_PLACEHOLDER;
      i = end;
    }
  }
  out += text.slice(i);
  return out;
}
