import { expect, type Locator, type Page } from "@playwright/test";

export type Role = "agent" | "reviewer_a" | "reviewer_b" | "admin";

/** Restore the seeded demo state. Seeded ids are deterministic (PR-1001 .. PR-1012). */
export async function resetDemo(page: Page): Promise<void> {
  const res = await page.request.post("/api/demo/reset", { headers: { "content-type": "application/json" } });
  expect(res.ok()).toBe(true);
}

const IDENTITY: Record<Role, string> = {
  agent: "agent:demo-operator",
  reviewer_a: "reviewer-a",
  reviewer_b: "reviewer-b",
  admin: "admin",
};

/** Switch the demo role through the UI and wait until the header shows it. */
export async function setRole(page: Page, role: Role): Promise<void> {
  await page.getByLabel("Acting as").selectOption(role);
  await expect(page.getByText("Identity:")).toContainText(IDENTITY[role]);
}

export async function openProposal(page: Page, id: string): Promise<void> {
  await page.goto(`/proposals/${id}`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(id);
}

/** Press Tab until `target` has focus (fails if it never does: a keyboard-reachability check). */
export async function tabTo(page: Page, target: Locator, max = 80): Promise<void> {
  for (let i = 0; i < max; i++) {
    if (await target.evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  throw new Error("Element was not reachable by keyboard within the tab limit");
}

/** The action-result region (excludes Next's own route-announcer alert). */
export function feedbackAlert(page: Page): Locator {
  return page.locator("#action-feedback [role=alert]");
}

export function statusBadge(page: Page, text: string): Locator {
  return page.locator("h1 ~ span.badge, h1 + span.badge").filter({ hasText: text });
}
