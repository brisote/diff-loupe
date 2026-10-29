import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

const panel = (page: Page) => page.getByRole("region", { name: "Terminal" });
const screen = (page: Page) => page.locator(".app-terminal-screen:not([hidden]) .xterm-rows");
const isWin = process.platform === "win32";

async function run(page: Page, command: string) {
  await page.locator(".app-terminal-screen:not([hidden]) .xterm").click();
  await page.keyboard.type(command);
  await page.keyboard.press("Enter");
}

test("the terminal runs commands in the repository and keeps its sessions", async ({
  page,
  workspace,
  startApp,
}) => {
  const repo = workspace.repo("acme-billing");
  workspace.write(repo, "src/main.kt", "fun main() {}\n");
  const other = workspace.repo("payments-api");
  await startApp({ open: [other, repo] });
  await page.getByRole("button", { name: /^Terminal\b/ }).click();
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).getByRole("tab")).toHaveText(["Local"]);
  if (isWin) {
    await run(page, "echo hi-42");
  } else {
    await run(page, "echo hi-$((40+2))");
  }
  await expect(screen(page)).toContainText("hi-42");

  if (isWin) {
    await run(page, "cd src && echo moved-src");
  } else {
    await run(page, "cd src && echo moved-$(basename $(pwd))");
  }
  await expect(screen(page)).toContainText("moved-src");
  await panel(page).getByRole("button", { name: "New session" }).click();
  await expect(panel(page).getByRole("tab")).toHaveText(["Local", "Local (2)"]);
  if (isWin) {
    await run(page, "echo at-acme-billing-end");
  } else {
    await run(page, "echo at-$(basename $(pwd))-end");
  }
  await expect(screen(page)).toContainText("at-acme-billing-end");

  await page.getByRole("button", { name: "Recent projects" }).click();
  await page.getByRole("option", { name: "payments-api" }).click();
  await expect(page.getByRole("button", { name: "Recent projects" })).toContainText("payments-api");
  await expect(panel(page).getByRole("tab")).toHaveCount(0);
  await page.getByRole("button", { name: "Recent projects" }).click();
  await page.getByRole("option", { name: "acme-billing" }).click();
  await expect(panel(page).getByRole("tab")).toHaveText(["Local", "Local (2)"]);
  await expect(screen(page)).toContainText("at-acme-billing-end");
  await panel(page).getByRole("tab", { name: "Local", exact: true }).click();
  await expect(screen(page)).toContainText("moved-src");

  await panel(page)
    .getByRole("button", { name: /^Hide\b/ })
    .click();
  await expect(panel(page)).toHaveCount(0);
  await page.keyboard.press("Alt+F12");
  await expect(screen(page)).toContainText("hi-42");
  await page.keyboard.press("Shift+Escape");
  await expect(panel(page)).toHaveCount(0);
});

test("closing a session and dragging the splitter", async ({ page, workspace, startApp }) => {
  const repo = workspace.repo("acme-billing");
  const app = await startApp({ open: [repo] });
  await page.getByRole("button", { name: /^Terminal\b/ }).click();
  await expect(panel(page).getByRole("tab")).toHaveText(["Local"]);
  await panel(page).getByRole("button", { name: "New session" }).click();
  await panel(page).getByRole("button", { name: "Close session" }).click();
  await expect(panel(page).getByRole("tab")).toHaveText(["Local"]);
  await run(page, "exit");
  await expect(panel(page).getByRole("tab")).toHaveCount(0);

  await panel(page).getByRole("button", { name: "New session" }).click();
  const before = (await panel(page).boundingBox())?.height ?? 0;
  const splitter = page.getByRole("separator", { name: "Resize terminal" });
  const box = await splitter.boundingBox();
  if (!box) throw new Error("no splitter");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y - 100, { steps: 5 });
  await page.mouse.up();
  await expect
    .poll(async () => (await panel(page).boundingBox())?.height ?? 0)
    .toBeGreaterThan(before + 90);
  const after = (await panel(page).boundingBox())?.height ?? 0;
  await app.restart();
  await page.getByRole("button", { name: /^Terminal\b/ }).click();
  await expect
    .poll(async () => Math.round((await panel(page).boundingBox())?.height ?? 0))
    .toBe(Math.round(after));
});

test("window shortcuts work while the terminal has focus", async ({
  page,
  workspace,
  startApp,
}) => {
  const repo = workspace.repo("acme-billing");
  await startApp({ open: [repo] });
  await expect(page.getByRole("button", { name: /^Terminal\b/ })).toBeVisible();
  await page.keyboard.press("Alt+F12");
  if (isWin) {
    await run(page, "echo marker-42");
  } else {
    await run(page, "echo marker-$((6*7))");
  }
  await expect(screen(page)).toContainText("marker-42");
  const mod = isWin ? "Control" : "Meta";
  await page.keyboard.press(`${mod}+k`);
  await expect(screen(page)).not.toContainText("marker-42");
  await page.keyboard.press(`${mod}+Comma`);
  const settings = page.getByRole("dialog", { name: "Settings" });
  await expect(settings).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(settings).toHaveCount(0);
  await page.getByRole("button", { name: "Recent projects" }).focus();
  await page.keyboard.press("Alt+F12");
  await expect(panel(page)).toBeVisible();
  await expect(page.locator(".app-terminal textarea")).toBeFocused();
  await page.keyboard.press("Alt+F12");
  await expect(panel(page)).toHaveCount(0);
});
