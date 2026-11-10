import { describe, expect, it } from "vitest";
import { evaluatePolicy, summarizePolicy, validatePolicyConfig, type PolicyConfig } from "../policy";
import { DEFAULT_POLICY } from "../policy-config";
import type { Payload } from "../types";

const refund = (amountCents: number, reasonCode = "damaged") =>
  ({ orderId: "ORD-100001", amountCents, currency: "USD", reasonCode }) as Payload;

const reply = (body: string) => ({ customerId: "CUS-1001", subject: "Hi", body }) as Payload;

const address = (shipmentStatus: string) =>
  ({
    orderId: "ORD-100002",
    shipmentStatus,
    newAddress: { line1: "1 Example Road", city: "A", region: "B", postalCode: "1", country: "US" },
  }) as Payload;

describe("refund thresholds", () => {
  it.each([
    [5_000, "auto_approve"],
    [5_001, "needs_approval"],
    [25_000, "needs_approval"],
    [25_001, "needs_two_approvals"],
  ])("amount %i cents -> %s", (amount, expected) => {
    expect(evaluatePolicy("issue_refund", refund(amount), DEFAULT_POLICY).outcome).toBe(expected);
  });

  it("reports required approvals and machine-readable codes", () => {
    const r = evaluatePolicy("issue_refund", refund(30_000), DEFAULT_POLICY);
    expect(r.requiredApprovals).toBe(2);
    expect(r.reasons.map((x) => x.code)).toEqual([
      "REFUND_OVER_DUAL_APPROVAL_THRESHOLD",
      "REFUND_OVER_APPROVAL_THRESHOLD",
    ]);
    expect(r.policyVersion).toBe(DEFAULT_POLICY.version);
  });

  it("an 'other' reason escalates a small refund to needs_approval", () => {
    const r = evaluatePolicy("issue_refund", refund(1_000, "other"), DEFAULT_POLICY);
    expect(r.outcome).toBe("needs_approval");
    expect(r.reasons[0].code).toBe("REFUND_REASON_UNSPECIFIED");
  });

  it("explains an auto-approval with the baseline rule", () => {
    const r = evaluatePolicy("issue_refund", refund(1_000), DEFAULT_POLICY);
    expect(r.outcome).toBe("auto_approve");
    expect(r.reasons.map((x) => x.code)).toEqual(["REFUND_WITHIN_AUTO_LIMIT"]);
  });
});

describe("credit thresholds", () => {
  it.each([
    [2_500, "auto_approve"],
    [2_501, "needs_approval"],
    [10_001, "needs_two_approvals"],
  ])("amount %i -> %s", (amount, expected) => {
    const payload = { customerId: "CUS-1001", amountCents: amount, currency: "USD", reasonCode: "goodwill" } as Payload;
    expect(evaluatePolicy("apply_account_credit", payload, DEFAULT_POLICY).outcome).toBe(expected);
  });
});

describe("reply content", () => {
  it("auto-approves routine text", () => {
    expect(evaluatePolicy("send_customer_reply", reply("Your order ships tomorrow."), DEFAULT_POLICY).outcome).toBe("auto_approve");
  });

  it.each([
    ["We will refund you in full today.", "REPLY_FINANCIAL_PROMISE"],
    ["We guarantee delivery by Friday.", "REPLY_FINANCIAL_PROMISE"],
    ["Our LEGAL team will be in touch.", "REPLY_LEGAL_OR_SAFETY"],
    ["Please send your card number to confirm.", "REPLY_SENSITIVE_DATA"],
  ])("flags %j", (body, code) => {
    const r = evaluatePolicy("send_customer_reply", reply(body), DEFAULT_POLICY);
    expect(r.outcome).toBe("needs_approval");
    expect(r.reasons.map((x) => x.code)).toContain(code);
  });

  it("does not flag substrings of harmless words", () => {
    expect(evaluatePolicy("send_customer_reply", reply("The illegally parked van is not ours."), DEFAULT_POLICY).outcome).toBe("auto_approve");
  });
});

describe("address changes", () => {
  it("needs approval before shipment", () => {
    expect(evaluatePolicy("update_shipping_address", address("not_shipped"), DEFAULT_POLICY).outcome).toBe("needs_approval");
  });

  it.each(["shipped", "delivered"])("is denied when %s", (status) => {
    const r = evaluatePolicy("update_shipping_address", address(status), DEFAULT_POLICY);
    expect(r.outcome).toBe("deny");
    expect(r.reasons[0].code).toBe("ADDRESS_CHANGE_AFTER_SHIPMENT");
  });
});

describe("engine behaviour", () => {
  it("fails closed when no rule covers the action", () => {
    const empty: PolicyConfig = { version: "empty", rules: [] };
    const r = evaluatePolicy("issue_refund", refund(100), empty);
    expect(r.outcome).toBe("needs_approval");
    expect(r.reasons[0].code).toBe("NO_MATCHING_RULE");
  });

  it("is driven by data: changing a threshold changes the outcome", () => {
    const stricter: PolicyConfig = {
      ...DEFAULT_POLICY,
      rules: DEFAULT_POLICY.rules.map((rule) =>
        rule.id === "refund-needs-approval" ? { ...rule, when: { op: "gt", field: "amountCents", value: 500 } } : rule,
      ),
    };
    expect(evaluatePolicy("issue_refund", refund(1_000), DEFAULT_POLICY).outcome).toBe("auto_approve");
    expect(evaluatePolicy("issue_refund", refund(1_000), stricter).outcome).toBe("needs_approval");
  });

  it("the strictest matching rule wins", () => {
    expect(evaluatePolicy("issue_refund", refund(30_000, "other"), DEFAULT_POLICY).outcome).toBe("needs_two_approvals");
  });

  it("summarises in plain language", () => {
    const text = summarizePolicy(evaluatePolicy("update_shipping_address", address("shipped"), DEFAULT_POLICY));
    expect(text).toMatch(/^Denied by policy\./);
  });

  it("the default policy config is valid and the config is plain JSON", () => {
    expect(validatePolicyConfig(DEFAULT_POLICY)).toEqual([]);
    expect(JSON.parse(JSON.stringify(DEFAULT_POLICY))).toEqual(DEFAULT_POLICY);
  });

  it("flags duplicate ids and invalid patterns", () => {
    const bad: PolicyConfig = {
      version: "x",
      rules: [
        { id: "a", actionType: "issue_refund", description: "", when: { op: "always" }, outcome: "auto_approve", reasonCode: "A", message: "" },
        { id: "a", actionType: "send_customer_reply", description: "", when: { op: "matches_any", field: "body", patterns: ["("] }, outcome: "deny", reasonCode: "B", message: "" },
      ],
    };
    const problems = validatePolicyConfig(bad);
    expect(problems).toContain('duplicate rule id "a"');
    expect(problems.some((p) => p.includes("invalid pattern"))).toBe(true);
  });
});
