import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, git, test, type Workspace } from "./fixtures";

function conflicting(workspace: Workspace): { repo: string; remote: string } {
  const repo = workspace.repo("acme-billing");
  const remote = join(workspace.dir, "remote.git");
  git(workspace.dir, "init", "-q", "--bare", "-b", "main", remote);
  git(repo, "remote", "add", "origin", remote);
  workspace.write(repo, "Totals.kt", "val rounding = 1\n");
  workspace.write(repo, "legacy.yaml", "export: old\n");
  workspace.write(repo, "notes.md", "notes\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "Base");
  git(repo, "push", "-q", "-u", "origin", "main");
  git(repo, "switch", "-q", "-c", "gs/invoice-export");
  workspace.write(repo, "Totals.kt", "val rounding = 2\n");
  git(repo, "rm", "-q", "legacy.yaml");
  git(repo, "commit", "-q", "-am", "Ours");
  git(repo, "switch", "-q", "main");
  workspace.write(repo, "Totals.kt", "val rounding = 3\n");
  workspace.write(repo, "legacy.yaml", "export: new\n");
  workspace.write(repo, "notes.md", "notes from main\n");
  git(repo, "commit", "-q", "-am", "Theirs");
  git(repo, "push", "-q", "origin", "main");
  git(repo, "reset", "-q", "--hard", "HEAD~1");
  git(repo, "switch", "-q", "gs/invoice-export");
  return { repo, remote };
}

async function mergeMain(page: Page) {
  await page.getByRole("button", { name: "Current branch" }).click();
  await page.getByRole("menuitem", { name: "Merge main into gs/invoice-export" }).click();
}

const banner = (page: Page) => page.locator(".app-editor-notice .dl-banner");

test("merging main stops on conflicts, the dialog accepts sides and the merge commits and pushes", async ({
  page,
  workspace,
  startApp,
}) => {
  const { repo, remote } = conflicting(workspace);
  await startApp({ open: [repo] });
  await mergeMain(page);

  const dialog = page.getByRole("dialog", { name: "Conflicts" });
  await expect(dialog).toContainText("Merging main into gs/invoice-export stopped on 2 files.");
  await expect(dialog.getByRole("option")).toHaveText([
    /legacy\.yaml\s*Deleted\s*Modified/,
    /Totals\.kt\s*Modified\s*Modified/,
  ]);
  await expect(page.locator(".dl-statusbar")).toContainText("Merging main");
  const tree = page.getByRole("tree", { name: "Changed files" });
  await expect(tree.getByRole("treeitem", { name: /Merge Conflicts/ })).toBeVisible();

  await dialog.getByRole("option", { name: "Totals.kt" }).click({ modifiers: ["Meta"] });
  await expect(dialog.getByRole("option", { selected: true })).toHaveCount(2);
  await dialog.getByRole("option", { name: "legacy.yaml" }).click();
  await expect(dialog.getByRole("option", { selected: true })).toHaveCount(1);
  await dialog.getByRole("button", { name: "Accept Theirs" }).click();
  await expect(dialog.getByRole("option")).toHaveCount(1);
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(banner(page)).toHaveText(
    /Merging main into gs\/invoice-export: 1 file has conflicts\./,
  );
  await tree.getByRole("treeitem", { name: "Totals.kt" }).click();
  await expect(
    page.getByRole("region", { name: "Editor" }).getByRole("region", { name: "Merge" }),
  ).toBeVisible();

  await banner(page).getByRole("button", { name: "Resolve" }).click();
  await dialog.getByRole("button", { name: "Accept Yours" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(banner(page)).toHaveText(/All conflicts are resolved/);

  await banner(page).getByRole("button", { name: "Commit merge" }).click();
  const commit = page.getByRole("dialog", { name: "Commit Merge" });
  await expect(commit.getByRole("textbox", { name: "Commit message" })).toHaveValue(
    "Merge remote-tracking branch 'origin/main' into gs/invoice-export",
  );
  await expect(commit.getByRole("region", { name: "Merged files" })).toContainText("legacy.yaml");
  await commit.getByRole("button", { name: "Commit and Push" }).click();
  await expect(banner(page)).toHaveText(/Pushed 2 commits to origin\/gs\/invoice-export/);
  await expect(page.locator(".dl-statusbar")).not.toContainText("Merging");
  expect(
    git(remote, "rev-list", "--parents", "-n", "1", "gs/invoice-export").split(" "),
  ).toHaveLength(3);
  expect(git(repo, "show", "HEAD:Totals.kt")).toBe("val rounding = 2");
  expect(git(repo, "show", "HEAD:legacy.yaml")).toBe("export: new");
});

test("aborting a merge restores the branch", async ({ page, workspace, startApp }) => {
  const { repo } = conflicting(workspace);
  const before = git(repo, "rev-parse", "HEAD");
  await startApp({ open: [repo] });
  await mergeMain(page);
  await page
    .getByRole("dialog", { name: "Conflicts" })
    .getByRole("button", { name: "Close" })
    .click();
  await banner(page).getByRole("button", { name: "Abort merge" }).click();
  const confirm = page.getByRole("dialog", { name: "Abort Merge" });
  await expect(confirm).toContainText("Abort the merge of main into gs/invoice-export?");
  await confirm.getByRole("button", { name: "Abort Merge" }).click();
  await expect(banner(page)).toHaveCount(0);
  await expect(
    page
      .getByRole("tree", { name: "Changed files" })
      .getByRole("treeitem", { name: /Merge Conflicts/ }),
  ).toHaveCount(0);
  expect(git(repo, "rev-parse", "HEAD")).toBe(before);
  expect(git(repo, "status", "--porcelain")).toBe("");
});

test("local changes that the merge would overwrite block it and are shown", async ({
  page,
  workspace,
  startApp,
}) => {
  const { repo } = conflicting(workspace);
  git(repo, "switch", "-q", "-c", "gs/notes", "main");
  workspace.write(repo, "notes.md", "my local notes\n");
  await startApp({ open: [repo] });
  await page.getByRole("button", { name: "Current branch" }).click();
  await page.getByRole("menuitem", { name: "Merge main into gs/notes" }).click();
  await expect(banner(page)).toHaveText(
    /Merge blocked: merging main would overwrite your local changes to notes\.md\. Commit them first, then merge again\./,
  );
  await banner(page).getByRole("button", { name: "Show files" }).click();
  await expect(
    page.getByRole("tree", { name: "Changed files" }).getByRole("treeitem", { name: "notes.md" }),
  ).toHaveAttribute("aria-selected", "true");
  await banner(page).getByRole("button", { name: "Commit…" }).click();
  await expect(page.getByRole("dialog", { name: "Commit Changes" })).toBeVisible();
});

test("a clean merge offers to push", async ({ page, workspace, startApp }) => {
  const { repo } = conflicting(workspace);
  git(repo, "switch", "-q", "-c", "gs/clean", "main");
  workspace.write(repo, "clean.txt", "c\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "Clean");
  await startApp({ open: [repo] });
  await page.getByRole("button", { name: "Current branch" }).click();
  await page.getByRole("menuitem", { name: "Merge main into gs/clean" }).click();
  await expect(banner(page)).toHaveText(/Merged main into gs\/clean\./);
  await banner(page).getByRole("button", { name: "Push…" }).click();
  await expect(banner(page)).toHaveText(/Pushed 2 commits to origin\/gs\/clean/);
});

async function aiControls(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [
      ...document.querySelectorAll(
        "button, [role=button], [role=menuitem], [role=option], [role=tab]",
      ),
    ]
      .map(
        (control) =>
          `${control.getAttribute("aria-label") ?? ""} ${control.getAttribute("title") ?? ""} ${control.textContent ?? ""}`,
      )
      .filter((label) => /\bAI\b/.test(label)),
  );
}

test("no screen offers AI", async ({ page, workspace, startApp }) => {
  const { repo } = conflicting(workspace);
  await startApp({ open: [repo] });
  const noAi = async () => {
    expect(await aiControls(page)).toEqual([]);
    await expect(page.getByRole("region", { name: "AI", exact: true })).toHaveCount(0);
  };
  await page.getByRole("treeitem", { name: /Totals\.kt/ }).click();
  await page.getByRole("region", { name: "Side-by-side diff" }).waitFor();
  await noAi();
  await page.getByRole("tab", { name: "Branch log" }).click();
  await page.getByRole("option", { name: /Ours/ }).click();
  await noAi();
  await page.getByRole("tab", { name: "Changes" }).click();

  await page.keyboard.press("Meta+Comma");
  const settings = page.getByRole("dialog", { name: "Settings" });
  await expect(
    settings.getByRole("listbox", { name: "Settings sections" }).getByRole("option"),
  ).toHaveText(["Diff", "Updates"]);
  await noAi();
  await settings.getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Settings menu" }).click();
  await page.getByRole("menuitem", { name: "About Diffloupe" }).click();
  const about = page.getByRole("dialog", { name: "About Diffloupe" });
  await expect(about).not.toContainText(/\bAI\b|Claude|personal build/);
  await about.getByRole("button", { name: "Close", exact: true }).click();

  await mergeMain(page);
  const dialog = page.getByRole("dialog", { name: "Conflicts" });
  await dialog.getByRole("option", { name: "Totals.kt" }).waitFor();
  await noAi();
  await dialog.getByRole("option", { name: "Totals.kt" }).click();
  await dialog.getByRole("button", { name: "Merge…" }).click();
  await page
    .getByRole("dialog", { name: "Merge Revisions" })
    .getByRole("region", { name: "Merge" })
    .waitFor();
  await noAi();
});
