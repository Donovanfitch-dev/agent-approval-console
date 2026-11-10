import { ValidationError, type ValidationIssue } from "@/domain/errors";
import type { Decision } from "@/domain/service";
import { POLICY_OUTCOMES, STATUSES, type PolicyOutcome, type Status } from "@/domain/types";
import { assertNoIssues, rootReader } from "@/domain/validation";

const ALLOWED_KEYS = {
  approve: ["decision", "comment"],
  reject: ["decision", "reason"],
  edit_approve: ["decision", "payload", "comment"],
} as const;

/**
 * Parse the JSON body of the decision endpoint into a domain Decision.
 * Each decision kind accepts only its own fields: for example `payload` is
 * refused unless the decision is `edit_approve`, so an approval can never
 * silently ignore a payload the caller believed it was changing.
 */
export function parseDecision(body: unknown): Decision {
  const issues: ValidationIssue[] = [];
  const r = rootReader(body, issues);
  const kind = r.enum("decision", ["approve", "reject", "edit_approve"] as const);
  assertNoIssues(issues);

  const raw = body as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    if (!(ALLOWED_KEYS[kind] as readonly string[]).includes(key)) {
      issues.push({
        path: key,
        message: ["payload", "reason", "comment"].includes(key)
          ? `not allowed with decision "${kind}"${key === "payload" ? " (only edit_approve takes a payload)" : ""}`
          : "unknown field",
      });
    }
  }
  assertNoIssues(issues);

  const comment = r.optionalString("comment", { max: 500 });
  switch (kind) {
    case "approve":
      assertNoIssues(issues);
      return { kind, comment };
    case "reject": {
      const reason = r.optionalString("reason", { max: 500 });
      assertNoIssues(issues);
      if (!reason) throw new ValidationError([{ path: "reason", message: "a reason is required to reject" }]);
      return { kind, reason };
    }
    case "edit_approve":
      assertNoIssues(issues);
      if (raw.payload === undefined) {
        throw new ValidationError([{ path: "payload", message: "the edited payload is required" }]);
      }
      return { kind, payload: raw.payload, comment };
  }
}

export function parseListQuery(params: URLSearchParams): {
  status?: Status;
  risk?: PolicyOutcome;
  search?: string;
} {
  const issues: ValidationIssue[] = [];
  const status = params.get("status") || undefined;
  const risk = params.get("risk") || undefined;
  if (status && !(STATUSES as readonly string[]).includes(status)) {
    issues.push({ path: "status", message: `must be one of: ${STATUSES.join(", ")}` });
  }
  if (risk && !(POLICY_OUTCOMES as readonly string[]).includes(risk)) {
    issues.push({ path: "risk", message: `must be one of: ${POLICY_OUTCOMES.join(", ")}` });
  }
  assertNoIssues(issues);
  return { status: status as Status | undefined, risk: risk as PolicyOutcome | undefined, search: params.get("q") || undefined };
}
