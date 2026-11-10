import { describe, expect, it } from "vitest";
import { buildEntry, canonicalize, GENESIS_HASH, verifyChain } from "../audit";
import type { AuditDraft, AuditEntry } from "../types";

function chain(n: number): AuditEntry[] {
  const entries: AuditEntry[] = [];
  for (let i = 0; i < n; i++) {
    const draft: AuditDraft = {
      proposalId: `PR-${1000 + i}`,
      type: "proposal_submitted",
      actor: "agent:returns-assistant",
      at: `2026-03-01T12:0${i}:00.000Z`,
      data: { amountCents: 1000 + i, nested: { b: 2, a: 1 } },
    };
    entries.push(buildEntry(entries[entries.length - 1], draft));
  }
  return entries;
}

describe("canonicalize", () => {
  it("is independent of key order", () => {
    expect(canonicalize({ a: 1, b: { d: 1, c: 2 } })).toBe(canonicalize({ b: { c: 2, d: 1 }, a: 1 }));
  });
});

describe("hash chain", () => {
  it("links each entry to the previous hash, starting from genesis", () => {
    const entries = chain(3);
    expect(entries[0].prevHash).toBe(GENESIS_HASH);
    expect(entries[1].prevHash).toBe(entries[0].hash);
    expect(entries[2].prevHash).toBe(entries[1].hash);
    expect(entries.map((e) => e.seq)).toEqual([1, 2, 3]);
  });

  it("verifies an intact chain, including an empty one", () => {
    const v = verifyChain(chain(5));
    expect(v).toMatchObject({ valid: true, checked: 5 });
    expect(verifyChain([])).toEqual({ valid: true, checked: 0, headHash: GENESIS_HASH });
  });

  it("detects a modified field", () => {
    const entries = chain(4);
    entries[1] = { ...entries[1], actor: "someone-else" };
    expect(verifyChain(entries)).toMatchObject({ valid: false, firstInvalidSeq: 2 });
  });

  it("detects modified nested data", () => {
    const entries = chain(3);
    (entries[2].data.nested as { a: number }).a = 99;
    expect(verifyChain(entries)).toMatchObject({ valid: false, firstInvalidSeq: 3 });
  });

  it("detects a deleted entry", () => {
    const entries = chain(4);
    entries.splice(1, 1);
    expect(verifyChain(entries).valid).toBe(false);
  });

  it("detects reordered entries", () => {
    const entries = chain(4);
    [entries[1], entries[2]] = [entries[2], entries[1]];
    expect(verifyChain(entries).valid).toBe(false);
  });

  it("detects a tampered entry even when its own hash is recomputed (chain breaks downstream)", () => {
    const entries = chain(3);
    const forged = buildEntry(undefined, { ...entries[0], actor: "forger" });
    const v = verifyChain([{ ...forged, seq: 1 }, entries[1], entries[2]]);
    expect(v).toMatchObject({ valid: false, firstInvalidSeq: 2 });
  });

  it("documents a known limit: truncating the tail is not detectable from the log alone", () => {
    const entries = chain(4);
    expect(verifyChain(entries.slice(0, 2)).valid).toBe(true);
    expect(verifyChain(entries.slice(0, 2)).headHash).not.toBe(verifyChain(entries).headHash);
  });
});
