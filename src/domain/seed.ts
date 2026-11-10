import { createApp, type App, type AppOptions } from "./app";
import { DEMO_ACTORS } from "./demo-roles";
import { ForbiddenError } from "./errors";
import type { Actor } from "./types";

const A = DEMO_ACTORS.reviewer_a;
const B = DEMO_ACTORS.reviewer_b;
const OPERATOR = DEMO_ACTORS.agent;

const returnsBot = "agent:returns-assistant";
const goodwillBot = "agent:goodwill-assistant";
const replyBot = "agent:reply-drafter";
const addressBot = "agent:address-assistant";

const addr = { line1: "100 Example Street", city: "Springfield", region: "ZZ", postalCode: "00001", country: "US" };

/**
 * Create an app and fill it with synthetic history by driving the real
 * service through a controllable clock. Every entry therefore goes through
 * the same validation, policy, state machine and audit chain as live traffic.
 *
 * All names, ids and amounts are fictional.
 */
export async function createSeededApp(options: AppOptions = {}): Promise<App> {
  const real = options.clock ?? (() => new Date());
  let override: Date | null = null;
  const clock = () => override ?? real();
  const app = createApp({ ...options, clock });
  const { service } = app;
  const base = real().getTime();
  const minutesAgo = (m: number) => {
    override = new Date(base - m * 60_000);
  };

  let n = 0;
  const submit = async (
    agentId: string,
    type: string,
    ticket: number,
    rationale: string,
    payload: Record<string, unknown>,
  ) => {
    n += 1;
    const { proposal } = await service.submit({
      type,
      payload,
      rationale,
      ticketId: `TKT-${ticket}`,
      agentId,
      idempotencyKey: `seed-${String(n).padStart(3, "0")}-${type}`,
    });
    return proposal;
  };
  const execute = (id: string, actor: Actor = OPERATOR) => service.execute(id, actor);

  // 1. Will have expired: nobody reviewed it within the 24h window.
  minutesAgo(1800);
  await submit(returnsBot, "issue_refund", 4401, "Customer reports a cracked water bottle on arrival; photos attached to the ticket.", {
    orderId: "ORD-230118", amountCents: 8400, currency: "USD", reasonCode: "damaged",
  });

  // 2. Two approvals required; one already given.
  minutesAgo(300);
  const big = await submit(returnsBot, "issue_refund", 4412, "Customer states the shell jacket leaks in light rain, contrary to the listing. Requesting a full refund.", {
    orderId: "ORD-230244", amountCents: 32000, currency: "USD", reasonCode: "not_as_described",
  });
  minutesAgo(280);
  await service.decide(big.id, A, { kind: "approve", comment: "Matches two other reports of the same jacket." });

  // 3. One approval required.
  minutesAgo(240);
  await submit(returnsBot, "issue_refund", 4417, "Parcel arrived nine days after the promised date; customer asked for the item to be refunded.", {
    orderId: "ORD-230377", amountCents: 7200, currency: "USD", reasonCode: "late",
  });

  // 4. Auto-approved and already executed.
  minutesAgo(200);
  const small = await submit(returnsBot, "issue_refund", 4420, "Minor scuff on a stuff sack; refund within standard policy.", {
    orderId: "ORD-230401", amountCents: 1850, currency: "USD", reasonCode: "damaged",
  });
  minutesAgo(199);
  await execute(small.id);

  // 5. Credit pending.
  minutesAgo(170);
  await submit(goodwillBot, "apply_account_credit", 4423, "Second delayed shipment this quarter; proposing a goodwill credit.", {
    customerId: "CUS-2041", amountCents: 6000, currency: "USD", reasonCode: "goodwill",
  });

  // 6. Risky reply pending.
  minutesAgo(150);
  await submit(replyBot, "send_customer_reply", 4426, "Drafting a reply to a customer whose tent zipper failed.", {
    customerId: "CUS-2077",
    subject: "About your tent",
    body: "I am sorry the zipper failed. We will refund you in full and send a prepaid return label today.",
  });

  // 7. Denied by policy.
  minutesAgo(130);
  await submit(addressBot, "update_shipping_address", 4430, "Customer asked for the parcel to go to a different address.", {
    orderId: "ORD-230455", shipmentStatus: "shipped", newAddress: addr,
  });

  // 8. Edit-then-approve, then executed.
  minutesAgo(110);
  const edited = await submit(returnsBot, "issue_refund", 4433, "Customer wants a refund for a sleeping bag; no reason given beyond 'not what I expected'.", {
    orderId: "ORD-230512", amountCents: 9500, currency: "USD", reasonCode: "other",
  });
  minutesAgo(100);
  await service.decide(edited.id, B, {
    kind: "edit_approve",
    payload: { orderId: "ORD-230512", amountCents: 7000, currency: "USD", reasonCode: "late" },
    comment: "Reduced to the item price; shipping was not refundable. Reason was a late delivery.",
  });
  minutesAgo(95);
  await execute(edited.id);

  // 9. Auto-approved routine reply, not yet executed.
  minutesAgo(80);
  await submit(replyBot, "send_customer_reply", 4438, "Customer asked where their order is.", {
    customerId: "CUS-2102",
    subject: "Update on your order",
    body: "Thanks for contacting Larkspur Trail Supply. Your order is packed and the tracking link was sent this morning.",
  });

  // 10. Approved, executor failed once; retryable.
  minutesAgo(60);
  const flaky = await submit(returnsBot, "issue_refund", 4441, "Delivery was late; refunding the item as a courtesy.", {
    orderId: "ORD-FLAKY-2210", amountCents: 6400, currency: "USD", reasonCode: "late",
  });
  minutesAgo(55);
  await service.decide(flaky.id, A, { kind: "approve" });
  minutesAgo(50);
  await execute(flaky.id);

  // 11. Rejected by a reviewer.
  minutesAgo(40);
  const legal = await submit(replyBot, "send_customer_reply", 4445, "Drafting a reply to a customer who mentioned an injury.", {
    customerId: "CUS-2150",
    subject: "Regarding your message",
    body: "Our legal team will follow up about the injury. Please stop using the unit.",
  });
  minutesAgo(35);
  await service.decide(legal.id, A, {
    kind: "reject",
    reason: "Injury reports go to the safety team, not an automated reply.",
  });

  // 12. Two approvals required; none yet.
  minutesAgo(20);
  const credit = await submit(goodwillBot, "apply_account_credit", 4450, "Three failed deliveries across one order; proposing a service-recovery credit.", {
    customerId: "CUS-2188", amountCents: 15000, currency: "USD", reasonCode: "service_recovery",
  });

  // 13. A refused attempt (an agent trying to approve) lands in the audit log.
  minutesAgo(15);
  try {
    await service.decide(credit.id, OPERATOR, { kind: "approve" });
  } catch (e) {
    if (!(e instanceof ForbiddenError)) throw e;
  }

  override = null;
  await service.expireStale();
  return app;
}
