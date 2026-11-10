import { describe, expect, it } from "vitest";
import { IllegalTransitionError } from "../errors";
import { canTransition, isTerminal, transition, TRANSITIONS } from "../state-machine";
import { STATUSES, type Status } from "../types";

describe("state machine", () => {
  const legal: [Status, Status][] = [
    ["proposed", "pending_approval"],
    ["proposed", "approved"],
    ["proposed", "rejected"],
    ["pending_approval", "approved"],
    ["pending_approval", "rejected"],
    ["pending_approval", "expired"],
    ["approved", "executing"],
    ["executing", "executed"],
    ["executing", "failed"],
    ["failed", "executing"],
  ];

  it.each(legal)("allows %s -> %s", (from, to) => {
    expect(transition(from, to)).toBe(to);
  });

  it("throws on every transition that is not in the table", () => {
    let illegalCount = 0;
    for (const from of STATUSES) {
      for (const to of STATUSES) {
        if (legal.some(([f, t]) => f === from && t === to)) continue;
        illegalCount++;
        expect(() => transition(from, to)).toThrow(IllegalTransitionError);
      }
    }
    expect(illegalCount).toBe(STATUSES.length * STATUSES.length - legal.length);
  });

  it("cannot skip approval or leave a terminal state", () => {
    expect(canTransition("pending_approval", "executing")).toBe(false);
    expect(canTransition("executed", "executing")).toBe(false);
    expect(canTransition("rejected", "approved")).toBe(false);
    expect(canTransition("expired", "approved")).toBe(false);
  });

  it("identifies terminal states", () => {
    expect(STATUSES.filter(isTerminal).sort()).toEqual(["executed", "expired", "rejected"]);
    expect(Object.keys(TRANSITIONS).sort()).toEqual([...STATUSES].sort());
  });
});
