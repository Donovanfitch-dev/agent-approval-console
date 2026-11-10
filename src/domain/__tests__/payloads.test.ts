import { describe, expect, it } from "vitest";
import { ValidationError } from "../errors";
import { validatePayload } from "../payloads";
import { validateSubmission } from "../submission";
import { refundInput } from "./helpers";

function issuesOf(fn: () => unknown): string[] {
  try {
    fn();
  } catch (e) {
    if (e instanceof ValidationError) return e.issues.map((i) => `${i.path}: ${i.message}`);
    throw e;
  }
  return [];
}

describe("validatePayload", () => {
  it("accepts and normalises a valid refund", () => {
    const p = validatePayload("issue_refund", {
      orderId: " ORD-12345 ",
      amountCents: 1200,
      currency: "USD",
      reasonCode: "late",
    });
    expect(p.orderId).toBe("ORD-12345");
  });

  it("reports every problem with a precise path", () => {
    const issues = issuesOf(() =>
      validatePayload("issue_refund", { orderId: "nope", amountCents: 12.5, currency: "EUR", reasonCode: "x", extra: 1 }),
    );
    expect(issues).toContain("payload.orderId: must look like ORD-12345");
    expect(issues).toContain("payload.amountCents: must be an integer");
    expect(issues.some((i) => i.startsWith("payload.currency"))).toBe(true);
    expect(issues.some((i) => i.startsWith("payload.reasonCode"))).toBe(true);
    expect(issues).toContain("payload.extra: unknown field");
  });

  it("rejects non-positive and absurd amounts", () => {
    expect(issuesOf(() => validatePayload("apply_account_credit", { customerId: "CUS-1234", amountCents: 0, currency: "USD", reasonCode: "goodwill" }))).toContain(
      "payload.amountCents: must be at least 1",
    );
    expect(issuesOf(() => validatePayload("apply_account_credit", { customerId: "CUS-1234", amountCents: 99_999_999, currency: "USD", reasonCode: "goodwill" }))).toContain(
      "payload.amountCents: must be at most 1000000",
    );
  });

  it("validates nested address fields", () => {
    const issues = issuesOf(() =>
      validatePayload("update_shipping_address", {
        orderId: "ORD-12345",
        shipmentStatus: "not_shipped",
        newAddress: { line1: "", city: "X", region: "Y", postalCode: "1", country: "usa" },
      }),
    );
    expect(issues).toContain("payload.newAddress.line1: is required");
    expect(issues.some((i) => i.startsWith("payload.newAddress.country"))).toBe(true);
  });

  it("rejects non-object input", () => {
    expect(issuesOf(() => validatePayload("send_customer_reply", "hi"))).toEqual(["payload: must be a JSON object"]);
  });
});

describe("validateSubmission", () => {
  it("accepts a well-formed submission", () => {
    const s = validateSubmission(refundInput(1000));
    expect(s.type).toBe("issue_refund");
  });

  it("rejects an unknown action type with a clear message", () => {
    const issues = issuesOf(() => validateSubmission({ ...refundInput(1000), type: "wire_money" }));
    expect(issues[0]).toMatch(/^type: must be one of/);
  });

  it("collects top-level and payload problems together", () => {
    const issues = issuesOf(() =>
      validateSubmission({ ...refundInput(1000, { ticketId: "bad", agentId: "human", idempotencyKey: "x" }), payload: {} }),
    );
    expect(issues.some((i) => i.startsWith("ticketId"))).toBe(true);
    expect(issues.some((i) => i.startsWith("agentId"))).toBe(true);
    expect(issues.some((i) => i.startsWith("idempotencyKey"))).toBe(true);
    expect(issues.some((i) => i.startsWith("payload.orderId"))).toBe(true);
  });

  it("requires a substantive rationale", () => {
    const issues = issuesOf(() => validateSubmission(refundInput(1000, { rationale: "ok" })));
    expect(issues).toContain("rationale: must be at least 10 characters");
  });
});

describe("isDomainError", () => {
  it("recognises domain errors by brand, not by class identity", async () => {
    const { isDomainError, hasErrorCode, NotFoundError } = await import("../errors");
    const err = new NotFoundError("x");
    expect(isDomainError(err)).toBe(true);
    expect(hasErrorCode(err, "not_found")).toBe(true);
    expect(hasErrorCode(err, "forbidden")).toBe(false);
    expect(isDomainError(new Error("plain"))).toBe(false);
    expect(isDomainError(null)).toBe(false);
  });
});
