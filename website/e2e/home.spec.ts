import { expect, test } from "@playwright/test";
import { loadImages } from "./design";

test("every Download link on the home page leads to the Download page", async ({ page }) => {
  await page.goto("/");
  const links = {
    header: page.locator("header.header").getByRole("link", { name: "Download" }),
    hero: page.locator(".hero").getByRole("link", { name: "Download for Mac" }),
    pricing: page.locator(".plan").getByRole("link", { name: "Download free" }),
    closing: page.locator(".closing").getByRole("link", { name: "Download" }),
    footer: page.locator("footer.footer").getByRole("link", { name: "Download" }),
  };
  for (const [place, link] of Object.entries(links))
    await expect(link, place).toHaveAttribute("href", "/download/");
  await expect(page.getByRole("link", { name: /^Download/ })).toHaveCount(5);
});

test("the questions open and close with the keyboard", async ({ page }) => {
  await page.goto("/");
  for (const question of ["What do I need?", "Do I need an account?"]) {
    const details = page.locator("details", { has: page.getByText(question, { exact: true }) });
    const summary = details.locator("summary");
    await summary.focus();
    await page.keyboard.press("Enter");
    await expect(details).toHaveAttribute("open", "");
    await page.keyboard.press(" ");
    await expect(details).not.toHaveAttribute("open");
  }
});

test("each screenshot shows the source of the colour scheme", async ({ page }, info) => {
  const scheme = info.project.use.colorScheme === "dark" ? "dark" : "light";
  await page.goto("/");
  await loadImages(page);
  const sources = await page
    .locator("main picture img")
    .evaluateAll((images) => images.map((image) => (image as HTMLImageElement).currentSrc));
  expect(sources).toHaveLength(13);
  for (const source of sources)
    expect(source).toMatch(new RegExp(`-${scheme}\\.[^/]+\\.(avif|webp)$`));
});

test("the first load at desktop width stays below 1.5 MB", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) < 1440, "desktop width only");
  const sizes: Promise<number>[] = [];
  page.on("requestfinished", (request) => {
    sizes.push(request.sizes().then((size) => size.responseBodySize + size.responseHeadersSize));
  });
  await page.goto("/", { waitUntil: "networkidle" });
  const bytes = (await Promise.all(sizes)).reduce((sum, size) => sum + size, 0);
  expect(bytes).toBeGreaterThan(100_000);
  expect(bytes).toBeLessThan(1.5 * 1024 * 1024);
});

test("sections below the first screen fade in once as they scroll into view", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveClass(/js-reveal/);
  const last = page.locator("[data-reveal]").last();
  expect((await last.boundingBox())?.y ?? 0).toBeGreaterThan(page.viewportSize()?.height ?? 0);
  await expect(last).not.toHaveClass(/is-in/);
  await expect(last).toHaveCSS("opacity", "0");
  await last.scrollIntoViewIfNeeded();
  await expect(last).toHaveClass(/is-in/);
  await expect(last).toHaveCSS("opacity", "1");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(700);
  await expect(last).toHaveClass(/is-in/);
  await expect(last).toHaveCSS("opacity", "1");
});

test("sections on the first screen are never hidden", async ({ page }) => {
  await page.goto("/");
  for (const item of await page.locator("[data-reveal]").all()) {
    const top = (await item.boundingBox())?.y ?? 0;
    if (top < (page.viewportSize()?.height ?? 0)) await expect(item).toHaveClass(/is-in/);
  }
});

test("nothing fades in when reduced motion is set", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator("html")).not.toHaveClass(/js-reveal/);
  for (const item of await page.locator("[data-reveal]").all())
    await expect(item).toHaveCSS("opacity", "1");
});

test("the GitHub button and the Open source chip lead to the repository", async ({ page }) => {
  const repository = "https://github.com/brisote/diff-loupe";
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Diffloupe on GitHub" })).toHaveAttribute(
    "href",
    repository,
  );
  await expect(page.locator(".hero .chip-link")).toHaveAttribute("href", repository);
  await expect(page.locator(".hero-actions").getByRole("link")).toHaveText(["Download for Mac"]);
});
