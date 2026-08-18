import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], launchOptions: { executablePath: "/opt/pw-browsers/chromium" } },
    },
  ],
  webServer: {
    command: "npm run build && npm run start -- -p 3100",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: !process.env.CI,
    timeout: 180 * 1000,
    env: {
      // Force demo/mock mode for deterministic e2e results, no live keys required.
      // With ANTHROPIC_API_KEY unset, /api/identify uses the heuristic text
      // fallback; with SERPAPI_KEY unset, /api/search-prices uses mock offers.
      SERPAPI_KEY: "",
      ANTHROPIC_API_KEY: "",
    },
  },
});
