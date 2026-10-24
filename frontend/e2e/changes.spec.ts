import { rmSync } from "node:fs";
import { join } from "node:path";
import { expect, git, test } from "./fixtures";

function changedRepo(workspace: import("./fixtures").Workspace) {
  const repo = workspace.repo("acme-billing");
  workspace.write(repo, "billing/InvoiceExporter.kt", "class InvoiceExporter\n");
  workspace.write(repo, "config/legacy-export.yaml", "a: 1\n");
  workspace.write(repo, "old name.md", "same\n");
  workspace.write(repo, ".gitignore", "build/\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "Add billing");
  git(repo, "switch", "-q", "-c", "gs/invoice-export");
  workspace.write(repo, "billing/InvoiceExporter.kt", "class InvoiceExporter(val csv: Boolean)\n");
  rmSync(join(repo, "config/legacy-export.yaml"));
  git(repo, "mv", "old name.md", "new name.md");
  workspace.write(repo, "web/src/exportButton.tsx", "export {}\n");
  git(repo, "add", "web/src/exportButton.tsx");
  workspace.write(repo, "docs/export notes.md", "notes\n");
  workspace.write(repo, "build/out.bin", "ignored\n");
  return repo;
}

test("the Changes list matches the repository", async ({ page, workspace, startApp }) => {
  const repo = changedRepo(workspace);
  await startApp({ open: [repo] });
  const tree = page.getByRole("tree", { name: "Changed files" });
  await expect(tree.getByRole("treeitem", { name: /^Staged/ })).toContainText("2 files");
  await expect(tree.getByRole("treeitem", { name: /^Changes/ })).toContainText("2 files");
  for (const path of ["new name.md, staged", "web/src/exportButton.tsx, staged"]) {
    await expect(tree.getByRole("treeitem", { name: path })).toBeVisible();
  }
  for (const path of ["billing/InvoiceExporter.kt", "config/legacy-export.yaml"]) {
    await expect(tree.getByRole("treeitem", { name: path, exact: true })).toBeVisible();
  }
  await expect(tree.getByRole("treeitem", { name: "new name.md, staged" })).toHaveAttribute(
    "title",
    "Renamed from old name.md",
  );
  await expect(tree.getByRole("treeitem", { name: /Unversioned Files/ })).toContainText("1 file");
  await expect(tree.getByRole("treeitem", { name: "docs/export notes.md" })).toBeVisible();
  await expect(tree.getByRole("treeitem", { name: "build/out.bin" })).toHaveCount(0);
  await expect(page.locator(".dl-statusbar")).toContainText("4 changes");
});

test("editing a file updates the list within one second", async ({ page, workspace, startApp }) => {
  const repo = workspace.repo("acme-billing");
  await startApp({ open: [repo] });
  await expect(page.getByText("No changes", { exact: true }).first()).toBeVisible();
  workspace.write(repo, "README.md", "# changed\n");
  await expect(page.getByRole("treeitem", { name: "README.md" })).toBeVisible({ timeout: 1000 });
  workspace.write(repo, "draft.txt", "new\n");
  await expect(page.getByRole("treeitem", { name: "draft.txt" })).toBeVisible({ timeout: 1000 });
});

test("files in ignored folders do not refresh the list", async ({ page, workspace, startApp }) => {
  const repo = workspace.repo("acme-billing");
  workspace.write(repo, ".gitignore", "target/\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "Ignore target");
  workspace.write(repo, "target/keep", "x\n");
  const app = await startApp({ open: [repo] });
  await expect(page.getByText("No changes", { exact: true }).first()).toBeVisible();
  await page.waitForTimeout(400);
  const listener = await app.bridge.listen();
  workspace.write(repo, "target/debug/app", "binary\n");
  await page.waitForTimeout(800);
  listener.close();
  expect(
    listener.events.filter((event) => (event as { type: string }).type === "repoChanged"),
  ).toEqual([]);
});

test("the selection and keys are remembered and unversioned files always show", async ({
  page,
  workspace,
  startApp,
}) => {
  const repo = changedRepo(workspace);
  const app = await startApp({ open: [repo] });
  const tree = page.getByRole("tree", { name: "Changed files" });
  await tree.getByRole("treeitem", { name: "new name.md" }).click();
  await expect(page.locator(".dl-statusbar")).toContainText("acme-billing › new name.md");
  await expect(page.locator(".app-editor-tabs")).toContainText("new name.md");
  await expect(page.getByRole("region", { name: "Side-by-side diff" })).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await expect(tree.getByRole("treeitem", { name: "web/src/exportButton.tsx" })).toHaveAttribute(
    "aria-selected",
    "true",
  );

  await expect(page.getByRole("button", { name: "Show unversioned files" })).toHaveCount(0);

  await app.restart();
  await expect(tree.getByRole("treeitem", { name: "web/src/exportButton.tsx" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(tree.getByRole("treeitem", { name: /Unversioned Files/ })).toHaveCount(1);
});
