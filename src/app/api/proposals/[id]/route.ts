import type { NextRequest } from "next/server";
import { getApp } from "@/server/store";
import { guard, ok } from "@/server/http";

export const dynamic = "force-dynamic";

export function GET(_request: NextRequest, ctx: RouteContext<"/api/proposals/[id]">) {
  return guard(async () => {
    const { id } = await ctx.params;
    const { service } = await getApp();
    return ok(await service.get(id));
  });
}
