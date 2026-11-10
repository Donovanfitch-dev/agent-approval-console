import { formatUtc } from "@/domain/format";
import { AUDIT_EVENT_LABELS, RISK_LABELS, summarizeAction } from "@/domain/labels";
import type { ActionType, AuditEntry, Payload, PolicyOutcome } from "@/domain/types";

type Data = Record<string, unknown>;

export function describeEntry(entry: AuditEntry): string {
  const d = entry.data as Data;
  switch (entry.type) {
    case "proposal_submitted":
      return `${entry.actor} proposed: ${summarizeAction(d.type as ActionType, d.payload as Payload)}.`;
    case "policy_evaluated":
      return `Policy ${String(d.policyVersion)}: ${RISK_LABELS[d.outcome as PolicyOutcome]}.`;
    case "approval_recorded": {
      const approvers = (d.approvers as string[]) ?? [];
      return `${entry.actor} approved. ${approvers.length} of ${String(d.required)} required approvals on payload revision ${String(d.payloadRevision)}.`;
    }
    case "payload_edited": {
      const diff = (d.diff as unknown[]) ?? [];
      return `${entry.actor} edited the payload (${diff.length} field${diff.length === 1 ? "" : "s"} changed). Earlier approvals invalidated: ${String(d.approvalsInvalidated)}.`;
    }
    case "approved":
      return d.via === "auto_approve" ? "Auto-approved by policy; no human review needed." : `Fully approved by ${((d.approvers as string[]) ?? []).join(" and ")}.`;
    case "rejected":
      return `Rejected${d.source === "policy" ? " by policy" : ` by ${entry.actor}`}: ${String(d.reason)}`;
    case "expired":
      return "Expired: no decision before the deadline.";
    case "decision_refused":
      return `${entry.actor} tried to ${String(d.attempted).replace(/_/g, " ")} and was refused: ${String(d.reason)}`;
    case "execution_started":
      return `Execution attempt ${String(d.attempt)} started by ${entry.actor}.`;
    case "execution_succeeded":
      return `Execution succeeded (attempt ${String(d.attempt)}): ${String((d.receipt as Data | undefined)?.effect ?? "")}`;
    case "execution_failed":
      return `Execution failed (attempt ${String(d.attempt)}): ${String(d.error)}`;
  }
}

export function Timeline({ entries }: { entries: AuditEntry[] }) {
  return (
    <ol className="grid gap-3">
      {entries.map((entry) => (
        <li key={entry.seq} className="grid gap-0.5 border-l-2 pl-3" style={{ borderColor: "var(--border)" }}>
          <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
            <strong>{AUDIT_EVENT_LABELS[entry.type]}</strong>
            <time dateTime={entry.at} className="muted text-xs">
              {formatUtc(entry.at)}
            </time>
            <span className="muted text-xs">audit #{entry.seq}</span>
          </div>
          <p className="text-sm">{describeEntry(entry)}</p>
        </li>
      ))}
    </ol>
  );
}
