import type { Page } from "@playwright/test";
import { expect, git, test } from "./fixtures";
import { logNow, logRepo } from "./logRepo";

async function openLog(page: Page) {
  await page.getByRole("tab", { name: "Branch log" }).click();
  await expect(page.getByRole("listbox", { name: "Branch commits" })).toBeVisible();
}

const commits = (page: Page) =>
  page.getByRole("listbox", { name: "Branch commits" }).getByRole("option");

test("the log draws the branch's history as a graph, with the merge from main as a plain row", async ({
  page,
  workspace,
  startApp,
}) => {
  const repo = logRepo(workspace);
  await page.clock.setFixedTime(logNow);
  await startApp({ open: [repo] });
  await openLog(page);
  await expect(page.getByText("Branch commit history")).toBeVisible();
  await expect(page.getByText("7 commits", { exact: true })).toBeVisible();
  await expect(commits(page)).toHaveText([
    /^Skip empty invoices before export\s*Ada Lovelace\s*2 hours ago$/,
    /^Round totals half-even to two decimals\s*Ada Lovelace\s*Yesterday$/,
    /^Merge branch 'main' into gs\/invoice-export\s*Ada Lovelace\s*Yesterday$/,
    /^Add CSV writer for invoices\s*Ada Lovelace\s*3 days ago$/,
    /^Scaffold the billing export module\s*Grace Hopper\s*5 days ago$/,
    /Add the totals calculator/,
    /Initial commit/,
  ]);
  await expect(page.getByText("Use the net price for totals")).toHaveCount(0);
  await expect(page.getByText(/Uncommitted|All branch changes/)).toHaveCount(0);
  await expect(page.getByText("Pick a commit")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Target branch" })).toHaveCount(0);
  await expect(commits(page).first()).toHaveClass(/is-first/);
  await expect(commits(page).filter({ hasText: "Merge branch 'main'" })).toHaveClass(/is-merge/);
  await expect(commits(page).last()).toHaveClass(/is-last/);
});

test("a commit's menu copies its full id, its message and its author", async ({
  page,
  workspace,
  startApp,
}) => {
  const repo = logRepo(workspace);
  await page.addInitScript(() => {
    const copied: string[] = [];
    Object.defineProperty(window, "copied", { value: copied });
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: async (text: string) => void copied.push(text) },
    });
  });
  await startApp({ open: [repo] });
  await openLog(page);
  await commits(page).filter({ hasText: "Round totals" }).click({ button: "right" });
  const menu = page.getByRole("menu", { name: "Commit actions" });
  await menu.getByRole("menuitem", { name: "Copy Revision Number" }).click();
  await expect(menu).toHaveCount(0);
  const row = commits(page).filter({ hasText: "Round totals" });
  await row.click({ button: "right" });
  await menu.getByRole("menuitem", { name: "Copy Commit Message" }).click();
  await row.click({ button: "right" });
  await menu.getByRole("menuitem", { name: "Copy Author" }).click();
  const copied = () => page.evaluate(() => (window as unknown as { copied: string[] }).copied);
  await expect.poll(copied).toHaveLength(3);
  expect(await copied()).toEqual([
    git(repo, "rev-parse", "HEAD~1"),
    git(repo, "log", "-1", "--format=%B", "HEAD~1").trim(),
    git(repo, "log", "-1", "--format=%an <%ae>", "HEAD~1"),
  ]);
});

test("the divider between the commits and the details moves and is remembered", async ({
  page,
  workspace,
  startApp,
}) => {
  const repo = logRepo(workspace);
  const app = await startApp({ open: [repo] });
  await openLog(page);
  const divider = page.getByRole("separator", { name: "Resize the commit list" });
  const before = Number(await divider.getAttribute("aria-valuenow"));
  await divider.focus();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await expect(divider).toHaveAttribute("aria-valuenow", String(before + 32));
  await app.restart();
  await openLog(page);
  await expect(page.getByRole("separator", { name: "Resize the commit list" })).toHaveAttribute(
    "aria-valuenow",
    String(before + 32),
  );
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

test("a merge commit shows its changes against its first parent", async ({
  page,
  workspace,
  startApp,
}) => {
  const repo = logRepo(workspace);
  await page.clock.setFixedTime(logNow);
  await startApp({ open: [repo] });
  await openLog(page);
  await commits(page).filter({ hasText: "Merge branch 'main'" }).click();
  await expect(page.getByText("Changed files", { exact: true })).toBeVisible();
  const files = page.getByRole("listbox", { name: "Changed files" });
  await expect(files.getByRole("option")).toHaveText([/^TotalsCalculator\.kt/, /^tax\.md/]);
  const details = page.getByRole("region", { name: "Commit details" });
  await expect(details.getByText(/parents/)).toBeVisible();
  const diff = page.getByRole("region", { name: "Side-by-side diff" });
  await expect(diff.getByText("Automatic merge")).toHaveCount(0);
  await expect(diff.getByText(/netPrice/).first()).toBeVisible();
});

test("a new branch lists the history it starts from", async ({ page, workspace, startApp }) => {
  const fresh = workspace.repo("payments-api", "gs/new");
  await startApp({ open: [fresh] });
  await openLog(page);
  await expect(commits(page)).toHaveText([/Initial commit/]);
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
  await expect(list.getByRole("option", { selected: true })).toHaveText(/Merge branch 'main'/);
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
  await expect(page.getByText("8 commits", { exact: true })).toBeVisible();
  await expect(commits(page).filter({ hasText: "Round totals" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByRole("region", { name: "Side-by-side diff" })).toBeVisible();
});
