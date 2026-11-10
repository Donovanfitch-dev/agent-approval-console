import { ValidationError, type ValidationIssue } from "./errors";

/**
 * A tiny hand-written validation toolkit. A `Reader` wraps an unknown record,
 * collects issues (rather than throwing on the first), and reports dotted
 * paths so callers get precise, actionable errors.
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface StringOptions {
  min?: number;
  max?: number;
  pattern?: RegExp;
  patternHint?: string;
}

export interface IntOptions {
  min?: number;
  max?: number;
}

export class Reader {
  constructor(
    private readonly src: Record<string, unknown>,
    readonly issues: ValidationIssue[],
    private readonly base: string,
  ) {}

  private path(key: string): string {
    return this.base ? `${this.base}.${key}` : key;
  }

  /** Reject keys that are not in the allow-list. */
  strictKeys(allowed: readonly string[]): void {
    for (const key of Object.keys(this.src)) {
      if (!allowed.includes(key)) {
        this.issues.push({ path: this.path(key), message: "unknown field" });
      }
    }
  }

  string(key: string, opts: StringOptions = {}): string {
    const raw = this.src[key];
    const path = this.path(key);
    if (typeof raw !== "string") {
      this.issues.push({ path, message: "must be a string" });
      return "";
    }
    const value = raw.trim();
    if (value.length < (opts.min ?? 1)) {
      this.issues.push({
        path,
        message: (opts.min ?? 1) <= 1 ? "is required" : `must be at least ${opts.min} characters`,
      });
    } else if (opts.max !== undefined && value.length > opts.max) {
      this.issues.push({ path, message: `must be at most ${opts.max} characters` });
    } else if (opts.pattern && !opts.pattern.test(value)) {
      this.issues.push({ path, message: opts.patternHint ?? `must match ${opts.pattern}` });
    }
    return value;
  }

  optionalString(key: string, opts: StringOptions = {}): string | undefined {
    const raw = this.src[key];
    if (raw === undefined || raw === null || (typeof raw === "string" && raw.trim() === "")) {
      return undefined;
    }
    return this.string(key, opts);
  }

  int(key: string, opts: IntOptions = {}): number {
    const raw = this.src[key];
    const path = this.path(key);
    if (typeof raw !== "number" || !Number.isInteger(raw)) {
      this.issues.push({ path, message: "must be an integer" });
      return 0;
    }
    if (opts.min !== undefined && raw < opts.min) {
      this.issues.push({ path, message: `must be at least ${opts.min}` });
    } else if (opts.max !== undefined && raw > opts.max) {
      this.issues.push({ path, message: `must be at most ${opts.max}` });
    }
    return raw;
  }

  enum<T extends string>(key: string, allowed: readonly T[]): T {
    const raw = this.src[key];
    if (typeof raw !== "string" || !(allowed as readonly string[]).includes(raw)) {
      this.issues.push({ path: this.path(key), message: `must be one of: ${allowed.join(", ")}` });
      return allowed[0];
    }
    return raw as T;
  }

  object(key: string): Reader {
    const raw = this.src[key];
    if (!isRecord(raw)) {
      this.issues.push({ path: this.path(key), message: "must be an object" });
      return new Reader({}, this.issues, this.path(key));
    }
    return new Reader(raw, this.issues, this.path(key));
  }
}

/** Throw a ValidationError if any issues were collected. */
export function assertNoIssues(issues: ValidationIssue[]): void {
  if (issues.length > 0) throw new ValidationError(issues);
}

/** Build a root Reader for an unknown input, or fail with a clear error. */
export function rootReader(input: unknown, issues: ValidationIssue[], base = ""): Reader {
  if (!isRecord(input)) {
    throw new ValidationError([{ path: base || "(root)", message: "must be a JSON object" }]);
  }
  return new Reader(input, issues, base);
}
