import { RISK_LABELS, STATUS_LABELS } from "@/domain/labels";
import type { PolicyOutcome, Status } from "@/domain/types";

const STATUS_CLASS: Record<Status, string> = {
  proposed: "badge-neutral",
  pending_approval: "badge-warn",
  approved: "badge-info",
  executing: "badge-info",
  executed: "badge-ok",
  failed: "badge-bad",
  rejected: "badge-bad",
  expired: "badge-neutral",
};

const RISK_CLASS: Record<PolicyOutcome, string> = {
  auto_approve: "badge-ok",
  needs_approval: "badge-warn",
  needs_two_approvals: "badge-bad",
  deny: "badge-bad",
};

export function StatusBadge({ status }: { status: Status }) {
  return <span className={`badge ${STATUS_CLASS[status]}`}>{STATUS_LABELS[status]}</span>;
}

export function RiskBadge({ outcome }: { outcome: PolicyOutcome }) {
  return <span className={`badge ${RISK_CLASS[outcome]}`}>{RISK_LABELS[outcome]}</span>;
}
