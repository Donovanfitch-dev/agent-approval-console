"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, describeError } from "@/lib/api-client";
import type { Proposal } from "@/domain/types";

interface Props {
  scenarios: { id: string; label: string }[];
}

export function SimulateButton({ scenarios }: Props) {
  const router = useRouter();
  const [scenario, setScenario] = useState("random");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<Proposal | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ proposal: Proposal }>("/api/simulate", { body: { scenario } });
      setCreated(result.proposal);
      router.refresh();
    } catch (e) {
      setCreated(null);
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" aria-labelledby="simulate-heading">
      <h2 id="simulate-heading" className="card-title">
        Simulate agent
      </h2>
      <p className="muted mb-3 text-sm">
        Generates a synthetic proposal as if a support agent had submitted it through the API. No language model is
        involved; it fills templates with random values.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1 basis-64">
          <label htmlFor="scenario" className="field-label">
            Scenario
          </label>
          <select id="scenario" className="field" value={scenario} onChange={(e) => setScenario(e.target.value)}>
            <option value="random">Random</option>
            {scenarios.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <button type="button" className="btn btn-primary" onClick={run} disabled={busy}>
          {busy ? "Submitting…" : "Simulate agent proposal"}
        </button>
      </div>
      <div aria-live="polite" className="mt-3 text-sm">
        {created ? (
          <p>
            Submitted{" "}
            <Link href={`/proposals/${created.id}`} className="font-semibold">
              {created.id}
            </Link>{" "}
            with status <strong>{created.status.replace(/_/g, " ")}</strong>.
          </p>
        ) : null}
        {error ? (
          <p role="alert" style={{ color: "var(--bad-fg)" }}>
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}
