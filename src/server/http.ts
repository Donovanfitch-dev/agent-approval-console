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
  console.error("Unhandled error in route handler", error);
  return NextResponse.json(
    { error: { code: "internal_error", message: "Unexpected server error" } },
    { status: 500, headers: NO_STORE },
  );
}

/** Read a size-limited JSON body; malformed input becomes a ValidationError (422). */
export async function readJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) {
    throw new ValidationError([{ path: "(body)", message: `request body exceeds ${MAX_BODY_BYTES} bytes` }]);
  }
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
