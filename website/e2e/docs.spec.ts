import { expect, test } from "@playwright/test";
import { formatDate } from "../src/lib/release";
import { groups, latest, published } from "./release";

test("the changelog shows the public releases newest first, with their files", async ({ page }) => {
  await page.goto("/changelog/");
  const releases = page.locator("article.release");
  await expect(releases.getByRole("heading", { level: 2 })).toHaveText(
    published.map((release) => `Diffloupe ${release.version}`),
  );
  await expect(page.locator(".count")).toHaveText(
    published.length === 1 ? "1 release" : `${published.length} releases`,
  );
  await expect(page.locator("main")).not.toContainText("Diffloupe 0.1.0");
  const first = releases.first();
  await expect(first.locator(".release-date")).toHaveText(formatDate(latest.date));
  await expect(first.locator(".release-tags")).toHaveText(`v${latest.version}Latest`);
  await expect(first.getByRole("link", { name: "Disk image" })).toHaveAttribute(
    "href",
    latest.dmg.url,
  );
  await expect(first.getByRole("link", { name: "Download" })).toHaveAttribute("href", "/download/");
  await expect(first.getByRole("heading", { level: 3 })).toHaveText(groups(latest.version));
  await expect(page.getByRole("link", { name: "Download the latest release" })).toHaveAttribute(
    "href",
    "/download/",
  );
});

test("the privacy page says there are no trackers and that the code is open source", async ({
  page,
}) => {
  await page.goto("/privacy/");
  const main = page.locator("main");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "No trackers. Your code stays on your computer.",
  );
  await expect(main).toContainText(
    "Diffloupe is open source, so you can read every line of what it does.",
  );
  await expect(main).toContainText("It has no account and sends no usage data,");
  const words = [
    await page.title(),
    await page.locator("meta[name=description]").getAttribute("content"),
    await main.textContent(),
  ].join(" ");
  expect(words).not.toMatch(/github|cloudflare|pages|host/i);
});
