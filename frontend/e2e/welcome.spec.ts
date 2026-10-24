import { rmSync } from "node:fs";
import { expect, test } from "./fixtures";

test("the welcome screen opens a repository through the folder picker", async ({
  page,
  workspace,
  startApp,
}) => {
  const repo = workspace.repo("acme-billing", "gs/invoice-export");
  await startApp({ pick: repo });
  await expect(page.getByRole("heading", { name: "Welcome to Diffloupe" })).toBeVisible();
  await page.getByRole("button", { name: "Open…" }).click();
  await expect(page.getByRole("button", { name: "Recent projects" })).toContainText("acme-billing");
  await expect(page.getByRole("button", { name: "Current branch" })).toContainText(
    "gs/invoice-export",
  );
  await expect(page.getByRole("button", { name: "Target branch" })).toContainText("main");
  await expect(page.getByText("Nothing to compare")).toBeVisible();
  await expect(page.locator(".dl-statusbar")).toContainText("acme-billing");
});

test("a plain folder shows the not-a-repository error", async ({ page, workspace, startApp }) => {
  const plain = workspace.folder("invoices");
  await startApp({ pick: plain });
  await page.getByRole("button", { name: "Open…" }).click();
  const banner = page.getByRole("alert");
  await expect(banner).toContainText("is not a git repository");
  await expect(banner).toContainText("invoices");
  await expect(page.getByRole("heading", { name: "Welcome to Diffloupe" })).toBeVisible();
});

test("the recent list opens a repository and can be searched", async ({
  page,
  workspace,
  startApp,
}) => {
  const billing = workspace.repo("acme-billing", "gs/invoice-export");
  const payments = workspace.repo("payments-api");
  const gone = workspace.repo("old-reports");
  const app = await startApp({ open: [billing, payments, gone] });
  rmSync(gone, { recursive: true, force: true });
  await app.restart();

  const recent = page.getByRole("listbox", { name: "Recent repositories" });
  await expect(recent.getByRole("option")).toHaveCount(3);
  await page.getByPlaceholder("Search recent repositories").fill("pay");
  await expect(recent.getByRole("option")).toHaveCount(1);
  await recent.getByRole("option", { name: "payments-api" }).click();
  await expect(page.getByRole("button", { name: "Recent projects" })).toContainText("payments-api");
});

test("dropping a folder on the window opens it", async ({ page, workspace, startApp }) => {
  const repo = workspace.repo("dropped-repo");
  const app = await startApp();
  await expect(page.getByText("Drop a folder here to open it")).toBeVisible();
  await app.bridge.call("devbridge_drop", { path: repo });
  await expect(page.getByRole("button", { name: "Recent projects" })).toContainText("dropped-repo");
});

test("the theme follows the system appearance", async ({ page, startApp }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await startApp();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});
