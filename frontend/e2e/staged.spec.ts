import { execFileSync } from "node:child_process";
import { expect, git, test } from "./fixtures";

const staged = "# Notes\n\nFirst line.\n";
const edited = `${staged}\nAdded after staging.\n`;

test("a file staged and edited again shows the staged part and the later edit apart", async ({
  page,
  workspace,
  startApp,
}) => {
  const repo = workspace.repo("acme-billing");
  workspace.write(repo, "notes_v1.md", staged);
  git(repo, "add", "notes_v1.md");
  workspace.write(repo, "notes_v1.md", edited);
  await startApp({ open: [repo] });

  const tree = page.getByRole("tree", { name: "Changed files" });
  await expect(tree.getByRole("treeitem", { name: /^Staged/ })).toContainText("1 file");
  await expect(tree.getByRole("treeitem", { name: /^Changes/ })).toContainText("1 file");

  await tree.getByRole("treeitem", { name: "notes_v1.md, staged" }).click();
  await expect(
    page.locator(".dl-md-block.is-inserted").filter({ hasText: "First line." }),
  ).toHaveCount(1);
  await expect(page.getByText("Added after staging.")).toHaveCount(0);

  await tree.getByRole("treeitem", { name: "notes_v1.md", exact: true }).click();
  await expect(page.locator(".dl-filehead-title").first()).toHaveText("Staged version");
  const inserted = page.locator(".dl-md-block.is-inserted");
  await expect(inserted).toHaveCount(1);
  await expect(inserted).toContainText("Added after staging.");

  await page.getByRole("button", { name: "Raw", exact: true }).click();
  const diff = page.getByRole("region", { name: "Side-by-side diff" });
  await expect(diff.getByLabel("Before")).toContainText("First line.");
  await expect(diff.getByLabel("Before")).not.toContainText("Added after staging.");
  await expect(diff.getByLabel("After")).toContainText("Added after staging.");
  await expect(page.getByText("1 difference", { exact: true })).toBeVisible();
});

test("committing the staged row commits the staged version and keeps the later edit", async ({
  page,
  workspace,
  startApp,
}) => {
  const repo = workspace.repo("acme-billing");
  workspace.write(repo, "notes_v1.md", staged);
  git(repo, "add", "notes_v1.md");
  workspace.write(repo, "notes_v1.md", edited);
  await startApp({ open: [repo] });

  await page.getByRole("button", { name: "Commit… ⌘K" }).click();
  const dialog = page.getByRole("dialog", { name: "Commit Changes" });
  await expect(dialog.getByRole("checkbox", { name: "notes_v1.md, staged" })).toBeChecked();
  await expect(
    dialog.getByRole("checkbox", { name: "notes_v1.md", exact: true }),
  ).not.toBeChecked();
  await dialog.getByRole("textbox", { name: "Commit message" }).fill("Add notes");
  await dialog.getByRole("button", { name: "Commit", exact: true }).click();
  await expect(dialog).toHaveCount(0);

  const tree = page.getByRole("tree", { name: "Changed files" });
  await expect(tree.getByRole("treeitem", { name: /^Staged/ })).toHaveCount(0);
  await expect(tree.getByRole("treeitem", { name: "notes_v1.md", exact: true })).toBeVisible();
  const committed = execFileSync("git", ["show", "HEAD:notes_v1.md"], { cwd: repo }).toString();
  expect(committed).toBe(staged);
});
