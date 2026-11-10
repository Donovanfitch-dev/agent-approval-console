import { getApp } from "@/server/store";
import { guard, ok } from "@/server/http";

export const dynamic = "force-dynamic";

/** The full audit log plus hash-chain verification. */
export function GET() {
  return guard(async () => {
    const { service } = await getApp();
    return ok(await service.auditReport());
  });
}
