import { ValidationError, type ValidationIssue } from "./errors";
import {
  ACTION_TYPES,
  CREDIT_REASONS,
  REFUND_REASONS,
  SHIPMENT_STATUSES,
  type ActionType,
  type Address,
  type AddressChangePayload,
  type CreditPayload,
  type Payload,
  type PayloadByType,
  type RefundPayload,
  type ReplyPayload,
} from "./types";
import { assertNoIssues, rootReader, type Reader } from "./validation";

const ORDER_ID = /^ORD-[A-Z0-9-]{3,24}$/;
const CUSTOMER_ID = /^CUS-\d{3,8}$/;
const MAX_MONEY_CENTS = 1_000_000; // $10,000.00 hard ceiling for any single action

export function isActionType(value: unknown): value is ActionType {
  return typeof value === "string" && (ACTION_TYPES as readonly string[]).includes(value);
}

function readOrderId(r: Reader): string {
  return r.string("orderId", { pattern: ORDER_ID, patternHint: "must look like ORD-12345" });
}

function readCustomerId(r: Reader): string {
  return r.string("customerId", { pattern: CUSTOMER_ID, patternHint: "must look like CUS-1234" });
}

function readRefund(r: Reader): RefundPayload {
  r.strictKeys(["orderId", "amountCents", "currency", "reasonCode"]);
  return {
    orderId: readOrderId(r),
    amountCents: r.int("amountCents", { min: 1, max: MAX_MONEY_CENTS }),
    currency: r.enum("currency", ["USD"] as const),
    reasonCode: r.enum("reasonCode", REFUND_REASONS),
  };
}

function readCredit(r: Reader): CreditPayload {
  r.strictKeys(["customerId", "amountCents", "currency", "reasonCode"]);
  return {
    customerId: readCustomerId(r),
    amountCents: r.int("amountCents", { min: 1, max: MAX_MONEY_CENTS }),
    currency: r.enum("currency", ["USD"] as const),
    reasonCode: r.enum("reasonCode", CREDIT_REASONS),
  };
}

function readReply(r: Reader): ReplyPayload {
  r.strictKeys(["customerId", "subject", "body"]);
  return {
    customerId: readCustomerId(r),
    subject: r.string("subject", { max: 120 }),
    body: r.string("body", { min: 5, max: 2000 }),
  };
}

function readAddress(r: Reader): Address {
  r.strictKeys(["line1", "line2", "city", "region", "postalCode", "country"]);
  const address: Address = {
    line1: r.string("line1", { max: 120 }),
    city: r.string("city", { max: 80 }),
    region: r.string("region", { max: 80 }),
    postalCode: r.string("postalCode", { max: 20 }),
    country: r.string("country", { min: 2, max: 2, pattern: /^[A-Z]{2}$/, patternHint: "must be a 2-letter uppercase country code" }),
  };
  const line2 = r.optionalString("line2", { max: 120 });
  if (line2 !== undefined) address.line2 = line2;
  return address;
}

function readAddressChange(r: Reader): AddressChangePayload {
  r.strictKeys(["orderId", "shipmentStatus", "newAddress"]);
  return {
    orderId: readOrderId(r),
    shipmentStatus: r.enum("shipmentStatus", SHIPMENT_STATUSES),
    newAddress: readAddress(r.object("newAddress")),
  };
}

/**
 * Validate and normalise an untrusted payload for the given action type.
 * Returns a fresh object (strings trimmed, unknown keys rejected) or throws
 * a ValidationError listing every problem found.
 */
export function validatePayload<T extends ActionType>(
  type: T,
  input: unknown,
  base = "payload",
): PayloadByType[T] {
  const issues: ValidationIssue[] = [];
  const r = rootReader(input, issues, base);
  let result: Payload;
  switch (type) {
    case "issue_refund":
      result = readRefund(r);
      break;
    case "apply_account_credit":
      result = readCredit(r);
      break;
    case "send_customer_reply":
      result = readReply(r);
      break;
    case "update_shipping_address":
      result = readAddressChange(r);
      break;
    default: {
      const never: never = type;
      throw new ValidationError([{ path: "type", message: `unsupported action type ${String(never)}` }]);
    }
  }
  assertNoIssues(issues);
  return result as PayloadByType[T];
}

/**
 * Fields a reviewer may NOT change during edit-then-approve. They identify
 * the target of the action (or are facts about the world), so changing them
 * would turn the proposal into a different action. Dotted paths.
 */
export const IMMUTABLE_FIELDS: Record<ActionType, readonly string[]> = {
  issue_refund: ["orderId", "currency"],
  apply_account_credit: ["customerId", "currency"],
  send_customer_reply: ["customerId"],
  update_shipping_address: ["orderId", "shipmentStatus"],
};

export type FieldKind = "money" | "text" | "longtext" | "enum";

export interface FieldSpec {
  path: string;
  label: string;
  kind: FieldKind;
  options?: readonly string[];
  editable: boolean;
}

function spec(type: ActionType, path: string, label: string, kind: FieldKind, options?: readonly string[]): FieldSpec {
  return { path, label, kind, options, editable: !IMMUTABLE_FIELDS[type].includes(path) };
}

/** Field metadata used by the UI to render payload tables and edit forms. */
export const FIELD_SPECS: Record<ActionType, readonly FieldSpec[]> = {
  issue_refund: [
    spec("issue_refund", "orderId", "Order", "text"),
    spec("issue_refund", "amountCents", "Amount", "money"),
    spec("issue_refund", "reasonCode", "Reason", "enum", REFUND_REASONS),
  ],
  apply_account_credit: [
    spec("apply_account_credit", "customerId", "Customer", "text"),
    spec("apply_account_credit", "amountCents", "Amount", "money"),
    spec("apply_account_credit", "reasonCode", "Reason", "enum", CREDIT_REASONS),
  ],
  send_customer_reply: [
    spec("send_customer_reply", "customerId", "Customer", "text"),
    spec("send_customer_reply", "subject", "Subject", "text"),
    spec("send_customer_reply", "body", "Message body", "longtext"),
  ],
  update_shipping_address: [
    spec("update_shipping_address", "orderId", "Order", "text"),
    spec("update_shipping_address", "shipmentStatus", "Shipment status (as reported)", "enum", SHIPMENT_STATUSES),
    spec("update_shipping_address", "newAddress.line1", "Address line 1", "text"),
    spec("update_shipping_address", "newAddress.line2", "Address line 2", "text"),
    spec("update_shipping_address", "newAddress.city", "City", "text"),
    spec("update_shipping_address", "newAddress.region", "Region", "text"),
    spec("update_shipping_address", "newAddress.postalCode", "Postal code", "text"),
    spec("update_shipping_address", "newAddress.country", "Country", "text"),
  ],
};

export const ACTION_LABELS: Record<ActionType, string> = {
  issue_refund: "Issue refund",
  apply_account_credit: "Apply account credit",
  send_customer_reply: "Send customer reply",
  update_shipping_address: "Update shipping address",
};
