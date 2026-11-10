"use client";

export interface ApiIssue {
  path: string;
  message: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly issues: ApiIssue[];

  constructor(message: string, status: number, issues: ApiIssue[] = []) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.issues = issues;
  }
}

/**
 * Call a JSON route handler. The current demo role is sent explicitly as a
 * header (the server also reads the cookie). DEMO ONLY: see src/server/actors.ts.
 */
export async function api<T>(path: string, init: { method?: string; role?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(path, {
    method: init.method ?? "POST",
    headers: {
      // The API requires this header on every mutating request, with or without a body.
      "Content-Type": "application/json",
      ...(init.role ? { "x-demo-role": init.role } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    // non-JSON error body; fall through to the generic message
  }
  if (!response.ok) {
    const err = (data as { error?: { message?: string; issues?: ApiIssue[] } } | null)?.error;
    throw new ApiError(err?.message ?? `Request failed (${response.status})`, response.status, err?.issues ?? []);
  }
  return data as T;
}

export function describeError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.issues.length > 0) return e.issues.map((i) => `${i.path}: ${i.message}`).join(" · ");
    return e.message;
  }
  return e instanceof Error ? e.message : "Something went wrong";
}
