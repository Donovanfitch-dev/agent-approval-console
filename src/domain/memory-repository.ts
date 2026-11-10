import { buildEntry } from "./audit";
import { ConflictError, IdempotencyConflictError, NotFoundError } from "./errors";
import type { AuditDraft, AuditEntry, Proposal } from "./types";
import type { AuditQuery, CommitResult, ProposalChange, ProposalRepository } from "./repository";

/**
 * In-memory ProposalRepository. Stores deep copies on the way in and out so
 * callers can never mutate stored state by aliasing. All checks run before
 * any mutation, so `commit` is atomic.
 *
 * State lives only as long as the process; there is no persistence.
 */
export class InMemoryRepository implements ProposalRepository {
  private readonly proposals = new Map<string, Proposal>();
  private readonly byKey = new Map<string, string>();
  private readonly audit: AuditEntry[] = [];

  async commit(change: ProposalChange): Promise<CommitResult> {
    const { proposal, expectedVersion, audit } = change;
    const existing = this.proposals.get(proposal.id);

    if (expectedVersion === null) {
      if (existing) throw new ConflictError(`Proposal ${proposal.id} already exists`);
      if (this.byKey.has(proposal.idempotencyKey)) {
        throw new IdempotencyConflictError(`Idempotency key "${proposal.idempotencyKey}" is already in use`);
      }
      if (proposal.version !== 1) throw new ConflictError("A new proposal must have version 1");
    } else {
      if (!existing) throw new NotFoundError(`Proposal ${proposal.id} not found`);
      if (existing.version !== expectedVersion) {
        throw new ConflictError(
          `Proposal ${proposal.id} was modified concurrently (expected version ${expectedVersion}, found ${existing.version})`,
        );
      }
      if (proposal.version !== expectedVersion + 1) {
        throw new ConflictError("Proposal version must increase by exactly one");
      }
    }

    const stored = structuredClone(proposal);
    this.proposals.set(stored.id, stored);
    this.byKey.set(stored.idempotencyKey, stored.id);

    const entries = await this.appendAudit(audit);
    return { proposal: structuredClone(stored), entries };
  }

  async appendAudit(drafts: AuditDraft[]): Promise<AuditEntry[]> {
    const entries: AuditEntry[] = [];
    for (const draft of drafts) {
      const entry = buildEntry(this.audit[this.audit.length - 1], draft);
      this.audit.push(entry);
      entries.push(structuredClone(entry));
    }
    return entries;
  }

  async getProposal(id: string): Promise<Proposal | undefined> {
    const found = this.proposals.get(id);
    return found ? structuredClone(found) : undefined;
  }

  async findByIdempotencyKey(key: string): Promise<Proposal | undefined> {
    const id = this.byKey.get(key);
    return id ? this.getProposal(id) : undefined;
  }

  async listProposals(): Promise<Proposal[]> {
    return [...this.proposals.values()].map((p) => structuredClone(p));
  }

  async listAudit(query: AuditQuery = {}): Promise<AuditEntry[]> {
    const rows = query.proposalId
      ? this.audit.filter((e) => e.proposalId === query.proposalId)
      : this.audit;
    return rows.map((e) => structuredClone(e));
  }

  /**
   * DEMO / TEST ONLY. Simulates someone editing a stored audit row directly in
   * the database, bypassing the application. Used to show that verifyChain
   * detects it. Not part of the ProposalRepository contract.
   */
  tamperWithAuditEntryForDemo(seq: number): boolean {
    const entry = this.audit.find((e) => e.seq === seq);
    if (!entry) return false;
    entry.actor = `${entry.actor} (altered)`;
    return true;
  }

  get auditLength(): number {
    return this.audit.length;
  }
}
