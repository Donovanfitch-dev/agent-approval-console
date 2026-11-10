import type { NextRequest } from "next/server";
import { getApp } from "@/server/store";
import { actorFromRequest } from "@/server/actors";
import { guard, ok, readJson } from "@/server/http";
import { parseDecision } from "@/server/parse";

export const dynamic = "force-dynamic";

/** Record a decision: { decision: "approve" | "reject" | "edit_approve", comment?, reason?, payload? }. */
export function POST(request: NextRequest, ctx: RouteContext<"/api/proposals/[id]/decision">) {
  return guard(async () => {
    const { actor } = actorFromRequest(request);
    const { id } = await ctx.params;
    const decision = parseDecision(await readJson(request));
    const { service } = await getApp();
    return ok({ proposal: await service.decide(id, actor, decision) });
  });
}
