"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { DEMO_ROLE_LABELS, type DemoRole } from "@/domain/demo-roles";
import { FIELD_SPECS, type FieldSpec } from "@/domain/payloads";
import { api, describeError } from "@/lib/api-client";
import type { Proposal } from "@/domain/types";

interface Props {
  proposal: Proposal;
  role: DemoRole;
  actorId: string;
  approvers: string[];
}

type Mode = "none" | "reject" | "edit";

function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let cur = obj;
  for (const part of parts.slice(0, -1)) {
    cur = cur[part] as Record<string, unknown>;
  }
  const last = parts[parts.length - 1];
  if (value === undefined) delete cur[last];
  else cur[last] = value;
}

function initialValue(spec: FieldSpec, payload: unknown): string {
  const raw = getPath(payload, spec.path);
  if (raw === undefined || raw === null) return "";
  if (spec.kind === "money") return (Number(raw) / 100).toFixed(2);
  return String(raw);
}

export function ProposalActions({ proposal, role, actorId, approvers }: Props) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("none");
  const [comment, setComment] = useState("");
  const [reason, setReason] = useState("");
  const editable = FIELD_SPECS[proposal.type].filter((f) => f.editable);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(editable.map((f) => [f.path, initialValue(f, proposal.payload)])),
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(label: string, fn: () => Promise<string | void>) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const done = await fn();
      setMessage(done || `${label} recorded.`);
      setMode("none");
      setComment("");
      setReason("");
      router.refresh();
    } catch (e) {
      setError(describeError(e));
      router.refresh(); // a refused attempt is still audited; show it in the timeline
    } finally {
      setBusy(false);
    }
  }

  const decide = (body: Record<string, unknown>, label: string) =>
    run(label, async () => {
      await api(`/api/proposals/${proposal.id}/decision`, { role, body });
    });

  function buildEditedPayload(): Record<string, unknown> {
    const next = structuredClone(proposal.payload) as unknown as Record<string, unknown>;
    for (const spec of editable) {
      const raw = (values[spec.path] ?? "").trim();
      if (spec.kind === "money") {
        const dollars = Number(raw);
        setPath(next, spec.path, raw === "" || !Number.isFinite(dollars) ? Number.NaN : Math.round(dollars * 100));
      } else if (raw === "" && spec.path.endsWith("line2")) {
        setPath(next, spec.path, undefined);
      } else {
        setPath(next, spec.path, raw);
      }
    }
    return next;
  }

  async function execute() {
    await run("Execution", async () => {
      const r = await api<{ outcome: string; performed: boolean }>(`/api/proposals/${proposal.id}/execute`, { role });
      if (r.outcome === "failed") throw new Error("The simulated executor failed. The failure is recorded; you can retry.");
      return r.performed ? "Executed (simulated)." : `No side effect performed: ${r.outcome.replace(/_/g, " ")}.`;
    });
  }

  async function executeTwice() {
    await run("Execution", async () => {
      const results = await Promise.all([
        api<{ outcome: string; performed: boolean }>(`/api/proposals/${proposal.id}/execute`, { role }),
        api<{ outcome: string; performed: boolean }>(`/api/proposals/${proposal.id}/execute`, { role }),
      ]);
      const performed = results.filter((r) => r.performed).length;
      return `Sent 2 simultaneous execute requests. Side effect performed ${performed} time(s); outcomes: ${results
        .map((r) => r.outcome.replace(/_/g, " "))
        .join(", ")}.`;
    });
  }

  const youApproved = approvers.includes(actorId);
  const required = proposal.policy.requiredApprovals;

  return (
    <section className="card" aria-labelledby="actions-heading">
      <h2 id="actions-heading" className="card-title">
        Review &amp; execution
      </h2>
      <p className="muted mb-3 text-sm">
        Acting as <strong>{DEMO_ROLE_LABELS[role]}</strong> (demo role).
      </p>

      {proposal.status === "pending_approval" ? (
        <div className="grid gap-3">
          <p className="text-sm">
            Approvals on the current payload: <strong>{approvers.length}</strong> of <strong>{required}</strong>
            {approvers.length > 0 ? ` (${approvers.join(", ")})` : ""}.
            {youApproved ? " You have already approved this revision." : ""}
          </p>
          {role === "agent" ? (
            <p className="notice notice-warn text-sm">
              Agents cannot review. You can still click a button to see the server refuse it and record the attempt in
              the audit log.
            </p>
          ) : null}

          <div>
            <label htmlFor="decision-comment" className="field-label">
              Comment (optional)
            </label>
            <textarea
              id="decision-comment"
              className="field"
              rows={2}
              maxLength={500}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => decide({ decision: "approve", comment }, "Approval")}
            >
              Approve
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy}
              aria-expanded={mode === "edit"}
              aria-controls="edit-form"
              onClick={() => setMode(mode === "edit" ? "none" : "edit")}
            >
              Edit &amp; approve…
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy}
              aria-expanded={mode === "reject"}
              aria-controls="reject-form"
              onClick={() => setMode(mode === "reject" ? "none" : "reject")}
            >
              Reject…
            </button>
          </div>

          {mode === "reject" ? (
            <form
              id="reject-form"
              className="grid gap-2 border-t pt-3"
              style={{ borderColor: "var(--border)" }}
              onSubmit={(e) => {
                e.preventDefault();
                decide({ decision: "reject", reason }, "Rejection");
              }}
            >
              <label htmlFor="reject-reason" className="field-label">
                Reason for rejecting (required)
              </label>
              <textarea
                id="reject-reason"
                className="field"
                rows={3}
                maxLength={500}
                required
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <div>
                <button type="submit" className="btn btn-danger" disabled={busy}>
                  Reject proposal
                </button>
              </div>
            </form>
          ) : null}

          {mode === "edit" ? (
            <form
              id="edit-form"
              className="grid gap-3 border-t pt-3"
              style={{ borderColor: "var(--border)" }}
              onSubmit={(e) => {
                e.preventDefault();
                decide({ decision: "edit_approve", payload: buildEditedPayload(), comment }, "Edit and approval");
              }}
            >
              <p className="muted text-sm">
                Your edit is recorded as a diff, the policy is re-evaluated on the new payload, and any earlier
                approvals of the old payload no longer count. Identifying fields (order, customer, currency) are locked.
              </p>
              {editable.map((spec) => {
                const id = `edit-${spec.path.replace(/\./g, "-")}`;
                const value = values[spec.path] ?? "";
                const onChange = (v: string) => setValues((s) => ({ ...s, [spec.path]: v }));
                return (
                  <div key={spec.path}>
                    <label htmlFor={id} className="field-label">
                      {spec.label}
                      {spec.kind === "money" ? " (USD)" : ""}
                    </label>
                    {spec.kind === "longtext" ? (
                      <textarea id={id} className="field" rows={5} value={value} onChange={(e) => onChange(e.target.value)} />
                    ) : spec.kind === "enum" ? (
                      <select id={id} className="field" value={value} onChange={(e) => onChange(e.target.value)}>
                        {spec.options?.map((o) => (
                          <option key={o} value={o}>
                            {o.replace(/_/g, " ")}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        id={id}
                        className="field"
                        type={spec.kind === "money" ? "number" : "text"}
                        {...(spec.kind === "money" ? { step: "0.01", min: "0.01", inputMode: "decimal" as const } : {})}
                        value={value}
                        onChange={(e) => onChange(e.target.value)}
                      />
                    )}
                  </div>
                );
              })}
              <div>
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  Save edit &amp; approve
                </button>
              </div>
            </form>
          ) : null}
        </div>
      ) : null}

      {proposal.status === "approved" || proposal.status === "failed" ? (
        <div className="grid gap-3">
          {proposal.status === "failed" ? (
            <p className="notice notice-bad text-sm" role="note">
              Last attempt failed: {proposal.execution.lastError}. The failure is in the audit log; retrying is safe
              because the executor honours the idempotency key.
            </p>
          ) : (
            <p className="text-sm">Approved. Execution is a separate, explicit step.</p>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-primary" disabled={busy} onClick={execute}>
              {proposal.status === "failed" ? "Retry execution (simulated)" : "Execute (simulated)"}
            </button>
            {proposal.status === "approved" ? (
              <button type="button" className="btn" disabled={busy} onClick={executeTwice}>
                Send 2 simultaneous execute requests
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {!["pending_approval", "approved", "failed"].includes(proposal.status) ? (
        <p className="text-sm muted">No further actions are available: this proposal is {proposal.status.replace(/_/g, " ")}.</p>
      ) : null}

      <div aria-live="polite" className="mt-3 text-sm">
        {message ? <p className="notice notice-ok">{message}</p> : null}
        {error ? (
          <p role="alert" className="notice notice-bad">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}
