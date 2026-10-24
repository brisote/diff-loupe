import { rmSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { designRepo, mergeRepo, withBranches } from "./designRepo";
import { expect, git, isolate, test } from "./fixtures";
import { logNow, logRepo } from "./logRepo";
import { markdownRepo, readmeAfter, readmeBefore } from "./markdownRepo";

test.skip(!process.env.DL_SCREENS, "screens are captured only with DL_SCREENS=1");

const out = join("target", "screens");

async function shoot(page: Page, name: string) {
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.waitForTimeout(150);
    await page.screenshot({ path: join(out, `${name}-${colorScheme}.png`) });
  }
}

test("welcome screens", async ({ page, workspace, startApp }) => {
  const invoices = workspace.repo("invoices");
  const payments = workspace.repo("payments-api");
  const loupe = workspace.repo("diff-loupe", "gs/diffloupe");
  const billing = workspace.repo("acme-billing", "gs/invoice-export");
  const app = await startApp({ open: [invoices, payments, loupe, billing] });
  rmSync(billing, { recursive: true, force: true });
  await app.restart({ pick: invoices });
  await shoot(page, "Main");
  rmSync(join(invoices, ".git"), { recursive: true, force: true });
  await page.getByRole("button", { name: "Open…" }).click();
  await page.getByRole("alert").waitFor();
  await shoot(page, "WelcomeError");
});

test("main window screens", async ({ page, workspace, startApp }) => {
  const names = [
    "design-tokens",
    "reporting-jobs",
    "notifications-service",
    "customer-api",
    "tax-rules",
  ];
  const others = names.map((name) => workspace.repo(name));
  const billing = designRepo(workspace);
  await startApp({
    open: [
      ...others,
      workspace.repo("payments-api"),
      workspace.repo("diff-loupe", "gs/diffloupe"),
      billing,
    ],
  });
  await page.getByRole("button", { name: "Recent projects" }).waitFor();
  await page.getByRole("treeitem", { name: /InvoiceExporter.kt/ }).click();
  await page.getByRole("region", { name: "Side-by-side diff" }).waitFor();
  await page.waitForTimeout(300);
  await shoot(page, "Changes");
  await page.getByRole("button", { name: "Unified viewer" }).click();
  await page.getByRole("region", { name: "Unified diff" }).waitFor();
  await page.waitForTimeout(300);
  await shoot(page, "Unified");
  await page.getByRole("button", { name: "Diff settings" }).click();
  await shoot(page, "DiffSettings");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Side-by-side viewer" }).click();

  await page.getByRole("button", { name: "Recent projects" }).click();
  await shoot(page, "ProjectSwitcher");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Settings menu" }).click();
  await shoot(page, "SettingsMenu");
  await page.getByRole("menuitem", { name: "About Diffloupe" }).click();
  await shoot(page, "About");
  await page.getByRole("button", { name: "Close", exact: true }).click();

  await page.keyboard.press("Meta+Comma");
  await shoot(page, "SettingsDiff");
  await page.getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("button", { name: "Settings menu" }).click();
  await page.getByRole("menuitem", { name: "Uninstall Diffloupe…" }).click();
  await shoot(page, "Uninstall");

  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Recent projects" }).click();
  await page.getByRole("option", { name: "payments-api" }).click();
  await page.getByText("No changes", { exact: true }).first().waitFor();
  await shoot(page, "NoChanges");
});

test("branch log screens", async ({ page, workspace, startApp }) => {
  const billing = logRepo(workspace);
  await page.clock.setFixedTime(logNow);
  await startApp({ open: [billing] });
  await page.getByRole("tab", { name: "Branch log" }).click();
  await page.getByRole("option", { name: /Round totals/ }).click();
  await page.getByRole("button", { name: "Compare Next File" }).click();
  await page.getByRole("region", { name: "Side-by-side diff" }).waitFor();
  await page.waitForTimeout(300);
  await shoot(page, "BranchLog");
  await page.getByRole("option", { name: "Merged main" }).click();
  await page.getByText("Merge commit").waitFor();
  await page.waitForTimeout(300);
  await shoot(page, "MergeDivider");
});

test("git action screens", async ({ page, workspace, startApp }) => {
  const billing = designRepo(workspace);
  const remote = withBranches(workspace, billing);
  await startApp({ open: [billing] });
  await page.getByRole("button", { name: "Recent projects" }).waitFor();
  await page.getByRole("button", { name: "Current branch" }).click();
  await page.getByRole("dialog", { name: "Branches" }).waitFor();
  await page.waitForTimeout(200);
  await shoot(page, "BranchPicker");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Target branch" }).click();
  await page.getByRole("dialog", { name: "Target branch" }).waitFor();
  await page.waitForTimeout(200);
  await shoot(page, "TargetPicker");
  await page.keyboard.press("Escape");
  await page.getByRole("treeitem", { name: /InvoiceExporter.kt/ }).click();
  await page.keyboard.press("Meta+k");
  const dialog = page.getByRole("dialog", { name: "Commit Changes" });
  await dialog.getByRole("checkbox", { name: "README.md" }).uncheck({ force: true });
  await dialog
    .getByRole("textbox", { name: "Commit message" })
    .fill(
      "Skip empty invoices before export\n\nThe CSV writer failed on invoices without lines. Empty invoices are now\ndropped, and an export with nothing to write returns 0 instead of throwing.",
    );
  await page.waitForTimeout(300);
  await shoot(page, "CommitDialog");
  await dialog.getByRole("button", { name: "Commit and Push" }).click();
  await page.getByRole("status").filter({ hasText: "Pushed" }).waitFor();
  await shoot(page, "PushDone");
  const other = join(workspace.dir, "other");
  git(workspace.dir, "clone", "-q", "-b", "gs/invoice-export", remote, other);
  isolate(other);
  for (const name of ["x.md", "y.md"]) {
    workspace.write(other, name, "x\n");
    git(other, "add", "-A");
    git(other, "commit", "-q", "-m", name);
  }
  git(other, "push", "-q");
  workspace.write(billing, "web/src/invoices/exportButton.tsx", "export const button = 1;\n");
  git(billing, "commit", "-q", "-am", "Tweak the button");
  await page.keyboard.press("Meta+Shift+k");
  await page.getByRole("status").filter({ hasText: "Push rejected" }).waitFor();
  await shoot(page, "PushRejected");
});

test("terminal screens", async ({ page, workspace, startApp }) => {
  const billing = designRepo(workspace);
  await startApp({ open: [billing] });
  await page.getByRole("treeitem", { name: /InvoiceExporter.kt/ }).click();
  await page.getByRole("region", { name: "Side-by-side diff" }).waitFor();
  await page.getByRole("button", { name: "Terminal ⌥F12" }).click();
  await page.locator(".app-terminal-screen:not([hidden]) .xterm").click();
  await page.keyboard.type("clear; git status --short -uall");
  await page.keyboard.press("Enter");
  await page.locator(".xterm-rows").getByText("export-notes.md").waitFor();
  await page.waitForTimeout(300);
  await shoot(page, "Terminal");
});

test("markdown screens", async ({ page, workspace, startApp }) => {
  const billing = markdownRepo(workspace);
  await startApp({ open: [billing] });
  await page.getByRole("treeitem", { name: "README.md" }).click();
  await page.getByRole("region", { name: "Rendered side-by-side diff" }).waitFor();
  await page.waitForTimeout(300);
  await shoot(page, "MarkdownRendered");
  await page.getByRole("button", { name: "Unified viewer" }).click();
  await page.getByRole("region", { name: "Rendered inline diff" }).waitFor();
  await page.waitForTimeout(300);
  await shoot(page, "MarkdownInline");
  await page.getByRole("button", { name: "Side-by-side viewer" }).click();
  await page.getByRole("button", { name: "Raw", exact: true }).click();
  await page.getByRole("region", { name: "Side-by-side diff" }).waitFor();
  await page.waitForTimeout(300);
  await shoot(page, "MarkdownRaw");
});

test("markdown run screens", async ({ page, workspace, startApp }) => {
  const billing = workspace.repo("acme-billing");
  workspace.write(
    billing,
    "README.md",
    `${readmeBefore}
## Retries

A failed export is retried three times, five minutes apart.
`,
  );
  git(billing, "add", "-A");
  git(billing, "commit", "-q", "-m", "Document the billing rules");
  git(billing, "switch", "-q", "-c", "gs/invoice-export");
  workspace.write(
    billing,
    "README.md",
    `${readmeAfter}
## Schedule

Exports run every night at 02:00 in the account's time zone.

- Empty days are skipped.
- A late invoice joins the next export.
`,
  );
  await startApp({ open: [billing] });
  await page.getByRole("treeitem", { name: "README.md" }).click();
  await page.getByRole("region", { name: "Rendered side-by-side diff" }).waitFor();
  await page.waitForTimeout(300);
  await shoot(page, "MarkdownRuns");
});

test("merge screens", async ({ page, workspace, startApp }) => {
  const repo = mergeRepo(workspace);
  await startApp({ open: [repo] });
  await page.getByRole("button", { name: "Current branch" }).click();
  await page.waitForTimeout(300);
  await shoot(page, "BranchPicker");
  await page.getByRole("menuitem", { name: "Merge main into gs/invoice-export" }).click();
  const dialog = page.getByRole("dialog", { name: "Conflicts" });
  await dialog.waitFor();
  await page.waitForTimeout(300);
  await shoot(page, "ConflictsDialog");
  await dialog.getByRole("button", { name: "Merge…" }).click();
  const window = page.getByRole("dialog", { name: "Merge Revisions" });
  await window.getByRole("textbox", { name: "Result" }).waitFor();
  await page.waitForTimeout(500);
  await shoot(page, "MergeWindow");
  await window.getByRole("button", { name: "Cancel" }).click();
  await dialog.getByRole("button", { name: "Close" }).click();
  await page.getByRole("treeitem", { name: /InvoiceExporter.kt/ }).click();
  await page.getByRole("textbox", { name: "Result" }).waitFor();
  await page.waitForTimeout(500);
  await shoot(page, "MergeBanner");
  await page.locator(".app-editor-notice").getByRole("button", { name: "Resolve" }).click();
  for (const option of (await dialog.getByRole("option").all()).slice(1))
    await option.click({ modifiers: ["Meta"] });
  await dialog.getByRole("button", { name: "Accept Yours" }).click();
  await dialog.waitFor({ state: "detached" });
  await page.locator(".app-editor-notice").getByRole("button", { name: "Commit merge" }).click();
  await page.getByRole("dialog", { name: "Commit Merge" }).waitFor();
  await page.waitForTimeout(300);
  await shoot(page, "MergeCommit");
});

test("merge blocked screen", async ({ page, workspace, startApp }) => {
  const repo = mergeRepo(workspace);
  workspace.write(repo, "billing/src/main/kotlin/acme/billing/InvoiceExporter.kt", "local\n");
  workspace.write(repo, "billing/src/main/kotlin/acme/billing/TotalsCalculator.kt", "local\n");
  await startApp({ open: [repo] });
  await page.getByRole("button", { name: "Current branch" }).click();
  await page.getByRole("menuitem", { name: "Merge main into gs/invoice-export" }).click();
  await page.locator(".app-editor-notice").getByRole("button", { name: "Show files" }).click();
  await page.waitForTimeout(300);
  await shoot(page, "MergeBlocked");
});

test("star prompt screen", async ({ page, workspace, startApp }) => {
  const billing = designRepo(workspace);
  const app = await startApp({ open: [billing] });
  await page.getByRole("button", { name: "Settings menu" }).waitFor();
  await expect
    .poll(async () => app.bridge.call("get_ui_value", { key: "star.prompt" }))
    .not.toBeNull();
  await app.bridge.call("set_ui_value", {
    key: "star.prompt",
    value: JSON.stringify({
      days: 7,
      lastDay: "2000-01-01",
      declined: 0,
      declinedAt: null,
      done: false,
    }),
  });
  await app.restart();
  await page.getByRole("status").filter({ hasText: "Give us a star on GitHub." }).waitFor();
  await page.waitForTimeout(300);
  await shoot(page, "StarPrompt");
});

test("error report screen", async ({ page, workspace, startApp }) => {
  const billing = designRepo(workspace);
  const app = await startApp({ open: [billing] });
  await page.getByRole("treeitem", { name: /InvoiceExporter.kt/ }).click();
  await page.getByRole("region", { name: "Side-by-side diff" }).waitFor();
  await app.bridge.call("devbridge_fail_next", {
    command: "set_repo_view",
    code: "store",
    message: "storage failed: database is locked",
  });
  await page.getByRole("tab", { name: "Branch log" }).click();
  await page.getByRole("dialog", { name: "Diffloupe ran into a problem" }).waitFor();
  await page.waitForTimeout(300);
  await shoot(page, "ErrorReport");
});
