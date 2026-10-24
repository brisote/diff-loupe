import type { Page } from "@playwright/test";
import { expect, git, test } from "./fixtures";
import { logNow, logRepo } from "./logRepo";

async function openLog(page: Page) {
  await page.getByRole("tab", { name: "Branch log" }).click();
  await expect(page.getByRole("listbox", { name: "Branch commits" })).toBeVisible();
}

const commits = (page: Page) =>
  page.getByRole("listbox", { name: "Branch commits" }).getByRole("option");

test("the log lists the branch's own commits with a row for the merge from main", async ({
  page,
  workspace,
  startApp,
}) => {
  const repo = logRepo(workspace);
  await page.clock.setFixedTime(logNow);
  await startApp({ open: [repo] });
  await openLog(page);
  await expect(page.getByText("Branch commit history")).toBeVisible();
  await expect(page.getByText("4 commits", { exact: true })).toBeVisible();
  await expect(commits(page)).toHaveText([
    /Skip empty invoices before export\s*2 files\s*Ada Lovelace\s*2 hours ago/,
    /Round totals half-even to two decimals\s*2 files\s*Ada Lovelace\s*Yesterday/,
    /^Merged main\s*Yesterday$/,
    /Add CSV writer for invoices\s*3 files\s*Ada Lovelace\s*3 days ago/,
    /Scaffold the billing export module\s*6 files\s*Grace Hopper\s*5 days ago/,
  ]);
  await expect(page.getByText("Use the net price for totals")).toHaveCount(0);
  await expect(page.getByText(/Uncommitted|All branch changes/)).toHaveCount(0);
  await expect(page.getByText("Pick a commit")).toHaveCount(2);
});

test("a commit shows its message, files and diffs", async ({ page, workspace, startApp }) => {
  const repo = logRepo(workspace);
  await page.clock.setFixedTime(logNow);
  await startApp({ open: [repo] });
  await openLog(page);
  await commits(page).filter({ hasText: "Round totals" }).click();
  const details = page.getByRole("region", { name: "Commit details" });
  await expect(details.getByText("Round totals half-even to two decimals")).toBeVisible();
  await expect(details.getByText(/Ada Lovelace · Yesterday at \d+:\d\d/)).toBeVisible();
  await expect(details.getByText(/Banker's rounding keeps/)).toBeVisible();
  const files = page.getByRole("listbox", { name: "Changed files" });
  await expect(files.getByRole("option")).toHaveText([/^README\.md/, /^TotalsCalculator\.kt/]);
  await expect(files.getByRole("option", { selected: true })).toHaveText(/README\.md/);
  const diff = page.getByRole("region", { name: "Side-by-side diff" });
  await expect(diff.getByText("Totals round half-even.")).toBeVisible();
  await expect(page.getByText("1/2 files")).toBeVisible();
  await page.getByRole("button", { name: "Compare Next File" }).click();
  await expect(files.getByRole("option", { selected: true })).toHaveText(/TotalsCalculator\.kt/);
  await expect(diff.getByText("HALF_EVEN")).toBeVisible();
  await expect(diff.locator(".dl-filehead-hash")).toHaveCount(2);
});

test("the merge row shows only what the merge changed", async ({ page, workspace, startApp }) => {
  const repo = logRepo(workspace);
  await page.clock.setFixedTime(logNow);
  await startApp({ open: [repo] });
  await openLog(page);
  await commits(page).filter({ hasText: "Merged main" }).click();
  await expect(page.getByText(/beyond git's automatic merge/)).toBeVisible();
  await expect(page.getByText("Changed by the merge")).toBeVisible();
  const files = page.getByRole("listbox", { name: "Changed files" });
  await expect(files.getByRole("option")).toHaveText([/^TotalsCalculator\.kt/]);
  const diff = page.getByRole("region", { name: "Side-by-side diff" });
  await expect(diff.getByText("Automatic merge")).toBeVisible();
  await expect(diff.getByText("with conflict markers")).toBeVisible();
  await expect(diff.getByText("Merge commit")).toBeVisible();
  await expect(diff.getByText(/^<<<<<<< /)).toBeVisible();
  await expect(page.getByText("2 differences", { exact: true })).toBeVisible();
  await expect(page.getByText("Use the net price for totals")).toHaveCount(0);
});

test("a clean merge says so, and a new branch has no commits", async ({
  page,
  workspace,
  startApp,
}) => {
  const repo = workspace.repo("acme-billing", "gs/clean");
  workspace.write(repo, "a.txt", "a\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "Add a");
  git(repo, "switch", "-q", "main");
  workspace.write(repo, "b.txt", "b\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "Add b");
  git(repo, "switch", "-q", "gs/clean");
  git(repo, "merge", "-q", "--no-edit", "main");
  const fresh = workspace.repo("payments-api", "gs/new");
  await startApp({ open: [fresh, repo] });
  await openLog(page);
  await commits(page).filter({ hasText: "Merged main" }).click();
  await expect(page.getByText("Clean merge: no manual changes")).toHaveCount(2);
  await page.getByRole("button", { name: "Recent projects" }).click();
  await page.getByRole("option", { name: "payments-api" }).click();
  await page.getByRole("tab", { name: "Branch log" }).click();
  await expect(page.getByText("No commits on this branch yet")).toBeVisible();
  await expect(page.getByText("Every commit on this branch is also on main.")).toBeVisible();
});

test("arrow keys walk the history, Enter moves to the files, and the filter narrows the list", async ({
  page,
  workspace,
  startApp,
}) => {
  const repo = logRepo(workspace);
  await page.clock.setFixedTime(logNow);
  await startApp({ open: [repo] });
  await openLog(page);
  const list = page.getByRole("listbox", { name: "Branch commits" });
  await list.focus();
  await page.keyboard.press("ArrowDown");
  await expect(list.getByRole("option", { selected: true })).toHaveText(/Skip empty invoices/);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(list.getByRole("option", { selected: true })).toHaveText(/Merged main/);
  await page.keyboard.press("ArrowUp");
  await expect(list.getByRole("option", { selected: true })).toHaveText(/Round totals/);
  const files = page.getByRole("listbox", { name: "Changed files" });
  await expect(files.getByRole("option", { selected: true })).toHaveText(/README\.md/);
  await page.keyboard.press("Enter");
  await expect(files).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(files.getByRole("option", { selected: true })).toHaveText(/TotalsCalculator/);
  await page.getByRole("textbox", { name: "Filter commits" }).fill("csv");
  await expect(commits(page)).toHaveText([/Add CSV writer for invoices/]);
  await page.getByRole("textbox", { name: "Filter commits" }).fill("zzz");
  await expect(page.getByText("No matching commits")).toBeVisible();
});

test("a new commit shows in the log and the selection survives the refresh", async ({
  page,
  workspace,
  startApp,
}) => {
  const repo = logRepo(workspace);
  await page.clock.setFixedTime(logNow);
  await startApp({ open: [repo] });
  await openLog(page);
  await commits(page).filter({ hasText: "Round totals" }).click();
  await expect(page.getByRole("listbox", { name: "Changed files" })).toBeVisible();
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "Describe the work in progress");
  await expect(commits(page).first()).toHaveText(/Describe the work in progress/, {
    timeout: 5000,
  });
  await expect(page.getByText("5 commits", { exact: true })).toBeVisible();
  await expect(commits(page).filter({ hasText: "Round totals" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByRole("region", { name: "Side-by-side diff" })).toBeVisible();
});
