import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { formatDate, formatSize } from "../src/lib/release";
import { latest, latestLinux, siteUrl } from "./release";

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
  await page.goto("/download/#macos");
});

test("the copy buttons put the exact commands on the clipboard", async ({ page }) => {
  const macos = page.locator('[data-platform-section="macos"]');
  await macos.getByRole("button", { name: "Copy the install command" }).click();
  const button = macos.locator(".install button.btn-light");
  await expect(button).toHaveText("Copy command");
  await button.click();
  await expect(button).toHaveText("Copied");
  await expect(button).toHaveText("Copy command", { timeout: 5000 });
  await macos.getByRole("button", { name: "Copy the xattr command" }).click();
  expect(await page.evaluate(() => (window as unknown as { copied: string[] }).copied)).toEqual([
    command,
    command,
    "xattr -dr com.apple.quarantine /Applications/Diffloupe.app",
  ]);
});

test("the release facts and the disk image link come from the release", async ({ page }) => {
  const stats = page.locator("#macos .stats");
  await expect(stats).toContainText(latest.version);
  await expect(stats).toContainText(formatDate(latest.date));
  await expect(stats).toContainText(formatSize(latest.dmg.size));
  const link = page.getByRole("link", { name: `Download ${latest.dmg.name}` });
  await expect(link).toHaveAttribute("href", latest.dmg.url);
  await expect(page.locator('.manual [data-platform-section="macos"]')).toContainText(
    `Double-click ${latest.dmg.name}`,
  );
});

test("the Linux section shows the .deb and .rpm links and copies their commands", async ({
  page,
}) => {
  test.skip(!latestLinux, "no Linux release");
  if (!latestLinux) return;
  await page.locator("#macos details.platform-menu summary").click();
  await page.locator("#macos .platform-list").getByRole("link", { name: "Linux" }).click();
  await expect(page.locator("#linux")).toBeVisible();
  await expect(page.locator("#macos")).toBeHidden();
  const stats = page.locator("#linux .stats");
  await expect(stats).toContainText(latestLinux.version);
  await expect(stats).toContainText(formatDate(latestLinux.date));
  await expect(stats).toContainText(formatSize(latestLinux.deb.size));
  const debLink = page.getByRole("link", { name: `Download ${latestLinux.deb.name}` });
  await expect(debLink).toHaveAttribute("href", latestLinux.deb.url);
  const rpmLink = page.getByRole("link", { name: "Download the .rpm" });
  await expect(rpmLink).toHaveAttribute("href", latestLinux.rpm.url);
  await page.getByRole("button", { name: "Copy the apt command" }).click();
  await page.getByRole("button", { name: "Copy the dnf command" }).click();
  expect(await page.evaluate(() => (window as unknown as { copied: string[] }).copied)).toEqual([
    `sudo apt install ./${latestLinux.deb.name}`,
    `sudo dnf install ./${latestLinux.rpm.name}`,
  ]);
});

test("user-agent recognition and dropdown selection switch between macOS and Linux", async ({
  browser,
}) => {
  test.skip(!latestLinux, "no Linux release");
  const agents = [
    {
      ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
      expected: "macos",
      label: "macOS",
    },
    {
      ua: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
      expected: "linux",
      label: "Linux",
    },
    {
      ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
      expected: "macos",
      label: "macOS",
    },
  ] as const;

  for (const { ua, expected, label } of agents) {
    const context = await browser.newContext({ userAgent: ua });
    try {
      const page = await context.newPage();
      await page.goto("/download/");
      const active = page.locator(`#${expected}`);
      const other = page.locator(expected === "macos" ? "#linux" : "#macos");
      await expect(active).toBeVisible();
      await expect(other).toBeHidden();
      await expect(active.locator("summary.platform-btn")).toContainText(label);

      if (expected === "macos") {
        await active.locator("summary.platform-btn").click();
        await active.locator(".platform-list").getByRole("link", { name: "Linux" }).click();
        await expect(page.locator("#linux")).toBeVisible();
        await expect(page.locator("#macos")).toBeHidden();
        await expect(page.locator("#linux summary.platform-btn")).toContainText("Linux");
      } else {
        await active.locator("summary.platform-btn").click();
        await active.locator(".platform-list").getByRole("link", { name: "macOS" }).click();
        await expect(page.locator("#macos")).toBeVisible();
        await expect(page.locator("#linux")).toBeHidden();
        await expect(page.locator("#macos summary.platform-btn")).toContainText("macOS");
      }
    } finally {
      await context.close();
    }
  }
});

test("the page links to the script, which carries the macOS and Linux checksums", async ({
  page,
}) => {
  await expect(
    page.locator("#macos").getByRole("link", { name: "diffloupe.com/install.sh" }),
  ).toHaveAttribute("href", "/install.sh");
  const response = await page.request.get("/install.sh");
  expect(response.ok()).toBe(true);
  const script = await response.text();
  expect(script.startsWith("#!/bin/bash\n")).toBe(true);
  expect(script).toContain(`url="${latest.dmg.url}"`);
  expect(script).toContain(`checksum="${latest.dmg.sha256}"`);
  if (latestLinux) {
    expect(script).toContain(`deb_url="${latestLinux.deb.url}"`);
    expect(script).toContain(`deb_checksum="${latestLinux.deb.sha256}"`);
    expect(script).toContain(`rpm_url="${latestLinux.rpm.url}"`);
    expect(script).toContain(`rpm_checksum="${latestLinux.rpm.sha256}"`);
  }
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
  await page.locator("#macos .install button.btn-light").click();
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
  await page.locator("#macos .install button.btn-light").click();
  await expect(page.locator("#macos .install button.btn-light")).toHaveText("Copy command");
  await expect(page.locator("[data-star-panel]:visible")).toHaveCount(0);
});

test("the latest version files are plain text for each platform's update check", async ({
  request,
}) => {
  const macosText = siteUrl
    ? await (await request.get("/download/latest/macos/version")).text()
    : readFileSync(new URL("../dist/download/latest/macos/version", import.meta.url), "utf8");
  expect(macosText).toBe(`${latest.version}\n`);
  if (latestLinux) {
    const linuxText = siteUrl
      ? await (await request.get("/download/latest/linux/version")).text()
      : readFileSync(new URL("../dist/download/latest/linux/version", import.meta.url), "utf8");
    expect(linuxText).toBe(`${latestLinux.version}\n`);
  }
});
