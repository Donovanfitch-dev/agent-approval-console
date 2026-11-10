/**
 * Synthetic "agent" for the demo. It is NOT a language model: it fills in
 * templates with seeded pseudo-random values so the demo can generate fresh
 * proposals that exercise every policy path. No network, no LLM calls.
 */

export type Rng = () => number;

/** Small deterministic PRNG so tests can reproduce a sequence. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function int(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[int(rng, 0, items.length - 1)];
}

function digits(rng: Rng, n: number): string {
  let out = "";
  for (let i = 0; i < n; i++) out += String(int(rng, 0, 9));
  return out;
}

interface SimulatedInput {
  type: string;
  payload: Record<string, unknown>;
  rationale: string;
  ticketId: string;
  agentId: string;
  idempotencyKey: string;
}

type Builder = (rng: Rng) => Omit<SimulatedInput, "ticketId" | "idempotencyKey">;

const ADDRESSES = [
  { line1: "100 Example Street", city: "Springfield", region: "ZZ", postalCode: "00001", country: "US" },
  { line1: "42 Sample Avenue", line2: "Unit 5", city: "Rivertown", region: "ZZ", postalCode: "00002", country: "US" },
  { line1: "7 Placeholder Lane", city: "Lakeside", region: "ZZ", postalCode: "00003", country: "US" },
];

const SAFE_REPLIES = [
  "Thanks for contacting Larkspur Trail Supply. Your order is packed and the tracking link was sent this morning; carrier scans can lag by a business day.",
  "Happy to help with sizing. The backpack runs true to size; if you are between sizes we suggest the larger one for winter layers.",
];

const RISKY_REPLIES: readonly { body: string; why: string }[] = [
  {
    body: "I am sorry the tent zipper failed. We will refund you in full and send a prepaid return label today.",
    why: "Customer reported a failed zipper; drafting an apology with a resolution.",
  },
  {
    body: "Thank you for flagging the stove injury. Our legal team will follow up, and please stop using the unit.",
    why: "Customer mentioned an injury; drafting a careful reply.",
  },
  {
    body: "To verify your account please reply with your card number and the one-time code we texted you.",
    why: "Drafting an account verification message.",
  },
];

export const SCENARIOS: Record<string, { label: string; build: Builder }> = {
  refund_small: {
    label: "Small refund (auto-approved)",
    build: (rng) => ({
      type: "issue_refund",
      agentId: "agent:returns-assistant",
      payload: {
        orderId: `ORD-${digits(rng, 6)}`,
        amountCents: int(rng, 800, 4_500),
        currency: "USD",
        reasonCode: pick(rng, ["damaged", "late", "not_as_described"]),
      },
      rationale: "Customer reported a minor defect on a low-value item; refund is within standard return policy.",
    }),
  },
  refund_medium: {
    label: "Refund over $50 (one approval)",
    build: (rng) => ({
      type: "issue_refund",
      agentId: "agent:returns-assistant",
      payload: {
        orderId: `ORD-${digits(rng, 6)}`,
        amountCents: int(rng, 5_500, 24_000),
        currency: "USD",
        reasonCode: pick(rng, ["damaged", "late", "not_as_described"]),
      },
      rationale: "Item arrived damaged per customer photos; full item refund requested within the return window.",
    }),
  },
  refund_large: {
    label: "Refund over $250 (two approvals)",
    build: (rng) => ({
      type: "issue_refund",
      agentId: "agent:returns-assistant",
      payload: {
        orderId: `ORD-${digits(rng, 6)}`,
        amountCents: int(rng, 26_000, 60_000),
        currency: "USD",
        reasonCode: "not_as_described",
      },
      rationale: "Customer states the shell jacket is not waterproof as advertised; requesting full refund.",
    }),
  },
  refund_flaky: {
    label: "Refund that fails once downstream (retry demo)",
    build: (rng) => ({
      type: "issue_refund",
      agentId: "agent:returns-assistant",
      payload: {
        orderId: `ORD-FLAKY-${digits(rng, 4)}`,
        amountCents: int(rng, 5_500, 9_000),
        currency: "USD",
        reasonCode: "late",
      },
      rationale: "Delivery arrived well after the promised window; refunding the item as a courtesy.",
    }),
  },
  credit_small: {
    label: "Small goodwill credit (auto-approved)",
    build: (rng) => ({
      type: "apply_account_credit",
      agentId: "agent:goodwill-assistant",
      payload: {
        customerId: `CUS-${digits(rng, 4)}`,
        amountCents: int(rng, 500, 2_000),
        currency: "USD",
        reasonCode: "goodwill",
      },
      rationale: "Minor shipping delay; applying a small goodwill credit per support guidelines.",
    }),
  },
  credit_large: {
    label: "Credit over $100 (two approvals)",
    build: (rng) => ({
      type: "apply_account_credit",
      agentId: "agent:goodwill-assistant",
      payload: {
        customerId: `CUS-${digits(rng, 4)}`,
        amountCents: int(rng, 10_500, 20_000),
        currency: "USD",
        reasonCode: "service_recovery",
      },
      rationale: "Repeated delivery failures over three orders; proposing a service-recovery credit.",
    }),
  },
  reply_safe: {
    label: "Routine reply (auto-approved)",
    build: (rng) => ({
      type: "send_customer_reply",
      agentId: "agent:reply-drafter",
      payload: {
        customerId: `CUS-${digits(rng, 4)}`,
        subject: "Update on your order",
        body: pick(rng, SAFE_REPLIES),
      },
      rationale: "Customer asked a routine question that matches an approved answer template.",
    }),
  },
  reply_risky: {
    label: "Reply with risky content (one approval)",
    build: (rng) => {
      const r = pick(rng, RISKY_REPLIES);
      return {
        type: "send_customer_reply",
        agentId: "agent:reply-drafter",
        payload: { customerId: `CUS-${digits(rng, 4)}`, subject: "Regarding your recent contact", body: r.body },
        rationale: r.why,
      };
    },
  },
  address_before_shipment: {
    label: "Address change before shipment (one approval)",
    build: (rng) => ({
      type: "update_shipping_address",
      agentId: "agent:address-assistant",
      payload: {
        orderId: `ORD-${digits(rng, 6)}`,
        shipmentStatus: "not_shipped",
        newAddress: pick(rng, ADDRESSES),
      },
      rationale: "Customer asked to ship to a different address; order has not left the warehouse.",
    }),
  },
  address_after_shipment: {
    label: "Address change after shipment (denied)",
    build: (rng) => ({
      type: "update_shipping_address",
      agentId: "agent:address-assistant",
      payload: {
        orderId: `ORD-${digits(rng, 6)}`,
        shipmentStatus: pick(rng, ["shipped", "delivered"]),
        newAddress: pick(rng, ADDRESSES),
      },
      rationale: "Customer wants the parcel redirected to a new address.",
    }),
  },
};

export const SCENARIO_IDS = Object.keys(SCENARIOS);

let counter = 0;

/**
 * Produce a submission as an agent would send it. Pass a `scenario` id for a
 * specific path, or omit for a random one. The result is untrusted input and
 * goes through the same validation as any API caller.
 */
export function simulateSubmission(rng: Rng = Math.random, scenario?: string): SimulatedInput {
  const id = scenario && scenario in SCENARIOS ? scenario : pick(rng, SCENARIO_IDS);
  const base = SCENARIOS[id].build(rng);
  counter += 1;
  return {
    ...base,
    ticketId: `TKT-${digits(rng, 4)}`,
    idempotencyKey: `sim-${counter}-${Math.floor(rng() * 0xffffffff).toString(36)}`,
  };
}
