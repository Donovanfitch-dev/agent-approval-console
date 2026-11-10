import { createApp, type App } from "../app";
import { DEMO_ACTORS } from "../demo-roles";

export const reviewerA = DEMO_ACTORS.reviewer_a;
export const reviewerB = DEMO_ACTORS.reviewer_b;
export const admin = DEMO_ACTORS.admin;
export const operator = DEMO_ACTORS.agent;

export interface TestApp extends App {
  advance(ms: number): void;
  now(): Date;
}

/** App with a manually advanced clock. */
export function makeApp(startIso = "2026-03-01T12:00:00.000Z", pendingTtlMs?: number): TestApp {
  let t = new Date(startIso).getTime();
  const app = createApp({ clock: () => new Date(t), pendingTtlMs });
  return { ...app, advance: (ms) => (t += ms), now: () => new Date(t) };
}

let keyCounter = 0;

export function refundInput(amountCents: number, extra: Record<string, unknown> = {}, payload: Record<string, unknown> = {}) {
  keyCounter += 1;
  return {
    type: "issue_refund",
    payload: { orderId: "ORD-100001", amountCents, currency: "USD", reasonCode: "damaged", ...payload },
    rationale: "Customer reported damage on arrival; photos on the ticket.",
    ticketId: "TKT-1001",
    agentId: "agent:returns-assistant",
    idempotencyKey: `test-key-${keyCounter}`,
    ...extra,
  };
}

export function replyInput(body: string) {
  keyCounter += 1;
  return {
    type: "send_customer_reply",
    payload: { customerId: "CUS-1001", subject: "Hello", body },
    rationale: "Drafted reply for the customer's question.",
    ticketId: "TKT-1002",
    agentId: "agent:reply-drafter",
    idempotencyKey: `test-key-${keyCounter}`,
  };
}

export function addressInput(shipmentStatus: string) {
  keyCounter += 1;
  return {
    type: "update_shipping_address",
    payload: {
      orderId: "ORD-100002",
      shipmentStatus,
      newAddress: { line1: "1 Example Road", city: "Springfield", region: "ZZ", postalCode: "00001", country: "US" },
    },
    rationale: "Customer asked to change the address.",
    ticketId: "TKT-1003",
    agentId: "agent:address-assistant",
    idempotencyKey: `test-key-${keyCounter}`,
  };
}
