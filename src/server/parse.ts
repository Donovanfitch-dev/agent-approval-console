import { ValidationError, type ValidationIssue } from "@/domain/errors";
import type { Decision } from "@/domain/service";
import { POLICY_OUTCOMES, STATUSES, type PolicyOutcome, type Status } from "@/domain/types";
import { assertNoIssues, rootReader } from "@/domain/validation";

/** Parse the JSON body of the decision endpoint into a domain Decision. */
export function parseDecision(body: unknown): Decision {
  const issues: ValidationIssue[] = [];
  const r = rootReader(body, issues);
  r.strictKeys(["decision", "comment", "reason", "payload"]);
  const kind = r.enum("decision", ["approve", "reject", "edit_approve"] as const);
  const comment = r.optionalString("comment", { max: 500 });
  assertNoIssues(issues);

  const raw = body as Record<string, unknown>;
  switch (kind) {
    case "approve":
      return { kind, comment };
    case "reject": {
      const reason = r.optionalString("reason", { max: 500 });
      if (!reason) throw new ValidationError([{ path: "reason", message: "a reason is required to reject" }]);
      return { kind, reason };
    }
    case "edit_approve":
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
