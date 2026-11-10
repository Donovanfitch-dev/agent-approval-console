import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as auditGet } from "@/app/api/audit/route";
import { POST as tamperPost } from "@/app/api/demo/tamper/route";
import { POST as resetPost } from "@/app/api/demo/reset/route";
import { POST as decisionPost } from "@/app/api/proposals/[id]/decision/route";
import { POST as executePost } from "@/app/api/proposals/[id]/execute/route";
import { POST as proposalsPost } from "@/app/api/proposals/route";
import { POST as simulatePost } from "@/app/api/simulate/route";
import { POST as rolePost } from "@/app/api/role/route";
import { parseDecision } from "@/server/parse";
import { getApp, resetApp } from "@/server/store";

/**
 * API-level tests: call the real route handlers with real Request objects
 * (no HTTP server). The store is the same globalThis singleton the app uses.
 */

const JSON_HEADERS = { "content-type": "application/json" };

function req(path: string, init: { role?: string; body?: string; headers?: Record<string, string> } = {}): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: "POST",
    headers: { ...JSON_HEADERS, ...(init.role ? { "x-demo-role": init.role } : {}), ...init.headers },
    body: init.body,
  });
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

type Json = { error?: { code: string; message: string; issues?: { path: string; message: string }[] }; [k: string]: unknown };
const body = async (res: Response) => (await res.json()) as Json;

beforeEach(async () => {
  process.env.ENABLE_DEMO_CONTROLS = "1";
  await resetApp();
});
afterEach(() => {
  delete process.env.ENABLE_DEMO_CONTROLS;
});

describe("identity and authorization", () => {
  it("returns 401 when no role is supplied, for decisions and for execution", async () => {
    const d = await decisionPost(req("/x", { body: '{"decision":"approve"}' }), ctx("PR-1003"));
    expect(d.status).toBe(401);
    expect((await body(d)).error?.code).toBe("unauthenticated");
    const e = await executePost(req("/x"), ctx("PR-1009"));
    expect(e.status).toBe(401);
  });

  it("returns 400 for an unknown role", async () => {
    const res = await executePost(req("/x", { role: "superuser" }), ctx("PR-1009"));
    expect(res.status).toBe(400);
  });

  it("returns 403 for execute as agent, audits the refusal, and does not execute", async () => {
    const res = await executePost(req("/x", { role: "agent" }), ctx("PR-1009"));
    expect(res.status).toBe(403);
    expect((await body(res)).error?.message).toMatch(/Agents cannot trigger execution/);
    const { service } = await getApp();
    const { proposal, timeline } = await service.get("PR-1009");
    expect(proposal.status).toBe("approved");
    expect(timeline.at(-1)).toMatchObject({ type: "decision_refused", data: { attempted: "execute" } });
  });

  it("returns the same 403 for execute and decide as agent on an unknown id", async () => {
    expect((await executePost(req("/x", { role: "agent" }), ctx("PR-9999"))).status).toBe(403);
    expect((await decisionPost(req("/x", { role: "agent", body: '{"decision":"approve"}' }), ctx("PR-9999"))).status).toBe(403);
  });

  it("lets a reviewer execute an approved proposal, and a second call is a no-op", async () => {
    const first = await body(await executePost(req("/x", { role: "reviewer_a" }), ctx("PR-1009")));
    expect(first).toMatchObject({ outcome: "executed", performed: true });
    const second = await body(await executePost(req("/x", { role: "reviewer_b" }), ctx("PR-1009")));
    expect(second).toMatchObject({ outcome: "already_executed", performed: false });
  });
});

describe("decision body rules", () => {
  it("rejects a payload on approve (422) and leaves the proposal untouched", async () => {
    const res = await decisionPost(
      req("/x", { role: "reviewer_a", body: JSON.stringify({ decision: "approve", payload: { amountCents: 1 } }) }),
      ctx("PR-1003"),
    );
    expect(res.status).toBe(422);
    const json = await body(res);
    expect(json.error?.issues?.[0]).toMatchObject({ path: "payload" });
    expect(json.error?.issues?.[0].message).toMatch(/only edit_approve takes a payload/);
    const { service } = await getApp();
    expect((await service.get("PR-1003")).proposal.status).toBe("pending_approval");
  });

  it("parseDecision accepts each kind's own fields and rejects the others", () => {
    expect(parseDecision({ decision: "approve", comment: "ok" })).toEqual({ kind: "approve", comment: "ok" });
    expect(parseDecision({ decision: "reject", reason: "no" })).toEqual({ kind: "reject", reason: "no" });
    expect(parseDecision({ decision: "edit_approve", payload: { a: 1 } })).toMatchObject({ kind: "edit_approve" });
    expect(() => parseDecision({ decision: "reject", payload: {} })).toThrow(/not allowed/);
    expect(() => parseDecision({ decision: "approve", reason: "x" })).toThrow(/not allowed/);
    expect(() => parseDecision({ decision: "edit_approve" })).toThrow(/edited payload is required/);
    expect(() => parseDecision({ decision: "approve", surprise: 1 })).toThrow(/unknown field/);
  });
});

describe("content type and body size", () => {
  const submission = JSON.stringify({
    type: "issue_refund",
    payload: { orderId: "ORD-777001", amountCents: 1000, currency: "USD", reasonCode: "late" },
    rationale: "Customer reported a late delivery.",
    ticketId: "TKT-9001",
    agentId: "agent:returns-assistant",
    idempotencyKey: "api-test-0001",
  });

  it("accepts application/json, including a charset parameter", async () => {
    const res = await proposalsPost(req("/x", { body: submission, headers: { "content-type": "application/json; charset=utf-8" } }));
    expect(res.status).toBe(201);
  });

  it.each(["text/plain", "application/x-www-form-urlencoded", "multipart/form-data"])("returns 415 for %s on submit", async (type) => {
    const res = await proposalsPost(req("/x", { body: submission, headers: { "content-type": type } }));
    expect(res.status).toBe(415);
    expect((await body(res)).error?.code).toBe("unsupported_media_type");
  });

  it("returns 415 on every other mutating route when the content type is wrong or missing", async () => {
    const bad = { "content-type": "text/plain" };
    expect((await decisionPost(req("/x", { role: "reviewer_a", body: "{}", headers: bad }), ctx("PR-1003"))).status).toBe(415);
    expect((await executePost(req("/x", { role: "reviewer_a", headers: bad }), ctx("PR-1009"))).status).toBe(415);
    expect((await simulatePost(req("/x", { headers: bad }))).status).toBe(415);
    expect((await rolePost(req("/x", { body: '{"role":"admin"}', headers: bad }))).status).toBe(415);
    expect((await resetPost(req("/x", { headers: bad }))).status).toBe(415);
    expect((await tamperPost(req("/x", { headers: bad }))).status).toBe(415);
    const noType = new NextRequest("http://localhost/x", { method: "POST", headers: { "x-demo-role": "reviewer_a" } });
    expect((await executePost(noType, ctx("PR-1009"))).status).toBe(415);
    const { service } = await getApp();
    expect((await service.get("PR-1009")).proposal.status).toBe("approved"); // nothing ran
  });

  it("returns 413 for a body over 64 KiB, counted in bytes while reading", async () => {
    const huge = JSON.stringify({ rationale: "x".repeat(70 * 1024) });
    expect((await proposalsPost(req("/x", { body: huge }))).status).toBe(413);
    // 40,000 two-byte characters: under the limit as UTF-16 units, over it as bytes.
    const multibyte = JSON.stringify({ rationale: "é".repeat(40_000) });
    expect(multibyte.length).toBeLessThan(64 * 1024);
    const res = await proposalsPost(req("/x", { body: multibyte }));
    expect(res.status).toBe(413);
    expect((await body(res)).error?.message).toMatch(/65536 bytes/);
  });

  it("also rejects an oversized declared content-length without reading the body", async () => {
    const res = await proposalsPost(req("/x", { body: "{}", headers: { "content-length": String(10 * 1024 * 1024) } }));
    expect(res.status).toBe(413);
  });

  it("returns 422 for malformed JSON", async () => {
    expect((await proposalsPost(req("/x", { body: "{not json" }))).status).toBe(422);
  });
});

describe("demo controls are gated by ENABLE_DEMO_CONTROLS", () => {
  it("reset and tamper return 403 without the flag and change nothing", async () => {
    delete process.env.ENABLE_DEMO_CONTROLS;
    const { service } = await getApp();
    const before = (await service.auditReport()).verification;
    const t = await tamperPost(req("/x"));
    expect(t.status).toBe(403);
    expect((await body(t)).error?.code).toBe("demo_controls_disabled");
    expect((await resetPost(req("/x"))).status).toBe(403);
    expect((await service.auditReport()).verification).toEqual(before);
    expect(before.valid).toBe(true);
  });

  it("only the exact value 1 enables them", async () => {
    process.env.ENABLE_DEMO_CONTROLS = "true";
    expect((await resetPost(req("/x"))).status).toBe(403);
  });

  it("with the flag, tamper breaks the chain and reset repairs it", async () => {
    expect((await tamperPost(req("/x"))).status).toBe(200);
    expect(((await body(await auditGet())) as { verification: { valid: boolean } }).verification.valid).toBe(false);
    expect((await resetPost(req("/x"))).status).toBe(200);
    expect(((await body(await auditGet())) as { verification: { valid: boolean } }).verification.valid).toBe(true);
  });
});
