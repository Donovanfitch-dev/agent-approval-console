import {
  ACTION_TYPES,
  POLICY_OUTCOMES,
  type ActionType,
  type Payload,
  type PolicyOutcome,
  type PolicyReason,
  type PolicyResult,
} from "./types";

/**
 * Risk policy engine. Rules are DATA (plain JSON-serialisable objects), not
 * code: they can be reviewed, diffed, versioned, and loaded from storage.
 * The engine is a pure function of (action type, payload, rules).
 *
 * Semantics: every rule that applies to the action type and whose condition
 * holds "matches". The final outcome is the STRICTEST matched outcome
 * (deny > needs_two_approvals > needs_approval > auto_approve). If no rule
 * matches at all, the engine fails closed to `needs_approval`.
 */

export type Condition =
  | { op: "always" }
  | { op: "gt" | "gte" | "lt" | "lte"; field: string; value: number }
  | { op: "in"; field: string; values: string[] }
  /** Case-insensitive match of any regular-expression source against a string field. */
  | { op: "matches_any"; field: string; patterns: string[] };

export interface PolicyRule {
  id: string;
  actionType: ActionType;
  description: string;
  when: Condition;
  outcome: PolicyOutcome;
  /** Stable machine-readable reason code reported when the rule matches. */
  reasonCode: string;
  /** Human-readable explanation shown to reviewers. */
  message: string;
}

export interface PolicyConfig {
  version: string;
  rules: PolicyRule[];
}

const SEVERITY: Record<PolicyOutcome, number> = {
  auto_approve: 0,
  needs_approval: 1,
  needs_two_approvals: 2,
  deny: 3,
};

const REQUIRED_APPROVALS: Record<PolicyOutcome, 0 | 1 | 2> = {
  auto_approve: 0,
  needs_approval: 1,
  needs_two_approvals: 2,
  deny: 0,
};

export function requiredApprovalsFor(outcome: PolicyOutcome): 0 | 1 | 2 {
  return REQUIRED_APPROVALS[outcome];
}

export function outcomeSeverity(outcome: PolicyOutcome): number {
  return SEVERITY[outcome];
}

function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function conditionHolds(cond: Condition, payload: Payload): boolean {
  if (cond.op === "always") return true;
  const actual = getPath(payload, cond.field);
  switch (cond.op) {
    case "gt":
      return typeof actual === "number" && actual > cond.value;
    case "gte":
      return typeof actual === "number" && actual >= cond.value;
    case "lt":
      return typeof actual === "number" && actual < cond.value;
    case "lte":
      return typeof actual === "number" && actual <= cond.value;
    case "in":
      return typeof actual === "string" && cond.values.includes(actual);
    case "matches_any":
      return (
        typeof actual === "string" &&
        cond.patterns.some((source) => new RegExp(source, "i").test(actual))
      );
  }
}

/** Evaluate a proposed action against the policy. Pure and deterministic. */
export function evaluatePolicy(type: ActionType, payload: Payload, config: PolicyConfig): PolicyResult {
  const matched = config.rules.filter(
    (rule) => rule.actionType === type && conditionHolds(rule.when, payload),
  );

  if (matched.length === 0) {
    return {
      outcome: "needs_approval",
      requiredApprovals: 1,
      policyVersion: config.version,
      reasons: [
        {
          ruleId: "fail-closed",
          code: "NO_MATCHING_RULE",
          outcome: "needs_approval",
          message: `No policy rule covers "${type}"; failing closed to human approval.`,
        },
      ],
    };
  }

  const outcome = matched.reduce<PolicyOutcome>(
    (worst, rule) => (SEVERITY[rule.outcome] > SEVERITY[worst] ? rule.outcome : worst),
    "auto_approve",
  );

  // Elevated matches explain why; if nothing elevated matched, the baseline explains.
  const explaining = matched.filter((rule) =>
    outcome === "auto_approve" ? true : SEVERITY[rule.outcome] > 0,
  );
  const reasons: PolicyReason[] = explaining
    .map((rule) => ({
      ruleId: rule.id,
      code: rule.reasonCode,
      outcome: rule.outcome,
      message: rule.message,
    }))
    .sort((a, b) => SEVERITY[b.outcome] - SEVERITY[a.outcome]);

  return {
    outcome,
    requiredApprovals: REQUIRED_APPROVALS[outcome],
    policyVersion: config.version,
    reasons,
  };
}

/** One-line human summary of a policy result. */
export function summarizePolicy(result: PolicyResult): string {
  const head: Record<PolicyOutcome, string> = {
    auto_approve: "Auto-approved by policy",
    needs_approval: "Needs one reviewer approval",
    needs_two_approvals: "Needs two distinct reviewer approvals",
    deny: "Denied by policy",
  };
  const why = result.reasons.map((r) => r.message).join(" ");
  return why ? `${head[result.outcome]}. ${why}` : head[result.outcome];
}

/**
 * Structural validation of a policy config (e.g. one loaded from storage).
 * Returns a list of problems; empty means the config is usable.
 */
export function validatePolicyConfig(config: PolicyConfig): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  if (!config.version) problems.push("version is required");
  for (const rule of config.rules) {
    if (seen.has(rule.id)) problems.push(`duplicate rule id "${rule.id}"`);
    seen.add(rule.id);
    if (!(ACTION_TYPES as readonly string[]).includes(rule.actionType)) {
      problems.push(`${rule.id}: unknown action type "${rule.actionType}"`);
    }
    if (!(POLICY_OUTCOMES as readonly string[]).includes(rule.outcome)) {
      problems.push(`${rule.id}: unknown outcome "${rule.outcome}"`);
    }
    if (rule.when.op === "matches_any") {
      for (const source of rule.when.patterns) {
        try {
          new RegExp(source, "i");
        } catch {
          problems.push(`${rule.id}: invalid pattern "${source}"`);
        }
      }
    }
  }
  return problems;
}
