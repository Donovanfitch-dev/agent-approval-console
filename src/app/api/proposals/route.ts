import type { NextRequest } from "next/server";
import { getApp } from "@/server/store";
import { guard, ok, readJson } from "@/server/http";
import { parseListQuery } from "@/server/parse";

export const dynamic = "force-dynamic";

/** List proposals, optionally filtered: ?status=&risk=&q= . Includes counts for the whole queue. */
export function GET(request: NextRequest) {
  return guard(async () => {
    const filter = parseListQuery(request.nextUrl.searchParams);
    const { service } = await getApp();
    const [proposals, counts] = await Promise.all([service.list(filter), service.counts()]);
    return ok({ proposals, counts });
  });
}

/**
 * Submit a proposal, as an agent would. Safe to retry: the same
 * `idempotencyKey` with the same content returns the original (HTTP 200).
 * DEMO NOTE: no caller authentication; a real system would authenticate the
 * agent with a service credential and derive `agentId` from it.
 */
export function POST(request: NextRequest) {
  return guard(async () => {
    const body = await readJson(request);
    const { service } = await getApp();
    const result = await service.submit(body);
    return ok(result, result.deduplicated ? 200 : 201);
  });
}
