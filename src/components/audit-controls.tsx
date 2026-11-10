"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, describeError } from "@/lib/api-client";

/** Demo-only controls for showing tamper detection and starting over. */
export function AuditControls({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function call(path: string, done: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await api(path, {});
      setMessage(done);
      router.refresh();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" aria-labelledby="demo-controls-heading">
      <h2 id="demo-controls-heading" className="card-title">
        Demo controls
      </h2>
      <p className="muted mb-3 text-sm">
        The application never edits or deletes audit entries. This button simulates someone altering a stored row
        directly in the database, so you can watch verification catch it. Reset restores the seeded data.
      </p>
      {!enabled ? (
        <p className="notice notice-warn mb-3 text-sm">
          These controls are switched off. Start the server with <code className="mono">ENABLE_DEMO_CONTROLS=1</code> to
          use them.
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          className="btn"
          disabled={busy || !enabled}
          onClick={() => call("/api/demo/tamper", "An audit entry was altered out-of-band. Verification above should now fail.")}
        >
          Simulate out-of-band tampering
        </button>
        <button
          type="button"
          className="btn"
          disabled={busy || !enabled}
          onClick={() => call("/api/demo/reset", "Demo data reset to the seeded state.")}
        >
          Reset demo data
        </button>
      </div>
      <div aria-live="polite" className="mt-3 text-sm">
        {message ? <p>{message}</p> : null}
        {error ? (
          <p role="alert" style={{ color: "var(--bad-fg)" }}>
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}
