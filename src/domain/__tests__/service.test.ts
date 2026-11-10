import { describe, expect, it } from "vitest";
import {
  ConflictError,
  ForbiddenError,
  IdempotencyConflictError,
  IllegalTransitionError,
  NotFoundError,
  ValidationError,
} from "../errors";
import { SimulatedExecutor } from "../executor";
import { addressInput, admin, makeApp, operator, refundInput, replyInput, reviewerA, reviewerB } from "./helpers";

describe("submission and policy routing", () => {
  it("auto-approves small refunds without human involvement", async () => {
    const app = makeApp();
    const { proposal } = await app.service.submit(refundInput(2000));
    expect(proposal.status).toBe("approved");
    expect(proposal.policy.outcome).toBe("auto_approve");
    expect(proposal.expiresAt).toBeNull();
    const { timeline } = await app.service.get(proposal.id);
    expect(timeline.map((e) => e.type)).toEqual(["proposal_submitted", "policy_evaluated", "approved"]);
    expect(timeline[2].actor).toBe("policy-engine");
  });

  it("parks medium refunds as pending with a deadline", async () => {
    const app = makeApp();
    const { proposal } = await app.service.submit(refundInput(8000));
    expect(proposal.status).toBe("pending_approval");
    expect(proposal.policy.requiredApprovals).toBe(1);
    expect(proposal.expiresAt).toBe("2026-03-02T12:00:00.000Z");
  });

  it("rejects policy-denied proposals immediately and records why", async () => {
    const app = makeApp();
    const { proposal } = await app.service.submit(addressInput("shipped"));
    expect(proposal.status).toBe("rejected");
    expect(proposal.rejection).toMatchObject({ source: "policy", by: "policy-engine" });
    expect(proposal.rejection?.reason).toMatch(/already shipped/);
  });

  it("rejects invalid submissions with a ValidationError and writes nothing", async () => {
    const app = makeApp();
    await expect(app.service.submit({ ...refundInput(100), payload: {} })).rejects.toBeInstanceOf(ValidationError);
    expect(app.repo.auditLength).toBe(0);
  });

  it("submission is idempotent: same key and content returns the original", async () => {
    const app = makeApp();
    const input = refundInput(8000);
    const first = await app.service.submit(input);
    const second = await app.service.submit(input);
    expect(second.deduplicated).toBe(true);
    expect(second.proposal.id).toBe(first.proposal.id);
    expect((await app.service.list()).length).toBe(1);
    expect(app.repo.auditLength).toBe(2); // submitted + policy_evaluated, written once
  });

  it("concurrent identical submissions create exactly one proposal", async () => {
    const app = makeApp();
    const input = refundInput(8000);
    const results = await Promise.all([app.service.submit(input), app.service.submit(input), app.service.submit(input)]);
    expect(new Set(results.map((r) => r.proposal.id)).size).toBe(1);
    expect(results.filter((r) => !r.deduplicated)).toHaveLength(1);
  });

  it("reusing a key with different content is a conflict", async () => {
    const app = makeApp();
    const input = refundInput(8000);
    await app.service.submit(input);
    await expect(app.service.submit({ ...input, payload: { ...input.payload, amountCents: 9000 } })).rejects.toBeInstanceOf(
      IdempotencyConflictError,
    );
  });
});

describe("decisions", () => {
  it("one approval satisfies a needs_approval proposal", async () => {
    const app = makeApp();
    const { proposal } = await app.service.submit(refundInput(8000));
    const approved = await app.service.decide(proposal.id, reviewerA, { kind: "approve", comment: "Looks right." });
    expect(approved.status).toBe("approved");
    expect(approved.expiresAt).toBeNull();
    expect(approved.approvals).toHaveLength(1);
  });

  it("an agent cannot approve, and the refusal is audited", async () => {
    const app = makeApp();
    const { proposal } = await app.service.submit(refundInput(8000));
    await expect(app.service.decide(proposal.id, operator, { kind: "approve" })).rejects.toBeInstanceOf(ForbiddenError);
    const { proposal: after, timeline } = await app.service.get(proposal.id);
    expect(after.status).toBe("pending_approval");
    expect(timeline.at(-1)).toMatchObject({ type: "decision_refused", actor: operator.id });
  });

  it("the proposing agent cannot approve its own proposal even if it were a reviewer", async () => {
    const app = makeApp();
    const { proposal } = await app.service.submit(refundInput(8000));
    const impostor = { id: proposal.agentId, kind: "reviewer" as const };
    await expect(app.service.decide(proposal.id, impostor, { kind: "approve" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("the two-approver rule requires two DISTINCT reviewers", async () => {
    const app = makeApp();
    const { proposal } = await app.service.submit(refundInput(30_000));
    expect(proposal.policy.requiredApprovals).toBe(2);

    const afterFirst = await app.service.decide(proposal.id, reviewerA, { kind: "approve" });
    expect(afterFirst.status).toBe("pending_approval");

    await expect(app.service.decide(proposal.id, reviewerA, { kind: "approve" })).rejects.toBeInstanceOf(ForbiddenError);
    expect((await app.service.get(proposal.id)).proposal.status).toBe("pending_approval");

    const afterSecond = await app.service.decide(proposal.id, reviewerB, { kind: "approve" });
    expect(afterSecond.status).toBe("approved");
    expect(afterSecond.approvals.map((a) => a.reviewerId)).toEqual(["reviewer-a", "reviewer-b"]);
  });

  it("an admin counts as a distinct second reviewer", async () => {
    const app = makeApp();
    const { proposal } = await app.service.submit(refundInput(30_000));
    await app.service.decide(proposal.id, reviewerA, { kind: "approve" });
    expect((await app.service.decide(proposal.id, admin, { kind: "approve" })).status).toBe("approved");
  });

  it("reject requires a reason", async () => {
    const app = makeApp();
    const { proposal } = await app.service.submit(refundInput(8000));
    await expect(app.service.decide(proposal.id, reviewerA, { kind: "reject", reason: "   " })).rejects.toBeInstanceOf(ValidationError);
    const rejected = await app.service.decide(proposal.id, reviewerA, { kind: "reject", reason: "Outside the return window." });
    expect(rejected.status).toBe("rejected");
    expect(rejected.rejection).toMatchObject({ by: "reviewer-a", source: "reviewer", reason: "Outside the return window." });
  });

  it("cannot decide on a proposal that is not pending", async () => {
    const app = makeApp();
    const { proposal } = await app.service.submit(refundInput(8000));
    await app.service.decide(proposal.id, reviewerA, { kind: "approve" });
    await expect(app.service.decide(proposal.id, reviewerB, { kind: "reject", reason: "late" })).rejects.toBeInstanceOf(IllegalTransitionError);
    await expect(app.service.decide("PR-9999", reviewerA, { kind: "approve" })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("edit-then-approve", () => {
  it("records the diff and re-evaluates policy on the edited payload", async () => {
    const app = makeApp();
    const { proposal } = await app.service.submit(refundInput(30_000));
    expect(proposal.policy.outcome).toBe("needs_two_approvals");

    const edited = await app.service.decide(proposal.id, reviewerA, {
      kind: "edit_approve",
      payload: { ...proposal.payload, amountCents: 8000 },
    });
    expect(edited.payload).toMatchObject({ amountCents: 8000 });
    expect(edited.originalPayload).toMatchObject({ amountCents: 30_000 });
    expect(edited.policy.outcome).toBe("needs_approval");
    expect(edited.edits[0]).toMatchObject({
      revision: 1,
      by: "reviewer-a",
      policyBefore: "needs_two_approvals",
      policyAfter: "needs_approval",
      diff: [{ path: "amountCents", before: 30_000, after: 8000 }],
    });
    // The editor's approval satisfies the now-lower requirement.
    expect(edited.status).toBe("approved");
  });

  it("invalidates earlier approvals when the payload changes", async () => {
    const app = makeApp();
    const { proposal } = await app.service.submit(refundInput(30_000));
    await app.service.decide(proposal.id, reviewerA, { kind: "approve" });

    // Reviewer B trims the amount but it still needs two approvals.
    const edited = await app.service.decide(proposal.id, reviewerB, {
      kind: "edit_approve",
      payload: { ...proposal.payload, amountCents: 28_000 },
    });
    expect(edited.status).toBe("pending_approval");
    expect(edited.edits[0].approvalsInvalidated).toBe(1);

    // A's approval of the old payload does not count; A must approve again.
    const final = await app.service.decide(proposal.id, reviewerA, { kind: "approve" });
    expect(final.status).toBe("approved");
    expect(final.approvals.filter((a) => a.payloadRevision === 1).map((a) => a.reviewerId)).toEqual(["reviewer-b", "reviewer-a"]);
  });

  it("an edit that raises the amount escalates the requirement", async () => {
    const app = makeApp();
    const { proposal } = await app.service.submit(refundInput(8000));
    const edited = await app.service.decide(proposal.id, reviewerA, {
      kind: "edit_approve",
      payload: { ...proposal.payload, amountCents: 40_000 },
    });
    expect(edited.policy.outcome).toBe("needs_two_approvals");
    expect(edited.status).toBe("pending_approval");
  });

  it("a reviewer cannot edit shipmentStatus to sidestep the deny rule", async () => {
    const app = makeApp();
    const { proposal } = await app.service.submit(addressInput("not_shipped"));
    await expect(
      app.service.decide(proposal.id, reviewerA, {
        kind: "edit_approve",
        payload: { ...proposal.payload, shipmentStatus: "shipped" },
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("denies when the edited payload violates a deny rule", async () => {
    const { createApp } = await import("../app");
    const { DEFAULT_POLICY } = await import("../policy-config");
    const policy = {
      ...DEFAULT_POLICY,
      rules: [
        ...DEFAULT_POLICY.rules,
        {
          id: "refund-hard-cap",
          actionType: "issue_refund" as const,
          description: "No refund above $500",
          when: { op: "gt" as const, field: "amountCents", value: 50_000 },
          outcome: "deny" as const,
          reasonCode: "REFUND_OVER_HARD_CAP",
          message: "Refund exceeds the $500.00 hard cap.",
        },
      ],
    };
    const app = createApp({ policy });
    const { proposal } = await app.service.submit(refundInput(8000));
    const result = await app.service.decide(proposal.id, reviewerA, {
      kind: "edit_approve",
      payload: { ...proposal.payload, amountCents: 60_000 },
    });
    expect(result.status).toBe("rejected");
    expect(result.rejection).toMatchObject({ source: "policy" });
    const { timeline } = await app.service.get(proposal.id);
    expect(timeline.map((e) => e.type)).toEqual(["proposal_submitted", "policy_evaluated", "payload_edited", "policy_evaluated", "rejected"]);
  });

  it("refuses edits to identifying fields and no-op edits", async () => {
    const app = makeApp();
    const { proposal } = await app.service.submit(refundInput(8000));
    await expect(
      app.service.decide(proposal.id, reviewerA, { kind: "edit_approve", payload: { ...proposal.payload, orderId: "ORD-999999" } }),
    ).rejects.toMatchObject({ issues: [{ path: "payload.orderId" }] });
    await expect(
      app.service.decide(proposal.id, reviewerA, { kind: "edit_approve", payload: { ...proposal.payload } }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      app.service.decide(proposal.id, reviewerA, { kind: "edit_approve", payload: { ...proposal.payload, amountCents: -5 } }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect((await app.service.get(proposal.id)).proposal.status).toBe("pending_approval");
  });

  it("an edited reply is re-checked for risky content", async () => {
    const app = makeApp();
    const { proposal } = await app.service.submit(replyInput("We guarantee a full refund."));
    expect(proposal.policy.outcome).toBe("needs_approval");
    const edited = await app.service.decide(proposal.id, reviewerA, {
      kind: "edit_approve",
      payload: { ...proposal.payload, body: "Thanks for writing in; we are looking into it." },
    });
    expect(edited.policy.outcome).toBe("auto_approve");
    expect(edited.status).toBe("approved");
  });
});

describe("expiry", () => {
  it("expires stale pending proposals using the injected clock", async () => {
    const app = makeApp();
    const { proposal } = await app.service.submit(refundInput(8000));
    app.advance(23 * 3600_000);
    expect((await app.service.get(proposal.id)).proposal.status).toBe("pending_approval");
    app.advance(2 * 3600_000);
    const { proposal: after, timeline } = await app.service.get(proposal.id);
    expect(after.status).toBe("expired");
    expect(timeline.at(-1)?.type).toBe("expired");
    await expect(app.service.decide(proposal.id, reviewerA, { kind: "approve" })).rejects.toBeInstanceOf(IllegalTransitionError);
  });

  it("does not expire approved proposals and honours a custom TTL", async () => {
    const app = makeApp(undefined, 60_000);
    const { proposal } = await app.service.submit(refundInput(8000));
    const other = await app.service.submit(refundInput(9000));
    await app.service.decide(other.proposal.id, reviewerA, { kind: "approve" });
    app.advance(61_000);
    const list = await app.service.list();
    expect(list.find((p) => p.id === proposal.id)?.status).toBe("expired");
    expect(list.find((p) => p.id === other.proposal.id)?.status).toBe("approved");
  });
});

describe("execution", () => {
  it("refuses to execute anything that is not approved", async () => {
    const app = makeApp();
    const { proposal } = await app.service.submit(refundInput(8000));
    await expect(app.service.execute(proposal.id, operator)).rejects.toBeInstanceOf(IllegalTransitionError);
    expect(app.executor.sideEffectCount).toBe(0);
  });

  it("executes an approved action once and records a receipt", async () => {
    const app = makeApp();
    const { proposal } = await app.service.submit(refundInput(2000));
    const res = await app.service.execute(proposal.id, operator);
    expect(res).toMatchObject({ performed: true, outcome: "executed" });
    expect(res.proposal.status).toBe("executed");
    expect(res.proposal.execution.receipt?.effect).toMatch(/refund of \$20\.00/);
    expect(app.executor.sideEffectCount).toBe(1);
  });

  it("executing twice (sequentially) performs the side effect once", async () => {
    const app = makeApp();
    const { proposal } = await app.service.submit(refundInput(2000));
    await app.service.execute(proposal.id, operator);
    const again = await app.service.execute(proposal.id, operator);
    expect(again).toMatchObject({ performed: false, outcome: "already_executed" });
    expect(app.executor.sideEffectCount).toBe(1);
  });

  it("concurrent double-click: many simultaneous executes yield exactly one side effect", async () => {
    const app = makeApp();
    const { proposal } = await app.service.submit(refundInput(2000));
    const results = await Promise.all(Array.from({ length: 8 }, () => app.service.execute(proposal.id, operator)));
    expect(app.executor.sideEffectCount).toBe(1);
    expect(results.filter((r) => r.performed)).toHaveLength(1);
    expect(results.every((r) => ["executed", "already_executed", "in_progress"].includes(r.outcome))).toBe(true);
    const { timeline } = await app.service.get(proposal.id);
    expect(timeline.filter((e) => e.type === "execution_started")).toHaveLength(1);
    expect(timeline.filter((e) => e.type === "execution_succeeded")).toHaveLength(1);
  });

  it("records executor failures and allows a retry that succeeds", async () => {
    const app = makeApp();
    const { proposal } = await app.service.submit(refundInput(2000, {}, { orderId: "ORD-FLAKY-0001" }));
    const first = await app.service.execute(proposal.id, operator);
    expect(first).toMatchObject({ performed: true, outcome: "failed" });
    expect(first.proposal.status).toBe("failed");
    expect(first.proposal.execution).toMatchObject({ attempts: 1 });
    expect(first.proposal.execution.lastError).toMatch(/timeout/);
    expect(app.executor.sideEffectCount).toBe(0);

    const second = await app.service.execute(proposal.id, operator);
    expect(second).toMatchObject({ performed: true, outcome: "executed" });
    expect(second.proposal.execution.attempts).toBe(2);
    expect(second.proposal.execution.lastError).toBeUndefined();
    expect(app.executor.sideEffectCount).toBe(1);

    const { timeline } = await app.service.get(proposal.id);
    expect(timeline.map((e) => e.type).slice(-4)).toEqual([
      "execution_started",
      "execution_failed",
      "execution_started",
      "execution_succeeded",
    ]);
  });

  it("the executor itself honours the idempotency key", async () => {
    const executor = new SimulatedExecutor(() => new Date("2026-03-01T00:00:00Z"));
    const req = {
      proposalId: "PR-1",
      type: "issue_refund" as const,
      payload: { orderId: "ORD-100001", amountCents: 100, currency: "USD" as const, reasonCode: "late" as const },
      idempotencyKey: "key-1",
      attempt: 1,
    };
    const a = await executor.execute(req);
    const b = await executor.execute({ ...req, attempt: 2 });
    expect(b).toEqual(a);
    expect(executor.sideEffectCount).toBe(1);
  });

  it("a stale-version write is rejected (compare-and-set)", async () => {
    const app = makeApp();
    const { proposal } = await app.service.submit(refundInput(8000));
    const stale = { ...proposal, status: "approved" as const, version: proposal.version + 1 };
    await app.repo.commit({ proposal: stale, expectedVersion: proposal.version, audit: [] });
    await expect(app.repo.commit({ proposal: stale, expectedVersion: proposal.version, audit: [] })).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("audit trail through the service", () => {
  it("records a verifiable chain across a full lifecycle", async () => {
    const app = makeApp();
    const { proposal } = await app.service.submit(refundInput(30_000));
    await app.service.decide(proposal.id, reviewerA, { kind: "approve" });
    await app.service.decide(proposal.id, reviewerB, { kind: "approve" });
    await app.service.execute(proposal.id, operator);
    const report = await app.service.auditReport();
    expect(report.verification).toMatchObject({ valid: true });
    expect(report.entries.map((e) => e.type)).toEqual([
      "proposal_submitted",
      "policy_evaluated",
      "approval_recorded",
      "approval_recorded",
      "approved",
      "execution_started",
      "execution_succeeded",
    ]);
  });

  it("detects tampering with a stored entry", async () => {
    const app = makeApp();
    const { proposal } = await app.service.submit(refundInput(8000));
    await app.service.decide(proposal.id, reviewerA, { kind: "approve" });
    expect((await app.service.auditReport()).verification.valid).toBe(true);
    expect(app.repo.tamperWithAuditEntryForDemo(3)).toBe(true);
    const report = await app.service.auditReport();
    expect(report.verification).toMatchObject({ valid: false, firstInvalidSeq: 3 });
  });

  it("returns copies: mutating a result does not alter stored state", async () => {
    const app = makeApp();
    const { proposal } = await app.service.submit(refundInput(8000));
    (proposal.payload as { amountCents: number }).amountCents = 1;
    expect(((await app.service.get(proposal.id)).proposal.payload as { amountCents: number }).amountCents).toBe(8000);
  });
});

describe("listing", () => {
  it("filters by status and risk and counts both", async () => {
    const app = makeApp();
    await app.service.submit(refundInput(2000));
    await app.service.submit(refundInput(8000));
    await app.service.submit(refundInput(30_000));
    await app.service.submit(addressInput("delivered"));

    expect(await app.service.list({ status: "pending_approval" })).toHaveLength(2);
    expect(await app.service.list({ risk: "deny" })).toHaveLength(1);
    expect(await app.service.list({ search: "TKT-1003" })).toHaveLength(1);

    const counts = await app.service.counts();
    expect(counts.total).toBe(4);
    expect(counts.byStatus).toMatchObject({ approved: 1, pending_approval: 2, rejected: 1, executed: 0 });
    expect(counts.byRisk).toEqual({ auto_approve: 1, needs_approval: 1, needs_two_approvals: 1, deny: 1 });
  });
});
