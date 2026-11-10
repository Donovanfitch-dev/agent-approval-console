import { guard, ok } from "@/server/http";
import { resetApp } from "@/server/store";

export const dynamic = "force-dynamic";

/** DEMO ONLY: discard all in-memory state and re-seed the synthetic data. */
export function POST() {
  return guard(async () => {
    const { service } = await resetApp();
    return ok({ reset: true, counts: await service.counts() });
  });
}
