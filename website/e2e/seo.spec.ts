import { expect, test } from "@playwright/test";
import { indexedPages } from "../src/lib/seo";
import { missing, pages } from "./pages";

const meta = (name: string) => `meta[property="${name}"], meta[name="${name}"]`;

for (const target of pages) {
  test(`${target.path} has a canonical address and a link preview`, async ({ page }) => {
    await page.goto(target.path);
    const head = page.locator("head");
    const address = `https://diffloupe.com${target.path}`;
    await expect(head.locator('link[rel="canonical"]')).toHaveAttribute("href", address);
    await expect(head.locator(meta("robots"))).toHaveCount(0);
    const title = await page.title();
    const description = await head.locator('meta[name="description"]').getAttribute("content");
    expect(description?.length).toBeGreaterThan(50);
    await expect(head.locator(meta("og:title"))).toHaveAttribute("content", title);
    await expect(head.locator(meta("og:description"))).toHaveAttribute(
      "content",
      description ?? "",
    );
    await expect(head.locator(meta("og:url"))).toHaveAttribute("content", address);
    await expect(head.locator(meta("og:image"))).toHaveAttribute(
      "content",
      "https://diffloupe.com/og.jpg",
    );
    await expect(head.locator(meta("og:image:width"))).toHaveAttribute("content", "1200");
    await expect(head.locator(meta("og:image:height"))).toHaveAttribute("content", "630");
    await expect(head.locator(meta("og:image:alt"))).toHaveAttribute("content", /.+/);
    await expect(head.locator(meta("twitter:card"))).toHaveAttribute(
      "content",
      "summary_large_image",
    );
    await expect(head.locator(meta("twitter:image"))).toHaveAttribute(
      "content",
      "https://diffloupe.com/og.jpg",
    );
  });
}

test("the missing page is not indexed and has no canonical address", async ({ page }) => {
  await page.goto(missing.path);
  await expect(page.locator('head meta[name="robots"]')).toHaveAttribute("content", "noindex");
  await expect(page.locator('head link[rel="canonical"]')).toHaveCount(0);
});

test("the preview image, robots.txt and the sitemap are served by the site", async ({
  request,
}) => {
  const image = await request.get("/og.jpg");
  expect(image.ok()).toBe(true);
  expect(image.headers()["content-type"]).toBe("image/jpeg");
  expect((await image.body()).length).toBeLessThan(300_000);
  const robots = await request.get("/robots.txt");
  expect(await robots.text()).toContain("Sitemap: https://diffloupe.com/sitemap.xml");
  const sitemap = await (await request.get("/sitemap.xml")).text();
  expect(
    [...sitemap.matchAll(/<loc>https:\/\/diffloupe\.com(.*?)<\/loc>/g)].map((m) => m[1]),
  ).toEqual(indexedPages);
  expect([...indexedPages].sort()).toEqual(pages.map((target) => target.path).sort());
});

test("the home page describes the app as structured data", async ({ page }) => {
  await page.goto("/");
  const data = JSON.parse(
    (await page.locator('script[type="application/ld+json"]').textContent()) ?? "{}",
  );
  expect(data["@type"]).toBe("SoftwareApplication");
  expect(data.softwareVersion).toMatch(/^\d+\.\d+\.\d+$/);
});
