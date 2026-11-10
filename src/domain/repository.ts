import type { AuditDraft, AuditEntry, Proposal } from "./types";

/**
 * Persistence port for the domain.
 *
 * The contract is deliberately small and database-friendly:
 *
 *  - `commit` is ATOMIC: the proposal write and its audit entries succeed or
 *    fail together. A SQL implementation wraps it in one transaction.
 *  - Writes use optimistic concurrency. The caller passes the version it read
 *    (`expectedVersion`), or `null` for an insert. A stale version raises
 *    ConflictError; this is the compare-and-set that makes concurrent
 *    "execute" calls safe (`UPDATE ... WHERE id = $1 AND version = $2`).
 *  - The idempotency key is unique across proposals (a UNIQUE constraint).
 *  - The repository, not the caller, assigns audit `seq`/`prevHash`/`hash`
 *    (using `buildEntry` from ./audit) so the chain tail is serialised in one
 *    place (`SELECT ... ORDER BY seq DESC LIMIT 1 FOR UPDATE` in Postgres).
 *
 * See docs/design.md for how a Postgres implementation would slot in.
 */
export interface ProposalChange {
  /** Full new state of the proposal; `version` must equal expectedVersion + 1 (or 1 for inserts). */
  proposal: Proposal;
  /** Version previously read, or null when inserting a new proposal. */
  expectedVersion: number | null;
  /** Audit events to append in the same atomic unit. */
  audit: AuditDraft[];
}

export interface CommitResult {
  proposal: Proposal;
  entries: AuditEntry[];
}

export interface AuditQuery {
  proposalId?: string;
}

export interface ProposalRepository {
  commit(change: ProposalChange): Promise<CommitResult>;
  /** Append audit events that are not tied to a proposal state change (e.g. refused attempts). */
  appendAudit(drafts: AuditDraft[]): Promise<AuditEntry[]>;
  getProposal(id: string): Promise<Proposal | undefined>;
  findByIdempotencyKey(key: string): Promise<Proposal | undefined>;
  listProposals(): Promise<Proposal[]>;
  /** Entries in sequence order. The full list is required for chain verification. */
  listAudit(query?: AuditQuery): Promise<AuditEntry[]>;
}
