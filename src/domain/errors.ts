/**
 * Domain error types. Every error carries a stable machine-readable `code`
 * so that an outer layer (HTTP, CLI, tests) can map it without string matching.
 */

export type DomainErrorCode =
  | "validation_failed"
  | "illegal_transition"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "idempotency_conflict";

/**
 * Brand used by `isDomainError`. Bundlers (Next.js among them) can evaluate
 * this module more than once, producing several distinct `DomainError`
 * classes; `instanceof` then fails across them. A registry-symbol brand is
 * identical in every copy, so the guard below stays reliable.
 */
const BRAND = Symbol.for("agent-approval-console.domain-error");

export class DomainError extends Error {
  readonly [BRAND] = true;
  readonly code: DomainErrorCode;

  constructor(code: DomainErrorCode, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

export interface ValidationIssue {
  /** Dotted path of the offending field, e.g. `payload.amountCents`. */
  path: string;
  message: string;
}

export class ValidationError extends DomainError {
  readonly issues: ValidationIssue[];

  constructor(issues: ValidationIssue[]) {
    const summary = issues.map((i) => `${i.path}: ${i.message}`).join("; ");
    super("validation_failed", `Validation failed: ${summary}`);
    this.issues = issues;
  }
}

export class IllegalTransitionError extends DomainError {
  readonly from: string;
  readonly to: string;

  constructor(from: string, to: string) {
    super("illegal_transition", `Illegal transition: ${from} -> ${to}`);
    this.from = from;
    this.to = to;
  }
}

export class ForbiddenError extends DomainError {
  constructor(message: string) {
    super("forbidden", message);
  }
}

export class NotFoundError extends DomainError {
  constructor(message: string) {
    super("not_found", message);
  }
}

/** Optimistic-concurrency or uniqueness failure raised by a repository. */
export class ConflictError extends DomainError {
  constructor(message: string) {
    super("conflict", message);
  }
}

/** The same idempotency key was reused with different content. */
export class IdempotencyConflictError extends DomainError {
  constructor(message: string) {
    super("idempotency_conflict", message);
  }
}

/** Cross-bundle-safe replacement for `instanceof DomainError`. */
export function isDomainError(value: unknown): value is DomainError {
  return typeof value === "object" && value !== null && (value as Record<symbol, unknown>)[BRAND] === true;
}

/** Cross-bundle-safe check for a specific domain error code. */
export function hasErrorCode(value: unknown, code: DomainErrorCode): value is DomainError {
  return isDomainError(value) && value.code === code;
}
