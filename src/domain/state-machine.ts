import { IllegalTransitionError } from "./errors";
import type { Status } from "./types";

/**
 * Proposal lifecycle. A transition not listed here is illegal and throws.
 *
 *   proposed ─┬─> pending_approval ─┬─> approved ─> executing ─┬─> executed
 *             │                     ├─> rejected               └─> failed ─> executing (retry)
 *             ├─> approved (auto)   └─> expired
 *             └─> rejected (policy deny)
 */
export const TRANSITIONS: Readonly<Record<Status, readonly Status[]>> = {
  proposed: ["pending_approval", "approved", "rejected"],
  pending_approval: ["approved", "rejected", "expired"],
  approved: ["executing"],
  executing: ["executed", "failed"],
  failed: ["executing"],
  executed: [],
  rejected: [],
  expired: [],
};

export function canTransition(from: Status, to: Status): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Return `to` if the transition is legal, otherwise throw. */
export function transition(from: Status, to: Status): Status {
  if (!canTransition(from, to)) throw new IllegalTransitionError(from, to);
  return to;
}

export function isTerminal(status: Status): boolean {
  return TRANSITIONS[status].length === 0;
}
