import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { resetDemo } from "./helpers";

test.beforeEach(async ({ page }) => {
  await resetDemo(page);
});

const PAGES = [
  { name: "queue", path: "/", h1: "Approval queue" },
  { name: "proposal detail", path: "/proposals/PR-1002", h1: "PR-1002" },
  { name: "proposal detail (edit form open)", path: "/proposals/PR-1003", h1: "PR-1003", openEdit: true },
  { name: "audit log", path: "/audit", h1: "Audit log" },
  { name: "not found", path: "/proposals/PR-9999", h1: "Not found" },
] as const;

/** Load a page and confirm the intended page (not an error or a different route) rendered. */
async function load(page: Page, p: (typeof PAGES)[number]) {
  await page.goto(p.path);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(p.h1);
  if ("openEdit" in p && p.openEdit) {
    await page.getByRole("button", { name: /Edit & approve/ }).click();
    await expect(page.getByRole("button", { name: "Save edit & approve" })).toBeVisible();
  }
}

test.describe("no horizontal overflow", () => {
  for (const width of [375, 320]) {
    for (const p of PAGES) {
      test(`${p.name} at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: width === 375 ? 812 : 568 });
        await load(page, p);
        const { scrollWidth, clientWidth } = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }));
        expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
      });
    }
  }

  for (const width of [375, 320]) {
    test(`interactive controls are at least 40px in both dimensions at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 375 ? 812 : 568 });
      for (const p of PAGES.slice(0, 4)) {
        await load(page, p);
        const small = await page.evaluate(() => {
          const out: string[] = [];
          for (const el of document.querySelectorAll("a[href], button, select, input, textarea, summary")) {
            if (el.classList.contains("skip-link")) continue;
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue;
            if (r.height < 40 || r.width < 40) out.push(`${el.tagName} "${(el.textContent ?? "").trim().slice(0, 25)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
          }
          return out;
        });
        expect(small, p.name).toEqual([]);
      }
    });
  }
});

test.describe("page structure", () => {
  const TITLES: [string, string][] = [
    ["/", "Approval queue · Agent Approval Console"],
    ["/proposals/PR-1002", "PR-1002 · Issue refund · Agent Approval Console"],
    ["/audit", "Audit log · Agent Approval Console"],
    ["/proposals/PR-9999", "Proposal not found · Agent Approval Console"],
  ];
  for (const [path, title] of TITLES) {
    test(`${path} has lang, a distinct title, one h1, and landmarks`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveTitle(title);
      await expect(page.locator("html")).toHaveAttribute("lang", "en");
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expect(page.getByRole("main")).toHaveCount(1);
      await expect(page.getByRole("banner")).toHaveCount(1);
      await expect(page.getByRole("contentinfo")).toHaveCount(1);
      await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
    });
  }
});

test.describe("axe: no serious or critical violations", () => {
  for (const scheme of ["light", "dark"] as const) {
    for (const viewport of [
      { label: "mobile 375px", width: 375, height: 812 },
      { label: "desktop 1280px", width: 1280, height: 800 },
    ]) {
      for (const p of PAGES) {
        test(`${p.name}, ${scheme}, ${viewport.label}`, async ({ page }) => {
          await page.emulateMedia({ colorScheme: scheme });
          await page.setViewportSize({ width: viewport.width, height: viewport.height });
          await load(page, p);
          const results = await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
            .analyze();
          const blocking = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
          expect(
            blocking.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`),
          ).toEqual([]);
        });
      }
    }
  }

  test("focus indicator is visible on interactive controls in both themes", async ({ page }) => {
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/");
      for (let i = 0; i < 6; i++) {
        await page.keyboard.press("Tab");
        const outline = await page.evaluate(() => {
          const cs = getComputedStyle(document.activeElement as Element);
          return { style: cs.outlineStyle, width: parseFloat(cs.outlineWidth) };
        });
        expect(outline.style, `${scheme} tab ${i}`).not.toBe("none");
        expect(outline.width).toBeGreaterThanOrEqual(2);
      }
    }
  });
});
