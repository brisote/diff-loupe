import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const fixture: {
  releases: { assets: { name: string; browser_download_url: string }[] }[];
  checksum: string;
} = JSON.parse(readFileSync(new URL("../src/data/release.fixture.json", import.meta.url), "utf8"));

const command = "curl -fsSL https://diffloupe.com/install.sh | bash";
const dmg = fixture.releases[0]?.assets.find((asset) => asset.name === "Diffloupe-0.2.0.dmg");

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
  await expect(stats).toContainText("0.2.0");
  await expect(stats).toContainText("November 3, 2026");
  await expect(stats).toContainText("11.8 MB");
  const link = page.getByRole("link", { name: `Download ${dmg?.name}` });
  await expect(link).toHaveAttribute("href", dmg?.browser_download_url ?? "");
  await expect(page.locator(".manual")).toContainText(`Double-click ${dmg?.name}`);
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
  expect(script).toContain(`url="${dmg?.browser_download_url}"`);
  expect(script).toContain(`checksum="${fixture.checksum.split(" ")[0]}"`);
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
  const link = page.getByRole("link", { name: "Download Diffloupe-0.2.0.dmg" });
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
