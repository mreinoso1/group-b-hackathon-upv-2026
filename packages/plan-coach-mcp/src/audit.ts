import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface AuditEntry {
  at: string;
  kind: "tool" | "resource" | "prompt";
  name: string;
  args: unknown;
  ms: number;
  ok: boolean;
  error?: string;
}

export interface AuditLog {
  write(entry: AuditEntry): void;
}

const SECRET_KEY = /token|key|secret|password|authorization|bearer/i;
const SECRET_VALUE = /\b(sk-[A-Za-z0-9_-]{8,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+)/g;

/** Removes anything that looks like a credential before it reaches a log line. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[…]";
  if (typeof value === "string") return value.replace(SECRET_VALUE, "[redacted]").slice(0, 500);
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, SECRET_KEY.test(k) ? "[redacted]" : redact(v, depth + 1)]),
    );
  }
  return value;
}

export class JsonlAuditLog implements AuditLog {
  constructor(private readonly file: string) {
    mkdirSync(dirname(file), { recursive: true });
  }
  write(entry: AuditEntry) {
    appendFileSync(this.file, `${JSON.stringify({ ...entry, args: redact(entry.args) })}\n`, "utf8");
  }
}

export class MemoryAuditLog implements AuditLog {
  readonly entries: AuditEntry[] = [];
  write(entry: AuditEntry) {
    this.entries.push({ ...entry, args: redact(entry.args) });
  }
}

/**
 * Wraps a handler so every call is logged with its duration and outcome.
 * Only the first argument is logged (tool arguments, or the resource URI): the MCP `extra`
 * argument carries request metadata such as headers and is never written down.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function audited<F extends (...args: any[]) => Promise<any>>(log: AuditLog, kind: AuditEntry["kind"], name: string, fn: F): F {
  const wrapped = async (...callArgs: Parameters<F>) => {
    const first: unknown = callArgs[0];
    const args = first instanceof URL ? first.href : first;
    const start = Date.now();
    try {
      const result = await fn(...callArgs);
      const ok = !(result && typeof result === "object" && "isError" in result && result.isError === true);
      log.write({ at: new Date().toISOString(), kind, name, args, ms: Date.now() - start, ok });
      return result;
    } catch (e) {
      log.write({ at: new Date().toISOString(), kind, name, args, ms: Date.now() - start, ok: false, error: (e as Error).message });
      throw e;
    }
  };
  return wrapped as F;
}
