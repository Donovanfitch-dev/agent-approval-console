import { createHash } from "node:crypto";
import type { AuditDraft, AuditEntry, JsonValue } from "./types";

/**
 * Append-only audit log with a hash chain.
 *
 * Each entry stores `prevHash` (the hash of the entry before it) and its own
 * `hash = SHA-256(prevHash || canonical(entry fields))`. Editing, deleting, or
 * reordering any entry in the middle of the log breaks every hash after it,
 * which `verifyChain` detects.
 *
 * What this does NOT give you: truncation of the tail is undetectable from the
 * log alone (there is nothing after the cut to disagree). Defending against
 * that requires publishing the head hash somewhere the log's writer cannot
 * rewrite (a WORM store, a transparency log, a periodic external anchor).
 */

export const GENESIS_HASH = "0".repeat(64);

/** Deterministic JSON: object keys sorted recursively, no whitespace. */
export function canonicalize(value: JsonValue | undefined): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => canonicalize(v)).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(",")}}`;
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export function computeEntryHash(
  prevHash: string,
  fields: Pick<AuditEntry, "seq" | "proposalId" | "type" | "actor" | "at" | "data">,
): string {
  const body = canonicalize({
    seq: fields.seq,
    proposalId: fields.proposalId,
    type: fields.type,
    actor: fields.actor,
    at: fields.at,
    data: fields.data,
  });
  return sha256Hex(`${prevHash}\n${body}`);
}

/** Create the next entry in the chain from a draft. */
export function buildEntry(prev: AuditEntry | undefined, draft: AuditDraft): AuditEntry {
  const seq = prev ? prev.seq + 1 : 1;
  const prevHash = prev ? prev.hash : GENESIS_HASH;
  const entry = {
    seq,
    proposalId: draft.proposalId,
    type: draft.type,
    actor: draft.actor,
    at: draft.at,
    data: structuredClone(draft.data),
  };
  return { ...entry, prevHash, hash: computeEntryHash(prevHash, entry) };
}

export interface ChainVerification {
  valid: boolean;
  /** Number of entries examined. */
  checked: number;
  /** Hash of the last entry (or genesis for an empty log). Anchor this externally. */
  headHash: string;
  /** Sequence number of the first entry that failed verification. */
  firstInvalidSeq?: number;
  reason?: string;
}

/** Recompute every hash and link; report the first inconsistency, if any. */
export function verifyChain(entries: readonly AuditEntry[]): ChainVerification {
  let prevHash = GENESIS_HASH;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const fail = (reason: string): ChainVerification => ({
      valid: false,
      checked: i + 1,
      headHash: prevHash,
      firstInvalidSeq: entry.seq,
      reason,
    });
    if (entry.seq !== i + 1) return fail(`expected sequence ${i + 1} but found ${entry.seq}`);
    if (entry.prevHash !== prevHash) return fail("prevHash does not match the previous entry's hash");
    if (computeEntryHash(entry.prevHash, entry) !== entry.hash) {
      return fail("entry contents do not match its stored hash (entry was modified)");
    }
    prevHash = entry.hash;
  }
  return { valid: true, checked: entries.length, headHash: prevHash };
}
