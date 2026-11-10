import { describe, expect, it } from "vitest";
import { createApp } from "../app";
import { createSeededApp } from "../seed";
import { mulberry32, SCENARIO_IDS, simulateSubmission } from "../simulate";

describe("seeded demo data", () => {
  it("builds a valid chain and covers every interesting state", async () => {
    const app = await createSeededApp();
    const counts = await app.service.counts();
    expect(counts.total).toBe(12);
    for (const status of ["pending_approval", "approved", "executed", "failed", "rejected", "expired"] as const) {
      expect(counts.byStatus[status], status).toBeGreaterThan(0);
    }
    const report = await app.service.auditReport();
    expect(report.verification.valid).toBe(true);
    expect(report.entries.some((e) => e.type === "decision_refused")).toBe(true);
    expect(report.entries.some((e) => e.type === "payload_edited")).toBe(true);
  });

  it("is built through the real service, so a clock in the past expires nothing extra", async () => {
    const app = await createSeededApp({ clock: () => new Date("2026-03-01T12:00:00Z") });
    const list = await app.service.list();
    expect(list.filter((p) => p.status === "expired")).toHaveLength(1);
  });
});

describe("simulated agent", () => {
  it("every scenario produces a valid submission with the advertised outcome", async () => {
    const expected: Record<string, string> = {
      refund_small: "auto_approve",
      refund_medium: "needs_approval",
      refund_large: "needs_two_approvals",
      refund_flaky: "needs_approval",
      credit_small: "auto_approve",
      credit_large: "needs_two_approvals",
      reply_safe: "auto_approve",
      reply_risky: "needs_approval",
      address_before_shipment: "needs_approval",
      address_after_shipment: "deny",
    };
    expect(SCENARIO_IDS.sort()).toEqual(Object.keys(expected).sort());
    const app = createApp();
    const rng = mulberry32(42);
    for (const id of SCENARIO_IDS) {
      for (let i = 0; i < 20; i++) {
        const { proposal } = await app.service.submit(simulateSubmission(rng, id));
        expect(proposal.policy.outcome, id).toBe(expected[id]);
      }
    }
  });

  it("random scenarios are reproducible from a seed", () => {
    const a = simulateSubmission(mulberry32(7));
    const b = simulateSubmission(mulberry32(7));
    expect({ ...a, idempotencyKey: "" }).toEqual({ ...b, idempotencyKey: "" });
  });
});
