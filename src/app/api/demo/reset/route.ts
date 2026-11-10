import { guard, ok, requireDemoControls, requireJson } from "@/server/http";
import { resetApp } from "@/server/store";

export const dynamic = "force-dynamic";

/** DEMO ONLY: discard all in-memory state and re-seed the synthetic data. */
/** Requires ENABLE_DEMO_CONTROLS=1. */
export function POST(request: Request) {
  return guard(async () => {
    requireDemoControls();
    requireJson(request);
    const { service } = await resetApp();
    return ok({ reset: true, counts: await service.counts() });
  });
}
