import { sha256Hex } from "./audit";
import { formatCents } from "./format";
import type { ExecutionReceipt, Payload, ActionType } from "./types";

/**
 * The executor is the only component allowed to cause side effects. It is a
 * port: the real implementation would call a payments API, a CRM, an email
 * service. THIS repository only ships a simulation that records receipts in
 * memory and calls nothing.
 */

export interface ExecutionRequest {
  proposalId: string;
  type: ActionType;
  payload: Payload;
  idempotencyKey: string;
  /** 1-based attempt number for this proposal. */
  attempt: number;
}

export interface Executor {
  execute(request: ExecutionRequest): Promise<ExecutionReceipt>;
}

export class ExecutorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExecutorError";
  }
}

export type FailureRule = (request: ExecutionRequest) => string | null;

/**
 * Demo failure injection: an order id containing "FLAKY" fails on its first
 * attempt (a simulated transient downstream timeout) and succeeds on retry.
 */
export const flakyOrderFailure: FailureRule = (request) => {
  const payload = request.payload as { orderId?: string };
  if (payload.orderId?.includes("FLAKY") && request.attempt === 1) {
    return "Simulated downstream timeout (transient). Safe to retry.";
  }
  return null;
};

function describeEffect(type: ActionType, payload: Payload): string {
  switch (type) {
    case "issue_refund": {
      const p = payload as { orderId: string; amountCents: number };
      return `Simulated refund of ${formatCents(p.amountCents)} USD to order ${p.orderId}`;
    }
    case "apply_account_credit": {
      const p = payload as { customerId: string; amountCents: number };
      return `Simulated account credit of ${formatCents(p.amountCents)} USD for ${p.customerId}`;
    }
    case "send_customer_reply": {
      const p = payload as { customerId: string; subject: string };
      return `Simulated reply "${p.subject}" queued for ${p.customerId}`;
    }
    case "update_shipping_address": {
      const p = payload as { orderId: string };
      return `Simulated shipping address update on order ${p.orderId}`;
    }
  }
}

/**
 * Simulated executor. Like a well-behaved downstream API, it honours the
 * idempotency key: a repeated call with the same key returns the original
 * receipt and does not perform the effect again. `sideEffectCount` lets tests
 * (and the UI) prove that the effect happened exactly once.
 */
export class SimulatedExecutor implements Executor {
  private readonly receipts = new Map<string, ExecutionReceipt>();
  private effects = 0;

  constructor(
    private readonly clock: () => Date,
    private readonly failureRule: FailureRule = flakyOrderFailure,
  ) {}

  get sideEffectCount(): number {
    return this.effects;
  }

  async execute(request: ExecutionRequest): Promise<ExecutionReceipt> {
    const prior = this.receipts.get(request.idempotencyKey);
    if (prior) return prior;

    const failure = this.failureRule(request);
    if (failure) throw new ExecutorError(failure);

    this.effects += 1;
    const receipt: ExecutionReceipt = {
      receiptId: `rcpt_${sha256Hex(request.idempotencyKey).slice(0, 12)}`,
      effect: describeEffect(request.type, request.payload),
      performedAt: this.clock().toISOString(),
      idempotencyKey: request.idempotencyKey,
      simulated: true,
    };
    this.receipts.set(request.idempotencyKey, receipt);
    return receipt;
  }
}
