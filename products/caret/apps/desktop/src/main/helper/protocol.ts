export const MAX_LINE_BYTES = 65_536;
export const MAX_TEXT_BYTES = 32_768;
export const MAX_PENDING_REQUESTS = 32;

export interface Target {
  foreground: string;
  focus: string;
}
export type InsertOutcome =
  | "target_changed"
  | "clipboard_busy"
  | "unsupported"
  | "paste_requested";
export type HelperErrorCode =
  | "invalid_request"
  | "duplicate_request"
  | "duplicate_session"
  | "no_target"
  | "limit_exceeded"
  | "internal_error";
export type HelperRequest =
  | { requestId: string; op: "snapshot" }
  | {
      requestId: string;
      op: "insert";
      expectedTarget: Target;
      sessionId: string;
      text: string;
    };
export type HelperResponse =
  | { requestId: string; ok: true; target: Target }
  | { requestId: string; ok: true; outcome: InsertOutcome }
  | { requestId: string | null; ok: false; error: HelperErrorCode };

const outcomes = new Set<string>([
  "target_changed", "clipboard_busy", "unsupported", "paste_requested",
]);
const errors = new Set<string>([
  "invalid_request", "duplicate_request", "duplicate_session", "no_target",
  "limit_exceeded", "internal_error",
]);
export function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function keys(value: Record<string, unknown>, expected: string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}
export function isTarget(value: unknown): value is Target {
  return record(value) && keys(value, ["foreground", "focus"]) &&
    typeof value.foreground === "string" && typeof value.focus === "string" &&
    /^0x[1-9a-f][0-9a-f]{0,15}$/.test(value.foreground) &&
    /^0x[1-9a-f][0-9a-f]{0,15}$/.test(value.focus);
}
export function isText(value: unknown): value is string {
  if (typeof value !== "string" || !value.length || value.includes("\0") ||
      Buffer.byteLength(value, "utf8") > MAX_TEXT_BYTES) return false;
  // JSON.stringify would otherwise silently transmit lone surrogate escapes.
  for (let i = 0; i < value.length; i++) {
    const unit = value.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const low = value.charCodeAt(++i);
      if (!(low >= 0xdc00 && low <= 0xdfff)) return false;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
  }
  return true;
}

// JSON.parse checks grammar first. This lexical pass additionally rejects
// duplicate object keys, including keys expressed via JSON Unicode escapes.
function rejectDuplicateKeys(line: string): void {
  const stack: (Set<string> | null)[] = [];
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "{") stack.push(new Set());
    else if (c === "[") stack.push(null);
    else if (c === "}" || c === "]") stack.pop();
    else if (c === '"') {
      const start = i++;
      while (i < line.length && line[i] !== '"') {
        if (line[i] === "\\") i++;
        i++;
      }
      let after = i + 1;
      while (/\s/.test(line[after] ?? "") && after < line.length) after++;
      if (line[after] === ":") {
        const key = JSON.parse(line.slice(start, i + 1)) as string;
        const objectKeys = stack[stack.length - 1];
        if (!objectKeys || objectKeys.has(key)) throw new Error("Malformed helper response");
        objectKeys.add(key);
      }
    }
  }
}
export function parseResponse(line: string): HelperResponse {
  if (Buffer.byteLength(line, "utf8") > MAX_LINE_BYTES) throw new Error("Malformed helper response");
  const value: unknown = JSON.parse(line);
  rejectDuplicateKeys(line);
  if (!record(value)) throw new Error("Malformed helper response");
  if (value.ok === false && keys(value, ["requestId", "ok", "error"]) &&
      (value.requestId === null || isIdentifier(value.requestId)) &&
      typeof value.error === "string" && errors.has(value.error)) return value as HelperResponse;
  if (value.ok === true && isIdentifier(value.requestId)) {
    if (keys(value, ["requestId", "ok", "target"]) && isTarget(value.target))
      return value as unknown as HelperResponse;
    if (keys(value, ["requestId", "ok", "outcome"]) &&
        typeof value.outcome === "string" && outcomes.has(value.outcome))
      return value as HelperResponse;
  }
  throw new Error("Malformed helper response");
}
