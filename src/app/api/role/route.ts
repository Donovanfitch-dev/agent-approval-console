import type { NextRequest } from "next/server";
import { DEFAULT_DEMO_ROLE, DEMO_ACTORS, isDemoRole } from "@/domain/demo-roles";
import { ValidationError } from "@/domain/errors";
import { ROLE_COOKIE } from "@/server/actors";
import { guard, ok, readJson } from "@/server/http";

export const dynamic = "force-dynamic";

/** DEMO ONLY: report the role currently stored in the cookie. */
export function GET(request: NextRequest) {
  return guard(async () => {
    const value = request.cookies.get(ROLE_COOKIE)?.value;
    const role = isDemoRole(value) ? value : DEFAULT_DEMO_ROLE;
    return ok({ role, actor: DEMO_ACTORS[role], demoOnly: true });
  });
}

/** DEMO ONLY: choose a role. This is a label, not authentication. Body: { role }. */
export function POST(request: NextRequest) {
  return guard(async () => {
    const body = (await readJson(request)) as { role?: unknown } | null;
    const role = body?.role;
    if (!isDemoRole(role)) {
      throw new ValidationError([{ path: "role", message: "must be one of: agent, reviewer_a, reviewer_b, admin" }]);
    }
    const response = ok({ role, actor: DEMO_ACTORS[role], demoOnly: true });
    response.cookies.set(ROLE_COOKIE, role, { path: "/", sameSite: "lax", httpOnly: true, maxAge: 60 * 60 * 24 });
    return response;
  });
}
