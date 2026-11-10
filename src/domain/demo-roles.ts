import type { Actor } from "./types";

/**
 * DEMO STAND-IN for authentication. A "role" is just a label picked from a
 * dropdown; there are no users, passwords, or sessions. The domain only ever
 * sees the resulting `Actor`, which is exactly what a real auth layer would
 * supply (a verified identity and a coarse kind).
 */
export const DEMO_ROLES = ["agent", "reviewer_a", "reviewer_b", "admin"] as const;
export type DemoRole = (typeof DEMO_ROLES)[number];

export const DEMO_ROLE_LABELS: Record<DemoRole, string> = {
  agent: "Agent",
  reviewer_a: "Reviewer A",
  reviewer_b: "Reviewer B",
  admin: "Admin",
};

export const DEMO_ACTORS: Record<DemoRole, Actor> = {
  agent: { id: "agent:demo-operator", kind: "agent" },
  reviewer_a: { id: "reviewer-a", kind: "reviewer" },
  reviewer_b: { id: "reviewer-b", kind: "reviewer" },
  admin: { id: "admin", kind: "admin" },
};

export const DEFAULT_DEMO_ROLE: DemoRole = "reviewer_a";

export function isDemoRole(value: unknown): value is DemoRole {
  return typeof value === "string" && (DEMO_ROLES as readonly string[]).includes(value);
}
