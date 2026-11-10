import type { PolicyConfig } from "./policy";

/**
 * The demo policy. Thresholds are in cents. Edit this file (or load an
 * equivalent JSON document) to change behaviour; no engine code changes.
 */
export const DEFAULT_POLICY: PolicyConfig = {
  version: "2026-01-demo",
  rules: [
    // --- issue_refund -------------------------------------------------------
    {
      id: "refund-baseline",
      actionType: "issue_refund",
      description: "Small refunds are within agent autonomy.",
      when: { op: "always" },
      outcome: "auto_approve",
      reasonCode: "REFUND_WITHIN_AUTO_LIMIT",
      message: "Refund is within the automatic limit.",
    },
    {
      id: "refund-needs-approval",
      actionType: "issue_refund",
      description: "Refunds above $50.00 need one human approval.",
      when: { op: "gt", field: "amountCents", value: 5_000 },
      outcome: "needs_approval",
      reasonCode: "REFUND_OVER_APPROVAL_THRESHOLD",
      message: "Refund exceeds $50.00, so a reviewer must approve it.",
    },
    {
      id: "refund-two-approvals",
      actionType: "issue_refund",
      description: "Refunds above $250.00 need two distinct approvers.",
      when: { op: "gt", field: "amountCents", value: 25_000 },
      outcome: "needs_two_approvals",
      reasonCode: "REFUND_OVER_DUAL_APPROVAL_THRESHOLD",
      message: "Refund exceeds $250.00, so two distinct reviewers must approve it.",
    },
    {
      id: "refund-other-reason",
      actionType: "issue_refund",
      description: "A free-form 'other' reason code needs a human look.",
      when: { op: "in", field: "reasonCode", values: ["other"] },
      outcome: "needs_approval",
      reasonCode: "REFUND_REASON_UNSPECIFIED",
      message: "Refund reason is 'other', so a reviewer must confirm it is legitimate.",
    },

    // --- apply_account_credit ----------------------------------------------
    {
      id: "credit-baseline",
      actionType: "apply_account_credit",
      description: "Small goodwill credits are within agent autonomy.",
      when: { op: "always" },
      outcome: "auto_approve",
      reasonCode: "CREDIT_WITHIN_AUTO_LIMIT",
      message: "Credit is within the automatic limit.",
    },
    {
      id: "credit-needs-approval",
      actionType: "apply_account_credit",
      description: "Credits above $25.00 need one human approval.",
      when: { op: "gt", field: "amountCents", value: 2_500 },
      outcome: "needs_approval",
      reasonCode: "CREDIT_OVER_APPROVAL_THRESHOLD",
      message: "Credit exceeds $25.00, so a reviewer must approve it.",
    },
    {
      id: "credit-two-approvals",
      actionType: "apply_account_credit",
      description: "Credits above $100.00 need two distinct approvers.",
      when: { op: "gt", field: "amountCents", value: 10_000 },
      outcome: "needs_two_approvals",
      reasonCode: "CREDIT_OVER_DUAL_APPROVAL_THRESHOLD",
      message: "Credit exceeds $100.00, so two distinct reviewers must approve it.",
    },

    // --- send_customer_reply -----------------------------------------------
    {
      id: "reply-baseline",
      actionType: "send_customer_reply",
      description: "Routine replies are within agent autonomy.",
      when: { op: "always" },
      outcome: "auto_approve",
      reasonCode: "REPLY_NO_RISKY_CONTENT",
      message: "Reply contains no content that requires review.",
    },
    {
      id: "reply-financial-promise",
      actionType: "send_customer_reply",
      description: "Replies that promise money, refunds, or compensation.",
      when: {
        op: "matches_any",
        field: "body",
        patterns: [
          "\\b(we|i)('ll| will) (refund|reimburse|credit|compensate)",
          "\\bfull refund\\b",
          "\\bguarantee[ds]?\\b",
          "\\bcompensation\\b",
        ],
      },
      outcome: "needs_approval",
      reasonCode: "REPLY_FINANCIAL_PROMISE",
      message: "Reply appears to promise a refund, credit, or guarantee.",
    },
    {
      id: "reply-legal-or-safety",
      actionType: "send_customer_reply",
      description: "Replies touching legal threats, injury, or safety.",
      when: {
        op: "matches_any",
        field: "body",
        patterns: ["\\blawyer\\b", "\\blawsuit\\b", "\\blegal\\b", "\\binjur(y|ed)\\b", "\\bsafety (recall|hazard)\\b"],
      },
      outcome: "needs_approval",
      reasonCode: "REPLY_LEGAL_OR_SAFETY",
      message: "Reply mentions legal or safety matters.",
    },
    {
      id: "reply-sensitive-data",
      actionType: "send_customer_reply",
      description: "Replies that request or reveal credentials or card data.",
      when: {
        op: "matches_any",
        field: "body",
        patterns: ["\\bpassword\\b", "\\bcard number\\b", "\\bcvv\\b", "\\bone-time (code|passcode)\\b"],
      },
      outcome: "needs_approval",
      reasonCode: "REPLY_SENSITIVE_DATA",
      message: "Reply mentions passwords, card numbers, or one-time codes.",
    },

    // --- update_shipping_address -------------------------------------------
    {
      id: "address-before-shipment",
      actionType: "update_shipping_address",
      description: "Address changes are a common account-takeover vector.",
      when: { op: "in", field: "shipmentStatus", values: ["not_shipped"] },
      outcome: "needs_approval",
      reasonCode: "ADDRESS_CHANGE_NEEDS_REVIEW",
      message: "Address changes always need a reviewer, even before shipment.",
    },
    {
      id: "address-after-shipment",
      actionType: "update_shipping_address",
      description: "Once a parcel has shipped the address cannot be changed here.",
      when: { op: "in", field: "shipmentStatus", values: ["shipped", "delivered"] },
      outcome: "deny",
      reasonCode: "ADDRESS_CHANGE_AFTER_SHIPMENT",
      message: "The order has already shipped; the address can no longer be changed. Use a carrier redirect instead.",
    },
  ],
};
