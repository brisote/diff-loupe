import { expect, git, test, type Workspace } from "./fixtures";

function repoWith(workspace: Workspace, files: Record<string, [string, string]>): string {
  const repo = workspace.repo("search-repo");
  for (const [path, [before]] of Object.entries(files)) workspace.write(repo, path, before);
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "Before");
  for (const [path, [, after]] of Object.entries(files)) workspace.write(repo, path, after);
  return repo;
}

test("opens diff search with Mod+F, finds matches, navigates, and closes with Escape", async ({
  page,
  workspace,
  startApp,
}) => {
  const repo = repoWith(workspace, {
    "src/calc.rs": [
      "fn calculate() {\n  let total = 0;\n  total\n}\n",
      "fn calculate() {\n  let total = 10;\n  let grand_total = total;\n}\n",
    ],
  });
  await startApp({ open: [repo] });
  await page.getByRole("treeitem", { name: "src/calc.rs" }).click();
  await expect(page.getByRole("region", { name: "Side-by-side diff" })).toBeVisible();

  await expect(page.locator(".dl-diff-search")).not.toBeVisible();
  await page.keyboard.press("ControlOrMeta+f");
  const searchBar = page.locator(".dl-diff-search");
  await expect(searchBar).toBeVisible();

  const input = page.getByRole("textbox", { name: "Search diff" });
  await expect(input).toBeFocused();

  await input.fill("total");
  const counter = page.locator(".dl-diff-search-count");
  await expect(counter).toHaveText("1 of 5");
  await expect(page.locator(".dl-search-match")).toHaveCount(5);
  await expect(page.locator(".dl-search-match.is-current")).toHaveCount(1);

  await page.keyboard.press("Enter");
  await expect(counter).toHaveText("2 of 5");

  await page.getByRole("button", { name: "Next Match Enter" }).click();
  await expect(counter).toHaveText("3 of 5");

  await page.getByRole("button", { name: "Previous Match ⇧Enter" }).click();
  await expect(counter).toHaveText("2 of 5");

  await page.keyboard.press("Shift+Enter");
  await expect(counter).toHaveText("1 of 5");

  const caseBtn = page.getByRole("button", { name: "Match Case ⌥C" });
  await caseBtn.click();
  await expect(caseBtn).toHaveClass(/is-toggled/);

  await input.fill("Total");
  await expect(counter).toHaveText("0 of 0");
  await expect(counter).toHaveClass(/is-empty/);
  await expect(page.locator(".dl-search-match")).toHaveCount(0);

  await page.keyboard.press("Escape");
  await expect(searchBar).not.toBeVisible();
});

test("searches and navigates in unified diff mode", async ({ page, workspace, startApp }) => {
  const repo = repoWith(workspace, {
    "src/calc.rs": [
      "fn calculate() {\n  let total = 0;\n}\n",
      "fn calculate() {\n  let total = 10;\n}\n",
    ],
  });
  await startApp({ open: [repo] });
  await page.getByRole("treeitem", { name: "src/calc.rs" }).click();
  await page.getByRole("button", { name: "Unified viewer" }).click();
  await expect(page.getByRole("region", { name: "Unified diff" })).toBeVisible();

  await page.keyboard.press("ControlOrMeta+f");
  const searchBar = page.locator(".dl-diff-search");
  await expect(searchBar).toBeVisible();

  const input = page.getByRole("textbox", { name: "Search diff" });
  await input.fill("calculate");
  const counter = page.locator(".dl-diff-search-count");
  await expect(counter).toHaveText("1 of 1");
  await expect(page.locator(".dl-search-match")).toHaveCount(1);

  await page.getByRole("button", { name: "Close ⎋" }).click();
  await expect(searchBar).not.toBeVisible();
});

test("searches in rendered markdown diff", async ({ page, workspace, startApp }) => {
  const repo = repoWith(workspace, {
    "README.md": [
      "# Documentation\n\nOld overview of the system.\n",
      "# Documentation\n\nNew overview of the system.\n",
    ],
  });
  await startApp({ open: [repo] });
  await page.getByRole("treeitem", { name: "README.md" }).click();
  await expect(page.getByRole("region", { name: "Rendered side-by-side diff" })).toBeVisible();

  await page.keyboard.press("ControlOrMeta+f");
  const searchBar = page.locator(".dl-diff-search");
  await expect(searchBar).toBeVisible();

  const input = page.getByRole("textbox", { name: "Search diff" });
  await input.fill("overview");
  const counter = page.locator(".dl-diff-search-count");
  await expect(counter).toHaveText("1 of 2");

  await page.keyboard.press("Escape");
  await expect(searchBar).not.toBeVisible();
});
