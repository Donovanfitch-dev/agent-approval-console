import { verifyChain, type ChainVerification } from "./audit";
import {
  ConflictError,
  ForbiddenError,
  IdempotencyConflictError,
  IllegalTransitionError,
  NotFoundError,
  ValidationError,
} from "./errors";
import { diffPayload } from "./diff";
import type { Executor } from "./executor";
import { IMMUTABLE_FIELDS, validatePayload } from "./payloads";
import { evaluatePolicy, summarizePolicy, type PolicyConfig } from "./policy";
import type { ProposalRepository } from "./repository";
import { transition } from "./state-machine";
import { submissionHash, validateSubmission } from "./submission";
import {
  POLICY_OUTCOMES,
  STATUSES,
  type Actor,
  type AuditDraft,
  type AuditEntry,
  type AuditEventType,
  type ExecutionReceipt,
  type JsonValue,
  type Payload,
  type PolicyOutcome,
  type PolicyResult,
  type Proposal,
  type Status,
} from "./types";

export const SYSTEM_ACTOR = "system";
export const POLICY_ACTOR = "policy-engine";
export const DEFAULT_PENDING_TTL_MS = 24 * 60 * 60 * 1000;

export interface ServiceDeps {
  repo: ProposalRepository;
  executor: Executor;
  policy: PolicyConfig;
  /** Injectable clock; every timestamp and expiry decision flows through it. */
  clock: () => Date;
  nextId: () => string;
  /** How long a proposal may wait for review before it expires. */
  pendingTtlMs?: number;
}

export type Decision =
  | { kind: "approve"; comment?: string }
  | { kind: "reject"; reason: string }
  | { kind: "edit_approve"; payload: unknown; comment?: string };

export interface SubmitResult {
  proposal: Proposal;
  /** True when the idempotency key matched an earlier identical submission. */
  deduplicated: boolean;
}

export type ExecuteOutcome = "executed" | "failed" | "already_executed" | "in_progress";

export interface ExecuteResult {
  proposal: Proposal;
  /** True only if THIS call ran the executor. */
  performed: boolean;
  outcome: ExecuteOutcome;
}

export interface ListFilter {
  status?: Status;
  risk?: PolicyOutcome;
  search?: string;
}

export interface Counts {
  total: number;
  byStatus: Record<Status, number>;
  byRisk: Record<PolicyOutcome, number>;
}

export interface ProposalDetail {
  proposal: Proposal;
  timeline: AuditEntry[];
}

export interface AuditReport {
  entries: AuditEntry[];
  verification: ChainVerification;
}

/** Convert arbitrary serialisable data to a JsonValue (drops undefined). */
function toJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as JsonValue;
}

function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

export function sequentialIds(prefix: string, start = 1001): () => string {
  let n = start;
  return () => `${prefix}-${n++}`;
}

export function distinctApprovers(proposal: Proposal): string[] {
  return [
    ...new Set(
      proposal.approvals
        .filter((a) => a.payloadRevision === proposal.payloadRevision)
        .map((a) => a.reviewerId),
    ),
  ];
}

/**
 * The application service: orchestrates validation, policy, the state
 * machine, the repository, the executor, and the audit trail. It is
 * framework-free: no HTTP, no cookies, no React.
 */
export class ApprovalService {
  private readonly ttlMs: number;

  constructor(private readonly deps: ServiceDeps) {
    this.ttlMs = deps.pendingTtlMs ?? DEFAULT_PENDING_TTL_MS;
  }

  private now(): Date {
    return this.deps.clock();
  }

  private audit(
    proposalId: string | null,
    type: AuditEventType,
    actor: string,
    at: string,
    data: Record<string, unknown>,
  ): AuditDraft {
    return { proposalId, type, actor, at, data: toJson(data) as { [key: string]: JsonValue } };
  }

  private policyDraft(proposalId: string, at: string, result: PolicyResult): AuditDraft {
    return this.audit(proposalId, "policy_evaluated", POLICY_ACTOR, at, {
      outcome: result.outcome,
      requiredApprovals: result.requiredApprovals,
      policyVersion: result.policyVersion,
      reasons: result.reasons,
    });
  }

  private async require(id: string): Promise<Proposal> {
    const found = await this.deps.repo.getProposal(id);
    if (!found) throw new NotFoundError(`Proposal ${id} not found`);
    return found;
  }

  // ---------------------------------------------------------------- submit

  async submit(input: unknown): Promise<SubmitResult> {
    const sub = validateSubmission(input);
    const hash = submissionHash(sub);

    const dedupe = async (): Promise<SubmitResult | undefined> => {
      const existing = await this.deps.repo.findByIdempotencyKey(sub.idempotencyKey);
      if (!existing) return undefined;
      if (existing.submissionHash !== hash) {
        throw new IdempotencyConflictError(
          `Idempotency key "${sub.idempotencyKey}" was already used for a different proposal (${existing.id})`,
        );
      }
      return { proposal: existing, deduplicated: true };
    };

    const prior = await dedupe();
    if (prior) return prior;

    const now = this.now();
    const at = now.toISOString();
    const policy = evaluatePolicy(sub.type, sub.payload, this.deps.policy);
    const id = this.deps.nextId();

    let status: Status = "proposed";
    const drafts: AuditDraft[] = [
      this.audit(id, "proposal_submitted", sub.agentId, at, {
        type: sub.type,
        ticketId: sub.ticketId,
        rationale: sub.rationale,
        payload: sub.payload,
        idempotencyKey: sub.idempotencyKey,
      }),
      this.policyDraft(id, at, policy),
    ];

    let rejection: Proposal["rejection"];
    if (policy.outcome === "auto_approve") {
      status = transition(status, "approved");
      drafts.push(this.audit(id, "approved", POLICY_ACTOR, at, { via: "auto_approve" }));
    } else if (policy.outcome === "deny") {
      status = transition(status, "rejected");
      const reason = summarizePolicy(policy);
      rejection = { by: POLICY_ACTOR, at, reason, source: "policy" };
      drafts.push(this.audit(id, "rejected", POLICY_ACTOR, at, { source: "policy", reason }));
    } else {
      status = transition(status, "pending_approval");
    }

    const proposal: Proposal = {
      id,
      type: sub.type,
      payload: sub.payload,
      originalPayload: structuredClone(sub.payload),
      payloadRevision: 0,
      rationale: sub.rationale,
      ticketId: sub.ticketId,
      agentId: sub.agentId,
      idempotencyKey: sub.idempotencyKey,
      submissionHash: hash,
      status,
      policy,
      createdAt: at,
      updatedAt: at,
      expiresAt: status === "pending_approval" ? new Date(now.getTime() + this.ttlMs).toISOString() : null,
      approvals: [],
      edits: [],
      ...(rejection ? { rejection } : {}),
      execution: { attempts: 0 },
      version: 1,
    };

    try {
      const result = await this.deps.repo.commit({ proposal, expectedVersion: null, audit: drafts });
      return { proposal: result.proposal, deduplicated: false };
    } catch (e) {
      if (e instanceof IdempotencyConflictError) {
        const raced = await dedupe();
        if (raced) return raced;
      }
      throw e;
    }
  }

  // ---------------------------------------------------------------- decide

  /**
   * Record a refused attempt and throw. The only side effect of a refusal is
   * this one audit entry. `proposalId` is whatever the caller supplied (capped
   * in length), so a refusal reads the same whether or not the proposal exists.
   */
  private async refuse(proposalId: string, actor: Actor, attempted: string, message: string): Promise<never> {
    await this.deps.repo.appendAudit([
      this.audit(proposalId.slice(0, 64), "decision_refused", actor.id, this.now().toISOString(), {
        attempted,
        reason: message,
      }),
    ]);
    throw new ForbiddenError(message);
  }

  async decide(id: string, actor: Actor, decision: Decision): Promise<Proposal> {
    // Authorize by role BEFORE any state change (expiry sweep) or existence check,
    // so an unauthorized caller cannot probe which proposals exist or what state they are in.
    if (actor.kind === "agent") {
      await this.refuse(id, actor, decision.kind, "Agents cannot review proposals; a human reviewer must decide.");
    }
    await this.expireStale();
    const proposal = await this.require(id);
    if (actor.id === proposal.agentId) {
      await this.refuse(id, actor, decision.kind, "The proposing agent cannot review its own proposal.");
    }

    const target: Status = decision.kind === "reject" ? "rejected" : "approved";
    if (proposal.status !== "pending_approval") {
      throw new IllegalTransitionError(proposal.status, target);
    }

    switch (decision.kind) {
      case "approve":
        return this.approve(proposal, actor, decision.comment);
      case "reject":
        return this.reject(proposal, actor, decision.reason);
      case "edit_approve":
        return this.editAndApprove(proposal, actor, decision.payload, decision.comment);
    }
  }

  private cleanComment(comment: string | undefined): string | undefined {
    const c = comment?.trim();
    if (!c) return undefined;
    if (c.length > 500) throw new ValidationError([{ path: "comment", message: "must be at most 500 characters" }]);
    return c;
  }

  private async approve(proposal: Proposal, actor: Actor, rawComment?: string): Promise<Proposal> {
    const comment = this.cleanComment(rawComment);
    const already = proposal.approvals.some(
      (a) => a.reviewerId === actor.id && a.payloadRevision === proposal.payloadRevision,
    );
    if (already) {
      throw new ForbiddenError(
        "You have already approved this proposal. A distinct second reviewer is required, not a repeat approval.",
      );
    }
    const at = this.now().toISOString();
    const next: Proposal = {
      ...proposal,
      approvals: [
        ...proposal.approvals,
        { reviewerId: actor.id, at, payloadRevision: proposal.payloadRevision, ...(comment ? { comment } : {}) },
      ],
    };
    return this.settleApprovals(proposal, next, actor, at);
  }

  /** Shared tail of approve / edit-approve: record progress and approve if satisfied. */
  private async settleApprovals(
    before: Proposal,
    next: Proposal,
    actor: Actor,
    at: string,
    leadingDrafts: AuditDraft[] = [],
  ): Promise<Proposal> {
    const approvers = distinctApprovers(next);
    const required = next.policy.requiredApprovals;
    const drafts: AuditDraft[] = [
      ...leadingDrafts,
      this.audit(next.id, "approval_recorded", actor.id, at, {
        payloadRevision: next.payloadRevision,
        approvers,
        required,
      }),
    ];
    let status = next.status;
    let expiresAt = next.expiresAt;
    if (approvers.length >= required) {
      status = transition(next.status, "approved");
      expiresAt = null;
      drafts.push(this.audit(next.id, "approved", actor.id, at, { approvers }));
    }
    const saved: Proposal = { ...next, status, expiresAt, updatedAt: at, version: before.version + 1 };
    const result = await this.deps.repo.commit({ proposal: saved, expectedVersion: before.version, audit: drafts });
    return result.proposal;
  }

  private async reject(proposal: Proposal, actor: Actor, rawReason: string): Promise<Proposal> {
    const reason = typeof rawReason === "string" ? rawReason.trim() : "";
    if (!reason) throw new ValidationError([{ path: "reason", message: "a reason is required to reject" }]);
    if (reason.length > 500) throw new ValidationError([{ path: "reason", message: "must be at most 500 characters" }]);
    const at = this.now().toISOString();
    const saved: Proposal = {
      ...proposal,
      status: transition(proposal.status, "rejected"),
      expiresAt: null,
      rejection: { by: actor.id, at, reason, source: "reviewer" },
      updatedAt: at,
      version: proposal.version + 1,
    };
    const result = await this.deps.repo.commit({
      proposal: saved,
      expectedVersion: proposal.version,
      audit: [this.audit(proposal.id, "rejected", actor.id, at, { source: "reviewer", reason })],
    });
    return result.proposal;
  }

  private async editAndApprove(
    proposal: Proposal,
    actor: Actor,
    rawPayload: unknown,
    rawComment?: string,
  ): Promise<Proposal> {
    const comment = this.cleanComment(rawComment);
    const edited = validatePayload(proposal.type, rawPayload) as Payload;

    const locked = IMMUTABLE_FIELDS[proposal.type]
      .filter((path) => getPath(edited, path) !== getPath(proposal.payload, path))
      .map((path) => ({ path: `payload.${path}`, message: "cannot be changed by a reviewer" }));
    if (locked.length > 0) throw new ValidationError(locked);

    const diff = diffPayload(proposal.payload, edited);
    if (diff.length === 0) {
      throw new ValidationError([{ path: "payload", message: "no changes: use Approve instead" }]);
    }

    const at = this.now().toISOString();
    const policyAfter = evaluatePolicy(proposal.type, edited, this.deps.policy);
    const revision = proposal.payloadRevision + 1;
    const invalidated = distinctApprovers(proposal).length;

    const editRecord = {
      revision,
      by: actor.id,
      at,
      diff,
      policyBefore: proposal.policy.outcome,
      policyAfter: policyAfter.outcome,
      approvalsInvalidated: invalidated,
    };
    const leading: AuditDraft[] = [
      this.audit(proposal.id, "payload_edited", actor.id, at, editRecord),
      this.policyDraft(proposal.id, at, policyAfter),
    ];

    const base: Proposal = {
      ...proposal,
      payload: edited,
      payloadRevision: revision,
      policy: policyAfter,
      edits: [...proposal.edits, editRecord],
    };

    // The edited payload is now itself denied by policy: the edit ends the proposal.
    if (policyAfter.outcome === "deny") {
      const reason = summarizePolicy(policyAfter);
      const saved: Proposal = {
        ...base,
        status: transition(base.status, "rejected"),
        expiresAt: null,
        rejection: { by: POLICY_ACTOR, at, reason, source: "policy" },
        updatedAt: at,
        version: proposal.version + 1,
      };
      const result = await this.deps.repo.commit({
        proposal: saved,
        expectedVersion: proposal.version,
        audit: [...leading, this.audit(proposal.id, "rejected", POLICY_ACTOR, at, { source: "policy", reason })],
      });
      return result.proposal;
    }

    // Approvals given to the previous payload do not carry over; the editor's approval does.
    const next: Proposal = {
      ...base,
      approvals: [
        ...proposal.approvals,
        { reviewerId: actor.id, at, payloadRevision: revision, ...(comment ? { comment } : {}) },
      ],
    };
    return this.settleApprovals(proposal, next, actor, at, leading);
  }

  // --------------------------------------------------------------- execute

  /**
   * Run an approved proposal's side effect. Only reviewers and admins may
   * trigger execution: an agent must not be able to cause the effect it
   * proposed. (There is no separate "system" executor path; auto-approved
   * proposals also wait for a reviewer or admin to execute them.)
   */
  async execute(id: string, actor: Actor): Promise<ExecuteResult> {
    if (actor.kind === "agent") {
      await this.refuse(id, actor, "execute", "Agents cannot trigger execution; a reviewer or admin must run approved actions.");
    }
    for (let tries = 0; tries < 3; tries++) {
      const proposal = await this.require(id);

      if (proposal.status === "executed") return { proposal, performed: false, outcome: "already_executed" };
      if (proposal.status === "executing") return { proposal, performed: false, outcome: "in_progress" };
      transition(proposal.status, "executing"); // throws for pending, rejected, expired, ...

      const attempt = proposal.execution.attempts + 1;
      const startedAt = this.now().toISOString();
      const execution = { ...proposal.execution, attempts: attempt };
      delete execution.lastError;
      const claimed: Proposal = {
        ...proposal,
        status: "executing",
        execution,
        updatedAt: startedAt,
        version: proposal.version + 1,
      };

      // Compare-and-set claim: of N concurrent callers, exactly one wins this commit.
      let claimedState: Proposal;
      try {
        const res = await this.deps.repo.commit({
          proposal: claimed,
          expectedVersion: proposal.version,
          audit: [this.audit(id, "execution_started", actor.id, startedAt, { attempt })],
        });
        claimedState = res.proposal;
      } catch (e) {
        if (e instanceof ConflictError) continue; // lost the race; re-read and report the winner's state
        throw e;
      }

      // The side effect runs outside any storage transaction: it is the one step
      // that cannot be rolled back, which is why it sits behind the claim above
      // and why the executor itself must honour the idempotency key.
      let receipt: ExecutionReceipt | undefined;
      let errorMessage = "";
      try {
        receipt = await this.deps.executor.execute({
          proposalId: id,
          type: claimedState.type,
          payload: claimedState.payload,
          idempotencyKey: claimedState.idempotencyKey,
          attempt,
        });
      } catch (e) {
        errorMessage = e instanceof Error ? e.message : "Unknown executor error";
      }

      const at = this.now().toISOString();
      if (receipt) {
        const done: Proposal = {
          ...claimedState,
          status: transition(claimedState.status, "executed"),
          execution: { attempts: attempt, receipt },
          updatedAt: at,
          version: claimedState.version + 1,
        };
        const res = await this.deps.repo.commit({
          proposal: done,
          expectedVersion: claimedState.version,
          audit: [this.audit(id, "execution_succeeded", actor.id, at, { attempt, receipt })],
        });
        return { proposal: res.proposal, performed: true, outcome: "executed" };
      }
      const failed: Proposal = {
        ...claimedState,
        status: transition(claimedState.status, "failed"),
        execution: { attempts: attempt, lastError: errorMessage },
        updatedAt: at,
        version: claimedState.version + 1,
      };
      const res = await this.deps.repo.commit({
        proposal: failed,
        expectedVersion: claimedState.version,
        audit: [this.audit(id, "execution_failed", actor.id, at, { attempt, error: errorMessage })],
      });
      return { proposal: res.proposal, performed: true, outcome: "failed" };
    }
    throw new ConflictError(`Proposal ${id} is being modified concurrently; try again`);
  }

  // ---------------------------------------------------------------- expiry

  /** Expire every pending proposal whose deadline has passed. Returns the expired ids. */
  async expireStale(): Promise<string[]> {
    const now = this.now();
    const at = now.toISOString();
    const expired: string[] = [];
    for (const p of await this.deps.repo.listProposals()) {
      if (p.status !== "pending_approval" || !p.expiresAt || new Date(p.expiresAt) > now) continue;
      const saved: Proposal = {
        ...p,
        status: transition(p.status, "expired"),
        expiresAt: null,
        updatedAt: at,
        version: p.version + 1,
      };
      try {
        await this.deps.repo.commit({
          proposal: saved,
          expectedVersion: p.version,
          audit: [
            this.audit(p.id, "expired", SYSTEM_ACTOR, at, {
              deadline: p.expiresAt,
              approvalsAtExpiry: distinctApprovers(p).length,
            }),
          ],
        });
        expired.push(p.id);
      } catch (e) {
        if (!(e instanceof ConflictError)) throw e; // someone decided it first; fine
      }
    }
    return expired;
  }

  // ----------------------------------------------------------------- reads

  async list(filter: ListFilter = {}): Promise<Proposal[]> {
    await this.expireStale();
    const needle = filter.search?.trim().toLowerCase();
    return (await this.deps.repo.listProposals())
      .filter((p) => !filter.status || p.status === filter.status)
      .filter((p) => !filter.risk || p.policy.outcome === filter.risk)
      .filter(
        (p) =>
          !needle ||
          [p.id, p.ticketId, p.agentId, p.type].some((field) => field.toLowerCase().includes(needle)),
      )
      .sort((a, b) => (a.createdAt === b.createdAt ? b.id.localeCompare(a.id) : b.createdAt.localeCompare(a.createdAt)));
  }

  async counts(): Promise<Counts> {
    await this.expireStale();
    const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<Status, number>;
    const byRisk = Object.fromEntries(POLICY_OUTCOMES.map((o) => [o, 0])) as Record<PolicyOutcome, number>;
    const all = await this.deps.repo.listProposals();
    for (const p of all) {
      byStatus[p.status] += 1;
      byRisk[p.policy.outcome] += 1;
    }
    return { total: all.length, byStatus, byRisk };
  }

  async get(id: string): Promise<ProposalDetail> {
    await this.expireStale();
    const proposal = await this.require(id);
    const timeline = await this.deps.repo.listAudit({ proposalId: id });
    return { proposal, timeline };
  }

  async auditReport(): Promise<AuditReport> {
    await this.expireStale();
    const entries = await this.deps.repo.listAudit();
    return { entries, verification: verifyChain(entries) };
  }
}

