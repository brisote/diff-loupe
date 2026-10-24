import { expect, test } from "@playwright/test";
import { missing, pages } from "./pages";

for (const target of pages) {
  test(`${target.path} has the shared header and footer`, async ({ page }) => {
    await page.goto(target.path);
    const header = page.locator("header.header");
    await expect(header.getByRole("link", { name: "Diffloupe", exact: true })).toHaveAttribute(
      "href",
      "/",
    );
    const nav = header.getByRole("navigation", { name: "Main" });
    await expect(nav.getByRole("link")).toHaveText(["Home", "Pricing", "Changelog", "Privacy"]);
    await expect(header.getByRole("link", { name: "Download" })).toHaveAttribute(
      "href",
      "/download/",
    );
    await expect(page.locator('header [aria-current="page"]')).toHaveText(target.current);
    const footer = page.locator("footer.footer");
    await expect(footer.getByRole("navigation", { name: "Product" }).getByRole("link")).toHaveText([
      "Home",
      "Download",
      "Changelog",
    ]);
    await expect(footer.getByRole("navigation", { name: "About" }).getByRole("link")).toHaveText([
      "Privacy",
      "Install by hand",
      "Questions",
    ]);
    await expect(page).toHaveTitle(new RegExp(target.title));
  });
}

test("the header links lead to their pages", async ({ page }) => {
  await page.goto("/");
  for (const [name, path] of [
    ["Changelog", "/changelog/"],
    ["Privacy", "/privacy/"],
    ["Home", "/"],
  ] as const) {
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name }).click();
    await expect(page).toHaveURL(path);
  }
  await page.locator("header").getByRole("link", { name: "Download" }).click();
  await expect(page).toHaveURL("/download/");
});

test("an unknown address shows the 404 page with a way back", async ({ page }) => {
  const response = await page.goto(missing.path);
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("This page is not here.");
  await expect(page.getByRole("link", { name: "Download for Mac" })).toHaveAttribute(
    "href",
    "/download/",
  );
  await expect(page.getByRole("link", { name: "Back to the home page" })).toHaveAttribute(
    "href",
    "/",
  );
  await expect(page.locator("header [aria-current]")).toHaveCount(0);
});

test("on a phone the page links sit in a row of pills under the name", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) >= 768, "phone layout only");
  await page.goto("/");
  const brand = await page.locator(".brand").first().boundingBox();
  const links = page.getByRole("navigation", { name: "Main" }).getByRole("link");
  for (const link of await links.all()) {
    await expect(link).toBeVisible();
    expect((await link.boundingBox())?.y ?? 0).toBeGreaterThan(
      (brand?.y ?? 0) + (brand?.height ?? 0),
    );
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
