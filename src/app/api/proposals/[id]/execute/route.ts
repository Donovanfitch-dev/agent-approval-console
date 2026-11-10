import type { NextRequest } from "next/server";
import { getApp } from "@/server/store";
import { actorFromRequest } from "@/server/actors";
import { guard, ok, requireJson } from "@/server/http";

export const dynamic = "force-dynamic";

/**
 * Execute an approved proposal. Reviewer and admin roles only (an agent gets
 * 403 and the refusal is audited). Idempotent: repeating the call never repeats
 * the side effect. `performed` is true only for the call that ran the executor.
 */
export function POST(request: NextRequest, ctx: RouteContext<"/api/proposals/[id]/execute">) {
  return guard(async () => {
    requireJson(request);
    const { actor } = actorFromRequest(request);
    const { id } = await ctx.params;
    const { service } = await getApp();
    return ok(await service.execute(id, actor));
  });
}
