import type { Metadata } from "next";
import Link from "next/link";
import { AuditControls } from "@/components/audit-controls";
import { formatUtc } from "@/domain/format";
import { AUDIT_EVENT_LABELS } from "@/domain/labels";
import { demoControlsEnabled } from "@/server/http";
import { getApp } from "@/server/store";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Audit log" };

export default async function AuditPage() {
  const { service } = await getApp();
  const { entries, verification } = await service.auditReport();
  const ordered = [...entries].reverse();

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-bold">Audit log</h1>
        <p className="muted mt-1 max-w-3xl">
          Append-only. Each entry stores the SHA-256 hash of the entry before it, so changing or removing any past entry
          breaks every hash after it. The same data is available as JSON at{" "}
          <code className="mono">/api/audit</code>.
        </p>
      </div>

      <div role="status" className={`notice ${verification.valid ? "notice-ok" : "notice-bad"}`}>
        {verification.valid ? (
          <>
            <p className="font-semibold">Hash chain verified: valid</p>
            <p className="text-sm">
              {verification.checked} entries checked. Head hash: <code className="mono break-all">{verification.headHash}</code>
            </p>
          </>
        ) : (
          <>
            <p className="font-semibold">Hash chain verification FAILED</p>
            <p className="text-sm">
              First inconsistency at entry #{verification.firstInvalidSeq}: {verification.reason}. Entries from that
              point on cannot be trusted.
            </p>
          </>
        )}
      </div>

      <AuditControls enabled={demoControlsEnabled()} />

      <section aria-labelledby="entries-heading">
        <h2 id="entries-heading" className="mb-2 text-lg font-semibold">
          {entries.length} entries (newest first)
        </h2>
        <div className="card !p-0 overflow-x-auto" tabIndex={0} role="region" aria-label="Audit log entries, scrollable">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Time</th>
                <th scope="col">Event</th>
                <th scope="col">Proposal</th>
                <th scope="col">Actor</th>
                <th scope="col">Hash</th>
              </tr>
            </thead>
            <tbody>
              {ordered.map((e) => {
                const broken = !verification.valid && verification.firstInvalidSeq !== undefined && e.seq >= verification.firstInvalidSeq;
                return (
                  <tr key={e.seq}>
                    <td className="mono">{e.seq}</td>
                    <td className="whitespace-nowrap">
                      <time dateTime={e.at}>{formatUtc(e.at)}</time>
                    </td>
                    <td>
                      <details>
                        <summary className="cursor-pointer">{AUDIT_EVENT_LABELS[e.type]}</summary>
                        <pre className="mono mt-1 max-w-md overflow-x-auto whitespace-pre-wrap break-words">
                          {JSON.stringify(e.data, null, 2)}
                        </pre>
                        <p className="mono muted break-all">prev {e.prevHash}</p>
                        <p className="mono muted break-all">hash {e.hash}</p>
                      </details>
                    </td>
                    <td>
                      {e.proposalId ? <Link href={`/proposals/${e.proposalId}`} className="tap">{e.proposalId}</Link> : "—"}
                    </td>
                    <td className="mono">{e.actor}</td>
                    <td className="mono">
                      {e.hash.slice(0, 10)}…
                      {broken ? <span className="badge badge-bad ml-2">unverified</span> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
