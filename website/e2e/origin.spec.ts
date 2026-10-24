import { expect, test } from "@playwright/test";
import { port } from "../playwright.config";
import { missing, pages } from "./pages";

const allowed = new Set(["'self'", "'none'"]);

for (const path of [...pages.map((target) => target.path), missing.path]) {
  test(`${path} loads only from its own origin and sets no cookie`, async ({ page, context }) => {
    const elsewhere: string[] = [];
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.host !== `127.0.0.1:${port}`) {
        elsewhere.push(url.href);
        return route.abort();
      }
      return route.continue();
    });
    await page.addInitScript(() => {
      document.addEventListener("securitypolicyviolation", (event) => {
        document.documentElement.dataset.blocked = `${event.violatedDirective} ${event.blockedURI}`;
      });
    });
    await page.goto(path, { waitUntil: "networkidle" });
    expect(elsewhere).toEqual([]);
    expect(await page.locator("html").getAttribute("data-blocked")).toBeNull();
    expect(await context.cookies()).toEqual([]);
    const policy =
      (await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute("content")) ??
      "";
    const directives = policy.split(";").map((directive) => directive.trim().split(/\s+/));
    expect(directives.find(([name]) => name === "default-src")?.slice(1)).toEqual(["'none'"]);
    for (const [name, ...sources] of directives) {
      expect(
        sources.filter((source) => !allowed.has(source)),
        `${name} sources`,
      ).toEqual([]);
    }
  });
}
