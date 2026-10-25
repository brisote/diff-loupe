import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { formatDate, formatSize } from "../src/lib/release";
import { latest, siteUrl } from "./release";

const command = "curl -fsSL https://diffloupe.com/install.sh | bash";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const copied: string[] = [];
    Object.defineProperty(window, "copied", { value: copied });
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async (text: string) => {
          if (document.body.dataset.denyCopy !== undefined) throw new Error("denied");
          copied.push(text);
        },
      },
    });
  });
  await page.goto("/download/");
});

test("the copy buttons put the exact commands on the clipboard", async ({ page }) => {
  await page.getByRole("button", { name: "Copy the install command" }).click();
  const button = page.locator(".install button.btn-light");
  await expect(button).toHaveText("Copy command");
  await button.click();
  await expect(button).toHaveText("Copied");
  await expect(button).toHaveText("Copy command", { timeout: 5000 });
  await page.getByRole("button", { name: "Copy the xattr command" }).click();
  expect(await page.evaluate(() => (window as unknown as { copied: string[] }).copied)).toEqual([
    command,
    command,
    "xattr -dr com.apple.quarantine /Applications/Diffloupe.app",
  ]);
});

test("the release facts and the disk image link come from the release", async ({ page }) => {
  const stats = page.locator(".stats");
  await expect(stats).toContainText(latest.version);
  await expect(stats).toContainText(formatDate(latest.date));
  await expect(stats).toContainText(formatSize(latest.dmg.size));
  const link = page.getByRole("link", { name: `Download ${latest.dmg.name}` });
  await expect(link).toHaveAttribute("href", latest.dmg.url);
  await expect(page.locator(".manual")).toContainText(`Double-click ${latest.dmg.name}`);
});

test("the page links to the script, which carries the release's checksum", async ({ page }) => {
  await expect(page.getByRole("link", { name: "diffloupe.com/install.sh" })).toHaveAttribute(
    "href",
    "/install.sh",
  );
  const response = await page.request.get("/install.sh");
  expect(response.ok()).toBe(true);
  const script = await response.text();
  expect(script.startsWith("#!/bin/bash\n")).toBe(true);
  expect(script).toContain(`url="${latest.dmg.url}"`);
  expect(script).toContain(`checksum="${latest.dmg.sha256}"`);
  expect(script.trimEnd().endsWith("install_diffloupe")).toBe(true);
});

test("the disk image instead link leads to the manual install", async ({ page }) => {
  await page.getByRole("link", { name: "Download the disk image instead" }).click();
  await expect(page).toHaveURL(/#manual$/);
  await expect(page.getByRole("heading", { name: "Prefer the disk image?" })).toBeInViewport();
});

test("the star panels appear after a copy", async ({ page }) => {
  const panels = page.locator("[data-star-panel]:visible");
  await expect(panels).toHaveCount(0);
  await page.locator(".install button.btn-light").click();
  await expect(panels).toHaveCount(2);
  await expect(panels.first().getByRole("link", { name: "Star on GitHub" })).toHaveAttribute(
    "href",
    "https://github.com/brisote/diff-loupe",
  );
});

test("the star panels appear after the disk image is downloaded", async ({ page }) => {
  const link = page.getByRole("link", { name: `Download ${latest.dmg.name}` });
  await link.evaluate((element) =>
    element.addEventListener("click", (event) => event.preventDefault()),
  );
  await link.click();
  await expect(page.locator("[data-star-panel]:visible")).toHaveCount(2);
});

test("a copy that fails shows no star panel", async ({ page }) => {
  await page.evaluate(() => {
    document.body.dataset.denyCopy = "";
  });
  await page.locator(".install button.btn-light").click();
  await expect(page.locator(".install button.btn-light")).toHaveText("Copy command");
  await expect(page.locator("[data-star-panel]:visible")).toHaveCount(0);
});

test("the latest version is plain text for the app's update check", async ({ request }) => {
  const text = siteUrl
    ? await (await request.get("/download/latest/macos/version")).text()
    : readFileSync(new URL("../dist/download/latest/macos/version", import.meta.url), "utf8");
  expect(text).toBe(`${latest.version}\n`);
});
