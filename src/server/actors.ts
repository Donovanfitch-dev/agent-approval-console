import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { DEFAULT_DEMO_ROLE, DEMO_ACTORS, isDemoRole, type DemoRole } from "@/domain/demo-roles";
import type { Actor } from "@/domain/types";

/**
 * DEMO STAND-IN for authentication.
 *
 * The caller's "identity" is whatever role label is in a cookie (or an
 * `x-demo-role` header, for curl). Nothing is verified: anyone can claim any
 * role. It exists so the approval rules (an agent cannot approve, two distinct
 * reviewers) can be demonstrated. A real deployment must derive the Actor from
 * a verified session or token and never from a client-chosen label.
 */
export const ROLE_COOKIE = "demo_role";
export const ROLE_HEADER = "x-demo-role";

export class MissingRoleError extends Error {
  constructor() {
    super(`No demo role supplied. Send a "${ROLE_HEADER}" header or set the "${ROLE_COOKIE}" cookie (agent, reviewer_a, reviewer_b, admin).`);
    this.name = "MissingRoleError";
  }
}

export class InvalidRoleError extends Error {
  constructor(value: string) {
    super(`Unknown demo role "${value}". Expected one of: agent, reviewer_a, reviewer_b, admin.`);
    this.name = "InvalidRoleError";
  }
}

/** Resolve the acting identity for an API request; throws if none is supplied. */
export function actorFromRequest(request: NextRequest): { role: DemoRole; actor: Actor } {
  const raw = request.headers.get(ROLE_HEADER) ?? request.cookies.get(ROLE_COOKIE)?.value;
  if (!raw) throw new MissingRoleError();
  if (!isDemoRole(raw)) throw new InvalidRoleError(raw);
  return { role: raw, actor: DEMO_ACTORS[raw] };
}

/** Role for rendering pages: the cookie if valid, else the default reviewer. */
export async function currentRole(): Promise<DemoRole> {
  const value = (await cookies()).get(ROLE_COOKIE)?.value;
  return isDemoRole(value) ? value : DEFAULT_DEMO_ROLE;
}
