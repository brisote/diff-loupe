import { expect, git, test } from "./fixtures";

function setupTabsRepo(workspace: import("./fixtures").Workspace) {
  const repo = workspace.repo("acme-billing");
  workspace.write(repo, "src/calc.rs", "fn calc() -> i32 { 1 }\n");
  workspace.write(repo, "src/model.rs", "struct Model;\n");
  workspace.write(repo, "README.md", "# Readme\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "Initial commit");
  git(repo, "switch", "-q", "-c", "gs/test-tabs");
  workspace.write(repo, "src/calc.rs", "fn calc() -> i32 { 2 }\n");
  workspace.write(repo, "src/model.rs", "struct Model { id: u64 }\n");
  workspace.write(repo, "README.md", "# Readme updated\n");
  return repo;
}

test("multi-tab opening, switching, and closing in editor island", async ({
  page,
  workspace,
  startApp,
}) => {
  const repo = setupTabsRepo(workspace);
  await startApp({ open: [repo] });

  const tree = page.getByRole("tree", { name: "Changed files" });
  await tree.getByRole("treeitem", { name: /calc.rs/ }).click();

  const tabsHeader = page.getByRole("tablist", { name: "Editor tabs" });
  await expect(tabsHeader.getByRole("tab")).toHaveCount(1);
  await expect(tabsHeader.getByRole("tab", { name: /calc.rs/ })).toHaveClass(/is-selected/);

  await tree.getByRole("treeitem", { name: /model.rs/ }).click({ button: "right" });
  const menu = page.getByRole("menu", { name: "File actions" });
  await expect(menu).toBeVisible();
  await menu.getByRole("menuitem", { name: "Open in New Tab" }).click();

  await expect(tabsHeader.getByRole("tab")).toHaveCount(2);
  await expect(tabsHeader.getByRole("tab", { name: /model.rs/ })).toHaveClass(/is-selected/);
  await expect(tabsHeader.getByRole("tab", { name: /calc.rs/ })).not.toHaveClass(/is-selected/);

  await tree.getByRole("treeitem", { name: /calc.rs/ }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Open in New Tab" }).click();
  await expect(tabsHeader.getByRole("tab")).toHaveCount(2);
  await expect(tabsHeader.getByRole("tab", { name: /calc.rs/ })).toHaveClass(/is-selected/);

  await tabsHeader.getByRole("tab", { name: /model.rs/ }).click();
  await expect(tabsHeader.getByRole("tab", { name: /model.rs/ })).toHaveClass(/is-selected/);

  await tree.getByRole("treeitem", { name: /README.md/ }).click();
  await expect(tabsHeader.getByRole("tab")).toHaveCount(2);
  await expect(tabsHeader.getByRole("tab", { name: /README.md/ })).toHaveClass(/is-selected/);

  const modelClose = tabsHeader
    .getByRole("tab", { name: /README.md/ })
    .getByRole("button", { name: "Close tab" });
  await modelClose.click();

  await expect(tabsHeader.getByRole("tab")).toHaveCount(1);
  await expect(tabsHeader.getByRole("tab", { name: /calc.rs/ })).toHaveClass(/is-selected/);

  const calcClose = tabsHeader
    .getByRole("tab", { name: /calc.rs/ })
    .getByRole("button", { name: "Close tab" });
  await calcClose.click();

  await expect(tabsHeader.getByRole("tab")).toHaveCount(0);
  await expect(page.getByText("Select a file to see its changes")).toBeVisible();
});
