import { NotFoundError } from "@/domain/errors";
import { guard, ok, requireDemoControls, requireJson } from "@/server/http";
import { getApp } from "@/server/store";

export const dynamic = "force-dynamic";

/**
 * DEMO ONLY: simulates someone editing a stored audit row directly in the
 * database (bypassing the application) so you can watch verification fail.
 * The application itself has no way to modify or delete audit entries.
 * Requires ENABLE_DEMO_CONTROLS=1.
 */
export function POST(request: Request) {
  return guard(async () => {
    requireDemoControls();
    requireJson(request);
    const { repo, service } = await getApp();
    const seq = Math.max(1, Math.ceil(repo.auditLength / 2));
    if (!repo.tamperWithAuditEntryForDemo(seq)) throw new NotFoundError("No audit entry to tamper with");
    return ok({ tamperedSeq: seq, verification: (await service.auditReport()).verification });
  });
}
