import type { NextRequest } from "next/server";
import { ValidationError } from "@/domain/errors";
import { SCENARIO_IDS, simulateSubmission } from "@/domain/simulate";
import { guard, ok, readOptionalJson } from "@/server/http";
import { getApp } from "@/server/store";

export const dynamic = "force-dynamic";

/** Demo control: have the synthetic agent submit a new proposal. Body: { scenario?: string }. */
export function POST(request: NextRequest) {
  return guard(async () => {
    const body = (await readOptionalJson(request)) as { scenario?: unknown } | null;
    const scenario = typeof body?.scenario === "string" && body.scenario !== "random" ? body.scenario : undefined;
    if (scenario && !SCENARIO_IDS.includes(scenario)) {
      throw new ValidationError([{ path: "scenario", message: `must be "random" or one of: ${SCENARIO_IDS.join(", ")}` }]);
    }
    const { service } = await getApp();
    return ok(await service.submit(simulateSubmission(Math.random, scenario)), 201);
  });
}
