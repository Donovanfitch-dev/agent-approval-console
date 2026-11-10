import { NextResponse } from "next/server";
import { ValidationError, hasErrorCode, isDomainError, type DomainErrorCode, type ValidationIssue } from "@/domain/errors";
import { InvalidRoleError, MissingRoleError } from "./actors";

const STATUS_BY_CODE: Record<DomainErrorCode, number> = {
  validation_failed: 422,
  illegal_transition: 409,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  idempotency_conflict: 409,
};

const NO_STORE = { "Cache-Control": "no-store" };
const MAX_BODY_BYTES = 64 * 1024;

export function ok(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status, headers: NO_STORE });
}

export function errorResponse(error: unknown): NextResponse {
  if (isDomainError(error)) {
    const body: { code: string; message: string; issues?: ValidationIssue[] } = { code: error.code, message: error.message };
    if (hasErrorCode(error, "validation_failed")) body.issues = (error as ValidationError).issues;
    return NextResponse.json({ error: body }, { status: STATUS_BY_CODE[error.code], headers: NO_STORE });
  }
  if (error instanceof MissingRoleError || error instanceof InvalidRoleError) {
    return NextResponse.json(
      { error: { code: error instanceof MissingRoleError ? "unauthenticated" : "invalid_role", message: error.message } },
      { status: error instanceof MissingRoleError ? 401 : 400, headers: NO_STORE },
    );
  }
  if (error instanceof UnsupportedMediaTypeError || error instanceof PayloadTooLargeError || error instanceof DemoControlsDisabledError) {
    const [code, status] =
      error instanceof UnsupportedMediaTypeError
        ? ["unsupported_media_type", 415]
        : error instanceof PayloadTooLargeError
          ? ["payload_too_large", 413]
          : ["demo_controls_disabled", 403];
    return NextResponse.json({ error: { code, message: error.message } }, { status, headers: NO_STORE });
  }
  console.error("Unhandled error in route handler", error);
  return NextResponse.json(
    { error: { code: "internal_error", message: "Unexpected server error" } },
    { status: 500, headers: NO_STORE },
  );
}

/** Mutating requests must declare JSON, which also keeps cross-site HTML forms (text/plain, urlencoded) out. */
export class UnsupportedMediaTypeError extends Error {
  constructor() {
    super('Mutating requests must send "Content-Type: application/json".');
    this.name = "UnsupportedMediaTypeError";
  }
}

export class PayloadTooLargeError extends Error {
  constructor() {
    super(`Request body exceeds ${MAX_BODY_BYTES} bytes.`);
    this.name = "PayloadTooLargeError";
  }
}

export class DemoControlsDisabledError extends Error {
  constructor() {
    super("Demo controls are disabled. Start the server with ENABLE_DEMO_CONTROLS=1 to use them.");
    this.name = "DemoControlsDisabledError";
  }
}

/** Throw unless the request declares `application/json`. Call first in every mutating handler. */
export function requireJson(request: Request): void {
  const type = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (type !== "application/json") throw new UnsupportedMediaTypeError();
}

/** DEMO ONLY routes (reset, tamper) are inert unless this environment flag is set to "1". */
export function requireDemoControls(): void {
  if (process.env.ENABLE_DEMO_CONTROLS !== "1") throw new DemoControlsDisabledError();
}

/** True when the demo reset/tamper controls are enabled (read per request, not at build time). */
export function demoControlsEnabled(): boolean {
  return process.env.ENABLE_DEMO_CONTROLS === "1";
}

/** Read the body as bytes, stopping as soon as the cap is exceeded (not after buffering it all). */
async function readBodyText(request: Request): Promise<string> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new PayloadTooLargeError();
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new PayloadTooLargeError();
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/** Read a JSON body (size-capped in bytes); malformed input becomes a ValidationError (422). */
export async function readJson(request: Request): Promise<unknown> {
  requireJson(request);
  const text = await readBodyText(request);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ValidationError([{ path: "(body)", message: "request body must be valid JSON" }]);
  }
}

/** Like readJson, but an empty body means "no input" ({}). */
export async function readOptionalJson(request: Request): Promise<unknown> {
  requireJson(request);
  const text = await readBodyText(request);
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ValidationError([{ path: "(body)", message: "request body must be valid JSON" }]);
  }
}

/** Wrap a handler so thrown errors become structured JSON responses. */
export async function guard(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await fn();
  } catch (e) {
    return errorResponse(e);
  }
}
