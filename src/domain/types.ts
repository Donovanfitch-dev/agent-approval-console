/** Core domain types. Everything here is plain, JSON-serialisable data. */

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export const ACTION_TYPES = [
  "issue_refund",
  "apply_account_credit",
  "send_customer_reply",
  "update_shipping_address",
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export const REFUND_REASONS = [
  "damaged",
  "late",
  "not_as_described",
  "customer_remorse",
  "other",
] as const;
export type RefundReason = (typeof REFUND_REASONS)[number];

export const CREDIT_REASONS = ["goodwill", "service_recovery", "promo_correction"] as const;
export type CreditReason = (typeof CREDIT_REASONS)[number];

export const SHIPMENT_STATUSES = ["not_shipped", "shipped", "delivered"] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

export interface RefundPayload {
  orderId: string;
  amountCents: number;
  currency: "USD";
  reasonCode: RefundReason;
}

export interface CreditPayload {
  customerId: string;
  amountCents: number;
  currency: "USD";
  reasonCode: CreditReason;
}

export interface ReplyPayload {
  customerId: string;
  subject: string;
  body: string;
}

export interface Address {
  line1: string;
  line2?: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
}

export interface AddressChangePayload {
  orderId: string;
  /** Shipment state as observed by the agent's order lookup tool. */
  shipmentStatus: ShipmentStatus;
  newAddress: Address;
}

export interface PayloadByType {
  issue_refund: RefundPayload;
  apply_account_credit: CreditPayload;
  send_customer_reply: ReplyPayload;
  update_shipping_address: AddressChangePayload;
}
export type Payload = PayloadByType[ActionType];

export const STATUSES = [
  "proposed",
  "pending_approval",
  "approved",
  "executing",
  "executed",
  "failed",
  "rejected",
  "expired",
] as const;
export type Status = (typeof STATUSES)[number];

export const POLICY_OUTCOMES = [
  "auto_approve",
  "needs_approval",
  "needs_two_approvals",
  "deny",
] as const;
export type PolicyOutcome = (typeof POLICY_OUTCOMES)[number];

export interface PolicyReason {
  ruleId: string;
  /** Stable machine-readable code, e.g. `REFUND_OVER_APPROVAL_THRESHOLD`. */
  code: string;
  outcome: PolicyOutcome;
  /** Human-readable explanation. */
  message: string;
}

export interface PolicyResult {
  outcome: PolicyOutcome;
  /** Distinct approvals required: 0 (auto), 1, or 2. Meaningless for `deny`. */
  requiredApprovals: 0 | 1 | 2;
  policyVersion: string;
  reasons: PolicyReason[];
}

export type ActorKind = "agent" | "reviewer" | "admin";

export interface Actor {
  id: string;
  kind: ActorKind;
}

export interface Approval {
  reviewerId: string;
  at: string;
  /** The payload revision this approval applies to. */
  payloadRevision: number;
  comment?: string;
}

export interface DiffEntry {
  path: string;
  before: JsonPrimitive;
  after: JsonPrimitive;
}

export interface PayloadEdit {
  revision: number;
  by: string;
  at: string;
  diff: DiffEntry[];
  policyBefore: PolicyOutcome;
  policyAfter: PolicyOutcome;
  approvalsInvalidated: number;
}

export interface Rejection {
  by: string;
  at: string;
  reason: string;
  source: "reviewer" | "policy";
}

export interface ExecutionReceipt {
  receiptId: string;
  effect: string;
  performedAt: string;
  idempotencyKey: string;
  simulated: true;
}

export interface ExecutionState {
  attempts: number;
  lastError?: string;
  receipt?: ExecutionReceipt;
}

export interface Proposal {
  id: string;
  type: ActionType;
  payload: Payload;
  originalPayload: Payload;
  /** Increments each time a reviewer edits the payload. Starts at 0. */
  payloadRevision: number;
  rationale: string;
  ticketId: string;
  agentId: string;
  idempotencyKey: string;
  /** Hash of the canonical submission; detects key reuse with different content. */
  submissionHash: string;
  status: Status;
  policy: PolicyResult;
  createdAt: string;
  updatedAt: string;
  /** When a still-pending proposal expires; null once it left pending_approval. */
  expiresAt: string | null;
  approvals: Approval[];
  edits: PayloadEdit[];
  rejection?: Rejection;
  execution: ExecutionState;
  /** Optimistic-concurrency token; increments on every write. */
  version: number;
}

export type AuditEventType =
  | "proposal_submitted"
  | "policy_evaluated"
  | "approval_recorded"
  | "payload_edited"
  | "approved"
  | "rejected"
  | "expired"
  | "decision_refused"
  | "execution_started"
  | "execution_succeeded"
  | "execution_failed";

export interface AuditDraft {
  proposalId: string | null;
  type: AuditEventType;
  actor: string;
  at: string;
  data: { [key: string]: JsonValue };
}

export interface AuditEntry extends AuditDraft {
  /** 1-based, gap-free sequence number. */
  seq: number;
  prevHash: string;
  hash: string;
}
