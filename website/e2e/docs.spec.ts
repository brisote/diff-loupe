import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const fixture: {
  releases: { tag_name: string; assets: { name: string; browser_download_url: string }[] }[];
} = JSON.parse(readFileSync(new URL("../src/data/release.fixture.json", import.meta.url), "utf8"));

test("the changelog shows the public releases newest first, with their files", async ({ page }) => {
  await page.goto("/changelog/");
  const releases = page.locator("article.release");
  await expect(releases.getByRole("heading", { level: 2 })).toHaveText(["Diffloupe 0.2.0"]);
  await expect(page.locator(".count")).toHaveText("1 release");
  await expect(page.locator("main")).not.toContainText("0.1.0");
  const first = releases.first();
  await expect(first.locator(".release-date")).toHaveText("November 3, 2026");
  await expect(first.locator(".release-tags")).toHaveText("v0.2.0Latest");
  const dmg = fixture.releases[0]?.assets.find((asset) => asset.name === "Diffloupe-0.2.0.dmg");
  await expect(first.getByRole("link", { name: "Disk image" })).toHaveAttribute(
    "href",
    dmg?.browser_download_url ?? "",
  );
  await expect(first.getByRole("link", { name: "Download" })).toHaveAttribute("href", "/download/");
  await expect(first.getByRole("heading", { level: 3 })).toHaveText(["Review", "Git", "Install"]);
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
    "No trackers. Your code stays on your Mac.",
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
