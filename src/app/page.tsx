import Link from "next/link";
import { RiskBadge, StatusBadge } from "@/components/badges";
import { SimulateButton } from "@/components/simulate-button";
import { formatUtc } from "@/domain/format";
import { RISK_SHORT_LABELS, STATUS_LABELS, summarizeAction } from "@/domain/labels";
import { ACTION_LABELS } from "@/domain/payloads";
import { SCENARIOS } from "@/domain/simulate";
import { POLICY_OUTCOMES, STATUSES, type PolicyOutcome, type Status } from "@/domain/types";
import { getApp } from "@/server/store";

export const dynamic = "force-dynamic";

const FILTER_STATUSES = STATUSES.filter((s) => s !== "proposed");

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function href(status?: Status, risk?: PolicyOutcome): string {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (risk) params.set("risk", risk);
  const qs = params.toString();
  return qs ? `/?${qs}` : "/";
}

export default async function QueuePage({ searchParams }: PageProps<"/">) {
  const sp = await searchParams;
  const rawStatus = first(sp.status);
  const rawRisk = first(sp.risk);
  const status = FILTER_STATUSES.find((s) => s === rawStatus);
  const risk = POLICY_OUTCOMES.find((o) => o === rawRisk);

  const { service } = await getApp();
  const [proposals, counts] = await Promise.all([service.list({ status, risk }), service.counts()]);
  const scenarios = Object.entries(SCENARIOS).map(([id, s]) => ({ id, label: s.label }));

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-bold">Approval queue</h1>
        <p className="muted mt-1 max-w-3xl">
          AI agents propose side-effecting actions; a risk policy decides whether each can proceed automatically, needs
          one or two human approvals, or is denied. Nothing executes until it is approved, and every step is written to
          a hash-chained audit log.
        </p>
        <p className="mt-2 text-sm">
          <strong>{counts.byStatus.pending_approval}</strong> awaiting review · <strong>{counts.total}</strong> proposals
          total
        </p>
      </div>

      <SimulateButton scenarios={scenarios} />

      <section aria-labelledby="filters-heading" className="grid gap-3">
        <h2 id="filters-heading" className="sr-only">
          Filters
        </h2>
        <nav aria-label="Filter by status">
          <p className="field-label">Status</p>
          <ul className="flex flex-wrap gap-2">
            <li>
              <Link className="chip" href={href(undefined, risk)} aria-current={!status ? "true" : undefined}>
                All <span aria-hidden="true">({counts.total})</span>
                <span className="sr-only">, {counts.total} proposals</span>
              </Link>
            </li>
            {FILTER_STATUSES.map((s) => (
              <li key={s}>
                <Link className="chip" href={href(s, risk)} aria-current={status === s ? "true" : undefined}>
                  {STATUS_LABELS[s]} <span aria-hidden="true">({counts.byStatus[s]})</span>
                  <span className="sr-only">, {counts.byStatus[s]} proposals</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <nav aria-label="Filter by risk">
          <p className="field-label">Risk (policy outcome)</p>
          <ul className="flex flex-wrap gap-2">
            <li>
              <Link className="chip" href={href(status, undefined)} aria-current={!risk ? "true" : undefined}>
                All risks
              </Link>
            </li>
            {POLICY_OUTCOMES.map((o) => (
              <li key={o}>
                <Link className="chip" href={href(status, o)} aria-current={risk === o ? "true" : undefined}>
                  {RISK_SHORT_LABELS[o]} <span aria-hidden="true">({counts.byRisk[o]})</span>
                  <span className="sr-only">, {counts.byRisk[o]} proposals</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </section>

      <section aria-labelledby="list-heading">
        <h2 id="list-heading" className="mb-2 text-lg font-semibold">
          {proposals.length} {proposals.length === 1 ? "proposal" : "proposals"}
          {status || risk ? " matching filters" : ""}
        </h2>
        {proposals.length === 0 ? (
          <p className="card muted">
            No proposals match these filters. <Link href="/">Clear filters</Link> or simulate a new agent proposal.
          </p>
        ) : (
          <ul className="grid gap-3">
            {proposals.map((p) => (
              <li key={p.id} className="card grid gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-base font-semibold">
                    <Link href={`/proposals/${p.id}`}>
                      {p.id} · {ACTION_LABELS[p.type]}
                    </Link>
                  </h3>
                  <StatusBadge status={p.status} />
                  <RiskBadge outcome={p.policy.outcome} />
                </div>
                <p className="text-sm">{summarizeAction(p.type, p.payload)}</p>
                <p className="muted text-xs">
                  {p.ticketId} · {p.agentId} · submitted <time dateTime={p.createdAt}>{formatUtc(p.createdAt)}</time>
                  {p.expiresAt ? (
                    <>
                      {" "}
                      · expires <time dateTime={p.expiresAt}>{formatUtc(p.expiresAt)}</time>
                    </>
                  ) : null}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
