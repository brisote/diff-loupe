import { expect, test } from "./fixtures";

const form = "https://github.com/brisote/diff-loupe/issues/new?template=error_report.yml";

test("an unhandled error offers a report for a GitHub issue", async ({
  page,
  workspace,
  startApp,
}) => {
  const repo = workspace.repo("acme-billing");
  const app = await startApp({ open: [repo] });
  await expect(page.getByRole("button", { name: "Settings menu" })).toBeVisible();
  await app.bridge.call("devbridge_fail_next", {
    command: "set_repo_view",
    code: "store",
    message: `storage failed: ${repo}/.git/index.lock is locked`,
  });
  await page.getByRole("tab", { name: "Commit history" }).click();
  const dialog = page.getByRole("dialog", { name: "Diffloupe ran into a problem" });
  await expect(dialog).toBeVisible();
  const report = dialog.getByRole("textbox", { name: "Error report" });
  await expect(report).toHaveValue(/`store` in `set_repo_view`/);
  await expect(report).toHaveValue(
    /- Diffloupe \d+\.\d+\.\d+ on (macOS|Windows|\S).+ \(\w+\), git \d/,
  );
  await expect(report).toHaveValue(/\| set_repo_view \| store \|/);
  expect(await report.inputValue()).not.toContain(repo);
  await expect(report).toHaveValue(/storage failed: <repository>\/\.git\/index\.lock is locked/);
  await dialog.getByRole("button", { name: "Open GitHub issue" }).click();
  await expect.poll(() => app.bridge.call("devbridge_opened")).toEqual([form]);
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();
});

test("an error the app explains offers no report", async ({ page, workspace, startApp }) => {
  const plain = workspace.folder("invoices");
  await startApp({ pick: plain });
  await page.getByRole("button", { name: "Open…" }).click();
  await expect(page.getByRole("alert")).toContainText("is not a git repository");
  await expect(page.getByRole("dialog", { name: "Diffloupe ran into a problem" })).toHaveCount(0);
});
