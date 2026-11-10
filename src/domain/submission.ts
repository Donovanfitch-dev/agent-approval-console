import { canonicalize, sha256Hex } from "./audit";
import { ValidationError, type ValidationIssue } from "./errors";
import { isActionType, validatePayload } from "./payloads";
import type { ActionType, JsonValue, Payload } from "./types";
import { assertNoIssues, rootReader } from "./validation";

/** What an agent sends when it proposes a side-effecting action. */
export interface Submission {
  type: ActionType;
  payload: Payload;
  /** The agent's stated reason, shown verbatim to reviewers. */
  rationale: string;
  /** The support ticket that prompted the action. */
  ticketId: string;
  /** Stable identity of the proposing agent, e.g. `agent:returns-assistant`. */
  agentId: string;
  /** Client-chosen key; retrying a submission with the same key is safe. */
  idempotencyKey: string;
}

export function validateSubmission(input: unknown): Submission {
  const issues: ValidationIssue[] = [];
  const r = rootReader(input, issues);
  r.strictKeys(["type", "payload", "rationale", "ticketId", "agentId", "idempotencyKey"]);

  const rawType = (input as Record<string, unknown>).type;
  if (!isActionType(rawType)) {
    throw new ValidationError([
      ...issues,
      {
        path: "type",
        message: "must be one of: issue_refund, apply_account_credit, send_customer_reply, update_shipping_address",
      },
    ]);
  }

  const rationale = r.string("rationale", { min: 10, max: 1000 });
  const ticketId = r.string("ticketId", { pattern: /^TKT-\d{4,8}$/, patternHint: "must look like TKT-12345" });
  const agentId = r.string("agentId", {
    pattern: /^agent:[a-z0-9-]{2,40}$/,
    patternHint: "must look like agent:returns-assistant",
  });
  const idempotencyKey = r.string("idempotencyKey", {
    min: 8,
    max: 128,
    pattern: /^[A-Za-z0-9._:-]+$/,
    patternHint: "may contain letters, digits, and . _ : -",
  });

  let payload: Payload | undefined;
  try {
    payload = validatePayload(rawType, (input as Record<string, unknown>).payload);
  } catch (e) {
    if (e instanceof ValidationError) issues.push(...e.issues);
    else throw e;
  }
  assertNoIssues(issues);
  return { type: rawType, payload: payload as Payload, rationale, ticketId, agentId, idempotencyKey };
}

/**
 * Fingerprint of everything except the idempotency key. Reusing a key with a
 * different fingerprint is a client bug and is rejected, not silently merged.
 */
export function submissionHash(sub: Submission): string {
  const body = canonicalize(
    JSON.parse(
      JSON.stringify({
        type: sub.type,
        payload: sub.payload,
        rationale: sub.rationale,
        ticketId: sub.ticketId,
        agentId: sub.agentId,
      }),
    ) as JsonValue,
  );
  return sha256Hex(body);
}
