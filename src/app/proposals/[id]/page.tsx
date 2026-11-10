import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RiskBadge, StatusBadge } from "@/components/badges";
import { DiffTable, PayloadView } from "@/components/payload-view";
import { ProposalActions } from "@/components/proposal-actions";
import { Timeline } from "@/components/timeline";
import { DEMO_ACTORS } from "@/domain/demo-roles";
import { hasErrorCode } from "@/domain/errors";
import { formatUtc } from "@/domain/format";
import { RISK_LABELS } from "@/domain/labels";
import { ACTION_LABELS } from "@/domain/payloads";
import { distinctApprovers, type ProposalDetail } from "@/domain/service";
import { currentRole } from "@/server/actors";
import { getApp } from "@/server/store";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/proposals/[id]">): Promise<Metadata> {
  const { id } = await params;
  const { service } = await getApp();
  try {
    const { proposal } = await service.get(id);
    return { title: `${proposal.id} · ${ACTION_LABELS[proposal.type]}` };
  } catch (e) {
    if (hasErrorCode(e, "not_found")) return { title: "Proposal not found" };
    throw e;
  }
}

export default async function ProposalPage({ params }: PageProps<"/proposals/[id]">) {
  const { id } = await params;
  const { service } = await getApp();
  let detail: ProposalDetail;
  try {
    detail = await service.get(id);
  } catch (e) {
    if (hasErrorCode(e, "not_found")) notFound();
    throw e;
  }
  const { proposal: p, timeline } = detail;
  const role = await currentRole();
  const approvers = distinctApprovers(p);
  const edited = p.edits.length > 0;

  return (
    <div className="grid gap-6">
      <div>
        <p className="text-sm">
          <Link href="/" className="tap">← Back to queue</Link>
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold">
            {p.id} · {ACTION_LABELS[p.type]}
          </h1>
          <StatusBadge status={p.status} />
          <RiskBadge outcome={p.policy.outcome} />
        </div>
        <p className="muted mt-1 text-sm">
          Ticket <span className="mono">{p.ticketId}</span> · proposed by <span className="mono">{p.agentId}</span> ·
          submitted <time dateTime={p.createdAt}>{formatUtc(p.createdAt)}</time>
          {p.expiresAt ? (
            <>
              {" "}
              · expires <time dateTime={p.expiresAt}>{formatUtc(p.expiresAt)}</time>
            </>
          ) : null}
        </p>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="grid gap-6">
          <section className="card" aria-labelledby="payload-heading">
            <h2 id="payload-heading" className="card-title">
              {edited ? "Current payload (edited by reviewer)" : "Proposed action"}
            </h2>
            <PayloadView type={p.type} payload={p.payload} />
          </section>

          <section className="card" aria-labelledby="rationale-heading">
            <h2 id="rationale-heading" className="card-title">
              Agent rationale
            </h2>
            <blockquote className="text-sm" style={{ borderLeft: "3px solid var(--border)", paddingLeft: "0.75rem" }}>
              {p.rationale}
            </blockquote>
            <p className="muted mt-2 text-xs">
              Stated by the agent. Treat it as a claim to check, not as evidence.
            </p>
          </section>

          <section className="card" aria-labelledby="policy-heading">
            <h2 id="policy-heading" className="card-title">
              Policy explanation
            </h2>
            <p className="text-sm">
              Outcome: <strong>{RISK_LABELS[p.policy.outcome]}</strong>
              {p.policy.outcome !== "deny" ? (
                <>
                  {" "}
                  · required approvals: <strong>{p.policy.requiredApprovals}</strong>
                </>
              ) : null}{" "}
              · <span className="muted">policy version {p.policy.policyVersion}</span>
            </p>
            <ul className="mt-2 grid gap-2">
              {p.policy.reasons.map((r) => (
                <li key={r.ruleId} className="text-sm">
                  {r.message} <code className="mono muted">{r.code}</code>
                </li>
              ))}
            </ul>
            {p.rejection ? (
              <p className="notice notice-bad mt-3 text-sm">
                Rejected by <strong>{p.rejection.by}</strong> ({p.rejection.source}) on{" "}
                <time dateTime={p.rejection.at}>{formatUtc(p.rejection.at)}</time>: {p.rejection.reason}
              </p>
            ) : null}
          </section>

          {edited ? (
            <section className="card" aria-labelledby="diff-heading">
              <h2 id="diff-heading" className="card-title">
                Reviewer edits
              </h2>
              <div className="grid gap-4">
                {p.edits.map((edit) => (
                  <div key={edit.revision}>
                    <p className="mb-1 text-sm">
                      Revision {edit.revision} by <strong>{edit.by}</strong> at{" "}
                      <time dateTime={edit.at}>{formatUtc(edit.at)}</time>. Policy re-evaluated:{" "}
                      {RISK_LABELS[edit.policyBefore]} → <strong>{RISK_LABELS[edit.policyAfter]}</strong>.
                      {edit.approvalsInvalidated > 0
                        ? ` ${edit.approvalsInvalidated} earlier approval(s) no longer count.`
                        : ""}
                    </p>
                    <div className="overflow-x-auto">
                      <DiffTable type={p.type} diff={edit.diff} />
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <section className="card" aria-labelledby="approvals-heading">
            <h2 id="approvals-heading" className="card-title">
              Approvals
            </h2>
            {p.approvals.length === 0 ? (
              <p className="muted text-sm">No reviewer approvals yet.</p>
            ) : (
              <ul className="grid gap-2 text-sm">
                {p.approvals.map((a, i) => (
                  <li key={i}>
                    <strong>{a.reviewerId}</strong> approved payload revision {a.payloadRevision} at{" "}
                    <time dateTime={a.at}>{formatUtc(a.at)}</time>
                    {a.payloadRevision !== p.payloadRevision ? (
                      <span className="badge badge-neutral ml-2">no longer counts</span>
                    ) : null}
                    {a.comment ? <span className="muted"> — “{a.comment}”</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {p.execution.attempts > 0 ? (
            <section className="card" aria-labelledby="exec-heading">
              <h2 id="exec-heading" className="card-title">
                Execution
              </h2>
              <p className="text-sm">
                Attempts: <strong>{p.execution.attempts}</strong>
              </p>
              {p.execution.lastError ? (
                <p className="notice notice-bad mt-2 text-sm">Last error: {p.execution.lastError}</p>
              ) : null}
              {p.execution.receipt ? (
                <p className="notice notice-ok mt-2 text-sm">
                  {p.execution.receipt.effect}. Receipt <code className="mono">{p.execution.receipt.receiptId}</code>{" "}
                  (simulated; no real system was called).
                </p>
              ) : null}
            </section>
          ) : null}
        </div>

        <div className="grid gap-6">
          <ProposalActions
            proposal={p}
            role={role}
            actorId={DEMO_ACTORS[role].id}
            approvers={approvers}
          />
          <section className="card" aria-labelledby="timeline-heading">
            <h2 id="timeline-heading" className="card-title">
              Timeline
            </h2>
            <Timeline entries={timeline} />
          </section>
        </div>
      </div>
    </div>
  );
}
