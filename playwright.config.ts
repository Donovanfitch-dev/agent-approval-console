import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests run against the PRODUCTION build on a non-default port.
 * The app keeps all state in one process's memory, so tests share one server:
 * they run serially (workers: 1) and each test resets state first through the
 * demo reset endpoint.
 */
const PORT = Number(process.env.E2E_PORT ?? 4317);
// CI builds once in an earlier step and sets E2E_SKIP_BUILD=1 so the build is not repeated.
const START = process.env.E2E_SKIP_BUILD
  ? `npx next start -p ${PORT}`
  : `npm run build && npx next start -p ${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: "list",
  timeout: 30_000,
  expect: { timeout: 7_000 },
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: START,
    // The reset/tamper endpoints are inert unless this flag is set; the suite uses reset before every test.
    env: { ENABLE_DEMO_CONTROLS: "1" },
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 240_000,
  },
});
