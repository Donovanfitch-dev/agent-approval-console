import { formatCents } from "./format";
import type { ActionType, Payload, PolicyOutcome, Status } from "./types";

export const STATUS_LABELS: Record<Status, string> = {
  proposed: "Proposed",
  pending_approval: "Pending approval",
  approved: "Approved",
  executing: "Executing",
  executed: "Executed",
  failed: "Failed",
  rejected: "Rejected",
  expired: "Expired",
};

/** Plain-language risk tier derived from the policy outcome. */
export const RISK_LABELS: Record<PolicyOutcome, string> = {
  auto_approve: "Low risk · auto",
  needs_approval: "Medium risk · 1 approval",
  needs_two_approvals: "High risk · 2 approvals",
  deny: "Blocked by policy",
};

export const RISK_SHORT_LABELS: Record<PolicyOutcome, string> = {
  auto_approve: "Low (auto)",
  needs_approval: "Medium",
  needs_two_approvals: "High",
  deny: "Blocked",
};

export const AUDIT_EVENT_LABELS: Record<string, string> = {
  proposal_submitted: "Proposal submitted",
  policy_evaluated: "Policy evaluated",
  approval_recorded: "Approval recorded",
  payload_edited: "Payload edited",
  approved: "Approved",
  rejected: "Rejected",
  expired: "Expired",
  decision_refused: "Decision refused",
  execution_started: "Execution started",
  execution_succeeded: "Execution succeeded",
  execution_failed: "Execution failed",
};

/** One-line human summary of a proposed action. */
export function summarizeAction(type: ActionType, payload: Payload): string {
  switch (type) {
    case "issue_refund": {
      const p = payload as { orderId: string; amountCents: number; reasonCode: string };
      return `Refund ${formatCents(p.amountCents)} on ${p.orderId} (${p.reasonCode.replace(/_/g, " ")})`;
    }
    case "apply_account_credit": {
      const p = payload as { customerId: string; amountCents: number; reasonCode: string };
      return `Credit ${formatCents(p.amountCents)} to ${p.customerId} (${p.reasonCode.replace(/_/g, " ")})`;
    }
    case "send_customer_reply": {
      const p = payload as { customerId: string; subject: string };
      return `Reply to ${p.customerId}: "${p.subject}"`;
    }
    case "update_shipping_address": {
      const p = payload as { orderId: string; newAddress: { city: string; region: string } };
      return `Change address on ${p.orderId} to ${p.newAddress.city}, ${p.newAddress.region}`;
    }
  }
}
