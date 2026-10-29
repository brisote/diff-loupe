import type { Page } from "@playwright/test";
import { expect, type PlatformName, test } from "./fixtures";

const platforms: PlatformName[] = ["macos", "windows", "linux"];

const labels = {
  macos: { commit: "⌘K", push: "⇧⌘K", settings: "⌘,", terminal: "⌥F12" },
  windows: { commit: "Ctrl+K", push: "Ctrl+Shift+K", settings: "Ctrl+,", terminal: "Alt+F12" },
  linux: { commit: "Ctrl+K", push: "Ctrl+Shift+K", settings: "Ctrl+,", terminal: "Alt+F12" },
} as const;

for (const platform of platforms) {
  test.describe(`as ${platform}`, () => {
    test("the dev bridge reports the platform it poses as", async ({ startApp }) => {
      const app = await startApp({ platform });
      const info = (await app.bridge.call("app_info")) as { platform: string };
      expect(info.platform).toBe(platform);
    });

    test("shortcut labels use the platform's keys", async ({ page, workspace, startApp }) => {
      const repo = workspace.repo("acme-billing");
      workspace.write(repo, "a.txt", "one\n");
      await startApp({ open: [repo], platform });
      const keys = labels[platform];
      await expect(page.getByRole("button", { name: `Commit… ${keys.commit}` })).toBeVisible();
      await expect(page.getByRole("button", { name: `Terminal ${keys.terminal}` })).toBeVisible();
      await page.getByRole("button", { name: "Current branch" }).click();
      await expect(page.getByRole("menuitem", { name: "Commit…" })).toContainText(keys.commit);
      await expect(page.getByRole("menuitem", { name: "Push…" })).toContainText(keys.push);
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Settings menu" }).click();
      await expect(page.getByRole("menuitem", { name: "Settings…" })).toContainText(keys.settings);
    });

    test("the platform's modifier opens Settings and Commit, and the other one does not", async ({
      page,
      workspace,
      startApp,
    }) => {
      const repo = workspace.repo("acme-billing");
      workspace.write(repo, "a.txt", "one\n");
      await startApp({ open: [repo], platform });
      const own = platform === "macos" ? "Meta" : "Control";
      const foreign = platform === "macos" ? "Control" : "Meta";
      const settings = page.getByRole("dialog", { name: "Settings" });
      const commit = page.getByRole("dialog", { name: "Commit Changes" });
      await page.getByRole("tab", { name: "Review" }).waitFor();
      await page.keyboard.press(`${foreign}+Comma`);
      await page.keyboard.press(`${foreign}+k`);
      await expect(settings).toHaveCount(0);
      await expect(commit).toHaveCount(0);
      await page.keyboard.press(`${own}+Comma`);
      await expect(settings).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(settings).toBeHidden();
      await page.keyboard.press(`${own}+k`);
      await expect(commit).toBeVisible();
    });

    test("the window frame follows the platform", async ({ page, workspace, startApp }) => {
      const app = await startApp({ open: [workspace.repo("acme-billing")], platform });
      const controls = page.locator(".dl-winctl");
      const lights = page.locator(".app-lights");
      await expect(page.getByRole("button", { name: "Recent projects" })).toBeVisible();
      if (platform === "windows") {
        await expect(lights).toHaveCount(0);
        await expect(controls).toBeVisible();
        await controls.getByRole("button", { name: "Minimize" }).click();
        await controls.getByRole("button", { name: "Maximize" }).click();
        await expect(controls.getByRole("button", { name: "Restore" })).toBeVisible();
        await controls.getByRole("button", { name: "Restore" }).click();
        await expect(controls.getByRole("button", { name: "Maximize" })).toBeVisible();
        await controls.getByRole("button", { name: "Close" }).click();
        await expect
          .poll(() => app.bridge.call("devbridge_window_calls"))
          .toEqual(["minimize", "toggleMaximize", "toggleMaximize", "close"]);
      } else {
        await expect(controls).toHaveCount(0);
        await expect(lights).toHaveCount(platform === "macos" ? 1 : 0);
        expect(await app.bridge.call("devbridge_window_calls")).toEqual([]);
      }
    });

    test("About and Uninstall name the right computer and the right removal", async ({
      page,
      workspace,
      startApp,
    }) => {
      await startApp({ open: [workspace.repo("acme-billing")], platform });
      await page.getByRole("button", { name: "Settings menu" }).click();
      await page.getByRole("menuitem", { name: "About Diffloupe" }).click();
      const about = page.getByRole("dialog", { name: "About Diffloupe" });
      if (platform === "macos") {
        await expect(about).toContainText("Dragging the app to the Trash");
        await expect(about).toContainText("this Mac");
      } else if (platform === "windows") {
        await expect(about).toContainText("Installed apps list");
      } else {
        await expect(about).toContainText("package manager");
      }
      if (platform !== "macos") await expect(about).not.toContainText(/Mac|Trash/);
      await about.getByRole("button", { name: "Close" }).click();
      await page.getByRole("button", { name: "Settings menu" }).click();
      await page.getByRole("menuitem", { name: "Uninstall Diffloupe…" }).click();
      const uninstall = page.getByRole("dialog", { name: "Uninstall Diffloupe" });
      if (platform === "macos") await expect(uninstall).toContainText("moves the app to the Trash");
      if (platform === "windows")
        await expect(uninstall).toContainText("removes the app and quits");
      if (platform === "linux") await expect(uninstall).toContainText("enter your password");
      if (platform !== "macos") await expect(uninstall).not.toContainText(/Mac|Trash/);
    });
  });
}

async function keyReport(page: Page, press: string) {
  await page.evaluate(() => {
    const w = window as unknown as { __keys?: boolean[] };
    if (!w.__keys) {
      const keys: boolean[] = [];
      w.__keys = keys;
      document.addEventListener(
        "keydown",
        (event) => {
          if (event.key.toLowerCase() === "k") keys.push(event.defaultPrevented);
        },
        true,
      );
    }
    w.__keys.length = 0;
  });
  await page.keyboard.press(press);
  return page.evaluate(() => [...((window as unknown as { __keys: boolean[] }).__keys ?? [])]);
}

for (const platform of platforms) {
  test(`${platform}: the terminal gets or keeps the right keys`, async ({
    page,
    workspace,
    startApp,
  }) => {
    const repo = workspace.repo("acme-billing");
    workspace.write(repo, "a.txt", "one\n");
    await startApp({ open: [repo], platform });
    await page.getByRole("button", { name: `Terminal ${labels[platform].terminal}` }).click();
    const panel = page.getByRole("region", { name: "Terminal" });
    await expect(panel).toBeVisible();
    const screen = panel.locator(".xterm-screen");
    await panel.locator(".xterm-helper-textarea").focus();
    await page.keyboard.type("echo marker-$((40+2))");
    await page.keyboard.press("Enter");
    await expect(screen).toContainText("marker-42");
    const own = platform === "macos" ? "Meta" : "Control";
    const handled = await keyReport(page, `${own}+k`);
    if (platform === "macos") {
      expect(handled).toEqual([true]);
      await expect(screen).not.toContainText("marker-42");
    } else {
      expect(handled).toEqual([false]);
      await expect(screen).toContainText("marker-42");
      await expect(page.getByRole("dialog", { name: "Commit Changes" })).toHaveCount(0);
    }
    expect(await keyReport(page, `${own}+Shift+k`)).toEqual([true]);
  });
}
