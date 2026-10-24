import { defineConfig, devices } from "@playwright/test";

export const port = 4322;

const browsers = { chromium: devices["Desktop Chrome"], webkit: devices["Desktop Safari"] };
const sizes = { desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } };
const schemes = ["light", "dark"] as const;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: `http://127.0.0.1:${port}`, trace: "retain-on-failure" },
  webServer: {
    command: `pnpm build && pnpm preview --host 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: false,
    timeout: 300_000,
  },
  projects: [
    ...Object.entries(browsers).flatMap(([browser, device]) =>
      Object.entries(sizes).flatMap(([size, viewport]) =>
        schemes.map((colorScheme) => ({
          name: `${browser}-${size}-${colorScheme}`,
          testIgnore: /no-js\.spec\.ts/,
          use: { ...device, viewport, colorScheme },
        })),
      ),
    ),
    {
      name: "no-js",
      testMatch: /no-js\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: sizes.desktop, javaScriptEnabled: false },
    },
  ],
});
