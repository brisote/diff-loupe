import { chmodSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, git, isolate, test, type Workspace } from "./fixtures";

function withRemote(workspace: Workspace): { repo: string; remote: string } {
  const repo = workspace.repo("acme-billing");
  const remote = join(workspace.dir, "remote.git");
  git(workspace.dir, "init", "-q", "--bare", "-b", "main", remote);
  git(repo, "remote", "add", "origin", remote);
  git(repo, "push", "-q", "-u", "origin", "main");
  return { repo, remote };
}

async function openBranches(page: Page) {
  await page.getByRole("button", { name: "Current branch" }).click();
  return page.getByRole("dialog", { name: "Branches" });
}

const changesTree = (page: Page) => page.getByRole("tree", { name: "Changed files" });

test("the Branch picker lists branches and switching updates Changes and the Branch log", async ({
  page,
  workspace,
  startApp,
}) => {
  const { repo } = withRemote(workspace);
  git(repo, "switch", "-q", "-c", "gs/invoice-export");
  workspace.write(repo, "invoice.txt", "invoice\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "Add invoices");
  git(repo, "push", "-q", "-u", "origin", "gs/invoice-export");
  git(repo, "switch", "-q", "-c", "gs/csv-writer", "main");
  git(repo, "switch", "-q", "gs/invoice-export");
  workspace.write(repo, "invoice.txt", "invoice 2\n");
  await startApp({ open: [repo] });
  await expect(changesTree(page).getByRole("treeitem", { name: "invoice.txt" })).toBeVisible();

  const picker = await openBranches(page);
  await expect(
    picker.getByRole("menuitem", { name: "Merge main into gs/invoice-export" }),
  ).not.toHaveAttribute("aria-disabled");
  await expect(picker.getByRole("listbox", { name: "Branches" }).getByRole("option")).toHaveText([
    /gs\/invoice-export\s*current/,
    "gs/csv-writer",
    "main",
    "origin/gs/invoice-export",
    "origin/main",
  ]);
  await picker.getByRole("textbox", { name: "Search branches" }).fill("csv");
  await expect(picker.getByRole("option")).toHaveText(["gs/csv-writer"]);
  await page.keyboard.press("Escape");

  await page.getByRole("tab", { name: "Branch log" }).click();
  await expect(page.getByRole("option", { name: "Add invoices" })).toBeVisible();
  workspace.write(repo, "invoice.txt", "invoice\n");
  await (await openBranches(page)).getByRole("option", { name: "main", exact: true }).click();
  await expect(page.getByRole("button", { name: "Current branch" })).toHaveText("main");
  await expect(page.getByRole("button", { name: "Target branch" })).toHaveCount(0);
  await expect(page.getByRole("option", { name: /Initial commit/ })).toBeVisible();
  await expect(page.getByRole("option", { name: /Add invoices/ })).toHaveCount(0);
  await page.getByRole("tab", { name: "Changes" }).click();
  await expect(page.getByText("No changes", { exact: true }).first()).toBeVisible();
  expect(git(repo, "branch", "--show-current")).toBe("main");

  git(repo, "push", "-q", "origin", "main:gs/remote-only");
  git(repo, "fetch", "-q");
  await (await openBranches(page)).getByRole("option", { name: "origin/gs/remote-only" }).click();
  await expect(page.getByRole("button", { name: "Current branch" })).toHaveText("gs/remote-only");
  expect(git(repo, "rev-parse", "--abbrev-ref", "@{u}")).toBe("origin/gs/remote-only");

  git(repo, "switch", "-q", "gs/csv-writer");
  await expect(page.getByRole("button", { name: "Current branch" })).toHaveText("gs/csv-writer");
});

test("a refused checkout shows git's message", async ({ page, workspace, startApp }) => {
  const repo = workspace.repo("acme-billing");
  git(repo, "switch", "-q", "-c", "gs/other");
  workspace.write(repo, "README.md", "# Other\n");
  git(repo, "commit", "-q", "-am", "Other readme");
  git(repo, "switch", "-q", "main");
  workspace.write(repo, "README.md", "# Local edit\n");
  await startApp({ open: [repo] });
  await (await openBranches(page)).getByRole("option", { name: "gs/other" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Checkout failed:" })).toContainText(
    "would be overwritten",
  );
  await expect(page.getByRole("button", { name: "Current branch" })).toHaveText("main");
});

test("the Target picker leaves the Branch log and the files alone", async ({
  page,
  workspace,
  startApp,
}) => {
  const repo = workspace.repo("acme-billing");
  git(repo, "switch", "-q", "-c", "develop");
  workspace.write(repo, "d.txt", "d\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "Develop work");
  git(repo, "switch", "-q", "-c", "gs/feature");
  workspace.write(repo, "f.txt", "f\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "Feature work");
  workspace.write(repo, "f.txt", "local edit\n");
  const head = git(repo, "rev-parse", "HEAD");
  await startApp({ open: [repo] });
  const history = [/Feature work/, /Develop work/, /Initial commit/];
  await page.getByRole("tab", { name: "Branch log" }).click();
  await expect(
    page.getByRole("listbox", { name: "Branch commits" }).getByRole("option"),
  ).toHaveText(history);
  await page.getByRole("tab", { name: "Changes" }).click();
  await page.getByRole("button", { name: "Target branch" }).click();
  const picker = page.getByRole("dialog", { name: "Target branch" });
  await expect(picker.getByRole("option")).toHaveText([/main\s*default/, "develop"]);
  await picker.getByRole("option", { name: "develop" }).click();
  await expect(page.getByRole("button", { name: "Target branch" })).toContainText("develop");
  await page.getByRole("tab", { name: "Branch log" }).click();
  await expect(
    page.getByRole("listbox", { name: "Branch commits" }).getByRole("option"),
  ).toHaveText(history);
  expect(git(repo, "rev-parse", "HEAD")).toBe(head);
  expect(git(repo, "branch", "--show-current")).toBe("gs/feature");
  expect(readFileSync(join(repo, "f.txt"), "utf8")).toBe("local edit\n");
});

test("the commit dialog commits the ticked files and pushes", async ({
  page,
  workspace,
  startApp,
}) => {
  const { repo, remote } = withRemote(workspace);
  git(repo, "switch", "-q", "-c", "gs/invoice-export");
  for (const name of ["a.txt", "b.txt"]) workspace.write(repo, name, "one\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "Add files");
  workspace.write(repo, "a.txt", "two\n");
  workspace.write(repo, "b.txt", "two\n");
  workspace.write(repo, "notes.md", "notes\n");
  await startApp({ open: [repo] });
  await expect(changesTree(page).getByRole("treeitem", { name: "notes.md" })).toBeVisible();
  await page.keyboard.press("Meta+k");
  const dialog = page.getByRole("dialog", { name: "Commit Changes" });
  await expect(dialog.getByText("gs/invoice-export")).toBeVisible();
  await expect(dialog.getByText("2 files", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("checkbox", { name: "notes.md" })).not.toBeChecked();
  await dialog.getByRole("checkbox", { name: "b.txt" }).uncheck({ force: true });
  await expect(dialog.getByText("1 of 2 files")).toBeVisible();
  await dialog.getByRole("checkbox", { name: "notes.md" }).check({ force: true });
  await expect(dialog.getByRole("button", { name: "Commit and Push" })).toBeDisabled();
  await dialog.getByRole("textbox", { name: "Commit message" }).fill("Change a and add notes");
  await dialog.getByRole("button", { name: "Commit and Push" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: "Pushed 2 commits to" })).toContainText(
    "origin/gs/invoice-export",
  );
  expect(git(repo, "log", "-1", "--format=%s")).toBe("Change a and add notes");
  expect(git(repo, "show", "--name-only", "--format=", "HEAD")).toBe("a.txt\nnotes.md");
  expect(git(remote, "log", "-1", "--format=%s", "gs/invoice-export")).toBe(
    "Change a and add notes",
  );
  for (const name of ["a.txt", "b.txt", "notes.md"])
    await expect(changesTree(page).getByRole("treeitem", { name })).toBeVisible();

  await page.getByRole("button", { name: "Show in Branch log" }).click();
  await expect(page.getByRole("option", { name: "Change a and add notes" })).toBeVisible();

  await page.getByRole("tab", { name: "Changes" }).click();
  await page.getByRole("button", { name: "Commit… ⌘K" }).click();
  await dialog.getByRole("button", { name: "Recent messages" }).click();
  await page.getByRole("menuitem", { name: "Change a and add notes" }).click();
  await expect(dialog.getByRole("textbox", { name: "Commit message" })).toHaveValue(
    "Change a and add notes",
  );
  await dialog.getByRole("textbox", { name: "Commit message" }).fill("");
  await dialog.getByText("Amend").click();
  await expect(dialog.getByRole("textbox", { name: "Commit message" })).toHaveValue(
    "Change a and add notes",
  );
  await dialog.getByRole("button", { name: /^Commit$/ }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "already on origin/gs/invoice-export. Amending it would need a force push",
  );
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
});

test("a failing hook keeps the dialog open with its output", async ({
  page,
  workspace,
  startApp,
}) => {
  const repo = workspace.repo("acme-billing");
  workspace.write(
    repo,
    ".git/hooks/pre-commit",
    "#!/bin/sh\necho 'lint found 2 problems' >&2\nexit 1\n",
  );
  chmodSync(join(repo, ".git/hooks/pre-commit"), 0o755);
  workspace.write(repo, "README.md", "# changed\n");
  await startApp({ open: [repo] });
  await page.getByRole("button", { name: "Commit… ⌘K" }).click();
  const dialog = page.getByRole("dialog", { name: "Commit Changes" });
  await dialog.getByRole("textbox", { name: "Commit message" }).fill("Try");
  await dialog.getByRole("button", { name: "Commit", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("lint found 2 problems");
  expect(git(repo, "rev-list", "--count", "HEAD")).toBe("1");
});

test("a rejected push explains why and offers to fetch and merge", async ({
  page,
  workspace,
  startApp,
}) => {
  const { repo, remote } = withRemote(workspace);
  const other = join(workspace.dir, "other");
  git(workspace.dir, "clone", "-q", remote, other);
  isolate(other);
  for (const name of ["x.txt", "y.txt"]) {
    workspace.write(other, name, "x\n");
    git(other, "add", "-A");
    git(other, "commit", "-q", "-m", name);
  }
  git(other, "push", "-q");
  git(repo, "fetch", "-q");
  workspace.write(repo, "mine.txt", "mine\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "Mine");
  await startApp({ open: [repo] });
  await expect(page.getByRole("button", { name: "Current branch" })).toBeVisible();
  await page.keyboard.press("Meta+Shift+k");
  const notice = page.getByRole("status").filter({ hasText: "Push rejected:" });
  await expect(notice).toContainText(
    "origin/main has 2 commits that you don't have. Merge them first, then push again.",
  );
  await notice.getByRole("button", { name: "Show details" }).click();
  await expect(page.getByRole("dialog", { name: "Git output" })).toContainText("[rejected]");
  await page
    .getByRole("dialog", { name: "Git output" })
    .getByRole("button", { name: "Close" })
    .click();
  await notice.getByRole("button", { name: "Fetch and merge" }).click();
  await expect(notice).toHaveCount(0);
  await expect.poll(() => git(repo, "rev-list", "--count", "HEAD")).toBe("5");
  await (await openBranches(page)).getByRole("menuitem", { name: "Push…" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Pushed" })).toContainText("origin/main");
});

test("a slow fetch can be cancelled from the status bar", async ({ page, workspace, startApp }) => {
  const repo = workspace.repo("acme-billing");
  const script = join(workspace.dir, "slow-remote.sh");
  workspace.write(workspace.dir, "slow-remote.sh", "#!/bin/sh\nsleep 30\n");
  chmodSync(script, 0o755);
  git(repo, "remote", "add", "origin", `ext::${script}`);
  git(repo, "config", "protocol.ext.allow", "always");
  await startApp({ open: [repo] });
  await (await openBranches(page)).getByRole("menuitem", { name: "Fetch" }).click();
  const cancel = page.getByRole("button", { name: "Cancel Fetching acme-billing" });
  await expect(cancel).toBeVisible();
  await cancel.click();
  await expect(page.getByRole("progressbar", { name: "Fetching acme-billing" })).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: "Fetch failed" })).toHaveCount(0);
});

test("the target sets what Changes compares, and Commit offers only uncommitted files", async ({
  page,
  workspace,
  startApp,
}) => {
  const { repo } = withRemote(workspace);
  workspace.write(repo, "Totals.kt", "val total = 1\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "Totals");
  git(repo, "push", "-q", "origin", "main");
  git(repo, "switch", "-q", "-c", "gs/export");
  workspace.write(repo, "Totals.kt", "val total = 2\n");
  git(repo, "commit", "-q", "-am", "Change totals on the branch");
  git(repo, "branch", "release");
  git(repo, "switch", "-q", "main");
  workspace.write(repo, "Main.kt", "fun main() = 1\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "Main moves on");
  git(repo, "switch", "-q", "gs/export");
  workspace.write(repo, "Notes.kt", "val notes = 1\n");
  await startApp({ open: [repo] });
  const tree = changesTree(page);
  await expect(tree.getByRole("treeitem", { name: "Totals.kt" })).toBeVisible();
  await expect(tree.getByRole("treeitem", { name: "Notes.kt" })).toBeVisible();
  await expect(tree.getByRole("treeitem", { name: "Main.kt" })).toHaveCount(0);
  await tree.getByRole("treeitem", { name: "Totals.kt" }).click();
  await expect(page.getByLabel("Before")).toContainText("val total = 1");
  await expect(page.getByLabel("After")).toContainText("val total = 2");

  await page.keyboard.press("Meta+k");
  const dialog = page.getByRole("dialog", { name: "Commit Changes" });
  await expect(dialog.getByRole("checkbox", { name: "Notes.kt" })).toBeVisible();
  await expect(dialog.getByRole("checkbox", { name: "Totals.kt" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Target branch" }).click();
  const picker = page.getByRole("dialog", { name: "Target branch" });
  await expect(picker.getByRole("option").first()).toHaveText(/main\s*default/);
  await expect(picker.getByRole("option").nth(1)).toHaveText("origin/main");
  await picker.getByRole("option", { name: "release" }).click();
  await expect(page.getByRole("button", { name: "Target branch" })).toContainText("release");
  await expect(tree.getByRole("treeitem", { name: "Totals.kt" })).toHaveCount(0);
  await expect(tree.getByRole("treeitem", { name: "Notes.kt" })).toBeVisible();
});

test("on the default branch the target is marked as an error and the picker offers only other branches", async ({
  page,
  workspace,
  startApp,
}) => {
  const repo = workspace.repo("acme-billing");
  workspace.write(repo, "a.txt", "a\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "Add a");
  git(repo, "branch", "develop");
  await startApp({ open: [repo] });
  const target = page.getByRole("button", { name: "Target branch" });
  await expect(target).toContainText("main");
  await expect(target).toHaveClass(/is-error/);
  await expect(target).toHaveAttribute(
    "title",
    "The target is the current branch. Pick another target.",
  );
  await page.getByRole("tab", { name: "Branch log" }).click();
  await expect(
    page.getByRole("listbox", { name: "Branch commits" }).getByRole("option"),
  ).toHaveText([/Add a/, /Initial commit/]);
  await page.getByRole("tab", { name: "Changes" }).click();
  await page.getByRole("button", { name: "Target branch" }).click();
  const picker = page.getByRole("dialog", { name: "Target branch" });
  await expect(picker.getByRole("option")).toHaveText(["develop"]);
});

test("Rollback restores the ticked files and keeps the others", async ({
  page,
  workspace,
  startApp,
}) => {
  const repo = workspace.repo("acme-billing");
  workspace.write(repo, "a.txt", "one\n");
  workspace.write(repo, "b.txt", "one\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "Add files");
  workspace.write(repo, "a.txt", "two\n");
  workspace.write(repo, "b.txt", "two\n");
  workspace.write(repo, "added.txt", "new\n");
  git(repo, "add", "added.txt");
  await startApp({ open: [repo] });
  await changesTree(page).getByRole("treeitem", { name: "a.txt", exact: true }).click();
  await page.getByRole("button", { name: "Rollback…" }).click();
  const dialog = page.getByRole("dialog", { name: "Rollback Changes" });
  await expect(dialog.getByRole("checkbox", { name: "a.txt" })).toBeChecked();
  await expect(dialog.getByRole("checkbox", { name: "b.txt" })).not.toBeChecked();
  await dialog.getByRole("checkbox", { name: "added.txt" }).check({ force: true });
  await dialog
    .getByRole("checkbox", { name: "Delete local copies of added files" })
    .check({ force: true });
  await dialog.getByRole("button", { name: "Rollback" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    changesTree(page).getByRole("treeitem", { name: "b.txt", exact: true }),
  ).toBeVisible();
  await expect(changesTree(page).getByRole("treeitem", { name: "a.txt", exact: true })).toHaveCount(
    0,
  );
  expect(readFileSync(join(repo, "a.txt"), "utf8")).toBe("one\n");
  expect(readFileSync(join(repo, "b.txt"), "utf8")).toBe("two\n");
  expect(git(repo, "status", "--porcelain")).toBe("M b.txt");
});
