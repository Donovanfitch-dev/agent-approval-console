import { expect, test } from "@playwright/test";
import { feedbackAlert, openProposal, resetDemo, setRole, statusBadge, tabTo } from "./helpers";

test.beforeEach(async ({ page }) => {
  await resetDemo(page);
});

test.describe("queue", () => {
  test("renders the seeded data with counts and filters", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Approval queue" })).toBeVisible();
    await expect(page.getByText("5 awaiting review")).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "12 proposals" })).toBeVisible();
    await expect(page.getByRole("link", { name: /^PR-1002 · Issue refund/ })).toBeVisible();

    await page.getByRole("link", { name: /^Pending approval/ }).click();
    await expect(page).toHaveURL(/status=pending_approval/);
    await expect(page.getByRole("heading", { level: 2, name: "5 proposals matching filters" })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Pending approval/ })).toHaveAttribute("aria-current", "true");

    await page.getByRole("link", { name: /^High/ }).click();
    await expect(page).toHaveURL(/risk=needs_two_approvals/);
    await expect(page.getByRole("heading", { level: 2, name: "2 proposals matching filters" })).toBeVisible();
  });

  test("shows an empty state for filters with no matches", async ({ page }) => {
    await page.goto("/?status=executing&risk=deny");
    await expect(page.getByText("No proposals match these filters.")).toBeVisible();
  });

  test("simulate agent creates a new proposal", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Scenario").selectOption("address_after_shipment");
    await page.getByRole("button", { name: "Simulate agent proposal" }).click();
    const result = page.getByText(/Submitted PR-1013 with status/);
    await expect(result).toContainText("rejected");
    await expect(page.getByRole("heading", { level: 2, name: "13 proposals" })).toBeVisible();
    await page.getByRole("link", { name: "PR-1013", exact: true }).click();
    await expect(page.getByText("Blocked by policy").first()).toBeVisible();
  });
});

test.describe("role switching", () => {
  test("changes identity, persists across reload, and labels the demo stand-in", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("note").first()).toContainText("stand-in for real authentication");
    await setRole(page, "reviewer_b");
    await page.reload();
    await expect(page.getByLabel("Acting as")).toHaveValue("reviewer_b");
    await expect(page.getByText("Identity:")).toContainText("reviewer-b");
  });
});

test.describe("decisions", () => {
  test("a single approval approves a one-approver proposal", async ({ page }) => {
    await openProposal(page, "PR-1003");
    await page.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(page.locator("#action-feedback")).toContainText("Approval recorded.");
    await expect(statusBadge(page, "Approved")).toBeVisible();
    await expect(page.getByRole("button", { name: "Execute (simulated)" })).toBeVisible();
    await expect(page.getByRole("list").filter({ hasText: "audit #" }).getByText("Fully approved by reviewer-a.")).toBeVisible();
  });

  test("two-approver rule: the same reviewer cannot approve twice", async ({ page }) => {
    await openProposal(page, "PR-1002"); // seeded with one approval from reviewer-a
    await expect(page.getByText(/Approvals on the current payload/)).toContainText("1 of 2");
    await page.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(feedbackAlert(page)).toContainText("already approved");
    await expect(statusBadge(page, "Pending approval")).toBeVisible();

    await setRole(page, "reviewer_b");
    await page.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(statusBadge(page, "Approved")).toBeVisible();
    await expect(page.getByText("Fully approved by reviewer-a and reviewer-b.")).toBeVisible();
  });

  test("an agent cannot approve and the refusal is audited", async ({ page }) => {
    await openProposal(page, "PR-1003");
    await setRole(page, "agent");
    await page.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(feedbackAlert(page)).toContainText("Agents cannot review");
    await expect(statusBadge(page, "Pending approval")).toBeVisible();
    await expect(page.getByText(/tried to approve and was refused/)).toBeVisible();
  });

  test("reject requires a reason", async ({ page }) => {
    await openProposal(page, "PR-1003");
    await page.getByRole("button", { name: "Reject…" }).click();
    const reason = page.getByLabel("Reason for rejecting (required)");

    // Empty: the browser's required-field validation blocks submission.
    await page.getByRole("button", { name: "Reject proposal" }).click();
    expect(await reason.evaluate((el: HTMLTextAreaElement) => el.validity.valueMissing)).toBe(true);
    await expect(statusBadge(page, "Pending approval")).toBeVisible();

    // Whitespace only: passes the browser check, refused by the server.
    await reason.fill("   ");
    await page.getByRole("button", { name: "Reject proposal" }).click();
    await expect(feedbackAlert(page)).toContainText("a reason is required");
    await expect(statusBadge(page, "Pending approval")).toBeVisible();

    await reason.fill("Outside the return window.");
    await page.getByRole("button", { name: "Reject proposal" }).click();
    await expect(statusBadge(page, "Rejected")).toBeVisible();
    await expect(page.getByText(/Outside the return window\./).first()).toBeVisible();
  });

  test("edit-then-approve shows the diff, re-evaluates policy, and voids old approvals", async ({ page }) => {
    await openProposal(page, "PR-1002"); // $320.00, needs two approvals, reviewer-a already approved
    await setRole(page, "reviewer_b");
    await page.getByRole("button", { name: /Edit & approve/ }).click();
    await page.getByLabel("Amount (USD)").fill("80.00");
    await page.getByRole("button", { name: "Save edit & approve" }).click();

    await expect(statusBadge(page, "Approved")).toBeVisible();
    const edits = page.getByRole("region").or(page.locator("section")).filter({ has: page.getByRole("heading", { name: "Reviewer edits" }) });
    const diff = edits.getByRole("table");
    await expect(diff).toContainText("$320.00");
    await expect(diff).toContainText("$80.00");
    await expect(edits).toContainText("High risk · 2 approvals → Medium risk · 1 approval");
    await expect(page.getByText("no longer counts")).toBeVisible();
  });

  test("edit-then-approve rejects invalid and unchanged payloads without changing state", async ({ page }) => {
    await openProposal(page, "PR-1003");
    await page.getByRole("button", { name: /Edit & approve/ }).click();
    await page.getByRole("button", { name: "Save edit & approve" }).click();
    await expect(feedbackAlert(page)).toContainText("no changes");
    await page.getByLabel("Amount (USD)").fill("10000.01");
    await page.getByRole("button", { name: "Save edit & approve" }).click();
    await expect(feedbackAlert(page)).toContainText("payload.amountCents");
    await expect(statusBadge(page, "Pending approval")).toBeVisible();
  });
});

test.describe("execution", () => {
  test("two parallel execute requests perform the side effect once", async ({ page }) => {
    await openProposal(page, "PR-1009"); // seeded: approved, not yet executed
    await page.getByRole("button", { name: "Send 2 parallel execute requests" }).click();
    await expect(page.locator("#action-feedback")).toContainText("Side effect performed 1 time(s)");
    await expect(statusBadge(page, "Executed")).toBeVisible();
    await expect(page.getByText("Attempts: 1")).toBeVisible();

    const res = await page.request.get("/api/proposals/PR-1009");
    const { timeline } = (await res.json()) as { timeline: { type: string }[] };
    expect(timeline.filter((e) => e.type === "execution_succeeded")).toHaveLength(1);
    expect(timeline.filter((e) => e.type === "execution_started")).toHaveLength(1);

    // Executing again through the API is a no-op.
    const again = await page.request.post("/api/proposals/PR-1009/execute", { headers: { "x-demo-role": "reviewer_a", "content-type": "application/json" } });
    expect(await again.json()).toMatchObject({ performed: false, outcome: "already_executed" });
  });

  test("an agent cannot trigger execution and the refusal is audited", async ({ page }) => {
    await openProposal(page, "PR-1009"); // approved, not yet executed
    await setRole(page, "agent");
    await page.getByRole("button", { name: "Execute (simulated)" }).click();
    await expect(feedbackAlert(page)).toContainText("Agents cannot trigger execution");
    await expect(statusBadge(page, "Approved")).toBeVisible();
    await expect(page.getByText(/tried to execute and was refused/)).toBeVisible();
    await setRole(page, "reviewer_a");
    await page.getByRole("button", { name: "Execute (simulated)" }).click();
    await expect(statusBadge(page, "Executed")).toBeVisible();
  });

  test("a failed execution is recorded and can be retried", async ({ page }) => {
    await openProposal(page, "PR-1010"); // seeded: executor failed once
    await expect(statusBadge(page, "Failed")).toBeVisible();
    await expect(page.getByText(/Simulated downstream timeout/).first()).toBeVisible();
    await page.getByRole("button", { name: "Retry execution (simulated)" }).click();
    await expect(statusBadge(page, "Executed")).toBeVisible();
    await expect(page.getByText("Attempts: 2")).toBeVisible();
  });
});

test.describe("audit log", () => {
  test("shows a valid chain, detects out-of-band tampering, and resets", async ({ page }) => {
    await page.goto("/audit");
    await expect(page.getByRole("heading", { level: 1, name: "Audit log" })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Hash chain verified: valid" })).toBeVisible();

    await page.getByRole("button", { name: "Simulate out-of-band tampering" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Hash chain verification FAILED" })).toBeVisible();
    await expect(page.getByText("unverified").first()).toBeVisible();

    await page.getByRole("button", { name: "Reset demo data" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Hash chain verified: valid" })).toBeVisible();
  });

  test("decisions made in the UI appear in the audit log", async ({ page }) => {
    await openProposal(page, "PR-1003");
    await page.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(statusBadge(page, "Approved")).toBeVisible();
    await page.getByRole("link", { name: "Audit log" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Audit log" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: /^45 entries/ })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Hash chain verified: valid" })).toBeVisible();
  });
});

test.describe("keyboard only", () => {
  test("skip link, open a proposal, approve, and reach the audit log without a mouse", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to content" });
    await expect(skip).toBeFocused();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");
    // First stop after the skip link is inside <main>, not the header navigation.
    expect(await page.evaluate(() => !!document.activeElement?.closest("main"))).toBe(true);

    await tabTo(page, page.getByRole("link", { name: /^PR-1003 · Issue refund/ }));
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("PR-1003");

    await tabTo(page, page.getByRole("button", { name: "Approve", exact: true }));
    await page.keyboard.press("Space");
    await expect(statusBadge(page, "Approved")).toBeVisible();
    // Focus is moved to the outcome so it is announced and not lost to <body>.
    await expect(page.locator("#action-feedback")).toBeFocused();
    await expect(page.locator("#action-feedback")).toContainText("Approval recorded.");

    await page.keyboard.press("Shift+Tab");
    await tabTo(page, page.getByRole("link", { name: "Audit log" }));
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { level: 1, name: "Audit log" })).toBeVisible();
  });

  test("reject with a reason using only the keyboard", async ({ page }) => {
    await openProposal(page, "PR-1005");
    await tabTo(page, page.getByRole("button", { name: "Reject…" }));
    await page.keyboard.press("Enter");
    const reason = page.getByLabel("Reason for rejecting (required)");
    await tabTo(page, reason);
    await page.keyboard.type("Duplicate of an earlier credit.");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Reject proposal" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(statusBadge(page, "Rejected")).toBeVisible();
    await expect(page.locator("#action-feedback")).toBeFocused();
  });

  test("no keyboard trap: Tab walks the whole page and leaves the document", async ({ page }) => {
    await openProposal(page, "PR-1003");
    const stops: string[] = [];
    for (let i = 0; i < 80; i++) {
      await page.keyboard.press("Tab");
      const desc = await page.evaluate(() => {
        const el = document.activeElement;
        return !el || el === document.body ? "BODY" : `${el.tagName}:${el.id || el.textContent?.trim().slice(0, 20)}`;
      });
      if (desc === "BODY") break;
      stops.push(desc);
    }
    expect(stops.length).toBeGreaterThan(8);
    expect(stops.length).toBeLessThan(80);
  });

  test("no keyboard trap inside the edit form: Escape-free forward and backward traversal", async ({ page }) => {
    await openProposal(page, "PR-1003");
    await tabTo(page, page.getByRole("button", { name: /Edit & approve/ }));
    await page.keyboard.press("Enter");
    const amount = page.getByLabel("Amount (USD)");
    await tabTo(page, amount);
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Reason", { exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Save edit & approve" })).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(amount).toBeFocused();
  });
});
